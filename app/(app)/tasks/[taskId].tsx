import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
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
import { flownoteApi, type Task } from '@/lib/flownote-api';

const numberOrNull = (value: string) => {
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

export default function TaskDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ taskId: string }>();
  const taskId = Array.isArray(params.taskId) ? params.taskId[0] : params.taskId;
  const { token } = useSession();
  const [task, setTask] = useState<Task | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [memo, setMemo] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [estimatedMinutes, setEstimatedMinutes] = useState('');
  const [actualMinutes, setActualMinutes] = useState('');
  const [tags, setTags] = useState('');
  const [status, setStatus] = useState('TODO');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyTask = useCallback((nextTask: Task) => {
    setTask(nextTask);
    setTitle(nextTask.taskName);
    setCategory(nextTask.category ?? '');
    setMemo(nextTask.memo ?? '');
    setDueDate(nextTask.dueDate ?? '');
    setDifficulty(nextTask.difficultyLevel?.toString() ?? '');
    setEstimatedMinutes(nextTask.estimatedMinutes?.toString() ?? '');
    setActualMinutes(nextTask.actualMinutes?.toString() ?? '');
    setTags(nextTask.tags.join(', '));
    setStatus(nextTask.status ?? 'TODO');
  }, []);

  const load = useCallback(async () => {
    if (!token || !taskId) return;
    setLoading(true);
    setError(null);
    try {
      const tasks = await flownoteApi.listTasks(token);
      const found = tasks.find((item) => item.id === taskId);
      if (!found) {
        setTask(null);
        setError('작업을 찾을 수 없습니다. 목록에서 다시 선택해 주세요.');
        return;
      }
      applyTask(found);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '작업을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [applyTask, taskId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!token || !taskId || !title.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await flownoteApi.updateTask(token, taskId, {
        taskName: title.trim(),
        category: category.trim() || null,
        memo: memo.trim() || null,
        dueDate: dueDate.trim() || null,
        difficultyLevel: numberOrNull(difficulty),
        estimatedMinutes: numberOrNull(estimatedMinutes),
        actualMinutes: numberOrNull(actualMinutes),
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        status,
      });
      if (result.updatedTask) applyTask(result.updatedTask);
      Alert.alert('Flownote', '작업을 저장했습니다.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '작업을 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    if (!token || !taskId) return;
    Alert.alert('작업 삭제', '이 작업을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => {
          void flownoteApi.deleteTask(token, taskId)
            .then(() => router.replace('/tasks'))
            .catch((deleteError: unknown) => {
              setError(deleteError instanceof Error ? deleteError.message : '작업을 삭제하지 못했습니다.');
            });
        },
      },
    ]);
  };

  if (loading) {
    return <ThemedView style={styles.centered}><ActivityIndicator size="large" color="#176B87" /></ThemedView>;
  }

  if (!task) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText style={styles.errorText}>{error ?? '작업을 찾을 수 없습니다.'}</ThemedText>
        <Pressable style={styles.primaryButton} onPress={() => router.replace('/tasks')}>
          <ThemedText type="defaultSemiBold" style={styles.primaryButtonText}>목록으로</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.heading}>
          <ThemedText type="title" style={styles.title}>작업 편집</ThemedText>
          <ThemedText style={styles.muted}>목록에서 선택한 작업의 상세 정보를 수정합니다.</ThemedText>
        </View>

        {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}

        <View style={styles.card}>
          <Field label="제목" value={title} onChangeText={setTitle} placeholder="작업 제목" />
          <Field label="카테고리" value={category} onChangeText={setCategory} placeholder="카테고리" />
          <View style={styles.field}>
            <ThemedText type="defaultSemiBold" style={styles.label}>상태</ThemedText>
            <View style={styles.segment}>
              {['TODO', 'DOING', 'DONE'].map((value) => (
                <Pressable
                  key={value}
                  style={[styles.segmentButton, status === value && styles.segmentButtonActive]}
                  onPress={() => setStatus(value)}>
                  <ThemedText type="defaultSemiBold" style={status === value ? styles.segmentTextActive : styles.segmentText}>{value}</ThemedText>
                </Pressable>
              ))}
            </View>
          </View>
          <Field label="마감일" value={dueDate} onChangeText={setDueDate} placeholder="YYYY-MM-DD 또는 ISO 날짜" />
          <View style={styles.numberRow}>
            <Field compact label="난이도" value={difficulty} onChangeText={setDifficulty} placeholder="1" keyboardType="number-pad" />
            <Field compact label="예상 분" value={estimatedMinutes} onChangeText={setEstimatedMinutes} placeholder="30" keyboardType="number-pad" />
            <Field compact label="실제 분" value={actualMinutes} onChangeText={setActualMinutes} placeholder="0" keyboardType="number-pad" />
          </View>
          <Field label="태그" value={tags} onChangeText={setTags} placeholder="태그를 쉼표로 구분" />
          <Field multiline label="메모" value={memo} onChangeText={setMemo} placeholder="작업 메모" />
        </View>

        <Pressable
          style={[styles.primaryButton, (!title.trim() || saving) && styles.disabled]}
          onPress={() => void save()}
          disabled={!title.trim() || saving}>
          {saving ? <ActivityIndicator color="#FFFFFF" /> : <MaterialIcons name="save" size={20} color="#FFFFFF" />}
          <ThemedText type="defaultSemiBold" style={styles.primaryButtonText}>저장</ThemedText>
        </Pressable>
        <Pressable style={styles.deleteButton} onPress={remove}>
          <MaterialIcons name="delete-outline" size={20} color="#991B1B" />
          <ThemedText type="defaultSemiBold" style={styles.deleteText}>작업 삭제</ThemedText>
        </Pressable>
      </ScrollView>
    </ThemedView>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  compact?: boolean;
  keyboardType?: 'default' | 'number-pad';
};

function Field({ label, value, onChangeText, placeholder, multiline, compact, keyboardType = 'default' }: FieldProps) {
  return (
    <View style={[styles.field, compact && styles.compactField]}>
      <ThemedText type="defaultSemiBold" style={styles.label}>{label}</ThemedText>
      <TextInput
        accessibilityLabel={label}
        multiline={multiline}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor="#7C8794"
        style={[styles.input, multiline && styles.textArea]}
        value={value}
        onChangeText={onChangeText}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: 16, padding: 18, paddingBottom: 44 },
  heading: { gap: 5 },
  title: { color: '#143241' },
  muted: { color: '#66727D' },
  errorText: { color: '#991B1B' },
  card: { gap: 14, borderWidth: 1, borderColor: '#D7E0E7', borderRadius: 12, backgroundColor: '#FFFFFF', padding: 16 },
  field: { flex: 1, gap: 6 },
  compactField: { minWidth: 90 },
  label: { color: '#33404C' },
  input: { minHeight: 46, borderWidth: 1, borderColor: '#CED8DF', borderRadius: 8, backgroundColor: '#FFFFFF', color: '#17212B', fontSize: 16, paddingHorizontal: 12, paddingVertical: 10 },
  textArea: { minHeight: 120, textAlignVertical: 'top' },
  segment: { flexDirection: 'row', gap: 6, borderRadius: 9, backgroundColor: '#EEF2F5', padding: 4 },
  segmentButton: { minHeight: 42, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 7 },
  segmentButtonActive: { backgroundColor: '#143241' },
  segmentText: { color: '#42505D' },
  segmentTextActive: { color: '#FFFFFF' },
  numberRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  primaryButton: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 10, backgroundColor: '#176B87', paddingHorizontal: 16 },
  primaryButtonText: { color: '#FFFFFF' },
  deleteButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderColor: '#FECACA', borderRadius: 10, backgroundColor: '#FEF2F2' },
  deleteText: { color: '#991B1B' },
  disabled: { opacity: 0.5 },
});
