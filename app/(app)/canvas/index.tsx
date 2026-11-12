import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useSession } from '@/context/session-context';
import { flownoteApi, type CanvasDocumentSummary, type CanvasFolder } from '@/lib/flownote-api';

export default function CanvasListScreen() {
  const router = useRouter();
  const { token } = useSession();
  const [documents, setDocuments] = useState<CanvasDocumentSummary[]>([]);
  const [folders, setFolders] = useState<CanvasFolder[]>([]);
  const [category, setCategory] = useState('');
  const [folderName, setFolderName] = useState('');
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const folderByCanvasId = useMemo(() => {
    const entries = folders.flatMap((folder) => folder.canvasIds.map((canvasId) => [canvasId, folder.id] as const));
    return new Map(entries);
  }, [folders]);
  const unfiled = useMemo(
    () => documents.filter((document) => !folderByCanvasId.has(document.id)),
    [documents, folderByCanvasId]
  );

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [nextDocuments, nextFolders] = await Promise.all([
        flownoteApi.listCanvasDocuments(token),
        flownoteApi.listCanvasFolders(token),
      ]);
      setDocuments(nextDocuments);
      setFolders(nextFolders);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '캔버스 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const openCanvas = (canvasId: string) => {
    router.push({ pathname: '/canvas/[canvasId]', params: { canvasId } });
  };

  const createCanvas = async (folderId?: string) => {
    if (!token || creating) return;
    setCreating(true);
    setError(null);
    try {
      const created = await flownoteApi.createCanvasDocument(token, `새 캔버스_${Date.now()}`);
      if (folderId) {
        await flownoteApi.addCanvasToFolder(token, folderId, created.id);
      }
      setDocuments((current) => [created, ...current]);
      openCanvas(created.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '캔버스를 만들지 못했습니다.');
    } finally {
      setCreating(false);
    }
  };

  const createFolder = async () => {
    if (!token || !folderName.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const created = await flownoteApi.createCanvasFolder(token, {
        category: category.trim(),
        name: folderName.trim(),
      });
      setFolders((current) => [created, ...current]);
      setCategory('');
      setFolderName('');
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '폴더를 만들지 못했습니다.');
    } finally {
      setCreating(false);
    }
  };

  const renderCanvasCard = (document: CanvasDocumentSummary) => (
    <Pressable
      key={document.id}
      accessibilityRole="button"
      accessibilityLabel={`${document.title} 캔버스 편집`}
      style={({ pressed }) => [styles.canvasCard, pressed && styles.pressed]}
      onPress={() => openCanvas(document.id)}>
      <View style={styles.canvasIcon}>
        <MaterialIcons name="draw" size={22} color="#7C3AED" />
      </View>
      <View style={styles.canvasText}>
        <ThemedText numberOfLines={1} type="defaultSemiBold" style={styles.canvasTitle}>
          {document.title || '제목 없는 캔버스'}
        </ThemedText>
        <ThemedText style={styles.canvasMeta}>선택하여 필기·요소 편집</ThemedText>
      </View>
      <MaterialIcons name="chevron-right" size={24} color="#52606D" />
    </Pressable>
  );

  return (
    <ThemedView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        <View style={styles.intro}>
          <ThemedText type="title" style={styles.title}>캔버스</ThemedText>
          <ThemedText style={styles.muted}>캔버스를 선택하면 하위 편집 화면에서 필기를 시작합니다.</ThemedText>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="새 캔버스 만들기"
          style={[styles.primaryButton, creating && styles.disabled]}
          onPress={() => void createCanvas()}
          disabled={creating}>
          {creating ? <ActivityIndicator color="#FFFFFF" /> : <MaterialIcons name="add" size={22} color="#FFFFFF" />}
          <ThemedText type="defaultSemiBold" style={styles.primaryButtonText}>새 캔버스</ThemedText>
        </Pressable>

        <View style={styles.folderForm}>
          <TextInput
            accessibilityLabel="캔버스 폴더 카테고리"
            placeholder="카테고리"
            placeholderTextColor="#7C8794"
            style={styles.input}
            value={category}
            onChangeText={setCategory}
          />
          <TextInput
            accessibilityLabel="캔버스 폴더 이름"
            placeholder="폴더 이름"
            placeholderTextColor="#7C8794"
            style={styles.input}
            value={folderName}
            onChangeText={setFolderName}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="캔버스 폴더 만들기"
            style={[styles.folderButton, (!folderName.trim() || creating) && styles.disabled]}
            onPress={() => void createFolder()}
            disabled={!folderName.trim() || creating}>
            <MaterialIcons name="create-new-folder" size={21} color="#FFFFFF" />
          </Pressable>
        </View>

        {error ? (
          <View style={styles.errorCard}>
            <ThemedText style={styles.errorText}>{error}</ThemedText>
            <Pressable style={styles.retryButton} onPress={() => void load()}>
              <ThemedText type="defaultSemiBold" style={styles.retryText}>다시 시도</ThemedText>
            </Pressable>
          </View>
        ) : null}

        {folders.map((folder) => {
          const folderDocuments = documents.filter((document) => folder.canvasIds.includes(document.id));
          return (
            <View key={folder.id} style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionTitleGroup}>
                  <MaterialIcons name="folder" size={22} color="#9A6700" />
                  <View style={styles.sectionTitleText}>
                    <ThemedText type="subtitle" numberOfLines={1}>{folder.name}</ThemedText>
                    <ThemedText style={styles.sectionMeta}>{folder.category || '카테고리 없음'} · {folderDocuments.length}개</ThemedText>
                  </View>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${folder.name}에 캔버스 추가`}
                  style={styles.addToFolderButton}
                  onPress={() => void createCanvas(folder.id)}>
                  <MaterialIcons name="add" size={20} color="#7C3AED" />
                </Pressable>
              </View>
              {folderDocuments.length > 0 ? folderDocuments.map(renderCanvasCard) : (
                <ThemedText style={styles.emptyText}>이 폴더에는 캔버스가 없습니다.</ThemedText>
              )}
            </View>
          );
        })}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleGroup}>
              <MaterialIcons name="schedule" size={22} color="#52606D" />
              <View style={styles.sectionTitleText}>
                <ThemedText type="subtitle">최근 캔버스</ThemedText>
                <ThemedText style={styles.sectionMeta}>폴더에 들어가지 않은 캔버스 {unfiled.length}개</ThemedText>
              </View>
            </View>
          </View>
          {unfiled.length > 0 ? unfiled.map(renderCanvasCard) : (
            <ThemedText style={styles.emptyText}>폴더 밖 캔버스가 없습니다.</ThemedText>
          )}
        </View>

        {!loading && documents.length === 0 ? (
          <View style={styles.emptyCard}>
            <MaterialIcons name="draw" size={36} color="#7C8794" />
            <ThemedText type="defaultSemiBold">저장된 캔버스가 없습니다.</ThemedText>
            <ThemedText style={styles.muted}>새 캔버스를 만든 뒤 편집 화면으로 이동하세요.</ThemedText>
          </View>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { width: '100%', maxWidth: 900, alignSelf: 'center', gap: 16, padding: 18, paddingBottom: 44 },
  intro: { gap: 5 },
  title: { color: '#143241' },
  muted: { color: '#66727D' },
  primaryButton: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 10, backgroundColor: '#7C3AED' },
  primaryButtonText: { color: '#FFFFFF' },
  disabled: { opacity: 0.5 },
  folderForm: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, borderWidth: 1, borderColor: '#D7E0E7', borderRadius: 12, backgroundColor: '#FFFFFF', padding: 12 },
  input: { minWidth: 130, minHeight: 46, flex: 1, borderWidth: 1, borderColor: '#CED8DF', borderRadius: 8, color: '#17212B', fontSize: 15, paddingHorizontal: 11 },
  folderButton: { width: 48, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: '#9A6700' },
  errorCard: { gap: 10, borderWidth: 1, borderColor: '#FECACA', borderRadius: 10, backgroundColor: '#FEF2F2', padding: 14 },
  errorText: { color: '#991B1B' },
  retryButton: { alignSelf: 'flex-start', borderRadius: 7, backgroundColor: '#991B1B', paddingHorizontal: 12, paddingVertical: 8 },
  retryText: { color: '#FFFFFF' },
  section: { gap: 9, borderWidth: 1, borderColor: '#D7E0E7', borderRadius: 12, backgroundColor: '#F8FAFB', padding: 12 },
  sectionHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  sectionTitleGroup: { minWidth: 0, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9 },
  sectionTitleText: { minWidth: 0, flex: 1, gap: 2 },
  sectionMeta: { color: '#66727D', fontSize: 12 },
  addToFolderButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#F3E8FF' },
  canvasCard: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 11, borderWidth: 1, borderColor: '#E1E6EA', borderRadius: 10, backgroundColor: '#FFFFFF', padding: 12 },
  pressed: { opacity: 0.72 },
  canvasIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#F3E8FF' },
  canvasText: { minWidth: 0, flex: 1, gap: 3 },
  canvasTitle: { color: '#17212B', fontSize: 16 },
  canvasMeta: { color: '#66727D', fontSize: 13 },
  emptyText: { color: '#7C8794', paddingVertical: 10, paddingHorizontal: 4 },
  emptyCard: { minHeight: 160, alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: '#D7E0E7', borderRadius: 12, backgroundColor: '#FFFFFF', padding: 20 },
});
