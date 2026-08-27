import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Skeleton, ErrorState, Sheet } from '@/src/components/ui';
import { DocumentCaptureSheet } from '@/src/components/DocumentCaptureSheet';
import { UploadQueueBadge } from '@/src/components/UploadQueueBadge';

// Work — the operational hub, laid out to the v2 design comp: a search bar,
// an "In progress" list of process rows (each showing its live state before
// you tap), and a "Recently recorded" list so you can confirm a save without
// hunting. Reuses /api/dashboard (same source as Home) so the numbers agree.
type DashboardData = {
  repairs_summary: { received: number; with_karigar: number; ready: number; overdue: number; total_open: number };
  samples_summary: { with_karigar: number; overdue: number };
  cashbook_summary: { closing_balance: number };
  tasks_summary: { due_today: number; overdue: number };
  todays_attendance?: { present: number; absent: number; late: number; not_checked_in: number; total: number };
  recent_activity?: { kind: 'repair' | 'cash' | 'stock' | 'ledger'; label: string; route: string }[];
};

const fmtINR = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;

// One coloured segment of a process row's description.
type Seg = { text: string; tone?: string };

export default function WorkScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { hasModule } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<DashboardData | null>(null);
  const [docSummary, setDocSummary] = useState<{ pending_count: number } | null>(null);
  const [captureDoc, setCaptureDoc] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Custom order for the In-progress rows — persisted per device so each user
  // arranges the board to match how they actually work.
  const ORDER_KEY = 'rmj.work_order';
  const [order, setOrder] = useState<string[]>([]);
  const [editOrder, setEditOrder] = useState(false);
  useFocusEffect(useCallback(() => {
    try { const raw = typeof window !== 'undefined' ? window.localStorage.getItem(ORDER_KEY) : null; if (raw) setOrder(JSON.parse(raw)); } catch { /* ignore */ }
  }, []));
  const persistOrder = (keys: string[]) => { setOrder(keys); try { if (typeof window !== 'undefined') window.localStorage.setItem(ORDER_KEY, JSON.stringify(keys)); } catch { /* ignore */ } };

  const load = useCallback(async () => {
    try { setError(''); setData(await api.get<DashboardData>('/dashboard')); }
    catch (e: any) { setError(e?.detail || 'Failed to load'); }
    finally { setLoading(false); }
    if (hasModule('documents')) api.get<{ pending_count: number }>('/documents/summary').then(setDocSummary).catch(() => {});
  }, [hasModule]);
  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const go = (route: string) => router.push(route as any);

  // Rows are built from the modules this user has — ALWAYS, not gated on the
  // dashboard fetch — so the board renders instantly with its structure and the
  // live counts fill in when /dashboard returns (no blank skeleton wait).
  type Row = { key: string; title: string; icon: keyof typeof Ionicons.glyphMap; segs: Seg[]; badge?: number; route: string };
  const placeholder: Seg[] = [{ text: '…' }];
  const rows: Row[] = [];
  if (hasModule('repairs')) rows.push({
    key: 'repairs', title: 'Repairs', icon: 'construct-outline', route: '/repairs',
    badge: data?.repairs_summary.ready || undefined,
    segs: data ? [
      { text: `${data.repairs_summary.with_karigar} with karigar`, tone: 'hot' }, { text: ' · ' },
      { text: `${data.repairs_summary.overdue} overdue`, tone: 'bad' }, { text: ' · ' },
      { text: `${data.repairs_summary.ready} to bill` },
    ] : placeholder,
  });
  if (hasModule('samples')) rows.push({
    key: 'stock', title: 'Stock In / Out', icon: 'diamond-outline', route: '/samples',
    segs: data ? [
      { text: `${data.samples_summary.with_karigar} samples out` },
      ...(data.samples_summary.overdue > 0 ? [{ text: ' · ' }, { text: `${data.samples_summary.overdue} overdue`, tone: 'bad' as const }] : []),
    ] : placeholder,
  });
  if (hasModule('cash_book')) rows.push({
    key: 'cash', title: 'Cash Book', icon: 'wallet-outline', route: '/cashbook',
    segs: data ? [{ text: 'Closing ' }, { text: fmtINR(data.cashbook_summary.closing_balance), tone: 'strong' }] : placeholder,
  });
  if (hasModule('tasks')) rows.push({
    key: 'tasks', title: 'Tasks', icon: 'checkbox-outline', route: '/tasks', badge: data?.tasks_summary.due_today || undefined,
    segs: data ? [
      { text: `${data.tasks_summary.due_today} due today` },
      ...(data.tasks_summary.overdue > 0 ? [{ text: ' · ' }, { text: `${data.tasks_summary.overdue} overdue`, tone: 'bad' as const }] : []),
    ] : placeholder,
  });
  if (hasModule('documents')) rows.push({
    key: 'documents', title: 'Documents', icon: 'documents-outline', route: '/documents',
    badge: docSummary?.pending_count || undefined,
    segs: docSummary ? (docSummary.pending_count > 0 ? [{ text: `${docSummary.pending_count} pending to record`, tone: 'hot' }] : [{ text: 'All recorded' }]) : placeholder,
  });

  // Apply the user's saved order; unknown/new rows fall to the end.
  const idx = (k: string) => { const i = order.indexOf(k); return i === -1 ? 999 : i; };
  const sortedRows = [...rows].sort((a, b) => idx(a.key) - idx(b.key));
  const move = (key: string, dir: -1 | 1) => {
    const keys = sortedRows.map((r) => r.key);
    const i = keys.indexOf(key); const j = i + dir;
    if (j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    persistOrder(keys);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="work-screen">
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.h1}>Work</Text>
            <Text style={styles.sub}>What&apos;s in progress — and what to do next.</Text>
          </View>
          {hasModule('documents') && <UploadQueueBadge />}
          {hasModule('documents') && (
            <Pressable onPress={() => setCaptureDoc(true)} style={styles.captureBtn} testID="work-capture-btn" hitSlop={8}>
              <Ionicons name="camera" size={22} color={colors.brandSecondary} />
            </Pressable>
          )}
          <Pressable onPress={() => setComposeOpen(true)} style={[styles.captureBtn, styles.captureBtnGold]} testID="work-compose-btn" hitSlop={8}>
            <Ionicons name="add" size={24} color={colors.onBrandPrimary} />
          </Pressable>
        </View>

        <Pressable onPress={() => go('/repairs/search')} style={styles.search} testID="work-search">
          <Ionicons name="search-outline" size={17} color={colors.mutedText} />
          <Text style={styles.searchText}>Find a repair, sample or customer…</Text>
        </Pressable>

        {sortedRows.length > 0 && (
          <View style={styles.progressHead}>
            <Text style={styles.sectionLabel}>In progress</Text>
            <Pressable onPress={() => setEditOrder((v) => !v)} hitSlop={8} testID="work-edit-order">
              <Text style={styles.editOrderText}>{editOrder ? 'Done' : 'Reorder'}</Text>
            </Pressable>
          </View>
        )}
        {sortedRows.map((r, ri) => (
          <Pressable key={r.key} onPress={() => !editOrder && go(r.route)} style={({ pressed }) => [styles.prow, pressed && !editOrder && { opacity: 0.85 }]} testID={`work-row-${r.key}`}>
            <View style={styles.pi}><Ionicons name={r.icon} size={22} color={colors.brandSecondary} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.pt}>{r.title}</Text>
              <Text style={styles.pd} numberOfLines={1}>
                {r.segs.map((s, i) => (
                  <Text key={i} style={s.tone === 'hot' ? { color: colors.onWarning } : s.tone === 'bad' ? { color: colors.onError } : s.tone === 'strong' ? { color: colors.onSurface, fontWeight: '700' } : undefined}>
                    {s.text}
                  </Text>
                ))}
              </Text>
            </View>
            {editOrder ? (
              <View style={styles.reorderCtrls}>
                <Pressable onPress={() => move(r.key, -1)} disabled={ri === 0} style={[styles.arrowBtn, ri === 0 && { opacity: 0.3 }]} hitSlop={6} testID={`work-up-${r.key}`}><Ionicons name="chevron-up" size={18} color={colors.onSurface} /></Pressable>
                <Pressable onPress={() => move(r.key, 1)} disabled={ri === sortedRows.length - 1} style={[styles.arrowBtn, ri === sortedRows.length - 1 && { opacity: 0.3 }]} hitSlop={6} testID={`work-down-${r.key}`}><Ionicons name="chevron-down" size={18} color={colors.onSurface} /></Pressable>
              </View>
            ) : r.badge ? (
              <View style={styles.badge}><Text style={styles.badgeText}>{r.badge}</Text></View>
            ) : (
              <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
            )}
          </Pressable>
        ))}

        {/* Attendance & Payroll — same button style, part of the operational hub. */}
        {hasModule('attendance') && (
          <Pressable onPress={() => go('/(tabs)/attendance?from=work')} style={({ pressed }) => [styles.prow, pressed && { opacity: 0.85 }]} testID="work-attendance">
            <View style={styles.pi}><Ionicons name="calendar-outline" size={22} color={colors.brandSecondary} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.pt}>Attendance &amp; Payroll</Text>
              <Text style={styles.pd} numberOfLines={1}>
                {data?.todays_attendance ? (
                  <>
                    <Text style={{ color: colors.onSuccess, fontWeight: '700' }}>{data.todays_attendance.present} present</Text>
                    <Text> · </Text>
                    <Text style={{ color: colors.onError, fontWeight: '700' }}>{data.todays_attendance.absent} absent</Text>
                    {data.todays_attendance.late > 0 && <Text> · {data.todays_attendance.late} late</Text>}
                  </>
                ) : 'Daily in/out · calendar · monthly salary'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
          </Pressable>
        )}

        {/* Reports — after In progress. The unified ledger is the single home
            for every party (customers, karigars, staff), filterable by type. */}
        <Text style={styles.sectionLabel}>Reports</Text>
        <Pressable onPress={() => go('/accounts')} style={({ pressed }) => [styles.prow, pressed && { opacity: 0.85 }]} testID="work-ledger">
          <View style={styles.pi}><Ionicons name="book-outline" size={22} color={colors.brandSecondary} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.pt}>Ledger</Text>
            <Text style={styles.pd} numberOfLines={1}>Customers, karigars & staff — fine gold & cash</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
        </Pressable>

        <View style={{ height: spacing.xxl }} />
      </ScrollView>
      <Sheet visible={composeOpen} onClose={() => setComposeOpen(false)} title="Create" testID="work-compose-sheet">
        {(() => {
          const actions: { key: string; label: string; icon: string; route: string; show: boolean }[] = [
            { key: 'task', label: 'New task', icon: 'checkbox-outline', route: '/tasks/new', show: hasModule('tasks') },
            { key: 'repair', label: 'New repair', icon: 'construct-outline', route: '/repairs/new', show: hasModule('repairs') },
            { key: 'stock', label: 'Stock In/Out', icon: 'diamond-outline', route: '/samples/new', show: hasModule('samples') },
            { key: 'adv-ded', label: 'Advance / Deduction', icon: 'swap-vertical-outline', route: '/(tabs)/employees?from=work', show: hasModule('team') || hasModule('payroll') },
            { key: 'cash', label: 'Cash in/out', icon: 'wallet-outline', route: '/cashbook', show: hasModule('cash_book') },
            { key: 'account', label: 'New ledger account', icon: 'book-outline', route: '/accounts/new', show: hasModule('ledger') },
            { key: 'document', label: 'Add document', icon: 'document-attach-outline', route: '/documents?capture=1', show: hasModule('documents') },
          ].filter((a) => a.show);
          const go = (route: string) => { setComposeOpen(false); router.push(route as any); };
          if (actions.length === 0) return <Text style={styles.sheetEmpty}>Nothing to create with your current access.</Text>;
          return actions.map((a) => (
            <Pressable key={a.key} onPress={() => go(a.route)} style={({ pressed }) => [styles.sheetRow, pressed && { opacity: 0.7 }]} testID={`work-compose-${a.key}`}>
              <View style={styles.sheetIcon}><Ionicons name={a.icon as keyof typeof Ionicons.glyphMap} size={18} color={colors.brandSecondary} /></View>
              <Text style={styles.sheetLabel}>{a.label}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.mutedText} />
            </Pressable>
          ));
        })()}
      </Sheet>
      <DocumentCaptureSheet visible={captureDoc} onClose={() => setCaptureDoc(false)} onSaved={load} autoCamera />
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  captureBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  captureBtnGold: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  sheetIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  sheetLabel: { flex: 1, color: colors.onSurface, fontSize: 16, fontWeight: '600' },
  sheetEmpty: { color: colors.mutedText, fontSize: 14, paddingVertical: spacing.lg, textAlign: 'center' },
  progressHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  editOrderText: { color: colors.brandSecondary, fontSize: 13, fontWeight: '700', marginTop: spacing.xl, marginBottom: spacing.md },
  reorderCtrls: { flexDirection: 'row', gap: 4 },
  arrowBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  h1: { color: colors.onSurface, fontSize: 30, fontWeight: '700', fontFamily: fonts.display, letterSpacing: -0.5 },
  sub: { color: colors.onSurfaceSecondary, fontSize: 15, marginTop: 6 },

  search: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: spacing.lg,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, height: 46,
  },
  searchText: { color: colors.mutedText, fontSize: 15 },

  sectionLabel: {
    color: colors.mutedText, fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase',
    marginTop: spacing.xl, marginBottom: spacing.md,
  },

  prow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  pi: { width: 46, height: 46, borderRadius: 13, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  pt: { color: colors.onSurface, fontSize: 17, fontWeight: '600' },
  pd: { color: colors.mutedText, fontSize: 13.5, marginTop: 3 },
  badge: {
    minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6,
    backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: colors.onBrandPrimary, fontSize: 12, fontWeight: '800' },

  group: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  li: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13, paddingHorizontal: spacing.md },
  liBorder: { borderTopWidth: 1, borderTopColor: colors.divider },
  gi: { width: 30, height: 30, borderRadius: 9, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  gt: { color: colors.onSurface, fontSize: 15, fontWeight: '500' },
  gtSub: { color: colors.mutedText, fontSize: 12, marginTop: 1 },

  empty: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.xxxl },
  emptyText: { color: colors.onSurfaceTertiary },
});
