import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
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
import { flownoteApi, type Task } from '@/lib/flownote-api';

export default function TaskListScreen() {
  const router = useRouter();
  const { token } = useSession();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskName, setTaskName] = useState('');
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setTasks(await flownoteApi.listTasks(token));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '작업 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const createTask = async () => {
    const title = taskName.trim();
    if (!token || !title || creating) return;
    setCreating(true);
    setError(null);
    try {
      const created = await flownoteApi.createTask(token, {
        taskName: title,
        memo: 'Expo 모바일 앱에서 생성됨',
      });
      setTaskName('');
      setTasks((current) => [created, ...current]);
      router.push({ pathname: '/tasks/[taskId]', params: { taskId: created.id } });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '작업을 만들지 못했습니다.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <ThemedView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        <View style={styles.intro}>
          <ThemedText type="title" style={styles.title}>작업</ThemedText>
          <ThemedText style={styles.muted}>목록에서 작업을 선택하면 상세 정보와 상태를 편집할 수 있습니다.</ThemedText>
        </View>

        <View style={styles.createCard}>
          <TextInput
            accessibilityLabel="새 작업 제목"
            placeholder="새 작업 제목"
            placeholderTextColor="#7C8794"
            style={styles.input}
            value={taskName}
            onChangeText={setTaskName}
            onSubmitEditing={() => void createTask()}
            returnKeyType="done"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="새 작업 만들기"
            style={[styles.createButton, (!taskName.trim() || creating) && styles.disabled]}
            onPress={() => void createTask()}
            disabled={!taskName.trim() || creating}>
            {creating ? <ActivityIndicator color="#FFFFFF" /> : <MaterialIcons name="add" size={22} color="#FFFFFF" />}
            <ThemedText type="defaultSemiBold" style={styles.createButtonText}>만들기</ThemedText>
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

        {!loading && tasks.length === 0 ? (
          <View style={styles.emptyCard}>
            <MaterialIcons name="check-circle-outline" size={34} color="#7C8794" />
            <ThemedText type="defaultSemiBold">등록된 작업이 없습니다.</ThemedText>
            <ThemedText style={styles.muted}>위 입력창에서 첫 작업을 만들어 보세요.</ThemedText>
          </View>
        ) : (
          <View style={styles.list}>
            {tasks.map((task) => (
              <Pressable
                key={task.id}
                accessibilityRole="button"
                accessibilityLabel={`${task.taskName} 작업 편집`}
                style={({ pressed }) => [styles.taskCard, pressed && styles.pressed]}
                onPress={() => router.push({ pathname: '/tasks/[taskId]', params: { taskId: task.id } })}>
                <View style={[styles.statusDot, task.status === 'DONE' && styles.statusDotDone]} />
                <View style={styles.taskText}>
                  <ThemedText numberOfLines={1} type="defaultSemiBold" style={styles.taskTitle}>
                    {task.taskName || '제목 없는 작업'}
                  </ThemedText>
                  <ThemedText numberOfLines={1} style={styles.taskMeta}>
                    {task.category || '카테고리 없음'} · {task.status || 'TODO'}
                  </ThemedText>
                  {task.dueDate ? <ThemedText style={styles.taskMeta}>마감 {task.dueDate}</ThemedText> : null}
                </View>
                <MaterialIcons name="chevron-right" size={24} color="#52606D" />
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { width: '100%', maxWidth: 820, alignSelf: 'center', gap: 16, padding: 18, paddingBottom: 40 },
  intro: { gap: 5 },
  title: { color: '#143241' },
  muted: { color: '#66727D' },
  createCard: { flexDirection: 'row', gap: 10, borderRadius: 12, backgroundColor: '#FFFFFF', padding: 12 },
  input: { minWidth: 0, minHeight: 48, flex: 1, borderWidth: 1, borderColor: '#CED8DF', borderRadius: 8, color: '#17212B', fontSize: 16, paddingHorizontal: 12 },
  createButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 8, backgroundColor: '#176B87', paddingHorizontal: 14 },
  createButtonText: { color: '#FFFFFF' },
  disabled: { opacity: 0.5 },
  errorCard: { gap: 10, borderWidth: 1, borderColor: '#FECACA', borderRadius: 10, backgroundColor: '#FEF2F2', padding: 14 },
  errorText: { color: '#991B1B' },
  retryButton: { alignSelf: 'flex-start', borderRadius: 7, backgroundColor: '#991B1B', paddingHorizontal: 12, paddingVertical: 8 },
  retryText: { color: '#FFFFFF' },
  emptyCard: { minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: '#D7E0E7', borderRadius: 12, backgroundColor: '#FFFFFF', padding: 20 },
  list: { gap: 10 },
  taskCard: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#D7E0E7', borderRadius: 12, backgroundColor: '#FFFFFF', padding: 14 },
  pressed: { opacity: 0.72 },
  statusDot: { width: 14, height: 14, borderWidth: 2, borderColor: '#176B87', borderRadius: 7 },
  statusDotDone: { borderColor: '#1E7F57', backgroundColor: '#1E7F57' },
  taskText: { minWidth: 0, flex: 1, gap: 4 },
  taskTitle: { color: '#17212B', fontSize: 16 },
  taskMeta: { color: '#66727D', fontSize: 13 },
});
