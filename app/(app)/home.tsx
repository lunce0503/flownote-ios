import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useSession } from '@/context/session-context';

const FEATURES = [
  {
    id: 'notes',
    title: '노트',
    description: '노트 목록에서 문서를 고르고 내용을 편집합니다.',
    icon: 'description' as const,
    path: '/notes' as const,
    color: '#9A6700',
    background: '#FFF7D6',
  },
  {
    id: 'tasks',
    title: '작업',
    description: '작업 목록과 일정·상태·메모를 관리합니다.',
    icon: 'check-circle-outline' as const,
    path: '/tasks' as const,
    color: '#176B87',
    background: '#EAF3F7',
  },
  {
    id: 'canvas',
    title: '캔버스',
    description: '캔버스를 선택한 뒤 필기와 요소 편집을 시작합니다.',
    icon: 'draw' as const,
    path: '/canvas' as const,
    color: '#7C3AED',
    background: '#F3E8FF',
  },
  {
    id: 'agent',
    title: 'AI Agent',
    description: '저장된 대화 기록을 확인하고 Agent에게 질문합니다.',
    icon: 'auto-awesome' as const,
    path: '/agent' as const,
    color: '#1E7F57',
    background: '#E8F7EF',
  },
];

export default function HomeScreen() {
  const router = useRouter();
  const { user, logout } = useSession();
  const { width } = useWindowDimensions();
  const tabletLayout = width >= 720;

  return (
    <ThemedView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroText}>
            <ThemedText type="title" style={styles.title}>홈</ThemedText>
            <ThemedText style={styles.subtitle}>
              {user?.nickname ?? '사용자'}님, 사용할 기능을 선택하세요.
            </ThemedText>
          </View>
          <View style={styles.accountCard}>
            <View style={styles.accountText}>
              <ThemedText type="defaultSemiBold">{user?.nickname ?? 'Flownote 사용자'}</ThemedText>
              <ThemedText numberOfLines={1} style={styles.muted}>{user?.email ?? ''}</ThemedText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="로그아웃"
              style={styles.logoutButton}
              onPress={logout}>
              <MaterialIcons name="logout" size={18} color="#7F1D1D" />
              <ThemedText type="defaultSemiBold" style={styles.logoutText}>로그아웃</ThemedText>
            </Pressable>
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <ThemedText type="subtitle">기능</ThemedText>
          <ThemedText style={styles.muted}>목록을 선택하면 상세 편집 화면으로 이동합니다.</ThemedText>
        </View>

        <View style={[styles.featureGrid, tabletLayout && styles.featureGridTablet]}>
          {FEATURES.map((feature) => (
            <Pressable
              key={feature.id}
              accessibilityRole="button"
              accessibilityLabel={`${feature.title} 열기`}
              style={({ pressed }) => [
                styles.featureCard,
                tabletLayout && styles.featureCardTablet,
                { backgroundColor: feature.background },
                pressed && styles.featureCardPressed,
              ]}
              onPress={() => router.push(feature.path)}>
              <View style={[styles.featureIcon, { backgroundColor: feature.color }]}>
                <MaterialIcons name={feature.icon} size={24} color="#FFFFFF" />
              </View>
              <View style={styles.featureText}>
                <ThemedText type="subtitle" style={styles.featureTitle}>{feature.title}</ThemedText>
                <ThemedText style={styles.featureDescription}>{feature.description}</ThemedText>
              </View>
              <MaterialIcons name="chevron-right" size={24} color={feature.color} />
            </Pressable>
          ))}
        </View>
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
    maxWidth: 920,
    alignSelf: 'center',
    gap: 22,
    padding: 18,
    paddingBottom: 40,
  },
  hero: {
    gap: 16,
  },
  heroText: {
    gap: 5,
  },
  title: {
    color: '#143241',
  },
  subtitle: {
    color: '#52606D',
  },
  accountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderWidth: 1,
    borderColor: '#D7E0E7',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    padding: 14,
  },
  accountText: {
    minWidth: 0,
    flex: 1,
    gap: 3,
  },
  muted: {
    color: '#66727D',
  },
  logoutButton: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 8,
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 12,
  },
  logoutText: {
    color: '#7F1D1D',
  },
  sectionHeader: {
    gap: 4,
  },
  featureGrid: {
    gap: 12,
  },
  featureGridTablet: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  featureCard: {
    minHeight: 104,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 14,
    padding: 16,
  },
  featureCardPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
  featureCardTablet: {
    width: '48.9%',
  },
  featureIcon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  featureText: {
    minWidth: 0,
    flex: 1,
    gap: 4,
  },
  featureTitle: {
    color: '#17212B',
  },
  featureDescription: {
    color: '#52606D',
    lineHeight: 20,
  },
});
