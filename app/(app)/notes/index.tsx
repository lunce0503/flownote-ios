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
import { flownoteApi, type Note } from '@/lib/flownote-api';
import { buildPlainTextNoteContent, noteContentToPlainText } from '@/lib/note-content';

const formatDate = (value: string | null | undefined) => {
  if (!value) return '날짜 없음';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '날짜 없음' : date.toLocaleDateString();
};

export default function NoteListScreen() {
  const router = useRouter();
  const { token } = useSession();
  const [notes, setNotes] = useState<Note[]>([]);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setNotes(await flownoteApi.listNotes(token));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '노트 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const createNote = async () => {
    const noteTitle = title.trim();
    if (!token || !noteTitle || creating) return;
    setCreating(true);
    setError(null);
    try {
      const created = await flownoteApi.createNote(token, {
        title: noteTitle,
        content: buildPlainTextNoteContent(''),
      });
      setTitle('');
      setNotes((current) => [created, ...current]);
      router.push({ pathname: '/notes/[noteId]', params: { noteId: created.id } });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '노트를 만들지 못했습니다.');
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
          <ThemedText type="title" style={styles.title}>노트</ThemedText>
          <ThemedText style={styles.muted}>노트를 고르면 별도의 상세 편집 화면으로 이동합니다.</ThemedText>
        </View>

        <View style={styles.createCard}>
          <TextInput
            accessibilityLabel="새 노트 제목"
            placeholder="새 노트 제목"
            placeholderTextColor="#7C8794"
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            onSubmitEditing={() => void createNote()}
            returnKeyType="done"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="새 노트 만들기"
            style={[styles.createButton, (!title.trim() || creating) && styles.disabled]}
            onPress={() => void createNote()}
            disabled={!title.trim() || creating}>
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

        {!loading && notes.length === 0 ? (
          <View style={styles.emptyCard}>
            <MaterialIcons name="description" size={34} color="#7C8794" />
            <ThemedText type="defaultSemiBold">작성된 노트가 없습니다.</ThemedText>
            <ThemedText style={styles.muted}>새 노트를 만든 뒤 상세 화면에서 내용을 작성하세요.</ThemedText>
          </View>
        ) : (
          <View style={styles.list}>
            {notes.map((note) => (
              <Pressable
                key={note.id}
                accessibilityRole="button"
                accessibilityLabel={`${note.title || '제목 없는 노트'} 편집`}
                style={({ pressed }) => [styles.noteCard, pressed && styles.pressed]}
                onPress={() => router.push({ pathname: '/notes/[noteId]', params: { noteId: note.id } })}>
                <View style={styles.noteIcon}>
                  <MaterialIcons name="description" size={22} color="#9A6700" />
                </View>
                <View style={styles.noteText}>
                  <ThemedText numberOfLines={1} type="defaultSemiBold" style={styles.noteTitle}>
                    {note.title || '제목 없는 노트'}
                  </ThemedText>
                  <ThemedText numberOfLines={2} style={styles.preview}>
                    {noteContentToPlainText(note.content) || '내용 없음'}
                  </ThemedText>
                  <ThemedText style={styles.date}>{formatDate(note.updatedAt || note.createdAt)}</ThemedText>
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
  createButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 8, backgroundColor: '#9A6700', paddingHorizontal: 14 },
  createButtonText: { color: '#FFFFFF' },
  disabled: { opacity: 0.5 },
  errorCard: { gap: 10, borderWidth: 1, borderColor: '#FECACA', borderRadius: 10, backgroundColor: '#FEF2F2', padding: 14 },
  errorText: { color: '#991B1B' },
  retryButton: { alignSelf: 'flex-start', borderRadius: 7, backgroundColor: '#991B1B', paddingHorizontal: 12, paddingVertical: 8 },
  retryText: { color: '#FFFFFF' },
  emptyCard: { minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: '#D7E0E7', borderRadius: 12, backgroundColor: '#FFFFFF', padding: 20 },
  list: { gap: 10 },
  noteCard: { minHeight: 106, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#D7E0E7', borderRadius: 12, backgroundColor: '#FFFFFF', padding: 14 },
  pressed: { opacity: 0.72 },
  noteIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#FFF7D6' },
  noteText: { minWidth: 0, flex: 1, gap: 4 },
  noteTitle: { color: '#17212B', fontSize: 16 },
  preview: { color: '#52606D', lineHeight: 19 },
  date: { color: '#7C8794', fontSize: 12 },
});
