import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, Platform, RefreshControl, Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/src/api/client';
import { colors, spacing, radius, images } from '@/src/theme';

type Emp = {
  id: string; name: string; employee_code: string; department: string;
  designation: string; shift: string; salary: number; joining_date?: string;
  mobile: string; address: string; aadhaar: string; pan: string;
  bank_account: string; bank_ifsc: string; bank_name: string;
  status: 'active' | 'inactive' | 'on_leave'; notes: string; photo?: string;
};
type TL = { id: string; type: string; title: string; description: string; amount: number; created_at: string };

const TABS = ['Timeline', 'Details', 'Payroll'] as const;
type TabKey = typeof TABS[number];

const fmtDate = (iso?: string) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return iso; }
};
const fmtINR = (n: number) => `₹${(n || 0).toLocaleString('en-IN')}`;

const TL_ICONS: Record<string, any> = {
  joined: 'briefcase-outline',
  salary_revised: 'trending-up-outline',
  advance: 'cash-outline',
  bonus: 'gift-outline',
  penalty: 'warning-outline',
  leave: 'calendar-outline',
  correction: 'create-outline',
};

export default function EmployeeProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<{ employee: Emp; timeline: TL[] } | null>(null);
  const [tab, setTab] = useState<TabKey>('Timeline');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ employee: Emp; timeline: TL[] }>(`/employees/${id}`);
      setData(res);
    } catch (_e) {
      setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const onDelete = () => {
    Alert.alert('Delete employee', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try { await api.del(`/employees/${id}`); router.replace('/(tabs)/employees'); }
          catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.brandPrimary} size="large" />
      </View>
    );
  }
  if (!data) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.centered}>
          <Text style={{ color: colors.onSurface }}>Employee not found</Text>
          <Pressable onPress={() => router.back()} style={styles.backBtnBig}>
            <Text style={{ color: colors.onBrandPrimary, fontWeight: '700' }}>Go back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const emp = data.employee;
  const initials = emp.name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('');

  return (
    <View style={styles.root} testID="employee-profile">
      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Cover */}
        <View style={styles.cover}>
          <Image source={images.goldTexture} style={StyleSheet.absoluteFill} contentFit="cover" />
          <LinearGradient colors={['rgba(13,13,13,0.4)', 'rgba(13,13,13,0.98)']} style={StyleSheet.absoluteFill} />
          <SafeAreaView edges={['top']}>
            <View style={styles.coverTop}>
              <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
                <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
              </Pressable>
              <View style={{ flex: 1 }} />
              <Pressable onPress={() => router.push(`/employee/set-pin/${emp.id}`)} style={styles.iconBtn} testID="pin-btn" hitSlop={12}>
                <Ionicons name="finger-print-outline" size={20} color={colors.onSurface} />
              </Pressable>
              <Pressable onPress={() => router.push(`/employee/edit/${emp.id}`)} style={[styles.iconBtn, { marginLeft: spacing.sm }]} testID="edit-btn" hitSlop={12}>
                <Ionicons name="create-outline" size={20} color={colors.onSurface} />
              </Pressable>
              <Pressable onPress={onDelete} style={[styles.iconBtn, { marginLeft: spacing.sm }]} testID="delete-btn" hitSlop={12}>
                <Ionicons name="trash-outline" size={20} color="#F1A9A9" />
              </Pressable>
            </View>
          </SafeAreaView>
          <View style={styles.avatarWrap}>
            <View style={styles.bigAvatar}>
              <Text style={styles.bigAvatarText}>{initials}</Text>
            </View>
          </View>
        </View>

        {/* Name section */}
        <View style={styles.nameBlock}>
          <Text style={styles.name} numberOfLines={2}>{emp.name}</Text>
          <Text style={styles.designation}>{emp.designation || '—'} · {emp.department || '—'}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.metaChip}>{emp.employee_code}</Text>
            <StatusChip status={emp.status} />
          </View>

          <Pressable
            onPress={() => router.push(`/ledger/${emp.id}`)}
            style={styles.ledgerLink}
            testID="open-ledger-btn"
          >
            <Ionicons name="book-outline" size={16} color={colors.onBrandPrimary} />
            <Text style={styles.ledgerLinkText}>Open Ledger</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.onBrandPrimary} />
          </Pressable>
        </View>

        {/* Segmented tabs */}
        <View style={styles.seg}>
          {TABS.map((t) => (
            <Pressable
              key={t}
              testID={`tab-${t.toLowerCase()}`}
              onPress={() => setTab(t)}
              style={[styles.segItem, tab === t && styles.segItemActive]}
            >
              <Text style={[styles.segText, tab === t && styles.segTextActive]}>{t}</Text>
            </Pressable>
          ))}
        </View>

        <View style={{ paddingHorizontal: spacing.lg }}>
          {tab === 'Timeline' && <TimelineList items={data.timeline} />}
          {tab === 'Details' && <DetailsCard emp={emp} />}
          {tab === 'Payroll' && <PayrollCard emp={emp} />}
        </View>
      </ScrollView>
    </View>
  );
}

function StatusChip({ status }: { status: Emp['status'] }) {
  const map = {
    active: { label: 'Active', bg: 'rgba(45,90,64,0.35)', bd: colors.success, fg: '#B7EFC5' },
    on_leave: { label: 'On Leave', bg: 'rgba(163,125,30,0.25)', bd: colors.warning, fg: '#F1D890' },
    inactive: { label: 'Inactive', bg: 'rgba(122,40,40,0.25)', bd: colors.error, fg: '#F1A9A9' },
  } as const;
  const s = map[status] || map.active;
  return (
    <View style={[styles.statusChip, { backgroundColor: s.bg, borderColor: s.bd }]}>
      <Text style={[styles.statusChipText, { color: s.fg }]}>{s.label}</Text>
    </View>
  );
}

function TimelineList({ items }: { items: TL[] }) {
  if (items.length === 0) {
    return (
      <View style={styles.emptyBox}>
        <Ionicons name="time-outline" size={36} color={colors.mutedText} />
        <Text style={styles.emptyText}>No timeline events yet</Text>
      </View>
    );
  }
  return (
    <View>
      {items.map((e, i) => (
        <View key={e.id} style={styles.tlRow}>
          <View style={styles.tlIconCol}>
            <View style={styles.tlIcon}>
              <Ionicons name={TL_ICONS[e.type] || 'ellipse-outline'} size={16} color={colors.brandSecondary} />
            </View>
            {i < items.length - 1 && <View style={styles.tlLine} />}
          </View>
          <View style={styles.tlContent}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
              <Text style={styles.tlTitle} numberOfLines={1}>{e.title}</Text>
              {!!e.amount && <Text style={styles.tlAmount}>{e.amount > 0 ? '+' : ''}{fmtINR(Math.abs(e.amount))}</Text>}
            </View>
            {!!e.description && <Text style={styles.tlDesc}>{e.description}</Text>}
            <Text style={styles.tlDate}>{fmtDate(e.created_at)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function DetailsCard({ emp }: { emp: Emp }) {
  return (
    <View style={styles.detailCard}>
      <SectionTitle text="Personal" />
      <DetailRow label="Mobile" value={emp.mobile || '—'} />
      <DetailRow label="Address" value={emp.address || '—'} />
      <DetailRow label="Aadhaar" value={emp.aadhaar || '—'} />
      <DetailRow label="PAN" value={emp.pan || '—'} />

      <SectionTitle text="Job" />
      <DetailRow label="Designation" value={emp.designation || '—'} />
      <DetailRow label="Department" value={emp.department || '—'} />
      <DetailRow label="Shift" value={emp.shift || '—'} />
      <DetailRow label="Joined" value={fmtDate(emp.joining_date)} />

      <SectionTitle text="Bank" />
      <DetailRow label="Bank" value={emp.bank_name || '—'} />
      <DetailRow label="Account" value={emp.bank_account || '—'} />
      <DetailRow label="IFSC" value={emp.bank_ifsc || '—'} />

      {!!emp.notes && (
        <>
          <SectionTitle text="Notes" />
          <Text style={styles.notes}>{emp.notes}</Text>
        </>
      )}
    </View>
  );
}

function PayrollCard({ emp }: { emp: Emp }) {
  return (
    <View style={styles.detailCard}>
      <SectionTitle text="Compensation" />
      <View style={styles.salaryHero}>
        <Text style={styles.salaryLabel}>Monthly Salary</Text>
        <Text style={styles.salaryValue}>{fmtINR(emp.salary)}</Text>
      </View>
      <View style={{ height: spacing.md }} />
      <DetailRow label="Shift" value={emp.shift || 'General'} />
      <DetailRow label="Joined" value={fmtDate(emp.joining_date)} />
      <View style={styles.infoBox}>
        <Ionicons name="information-circle-outline" size={16} color={colors.brandSecondary} />
        <Text style={styles.infoText}>Full payroll module arrives in Milestone 3.</Text>
      </View>
    </View>
  );
}

function SectionTitle({ text }: { text: string }) {
  return <Text style={styles.detailSection}>{text}</Text>;
}
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  centered: { flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  backBtnBig: { marginTop: spacing.md, backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.xl, paddingVertical: 12, borderRadius: radius.md },

  cover: { height: 220, backgroundColor: colors.surfaceSecondary, position: 'relative' },
  coverTop: { flexDirection: 'row', paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(38,38,38,0.85)', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  avatarWrap: { position: 'absolute', bottom: -36, left: spacing.lg },
  bigAvatar: {
    width: 88, height: 88, borderRadius: 44, backgroundColor: colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.surface,
  },
  bigAvatarText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 32 },

  nameBlock: { paddingHorizontal: spacing.lg, paddingTop: spacing.xxl + spacing.md, paddingBottom: spacing.md },
  name: {
    color: colors.onSurface, fontSize: 28, fontWeight: '600',
    fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }),
  },
  designation: { color: colors.onSurfaceTertiary, fontSize: 14, marginTop: 4 },
  metaRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, alignItems: 'center' },
  ledgerLink: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md,
    backgroundColor: colors.brandPrimary, paddingVertical: 10, paddingHorizontal: spacing.md,
    borderRadius: radius.md, alignSelf: 'flex-start',
  },
  ledgerLinkText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 13 },
  metaChip: {
    color: colors.brandSecondary, fontSize: 12, fontWeight: '600',
    backgroundColor: colors.brandTertiary, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill,
  },
  statusChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1 },
  statusChipText: { fontSize: 11, fontWeight: '700' },

  seg: {
    flexDirection: 'row', margin: spacing.lg, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill, padding: 4, borderWidth: 1, borderColor: colors.border,
  },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.pill },
  segItemActive: { backgroundColor: colors.brandPrimary },
  segText: { color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: '600' },
  segTextActive: { color: colors.onBrandPrimary },

  emptyBox: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
  emptyText: { color: colors.mutedText, fontSize: 13 },

  tlRow: { flexDirection: 'row', gap: spacing.md, minHeight: 72 },
  tlIconCol: { alignItems: 'center', width: 32 },
  tlIcon: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand,
  },
  tlLine: { flex: 1, width: 2, backgroundColor: colors.border, marginTop: 4 },
  tlContent: {
    flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md,
  },
  tlTitle: { flex: 1, color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  tlAmount: { color: colors.brandPrimary, fontWeight: '700' },
  tlDesc: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  tlDate: { color: colors.mutedText, fontSize: 11, marginTop: 6 },

  detailCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.lg,
  },
  detailSection: {
    color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase',
    marginTop: spacing.md, marginBottom: spacing.sm,
  },
  detailRow: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.divider, gap: spacing.md },
  detailLabel: { color: colors.mutedText, fontSize: 13, width: 100 },
  detailValue: { color: colors.onSurface, fontSize: 13, flex: 1, textAlign: 'right' },
  notes: { color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 4 },

  salaryHero: {
    backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary, borderWidth: 1,
    borderRadius: radius.md, padding: spacing.lg, alignItems: 'center',
  },
  salaryLabel: { color: colors.brandSecondary, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase' },
  salaryValue: {
    color: colors.onSurface, fontSize: 32, fontWeight: '700', marginTop: 4,
    fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }),
  },
  infoBox: {
    marginTop: spacing.lg, flexDirection: 'row', gap: spacing.sm, alignItems: 'center',
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  infoText: { color: colors.onSurfaceTertiary, fontSize: 12, flex: 1 },
});
