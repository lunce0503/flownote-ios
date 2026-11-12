import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { flownoteApi, type ChatMessage } from '@/lib/flownote-api';

export default function AgentScreen() {
  const { token } = useSession();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!token) {
      setMessages([]);
      return;
    }

    setLoading(true);
    try {
      setMessages(await flownoteApi.listChatMessages(token));
    } catch (error) {
      Alert.alert('Flownote Agent', error instanceof Error ? error.message : '대화를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const send = async () => {
    const text = input.trim();
    if (!token || !text) {
      return;
    }

    setSending(true);
    setInput('');
    try {
      const userMessage = await flownoteApi.createChatMessage(token, {
        sender: 'user',
        message: text,
      });
      setMessages((current) => [...current, userMessage]);

      const answer = await flownoteApi.askAgent(text);
      const aiMessage = await flownoteApi.createChatMessage(token, {
        sender: 'ai',
        message: answer || '응답이 비어 있습니다.',
      });
      setMessages((current) => [...current, aiMessage]);
    } catch (error) {
      Alert.alert('Flownote Agent', error instanceof Error ? error.message : '질문을 처리하지 못했습니다.');
    } finally {
      setSending(false);
    }
  };

  if (!token) {
    return (
      <ThemedView style={styles.centeredScreen}>
        <ThemedText type="subtitle" style={styles.title}>로그인이 필요합니다</ThemedText>
        <ThemedText style={styles.muted}>Account 탭에서 먼저 로그인하세요.</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        <View style={styles.header}>
          <ThemedText type="title" style={styles.title}>Agent</ThemedText>
          <ThemedText style={styles.muted}>작업과 노트를 정리할 때 바로 질문할 수 있습니다.</ThemedText>
        </View>

        <View style={styles.chatPanel}>
          {messages.length === 0 ? (
            <ThemedText style={styles.muted}>아직 대화가 없습니다.</ThemedText>
          ) : (
            messages.map((message) => {
              const isUser = message.sender === 'user';
              return (
                <View
                  key={message.id}
                  style={[styles.messageBubble, isUser ? styles.userBubble : styles.agentBubble]}>
                  <ThemedText type="defaultSemiBold" style={styles.messageSender}>
                    {isUser ? '나' : 'Agent'}
                  </ThemedText>
                  <ThemedText style={styles.messageText}>{message.message}</ThemedText>
                </View>
              );
            })
          )}
        </View>

        <View style={styles.inputPanel}>
          <TextInput
            multiline
            placeholder="Agent에게 질문"
            placeholderTextColor="#7C8794"
            style={styles.input}
            value={input}
            onChangeText={setInput}
          />
          <Pressable style={styles.sendButton} onPress={send} disabled={sending}>
            {sending ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <ThemedText type="defaultSemiBold" style={styles.sendButtonText}>전송</ThemedText>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  centeredScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 24,
  },
  content: {
    gap: 16,
    padding: 20,
  },
  header: {
    gap: 6,
  },
  title: {
    color: '#143241',
  },
  muted: {
    color: '#5C6670',
  },
  chatPanel: {
    gap: 10,
    minHeight: 360,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D7E0E7',
    backgroundColor: '#FFFFFF',
    padding: 14,
  },
  messageBubble: {
    gap: 5,
    maxWidth: '90%',
    borderRadius: 8,
    padding: 12,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#DDEEF4',
  },
  agentBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#F3F4F6',
  },
  messageSender: {
    color: '#17212B',
  },
  messageText: {
    color: '#2F3A45',
    lineHeight: 21,
  },
  inputPanel: {
    gap: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D7E0E7',
    backgroundColor: '#FFFFFF',
    padding: 12,
  },
  input: {
    minHeight: 110,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CED8DF',
    backgroundColor: '#FFFFFF',
    color: '#17212B',
    fontSize: 16,
    padding: 12,
    textAlignVertical: 'top',
  },
  sendButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#176B87',
  },
  sendButtonText: {
    color: '#FFFFFF',
  },
});
