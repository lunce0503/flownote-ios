import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { navigationAction, parseExport, resolveWebOrigin, type WebExport } from '@/lib/web-shell-policy';
import { pencilBridgeScript } from '@/lib/apple-pencil-bridge';
import { addApplePencilDoubleTapListener } from '@/modules/apple-pencil-events';
import { createPdfExportReceiver, isPdfExportMessage, pdfStatusScript } from '@/lib/pdf-export-protocol';

export default function InstalledWebApp() {
  const web = useRef<WebView>(null);
  const currentUrl = useRef('');
  const exportBusy = useRef(false);
  const externalBusy = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  let origin: string | null = null;
  try { origin = resolveWebOrigin(process.env.EXPO_PUBLIC_WEB_URL); }
  catch { /* Render the fixed configuration error after installing all hooks. */ }

  const pdfReceiver = useRef<ReturnType<typeof createPdfExportReceiver> | null>(null);
  if (!pdfReceiver.current) pdfReceiver.current = createPdfExportReceiver({
    confirm: (name, bytes) => new Promise(resolve => {
      if (exportBusy.current) { resolve(false); return; }
      Alert.alert('PDF 내보내기', `${name} (${(bytes / 1024 / 1024).toFixed(1)}MiB)\n공유 메뉴에서 ‘파일에 저장’을 선택하세요.`, [
        { text: '취소', style: 'cancel', onPress: () => resolve(false) },
        { text: '공유 / 저장', onPress: () => resolve(true) },
      ], { cancelable: true, onDismiss: () => resolve(false) });
    }),
    open: (name, id) => {
      const directory = new Directory(Paths.cache, `flownote-pdf-${id}`);
      directory.create({ intermediates: true, idempotent: true });
      try {
        const file = new File(directory, name); file.create();
        const handle = file.open(); let closed = false;
        return { uri: file.uri, append: bytes => handle.writeBytes(bytes),
          close: () => { if (!closed) { closed = true; handle.close(); } },
          remove: () => { if (directory.exists) directory.delete(); } };
      } catch (error) { if (directory.exists) directory.delete(); throw error; }
    },
    share: async (uri, name) => {
      if (!await Sharing.isAvailableAsync()) throw new Error('Sharing unavailable');
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: name });
    },
    notify: status => {
      if (navigationAction(currentUrl.current, resolveWebOrigin(process.env.EXPO_PUBLIC_WEB_URL)) === 'internal') web.current?.injectJavaScript(pdfStatusScript(status));
    },
  });
  useEffect(() => () => { pdfReceiver.current?.cancel(); }, []);

  useEffect(() => {
    const subscription = addApplePencilDoubleTapListener(({ action }) => {
      if (!origin || navigationAction(currentUrl.current, origin) !== 'internal') return;
      try { web.current?.injectJavaScript(pencilBridgeScript(action)); }
      catch { /* Native event payloads outside the fixed action list are ignored. */ }
    });
    return () => subscription.remove();
  }, [origin]);

  if (!origin) return <SafeAreaView style={styles.root}><Text style={styles.message}>앱 연결 설정을 확인할 수 없습니다. 새 버전을 설치해 주세요.</Text></SafeAreaView>;

  const openExternal = (url: string) => {
    if (navigationAction(url, origin) !== 'external' || externalBusy.current) return;
    externalBusy.current = true;
    Alert.alert('외부 링크', '이 링크를 앱 밖에서 여시겠습니까?', [
      { text: '취소', style: 'cancel', onPress: () => { externalBusy.current = false; } },
      { text: '열기', onPress: () => {
        externalBusy.current = false;
        void Linking.openURL(url).catch(() => Alert.alert('링크를 열 수 없습니다.'));
      } },
    ], { onDismiss: () => { externalBusy.current = false; } });
  };

  const share = async (file: WebExport) => {
    let directory: string | undefined;
    try {
      if (!FileSystem.cacheDirectory || !await Sharing.isAvailableAsync()) throw new Error('Sharing unavailable');
      directory = `${FileSystem.cacheDirectory}flownote-exports/${Date.now()}/`;
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      const uri = `${directory}${file.name}`;
      await FileSystem.writeAsStringAsync(uri, file.base64, { encoding: FileSystem.EncodingType.Base64 });
      await Sharing.shareAsync(uri, { mimeType: file.mime, dialogTitle: file.name });
    } catch { Alert.alert('파일 저장 실패', '공유 메뉴를 열지 못했습니다. 다시 시도해 주세요.'); }
    finally {
      if (directory) await FileSystem.deleteAsync(directory, { idempotent: true }).catch(() => {});
      exportBusy.current = false;
    }
  };

  const onMessage = (event: WebViewMessageEvent) => {
    if (navigationAction(currentUrl.current, origin) !== 'internal') return;
    if (isPdfExportMessage(event.nativeEvent.data)) {
      void pdfReceiver.current!.receive(event.nativeEvent.data, event.nativeEvent.url, origin).catch(() => {
        pdfReceiver.current?.cancel(); Alert.alert('PDF 저장 실패', '저장 공간을 확인한 뒤 다시 시도해 주세요.');
      }); return;
    }
    if (exportBusy.current || pdfReceiver.current?.busy) return;
    try {
      const file = parseExport(event.nativeEvent.data, event.nativeEvent.url, origin);
      exportBusy.current = true;
      Alert.alert('파일 내보내기', `${file.name}\n공유 메뉴에서 ‘파일에 저장’을 선택하세요.`, [
        { text: '취소', style: 'cancel', onPress: () => { exportBusy.current = false; } },
        { text: '공유 / 저장', onPress: () => { void share(file); } },
      ], { onDismiss: () => { exportBusy.current = false; } });
    } catch { Alert.alert('내보내기 불가', '지원하는 형식의 8MB 이하 파일만 저장할 수 있습니다.'); }
  };

  return <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
    <WebView ref={web} source={{ uri: origin }} style={styles.web}
      injectedJavaScriptBeforeContentLoaded="window.__flownotePdfExportV1=true;true;"
      injectedJavaScriptBeforeContentLoadedForMainFrameOnly
      applicationNameForUserAgent={`FlownoteIOS/${Constants.expoConfig?.version ?? '1.2.0'}`}
      // All schemes reach our fail-closed policy instead of being opened by WebView's OS fallback.
      originWhitelist={['*']}
      onShouldStartLoadWithRequest={(request) => {
        const action = navigationAction(request.url, origin);
        if (action === 'external' && request.isTopFrame !== false) openExternal(request.url);
        return action === 'internal';
      }}
      onOpenWindow={(event) => {
        const url = event.nativeEvent.targetUrl;
        if (navigationAction(url, origin) === 'internal') {
          web.current?.injectJavaScript(`window.location.assign(${JSON.stringify(url)});true;`);
        } else openExternal(url);
      }}
      onNavigationStateChange={(state) => { currentUrl.current = state.url; }}
      onLoadStart={(event) => {
        pdfReceiver.current?.cancel();
        currentUrl.current = event.nativeEvent.url; setLoading(true); setError(null);
      }}
      onLoadEnd={() => setLoading(false)}
      onError={(event) => {
        if (event.nativeEvent.code === -999) return; // WKNavigation cancellation is not a connection failure.
        setLoading(false); setError('인터넷 연결을 확인한 뒤 다시 시도해 주세요.');
      }}
      onHttpError={(event) => {
        if (event.nativeEvent.url === currentUrl.current && event.nativeEvent.statusCode >= 400) {
          setLoading(false); setError('서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        }
      }}
      onContentProcessDidTerminate={() => { pdfReceiver.current?.cancel(); setLoading(false); setError('앱 화면이 중지되었습니다. 다시 연결해 주세요.'); }}
      onMessage={onMessage}
      onFileDownload={() => Alert.alert('파일 저장', '노트·플래너의 내보내기 버튼을 이용해 파일을 저장해 주세요.')}
      incognito={false} cacheEnabled sharedCookiesEnabled={false}
      javaScriptEnabled domStorageEnabled
      allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
      javaScriptCanOpenWindowsAutomatically={false} mixedContentMode="never"
      mediaCapturePermissionGrantType="deny" webviewDebuggingEnabled={false}
      allowsInlineMediaPlayback allowsBackForwardNavigationGestures={false}
      allowsLinkPreview={false} bounces={false} pullToRefreshEnabled={false}
      automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never"
    />
    {loading && !error && <View pointerEvents="none" style={styles.loading}><ActivityIndicator color="#171714" accessibilityLabel="불러오는 중" /></View>}
    {error && <View style={styles.error} accessibilityRole="alert">
      <Text style={styles.message}>{error}</Text>
      <Pressable style={styles.retry} accessibilityRole="button" onPress={() => { setError(null); setLoading(true); web.current?.reload(); }}>
        <Text style={styles.retryText}>다시 연결</Text>
      </Pressable>
    </View>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f7f3e8' }, web: { flex: 1, backgroundColor: '#f7f3e8' },
  loading: { position: 'absolute', top: 12, right: 16, padding: 10, borderRadius: 24, backgroundColor: '#f7f3e8' },
  error: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 20, padding: 24, backgroundColor: '#f7f3e8' },
  message: { color: '#171714', textAlign: 'center', fontSize: 17, padding: 20 },
  retry: { minHeight: 48, paddingVertical: 14, paddingHorizontal: 24, backgroundColor: '#171714', borderRadius: 12 },
  retryText: { color: '#f7f3e8', fontSize: 16 },
});
