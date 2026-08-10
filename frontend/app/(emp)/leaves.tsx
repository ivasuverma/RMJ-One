import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Leave = {
  id: string; from_date: string; to_date: string; leave_type: string;
  reason: string; status: 'pending' | 'approved' | 'rejected'; created_at: string;
  decision_note?: string;
};

const fmtDate = (s: string) => {
  try { return new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return s; }
};

export default function EmployeeLeaves() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const [items, setItems] = useState<Leave[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await api.get<Leave[]>('/leaves')); }
    catch (_e) { setItems([]); }
    finally { setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="emp-leaves-screen">
      <View style={styles.header}>
        <Text style={styles.title}>My Leaves</Text>
        <Pressable
          onPress={() => router.push('/leaves/new')}
          style={styles.addBtn}
          testID="new-leave-btn"
        >
          <Ionicons name="add" size={18} color={colors.onBrandPrimary} />
          <Text style={styles.addBtnText}>Apply</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        showsVerticalScrollIndicator={false}
      >
        {items.length === 0 ? (
          <View style={styles.emptyBox} testID="emp-leaves-empty">
            <Ionicons name="calendar-outline" size={40} color={colors.mutedText} />
            <Text style={styles.emptyTitle}>No leave requests</Text>
            <Text style={styles.emptySub}>Tap Apply to submit a new leave request.</Text>
          </View>
        ) : (
          items.map((l) => (
            <View key={l.id} style={styles.card} testID={`leave-${l.id}`}>
              <View style={styles.rowTop}>
                <Text style={styles.type}>{l.leave_type.toUpperCase()}</Text>
                <StatusChip status={l.status} />
              </View>
              <Text style={styles.dates}>{fmtDate(l.from_date)} → {fmtDate(l.to_date)}</Text>
              {!!l.reason && <Text style={styles.reason}>{l.reason}</Text>}
              {!!l.decision_note && l.status !== 'pending' && (
                <Text style={styles.decision}>Owner note: {l.decision_note}</Text>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatusChip({ status }: { status: Leave['status'] }) {
  const { colors } = useTheme();
  const map = {
    pending: { label: 'Pending', bg: colors.warning, bd: colors.onWarning, fg: colors.onWarning },
    approved: { label: 'Approved', bg: colors.success, bd: colors.onSuccess, fg: colors.onSuccess },
    rejected: { label: 'Rejected', bg: colors.error, bd: colors.onError, fg: colors.onError },
  } as const;
  const s = map[status] || map.pending;
  return (
    <View style={[chip.wrap, { backgroundColor: s.bg, borderColor: s.bd }]}>
      <Text style={[chip.text, { color: s.fg }]}>{s.label}</Text>
    </View>
  );
}

const chip = StyleSheet.create({
  wrap: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1 },
  text: { fontSize: 11, fontWeight: '700' },
});

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  title: {
    flex: 1, color: colors.onSurface, fontSize: 26, fontWeight: '600',
    fontFamily: fonts.display,
  },
  addBtn: {
    flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill,
  },
  addBtnText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 13 },

  emptyBox: { alignItems: 'center', paddingVertical: 60, gap: spacing.sm },
  emptyTitle: { color: colors.onSurface, fontSize: 16, fontWeight: '700', marginTop: spacing.md },
  emptySub: { color: colors.onSurfaceTertiary, fontSize: 12 },

  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md,
  },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  type: { color: colors.brandSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  dates: { color: colors.onSurface, fontSize: 15, fontWeight: '600', marginBottom: 4 },
  reason: { color: colors.onSurfaceTertiary, fontSize: 12 },
  decision: { color: colors.mutedText, fontSize: 11, marginTop: 6, fontStyle: 'italic' },
});
