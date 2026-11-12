import { useEffect, useMemo, useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useSession } from '@/context/session-context';
import { flownoteApi, type MobileConfig } from '@/lib/flownote-api';

type AuthMode = 'login' | 'register';

export default function AccountScreen() {
  const router = useRouter();
  const { token, user, loading, login, logout, register } = useSession();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [nickname, setNickname] = useState('');
  const [config, setConfig] = useState<MobileConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  const endpoint = useMemo(() => flownoteApi.baseUrl(), []);

  useEffect(() => {
    let mounted = true;
    flownoteApi
      .getMobileConfig()
      .then((value) => {
        if (mounted) {
          setConfig(value);
          setConfigError(null);
        }
      })
      .catch((error: Error) => {
        if (mounted) {
          setConfigError(error.message);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const submit = async () => {
    try {
      if (mode === 'register') {
        await register({ username, email, password, nickname });
        await login(email, password);
        router.replace('/home');
        return;
      }

      await login(email, password);
      router.replace('/home');
    } catch (error) {
      Alert.alert('Flownote', error instanceof Error ? error.message : '로그인에 실패했습니다.');
    }
  };

  if (token && user) {
    return <Redirect href="/home" />;
  }

  return (
    <ThemedView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <ThemedText type="title" style={styles.title}>
            Flownote
          </ThemedText>
          <ThemedText style={styles.subtitle}>
            Expo 앱에서 Flownote 계정과 서버 데이터를 바로 사용합니다.
          </ThemedText>
        </View>

        <View style={styles.statusPanel}>
          <ThemedText type="defaultSemiBold">서버 연결</ThemedText>
          <ThemedText style={styles.muted}>{endpoint}</ThemedText>
          {config ? (
            <View style={styles.configRows}>
              <ThemedText style={styles.muted}>Core API: {config.coreApiUrl}</ThemedText>
              <ThemedText style={styles.muted}>AI API: {config.aiApiUrl}</ThemedText>
              <ThemedText style={styles.muted}>
                기능: {config.enabledFeatures.join(', ')}
              </ThemedText>
            </View>
          ) : (
            <ThemedText style={styles.errorText}>
              {configError ?? '서버 설정을 확인하는 중입니다.'}
            </ThemedText>
          )}
        </View>

        {user ? (
          <View style={styles.card}>
            <ThemedText type="subtitle">로그인됨</ThemedText>
            <ThemedText>{user.nickname}</ThemedText>
            <ThemedText style={styles.muted}>{user.email}</ThemedText>
            <Pressable style={styles.secondaryButton} onPress={logout}>
              <ThemedText type="defaultSemiBold" style={styles.secondaryButtonText}>
                로그아웃
              </ThemedText>
            </Pressable>
          </View>
        ) : (
          <View style={styles.card}>
            <View style={styles.segment}>
              <Pressable
                style={[styles.segmentButton, mode === 'login' && styles.segmentButtonActive]}
                onPress={() => setMode('login')}>
                <ThemedText
                  type="defaultSemiBold"
                  style={mode === 'login' ? styles.segmentTextActive : styles.segmentText}>
                  로그인
                </ThemedText>
              </Pressable>
              <Pressable
                style={[styles.segmentButton, mode === 'register' && styles.segmentButtonActive]}
                onPress={() => setMode('register')}>
                <ThemedText
                  type="defaultSemiBold"
                  style={mode === 'register' ? styles.segmentTextActive : styles.segmentText}>
                  회원가입
                </ThemedText>
              </Pressable>
            </View>

            {mode === 'register' ? (
              <>
                <TextInput
                  autoCapitalize="none"
                  placeholder="아이디"
                  placeholderTextColor="#7C8794"
                  style={styles.input}
                  value={username}
                  onChangeText={setUsername}
                />
                <TextInput
                  placeholder="닉네임"
                  placeholderTextColor="#7C8794"
                  style={styles.input}
                  value={nickname}
                  onChangeText={setNickname}
                />
              </>
            ) : null}

            <TextInput
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="이메일"
              placeholderTextColor="#7C8794"
              style={styles.input}
              value={email}
              onChangeText={setEmail}
            />
            <TextInput
              placeholder="비밀번호"
              placeholderTextColor="#7C8794"
              secureTextEntry
              style={styles.input}
              value={password}
              onChangeText={setPassword}
            />

            <Pressable style={styles.primaryButton} onPress={submit} disabled={loading}>
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <ThemedText type="defaultSemiBold" style={styles.primaryButtonText}>
                  {mode === 'login' ? 'Flownote 시작' : '계정 만들고 시작'}
                </ThemedText>
              )}
            </Pressable>
          </View>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
    gap: 18,
    padding: 20,
    paddingTop: 64,
  },
  header: {
    gap: 8,
  },
  title: {
    color: '#143241',
  },
  subtitle: {
    color: '#52606D',
  },
  statusPanel: {
    gap: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D5E1E8',
    backgroundColor: '#F7FAFC',
    padding: 16,
  },
  configRows: {
    gap: 4,
  },
  card: {
    gap: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E1E6EA',
    backgroundColor: '#FFFFFF',
    padding: 16,
  },
  segment: {
    flexDirection: 'row',
    borderRadius: 8,
    backgroundColor: '#EEF2F5',
    padding: 4,
  },
  segmentButton: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  segmentButtonActive: {
    backgroundColor: '#143241',
  },
  segmentText: {
    color: '#42505D',
  },
  segmentTextActive: {
    color: '#FFFFFF',
  },
  input: {
    minHeight: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CED8DF',
    backgroundColor: '#FFFFFF',
    color: '#17212B',
    fontSize: 16,
    paddingHorizontal: 12,
  },
  primaryButton: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#176B87',
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: '#FFFFFF',
  },
  secondaryButton: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#176B87',
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    color: '#176B87',
  },
  muted: {
    color: '#5C6670',
  },
  errorText: {
    color: '#B42318',
  },
});
