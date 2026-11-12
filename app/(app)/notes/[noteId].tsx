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
import { flownoteApi, type Note } from '@/lib/flownote-api';
import { buildPlainTextNoteContent, isPlainTextNoteContent, noteContentToPlainText } from '@/lib/note-content';

export default function NoteDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ noteId: string }>();
  const noteId = Array.isArray(params.noteId) ? params.noteId[0] : params.noteId;
  const { token } = useSession();
  const [note, setNote] = useState<Note | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [richContent, setRichContent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyNote = useCallback((nextNote: Note) => {
    setNote(nextNote);
    setTitle(nextNote.title);
    setBody(noteContentToPlainText(nextNote.content));
    setRichContent(!isPlainTextNoteContent(nextNote.content));
  }, []);

  const load = useCallback(async () => {
    if (!token || !noteId) return;
    setLoading(true);
    setError(null);
    try {
      const found = await flownoteApi.getNote(token, noteId);
      if (!found) {
        setNote(null);
        setError('노트를 찾을 수 없습니다. 목록에서 다시 선택해 주세요.');
        return;
      }
      applyNote(found);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '노트를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [applyNote, noteId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!token || !note || !title.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await flownoteApi.createNote(token, {
        id: note.id,
        title: title.trim(),
        content: richContent ? note.content : buildPlainTextNoteContent(body),
        createdAt: note.createdAt,
        revision: note.revision,
      });
      applyNote(updated);
      Alert.alert('Flownote', richContent ? '제목을 저장했습니다. 본문 서식은 그대로 유지했습니다.' : '노트를 저장했습니다.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '노트를 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    if (!token || !noteId) return;
    Alert.alert('노트 삭제', '이 노트를 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => {
          void flownoteApi.deleteNote(token, noteId)
            .then(() => router.replace('/notes'))
            .catch((deleteError: unknown) => {
              setError(deleteError instanceof Error ? deleteError.message : '노트를 삭제하지 못했습니다.');
            });
        },
      },
    ]);
  };

  if (loading) {
    return <ThemedView style={styles.centered}><ActivityIndicator size="large" color="#9A6700" /></ThemedView>;
  }

  if (!note) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText style={styles.errorText}>{error ?? '노트를 찾을 수 없습니다.'}</ThemedText>
        <Pressable style={styles.primaryButton} onPress={() => router.replace('/notes')}>
          <ThemedText type="defaultSemiBold" style={styles.primaryButtonText}>목록으로</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.heading}>
          <ThemedText type="title" style={styles.title}>노트 편집</ThemedText>
          <ThemedText style={styles.muted}>선택한 노트의 제목과 내용을 확인합니다.</ThemedText>
        </View>

        {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}
        {richContent ? (
          <View style={styles.warningCard}>
            <MaterialIcons name="warning-amber" size={22} color="#9A6700" />
            <ThemedText style={styles.warningText}>
              이 노트는 웹의 서식·이미지·하위 블록을 포함합니다. 데이터 손실을 막기 위해 모바일에서는 본문을 읽기 전용으로 표시하고 제목만 저장합니다.
            </ThemedText>
          </View>
        ) : null}

        <View style={styles.card}>
          <View style={styles.field}>
            <ThemedText type="defaultSemiBold" style={styles.label}>제목</ThemedText>
            <TextInput
              accessibilityLabel="노트 제목"
              placeholder="노트 제목"
              placeholderTextColor="#7C8794"
              style={styles.input}
              value={title}
              onChangeText={setTitle}
            />
          </View>
          <View style={styles.field}>
            <ThemedText type="defaultSemiBold" style={styles.label}>본문</ThemedText>
            <TextInput
              accessibilityLabel="노트 본문"
              multiline
              editable={!richContent}
              placeholder="노트 내용을 입력하세요."
              placeholderTextColor="#7C8794"
              style={[styles.input, styles.textArea, richContent && styles.readOnly]}
              value={body}
              onChangeText={setBody}
            />
          </View>
        </View>

        <Pressable
          style={[styles.primaryButton, (!title.trim() || saving) && styles.disabled]}
          onPress={() => void save()}
          disabled={!title.trim() || saving}>
          {saving ? <ActivityIndicator color="#FFFFFF" /> : <MaterialIcons name="save" size={20} color="#FFFFFF" />}
          <ThemedText type="defaultSemiBold" style={styles.primaryButtonText}>{richContent ? '제목 저장' : '노트 저장'}</ThemedText>
        </Pressable>
        <Pressable style={styles.deleteButton} onPress={remove}>
          <MaterialIcons name="delete-outline" size={20} color="#991B1B" />
          <ThemedText type="defaultSemiBold" style={styles.deleteText}>노트 삭제</ThemedText>
        </Pressable>
      </ScrollView>
    </ThemedView>
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
  warningCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderWidth: 1, borderColor: '#FDE68A', borderRadius: 10, backgroundColor: '#FFFBEB', padding: 13 },
  warningText: { minWidth: 0, flex: 1, color: '#7C5200', lineHeight: 20 },
  card: { gap: 16, borderWidth: 1, borderColor: '#D7E0E7', borderRadius: 12, backgroundColor: '#FFFFFF', padding: 16 },
  field: { gap: 6 },
  label: { color: '#33404C' },
  input: { minHeight: 46, borderWidth: 1, borderColor: '#CED8DF', borderRadius: 8, backgroundColor: '#FFFFFF', color: '#17212B', fontSize: 16, paddingHorizontal: 12, paddingVertical: 10 },
  textArea: { minHeight: 320, textAlignVertical: 'top' },
  readOnly: { backgroundColor: '#F3F4F6', color: '#52606D' },
  primaryButton: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 10, backgroundColor: '#9A6700', paddingHorizontal: 16 },
  primaryButtonText: { color: '#FFFFFF' },
  deleteButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderColor: '#FECACA', borderRadius: 10, backgroundColor: '#FEF2F2' },
  deleteText: { color: '#991B1B' },
  disabled: { opacity: 0.5 },
});
