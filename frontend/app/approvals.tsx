import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, Alert, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { colors, spacing, radius } from '@/src/theme';

type Correction = {
  id: string; employee_name: string; employee_code: string; date: string;
  reason_type: string; note: string; status: 'pending' | 'approved' | 'rejected';
  created_at: string;
};
type Leave = {
  id: string; employee_name: string; employee_code: string;
  from_date: string; to_date: string; leave_type: string; reason: string;
  status: 'pending' | 'approved' | 'rejected'; created_at: string;
};

const TABS = ['Corrections', 'Leaves'] as const;

const reasonLabel = (r: string) => ({
  forgot_check_in: 'Forgot Check-In', forgot_check_out: 'Forgot Check-Out',
  machine_error: 'Machine Error', other: 'Other',
} as any)[r] || r;

const fmtDate = (s?: string) => s ? new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—';

export default function Approvals() {
  const router = useRouter();
  const [tab, setTab] = useState<typeof TABS[number]>('Corrections');
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, l] = await Promise.all([
        api.get<Correction[]>('/attendance/corrections').catch(() => []),
        api.get<Leave[]>('/leaves').catch(() => []),
      ]);
      setCorrections(c); setLeaves(l);
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const decide = async (kind: 'correction' | 'leave', id: string, action: 'approve' | 'reject') => {
    try {
      const path = kind === 'correction' ? `/attendance/corrections/${id}/decide` : `/leaves/${id}/decide`;
      await api.post(path, { action });
      await load();
    } catch (e: any) {
      Alert.alert('Failed', e?.detail || 'Please try again');
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="approvals-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Approvals</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.segRow}>
        {TABS.map((t) => (
          <Pressable
            key={t}
            testID={`approvals-tab-${t.toLowerCase()}`}
            onPress={() => setTab(t)}
            style={[styles.segBtn, tab === t && styles.segBtnActive]}
          >
            <Text style={[styles.segText, tab === t && styles.segTextActive]}>{t}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.brandPrimary} size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
          showsVerticalScrollIndicator={false}
        >
          {tab === 'Corrections' ? (
            corrections.length === 0 ? (
              <EmptyBox icon="checkmark-done-outline" text="No correction requests" />
            ) : corrections.map((c) => (
              <View key={c.id} style={styles.card} testID={`corr-${c.id}`}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{c.employee_name}</Text>
                    <Text style={styles.meta}>{c.employee_code} · {reasonLabel(c.reason_type)} · {fmtDate(c.date)}</Text>
                    {!!c.note && <Text style={styles.note}>{c.note}</Text>}
                  </View>
                  <StatusChip s={c.status} />
                </View>
                {c.status === 'pending' && (
                  <DecideRow
                    onApprove={() => decide('correction', c.id, 'approve')}
                    onReject={() => decide('correction', c.id, 'reject')}
                    testIDPrefix={`corr-${c.id}`}
                  />
                )}
              </View>
            ))
          ) : (
            leaves.length === 0 ? (
              <EmptyBox icon="calendar-outline" text="No leave requests" />
            ) : leaves.map((l) => (
              <View key={l.id} style={styles.card} testID={`leave-${l.id}`}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{l.employee_name}</Text>
                    <Text style={styles.meta}>{l.employee_code} · {l.leave_type.toUpperCase()} · {fmtDate(l.from_date)} → {fmtDate(l.to_date)}</Text>
                    {!!l.reason && <Text style={styles.note}>{l.reason}</Text>}
                  </View>
                  <StatusChip s={l.status} />
                </View>
                {l.status === 'pending' && (
                  <DecideRow
                    onApprove={() => decide('leave', l.id, 'approve')}
                    onReject={() => decide('leave', l.id, 'reject')}
                    testIDPrefix={`leave-${l.id}`}
                  />
                )}
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function DecideRow({ onApprove, onReject, testIDPrefix }: { onApprove: () => void; onReject: () => void; testIDPrefix: string }) {
  return (
    <View style={styles.actions}>
      <Pressable style={[styles.actionBtn, styles.rejectBtn]} onPress={onReject} testID={`${testIDPrefix}-reject`}>
        <Ionicons name="close" size={16} color="#F1A9A9" />
        <Text style={[styles.actionText, { color: '#F1A9A9' }]}>Reject</Text>
      </Pressable>
      <Pressable style={[styles.actionBtn, styles.approveBtn]} onPress={onApprove} testID={`${testIDPrefix}-approve`}>
        <Ionicons name="checkmark" size={16} color={colors.onBrandPrimary} />
        <Text style={[styles.actionText, { color: colors.onBrandPrimary }]}>Approve</Text>
      </Pressable>
    </View>
  );
}

function StatusChip({ s }: { s: 'pending' | 'approved' | 'rejected' }) {
  const map = {
    pending: { label: 'Pending', bg: 'rgba(163,125,30,0.25)', bd: colors.warning, fg: '#F1D890' },
    approved: { label: 'Approved', bg: 'rgba(45,90,64,0.35)', bd: colors.success, fg: '#B7EFC5' },
    rejected: { label: 'Rejected', bg: 'rgba(122,40,40,0.25)', bd: colors.error, fg: '#F1A9A9' },
  }[s];
  return (
    <View style={[chip.wrap, { backgroundColor: map.bg, borderColor: map.bd }]}>
      <Text style={[chip.text, { color: map.fg }]}>{map.label}</Text>
    </View>
  );
}

function EmptyBox({ icon, text }: { icon: any; text: string }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={44} color={colors.mutedText} />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const chip = StyleSheet.create({
  wrap: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1 },
  text: { fontSize: 11, fontWeight: '700' },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  title: {
    flex: 1, color: colors.onSurface, fontSize: 22, fontWeight: '600',
    fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }),
  },
  segRow: {
    flexDirection: 'row', margin: spacing.lg, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill, padding: 4, borderWidth: 1, borderColor: colors.border,
  },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.pill },
  segBtnActive: { backgroundColor: colors.brandPrimary },
  segText: { color: colors.onSurfaceTertiary, fontWeight: '600', fontSize: 13 },
  segTextActive: { color: colors.onBrandPrimary },

  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  cardTop: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  name: { color: colors.onSurface, fontSize: 14, fontWeight: '700' },
  meta: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  note: { color: colors.mutedText, fontSize: 12, marginTop: 4, fontStyle: 'italic' },

  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  actionBtn: {
    flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.md, paddingVertical: 10, borderWidth: 1,
  },
  approveBtn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  rejectBtn: { backgroundColor: 'rgba(122,40,40,0.15)', borderColor: colors.error },
  actionText: { fontSize: 13, fontWeight: '700' },

  empty: { alignItems: 'center', paddingVertical: 60, gap: spacing.sm },
  emptyText: { color: colors.onSurfaceTertiary, fontSize: 13 },
});
