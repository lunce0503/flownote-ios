import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { useSession } from '@/context/session-context';

export default function ProtectedAppLayout() {
  const { token, loading } = useSession();

  if (loading) {
    return (
      <ThemedView style={styles.loading}>
        <ActivityIndicator size="large" color="#176B87" />
      </ThemedView>
    );
  }

  if (!token) {
    return <Redirect href="/login" />;
  }

  return (
    <Stack
      screenOptions={{
        headerBackTitle: '뒤로',
        headerTintColor: '#143241',
        headerStyle: { backgroundColor: '#F8FAFB' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: '#F8FAFB' },
      }}>
      <Stack.Screen name="home" options={{ title: 'Flownote', headerBackVisible: false }} />
      <Stack.Screen name="tasks/index" options={{ title: '작업 목록' }} />
      <Stack.Screen name="tasks/[taskId]" options={{ title: '작업 편집' }} />
      <Stack.Screen name="notes/index" options={{ title: '노트 목록' }} />
      <Stack.Screen name="notes/[noteId]" options={{ title: '노트 편집' }} />
      <Stack.Screen name="canvas/index" options={{ title: '캔버스 목록' }} />
      <Stack.Screen name="canvas/[canvasId]" options={{ title: '캔버스 편집' }} />
      <Stack.Screen name="agent" options={{ title: 'AI Agent' }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
