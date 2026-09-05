import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { api } from '@/src/api/client';
import { istDateTime, todayIST } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Sample = {
  id: string; sample_code: string; description: string; tag_number: string;
  weight: number; pc_count?: number; karigar_id: string; karigar_name: string;
  status: 'with_karigar' | 'received'; weight_diff: number | null;
  due_date: string | null; issue_type?: string;
  issued_at: string; received_at: string | null; issued_by?: string;
};
type Pipe = { with_karigar: number; overdue: number; received_today: number };

const STATUS_TABS: { key: string; label: string }[] = [
  { key: 'with_karigar', label: 'With Karigar' },
  { key: 'received', label: 'Received' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'all', label: 'All' },
];
const STATUS_TAB_KEYS = new Set(STATUS_TABS.map((t) => t.key));

type StageTone = 'info' | 'bad' | 'good';
// Same pipeline treatment as Repairs — a tappable stage bar instead of plain
// chips, backed by the same /samples/dashboard counts already used
// elsewhere (Work row, Home needs-attention).
const STAGES: { key: string; label: string; tone: StageTone; countKey: keyof Pipe }[] = [
  { key: 'with_karigar', label: 'Issued', tone: 'info', countKey: 'with_karigar' },
  { key: 'overdue', label: 'Overdue', tone: 'bad', countKey: 'overdue' },
  { key: 'received', label: 'Received\ntoday', tone: 'good', countKey: 'received_today' },
];

export default function SamplesScreen() {
  const router = useRouter();
  const { status: routeStatus } = useLocalSearchParams<{ status?: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [samples, setSamples] = useState<Sample[]>([]);
  const [pipe, setPipe] = useState<Pipe | null>(null);
  const initialStatus = routeStatus && STATUS_TAB_KEYS.has(routeStatus) ? routeStatus : 'with_karigar';
  const [statusTab, setStatusTab] = useState(initialStatus);
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      api.get<Pipe>('/samples/dashboard').then(setPipe).catch(() => {});
      const params = new URLSearchParams();
      if (statusTab !== 'all') params.set('status', statusTab);
      if (query.trim()) params.set('q', query.trim());
      setSamples(await api.get<Sample[]>(`/samples?${params.toString()}`));
    } catch (_e) { /* ignore */ }
    finally { setRefreshing(false); }
  }, [statusTab, query]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toneColor = (t: StageTone) => (t === 'info' ? colors.onInfo : t === 'good' ? colors.onSuccess : colors.onError);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="samples-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Stock In/Out</Text>
        {/* Issuing a new sample only ever needed module access on the
            backend (require_admin_or_module, no right check) — matching
            Repair's unconditional add button instead of gating this behind
            the Edit right, which is meant for modifying existing records. */}
        <Pressable onPress={() => router.push('/samples/new' as any)} style={[styles.iconBtn, styles.addBtn]} testID="new-sample-btn" hitSlop={12}>
          <Ionicons name="add" size={22} color={colors.onBrandPrimary} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
      >
        <View style={styles.pipe}>
          <View style={styles.pipeHeadRow}>
            <Text style={styles.pipeHead}>Pipeline</Text>
            <Pressable onPress={() => setStatusTab('all')} testID="sample-tab-all" hitSlop={8}>
              <Text style={[styles.pipeAllLink, statusTab === 'all' && styles.pipeAllLinkActive]}>All</Text>
            </Pressable>
          </View>
          <View style={styles.stages}>
            {STAGES.map((s) => {
              const active = statusTab === s.key;
              const count = pipe ? (pipe[s.countKey] as number) : 0;
              return (
                <Pressable key={s.key} style={styles.stage} onPress={() => setStatusTab(s.key)} testID={`stage-${s.key}`}>
                  <View style={styles.stageBar}>
                    <View style={{ height: '100%', borderRadius: 3, backgroundColor: toneColor(s.tone), width: active ? '100%' : count > 0 ? '55%' : '18%', opacity: active ? 1 : 0.65 }} />
                  </View>
                  <Text style={[styles.stageNum, active && { color: toneColor(s.tone) }]}>{count}</Text>
                  <Text style={styles.stageLbl}>{s.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <TextInput
          testID="samples-search" value={query} onChangeText={setQuery}
          placeholder="Search by tag, description, or karigar" placeholderTextColor={colors.mutedText}
          style={[styles.input, { marginTop: spacing.lg, marginBottom: spacing.md }]}
        />

        {samples.length === 0 ? (
          <View style={styles.empty}><Ionicons name="diamond-outline" size={36} color={colors.mutedText} /><Text style={styles.emptyText}>No samples here</Text></View>
        ) : samples.map((s) => {
          const isOverdue = s.status === 'with_karigar' && !!s.due_date && s.due_date < todayIST();
          const at = s.status === 'received' ? s.received_at : s.issued_at;
          return (
            <Pressable key={s.id} onPress={() => router.push(`/samples/${s.id}` as any)} style={styles.card} testID={`sample-${s.id}`}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.cName}>{s.karigar_name}</Text>
                  <Text style={styles.cMeta} numberOfLines={2}>
                    {s.sample_code}{s.tag_number ? ` · Tag ${s.tag_number}` : ''} · <Text style={styles.cDesc}>{s.description}</Text>
                  </Text>
                  <Text style={styles.cMeta2}>
                    <Text style={styles.cWeight}>{s.weight.toFixed(3)}g</Text>
                    {s.status === 'received' && s.weight_diff ? ` · diff ${s.weight_diff > 0 ? '+' : ''}${s.weight_diff.toFixed(3)}g` : ''}
                    {at ? ` · ${istDateTime(at)}` : ''}
                    {s.issued_by ? ` · by ${s.issued_by}` : ''}
                  </Text>
                </View>
                <View style={[styles.badge, isOverdue ? styles.badgeOverdue : s.status === 'received' ? styles.badgeReceived : styles.badgeOut]}>
                  <Text style={[styles.badgeText, isOverdue ? styles.badgeTextOverdue : s.status === 'received' ? styles.badgeTextReceived : styles.badgeTextOut]}>
                    {isOverdue ? 'Overdue' : s.status === 'received' ? 'Received' : 'With Karigar'}
                  </Text>
                </View>
              </View>
              {s.status === 'with_karigar' && (
                <View style={styles.actRow}>
                  <Pressable onPress={() => router.push(`/samples/receive?id=${s.id}` as any)} style={styles.recvBtn} testID={`receive-${s.id}`}>
                    <Text style={styles.recvBtnText}>Receive</Text>
                  </Pressable>
                </View>
              )}
            </Pressable>
          );
        })}
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

  pipe: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md,
  },
  pipeHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 },
  pipeHead: { color: colors.mutedText, fontSize: 13, fontWeight: '600' },
  pipeAllLink: { color: colors.mutedText, fontSize: 12, fontWeight: '700' },
  pipeAllLinkActive: { color: colors.brandSecondary },
  stages: { flexDirection: 'row', gap: 7 },
  stage: { flex: 1, alignItems: 'center' },
  stageBar: { height: 5, borderRadius: 3, backgroundColor: colors.surfaceTertiary, alignSelf: 'stretch', overflow: 'hidden', marginBottom: 9 },
  stageNum: { color: colors.onSurface, fontSize: 19, fontWeight: '700', letterSpacing: -0.4 },
  stageLbl: { color: colors.mutedText, fontSize: 10.5, textAlign: 'center', marginTop: 2, lineHeight: 13 },

  empty: { alignItems: 'center', paddingVertical: 40, gap: spacing.sm },
  emptyText: { color: colors.onSurfaceTertiary },
  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  actRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 6 },
  recvBtn: { backgroundColor: colors.brandPrimary, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12 },
  recvBtnText: { color: colors.onBrandPrimary, fontSize: 12, fontWeight: '700' },
  cName: { color: colors.onSurface, fontWeight: '700', fontSize: 14 },
  cMeta: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  cDesc: { color: colors.onSurfaceSecondary, fontWeight: '600' },
  cMeta2: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  cWeight: { color: colors.onSurface, fontWeight: '700' },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.sm },
  badgeOut: { backgroundColor: colors.brandTertiary },
  badgeReceived: { backgroundColor: colors.success },
  badgeOverdue: { backgroundColor: colors.error },
  badgeText: { fontSize: 10, fontWeight: '700' },
  badgeTextOut: { color: colors.brandSecondary },
  badgeTextReceived: { color: colors.onSuccess },
  badgeTextOverdue: { color: colors.onError },
});
