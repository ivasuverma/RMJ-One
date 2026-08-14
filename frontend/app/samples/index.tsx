import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Sample = {
  id: string; sample_code: string; description: string; tag_number: string;
  weight: number; karigar_id: string; karigar_name: string;
  status: 'with_karigar' | 'received'; weight_diff: number | null;
  issued_at: string; received_at: string | null;
};

const STATUS_TABS: { key: string; label: string }[] = [
  { key: 'with_karigar', label: 'With Karigar' },
  { key: 'received', label: 'Received' },
  { key: 'all', label: 'All' },
];

export default function SamplesScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { hasRight } = useAuth();
  const canIssue = hasRight('samples', 'edit'); // issuing is the "do the job" action, same tier as edit
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [samples, setSamples] = useState<Sample[]>([]);
  const [statusTab, setStatusTab] = useState('with_karigar');
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusTab !== 'all') params.set('status', statusTab);
      if (query.trim()) params.set('q', query.trim());
      setSamples(await api.get<Sample[]>(`/samples?${params.toString()}`));
    } catch (_e) { /* ignore */ }
    finally { setRefreshing(false); }
  }, [statusTab, query]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="samples-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Sample Issue/Receive</Text>
        {canIssue && (
          <Pressable onPress={() => router.push('/samples/new' as any)} style={[styles.iconBtn, styles.addBtn]} testID="new-sample-btn" hitSlop={12}>
            <Ionicons name="add" size={22} color={colors.onBrandPrimary} />
          </Pressable>
        )}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
      >
        <View style={styles.tabRow}>
          {STATUS_TABS.map((t) => (
            <Pressable key={t.key} onPress={() => setStatusTab(t.key)} style={[styles.tab, statusTab === t.key && styles.tabActive]} testID={`sample-tab-${t.key}`}>
              <Text style={[styles.tabText, statusTab === t.key && styles.tabTextActive]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>

        <TextInput
          testID="samples-search" value={query} onChangeText={setQuery}
          placeholder="Search by tag, description, or karigar" placeholderTextColor={colors.mutedText}
          style={[styles.input, { marginBottom: spacing.md }]}
        />

        {samples.length === 0 ? (
          <View style={styles.empty}><Ionicons name="diamond-outline" size={36} color={colors.mutedText} /><Text style={styles.emptyText}>No samples here</Text></View>
        ) : samples.map((s) => (
          <Pressable key={s.id} onPress={() => router.push(`/samples/${s.id}` as any)} style={styles.card} testID={`sample-${s.id}`}>
            <View style={styles.iconBox}><Ionicons name="diamond-outline" size={18} color={colors.brandSecondary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cName}>{s.sample_code}{s.tag_number ? ` · Tag ${s.tag_number}` : ''} · {s.description}</Text>
              <Text style={styles.cMeta}>
                {s.karigar_name} · {s.weight.toFixed(3)}g
                {s.status === 'received' && s.weight_diff ? ` · diff ${s.weight_diff > 0 ? '+' : ''}${s.weight_diff.toFixed(3)}g` : ''}
              </Text>
            </View>
            <View style={[styles.badge, s.status === 'received' ? styles.badgeReceived : styles.badgeOut]}>
              <Text style={[styles.badgeText, s.status === 'received' ? styles.badgeTextReceived : styles.badgeTextOut]}>
                {s.status === 'received' ? 'Received' : 'With Karigar'}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  addBtn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  title: { flex: 1, color: colors.onSurface, fontSize: 18, fontWeight: '600', fontFamily: fonts.display },

  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },

  tabRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  tabActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  tabTextActive: { color: colors.onBrandPrimary },

  empty: { alignItems: 'center', paddingVertical: 40, gap: spacing.sm },
  emptyText: { color: colors.onSurfaceTertiary },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  iconBox: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand,
  },
  cName: { color: colors.onSurface, fontWeight: '700', fontSize: 14 },
  cMeta: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.sm },
  badgeOut: { backgroundColor: colors.brandTertiary },
  badgeReceived: { backgroundColor: colors.success },
  badgeText: { fontSize: 10, fontWeight: '700' },
  badgeTextOut: { color: colors.brandSecondary },
  badgeTextReceived: { color: colors.onSuccess },
});
