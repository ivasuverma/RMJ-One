import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, Platform, RefreshControl, Alert, Share,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/src/api/client';
import { confirmAction } from '@/src/utils/confirm';
import { istDisplayDate, displayDateOnly } from '@/src/utils/datetime';
import { spacing, radius, images, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type IdProof = { id: string; name: string; data_uri: string; uploaded_at: string };

type Emp = {
  id: string; name: string; employee_code: string; department: string;
  designation: string; shift: string; salary: number; joining_date?: string;
  mobile: string; address: string; aadhaar: string; pan: string;
  bank_account: string; bank_ifsc: string; bank_name: string;
  status: 'active' | 'inactive' | 'on_leave'; notes: string; photo?: string;
  id_proofs?: IdProof[];
  auto_advance_amount?: number | null; auto_advance_day?: number | null;
};

function pickIdProofFile(): Promise<{ name: string; dataUri: string } | null> {
  return new Promise((resolve) => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') { resolve(null); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,application/pdf';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) { resolve(null); return; }
      if (file.size > 8 * 1024 * 1024) {
        Alert.alert('Too large', 'Please choose a file under 8 MB.');
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, dataUri: String(reader.result || '') });
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    input.click();
  });
}
type TL = { id: string; type: string; title: string; description: string; amount: number; created_at: string };

const TABS = ['Details', 'Payroll', 'Timeline'] as const;
type TabKey = typeof TABS[number];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Timeline entries carry a real UTC timestamp (needs IST conversion);
// joining_date is a bare 'YYYY-MM-DD' the owner picked (no timezone
// conversion applicable — see displayDateOnly for why these are handled
// differently instead of sharing one formatter).
const fmtDate = (iso?: string) => (iso ? istDisplayDate(iso) : '—');
const fmtJoinDate = (ds?: string) => (ds ? displayDateOnly(ds) : '—');
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
  const { colors, scheme } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<{ employee: Emp; timeline: TL[] } | null>(null);
  const [tab, setTab] = useState<TabKey>('Details');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sharingCreds, setSharingCreds] = useState(false);

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
    confirmAction('Delete employee', 'This cannot be undone.', 'Delete', async () => {
      try { await api.del(`/employees/${id}`); router.replace('/(tabs)/employees'); }
      catch (e: any) { Alert.alert('Failed', e?.detail || 'Could not delete this employee. Please try again.'); }
    });
  };

  const onShareCredentials = () => {
    if (!data) return;
    const name = data.employee.name;
    confirmAction(
      'Share login credentials',
      `This generates a new temporary password for ${name} and opens the share sheet. Their current password stops working immediately, and they'll be asked to set a new one the first time they log in.`,
      'Generate & Share',
      async () => {
        setSharingCreds(true);
        try {
          const res = await api.post<{ username: string; password: string }>(`/employees/${id}/reset-credentials`, {});
          Share.share({
            message: `RMJ-One login for ${name}\nUsername: ${res.username}\nTemporary Password: ${res.password}\n\nPlease log in and set your own password when asked.`,
          }).catch(() => {});
        } catch (e: any) {
          Alert.alert('Failed', e?.detail || 'Could not reset credentials. Please try again.');
        } finally {
          setSharingCreds(false);
        }
      },
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.loadingHeader}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.brandPrimary} size="large" />
        </View>
      </SafeAreaView>
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
  const gradientColors: [string, string] = scheme === 'light'
    ? ['rgba(247,241,230,0.35)', 'rgba(247,241,230,0.97)']
    : ['rgba(13,13,13,0.4)', 'rgba(13,13,13,0.98)'];

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
          <LinearGradient colors={gradientColors} style={StyleSheet.absoluteFill} />
          <SafeAreaView edges={['top']}>
            <View style={styles.coverTop}>
              <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
                <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
              </Pressable>
              <View style={{ flex: 1 }} />
              <Pressable onPress={() => router.push(`/employee/set-credentials/${emp.id}`)} style={styles.iconBtn} testID="pin-btn" hitSlop={12}>
                <Ionicons name="key-outline" size={20} color={colors.onSurface} />
              </Pressable>
              <Pressable onPress={() => router.push(`/employee/edit/${emp.id}`)} style={[styles.iconBtn, { marginLeft: spacing.sm }]} testID="edit-btn" hitSlop={12}>
                <Ionicons name="create-outline" size={20} color={colors.onSurface} />
              </Pressable>
              <Pressable onPress={onDelete} style={[styles.iconBtn, { marginLeft: spacing.sm }]} testID="delete-btn" hitSlop={12}>
                <Ionicons name="trash-outline" size={20} color={colors.onError} />
              </Pressable>
            </View>
          </SafeAreaView>
          <View style={styles.avatarWrap}>
            {emp.photo ? (
              <Image source={{ uri: emp.photo }} style={styles.bigAvatarPhoto} />
            ) : (
              <View style={styles.bigAvatar}>
                <Text style={styles.bigAvatarText}>{initials}</Text>
              </View>
            )}
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

          <View style={styles.actionLinkRow}>
            <Pressable
              onPress={() => router.push(`/ledger/${emp.id}`)}
              style={styles.ledgerLink}
              testID="open-ledger-btn"
            >
              <Ionicons name="book-outline" size={16} color={colors.onBrandPrimary} />
              <Text style={styles.ledgerLinkText}>Open Ledger</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.onBrandPrimary} />
            </Pressable>

            <Pressable
              onPress={() => router.push(`/employee/set-credentials/${emp.id}`)}
              style={styles.shareCredsLink}
              testID="share-credentials-btn"
            >
              <Ionicons name="key-outline" size={16} color={colors.brandSecondary} />
              <Text style={styles.shareCredsLinkText}>Share Credentials</Text>
            </Pressable>
          </View>
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
          {tab === 'Details' && <DetailsCard emp={emp} onReload={load} />}
          {tab === 'Payroll' && <PayrollCard emp={emp} />}
          {tab === 'Timeline' && <TimelineList items={data.timeline} />}
        </View>
      </ScrollView>
    </View>
  );
}

function StatusChip({ status }: { status: Emp['status'] }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const map = {
    active: { label: 'Active', bg: colors.success, bd: colors.onSuccess, fg: colors.onSuccess },
    on_leave: { label: 'On Leave', bg: colors.warning, bd: colors.onWarning, fg: colors.onWarning },
    inactive: { label: 'Inactive', bg: colors.error, bd: colors.onError, fg: colors.onError },
  } as const;
  const s = map[status] || map.active;
  return (
    <View style={[styles.statusChip, { backgroundColor: s.bg, borderColor: s.bd }]}>
      <Text style={[styles.statusChipText, { color: s.fg }]}>{s.label}</Text>
    </View>
  );
}

function TimelineList({ items }: { items: TL[] }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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

function DetailsCard({ emp, onReload }: { emp: Emp; onReload: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
      <DetailRow label="Joined" value={fmtJoinDate(emp.joining_date)} />

      <SectionTitle text="Bank" />
      <DetailRow label="Bank" value={emp.bank_name || '—'} />
      <DetailRow label="Account" value={emp.bank_account || '—'} />
      <DetailRow label="IFSC" value={emp.bank_ifsc || '—'} />

      <SectionTitle text="ID Proofs" />
      <IdProofsSection empId={emp.id} proofs={emp.id_proofs || []} onChange={onReload} />

      {!!emp.notes && (
        <>
          <SectionTitle text="Notes" />
          <Text style={styles.notes}>{emp.notes}</Text>
        </>
      )}
    </View>
  );
}

function IdProofsSection({ empId, proofs, onChange }: { empId: string; proofs: IdProof[]; onChange: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const upload = async () => {
    const file = await pickIdProofFile();
    if (!file) return;
    setUploading(true);
    try {
      await api.post(`/employees/${empId}/id-proofs`, { name: file.name, data_uri: file.dataUri });
      onChange();
    } catch (e: any) {
      Alert.alert('Upload failed', e?.detail || 'Please try again');
    } finally {
      setUploading(false);
    }
  };

  const remove = (p: IdProof) => {
    confirmAction('Delete document', `Remove "${p.name}"?`, 'Delete', async () => {
      setDeletingId(p.id);
      try {
        await api.del(`/employees/${empId}/id-proofs/${p.id}`);
        onChange();
      } catch (e: any) {
        Alert.alert('Failed', e?.detail || 'Could not delete this document');
      } finally {
        setDeletingId(null);
      }
    });
  };

  const view = (p: IdProof) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(p.data_uri, '_blank');
  };

  return (
    <View>
      {proofs.length === 0 && (
        <Text style={[styles.notes, { marginBottom: spacing.sm }]}>No ID proofs uploaded yet — Aadhaar, PAN, or any other document.</Text>
      )}
      {proofs.map((p) => (
        <Pressable key={p.id} onPress={() => view(p)} style={styles.proofRow} testID={`id-proof-${p.id}`}>
          <Ionicons name="document-attach-outline" size={18} color={colors.brandSecondary} />
          <Text style={styles.proofName} numberOfLines={1}>{p.name}</Text>
          <Pressable
            onPress={() => remove(p)}
            hitSlop={10}
            disabled={deletingId === p.id}
            style={styles.proofDelBtn}
            testID={`del-id-proof-${p.id}`}
          >
            {deletingId === p.id
              ? <ActivityIndicator size="small" color={colors.onError} />
              : <Ionicons name="trash-outline" size={16} color={colors.onError} />}
          </Pressable>
        </Pressable>
      ))}
      <Pressable style={[styles.uploadBtn, uploading && { opacity: 0.6 }]} onPress={upload} disabled={uploading} testID="upload-id-proof-btn">
        {uploading ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : (
          <>
            <Ionicons name="add-circle-outline" size={18} color={colors.brandPrimary} />
            <Text style={styles.uploadBtnText}>Add ID Proof</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

function PayrollCard({ emp }: { emp: Emp }) {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const payrollCardStyles = useMemo(() => makePayrollCardStyles(colors), [colors]);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [row, setRow] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<any>(`/payroll/${year}/${month}`);
      const found = (res.rows || []).find((r: any) => r.employee_id === emp.id);
      setRow(found ? { ...found, _saved: res.saved } : null);
    } catch (_e) { setRow(null); }
    finally { setLoading(false); }
  }, [emp.id, year, month]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const stepMonth = (delta: number) => {
    let m = month + delta, y = year;
    if (m > 12) { m = 1; y += 1; }
    if (m < 1) { m = 12; y -= 1; }
    setMonth(m); setYear(y);
  };

  return (
    <View style={styles.detailCard}>
      <SectionTitle text="Compensation" />
      <View style={styles.salaryHero}>
        <Text style={styles.salaryLabel}>Monthly Salary</Text>
        <Text style={styles.salaryValue}>{fmtINR(emp.salary)}</Text>
      </View>
      <View style={{ height: spacing.md }} />
      <DetailRow label="Shift" value={emp.shift || 'General'} />
      <DetailRow label="Joined" value={fmtJoinDate(emp.joining_date)} />
      {!!emp.auto_advance_amount && !!emp.auto_advance_day && (
        <DetailRow
          label="Auto Advance"
          value={`${fmtINR(emp.auto_advance_amount)} on day ${emp.auto_advance_day}`}
        />
      )}

      <View style={payrollCardStyles.monthRow}>
        <Pressable onPress={() => stepMonth(-1)} style={payrollCardStyles.monthNav} testID="emp-payroll-prev" hitSlop={8}>
          <Ionicons name="chevron-back" size={18} color={colors.onSurface} />
        </Pressable>
        <Text style={payrollCardStyles.monthLabel}>{MONTHS[month - 1]} {year}</Text>
        <Pressable onPress={() => stepMonth(1)} style={payrollCardStyles.monthNav} testID="emp-payroll-next" hitSlop={8}>
          <Ionicons name="chevron-forward" size={18} color={colors.onSurface} />
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginVertical: spacing.lg }} />
      ) : !row ? (
        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={16} color={colors.brandSecondary} />
          <Text style={styles.infoText}>No attendance recorded for this month yet.</Text>
        </View>
      ) : (
        <>
          <View style={payrollCardStyles.glance} testID="emp-payroll-glance">
            <GlanceCell label="Present" value={String(row.present_days)} />
            <GlanceCell label="Half" value={String(row.half_days)} />
            <GlanceCell label="Paid Off" value={String(row.weekly_off_days ?? 0)} />
            <GlanceCell label="Leave" value={String(row.leave_days)} />
          </View>
          <View style={[payrollCardStyles.netRow, row.paid && payrollCardStyles.netRowPaid]}>
            <View>
              <Text style={payrollCardStyles.netLabel}>{row.paid ? 'PAID THIS MONTH' : row._saved ? 'CALCULATED (UNPAID)' : 'ESTIMATED'}</Text>
              <Text style={payrollCardStyles.netVal}>{fmtINR(row.net_salary)}</Text>
            </View>
            {row.paid && <Ionicons name="checkmark-circle" size={22} color={colors.brandPrimary} />}
          </View>
          <Pressable
            style={payrollCardStyles.detailBtn}
            testID="emp-payroll-open-detail"
            onPress={() => router.push({ pathname: '/payroll/[emp]', params: { emp: emp.id, year: String(year), month: String(month) } })}
          >
            <Ionicons name="document-text-outline" size={16} color={colors.onSurface} />
            <Text style={payrollCardStyles.detailBtnText}>View full breakdown & formula</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.onSurface} />
          </Pressable>
        </>
      )}
    </View>
  );
}

function GlanceCell({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  const payrollCardStyles = useMemo(() => makePayrollCardStyles(colors), [colors]);
  return (
    <View style={payrollCardStyles.glanceCell}>
      <Text style={payrollCardStyles.glanceValue}>{value}</Text>
      <Text style={payrollCardStyles.glanceLabel}>{label}</Text>
    </View>
  );
}

const makePayrollCardStyles = (colors: ThemeColors) => StyleSheet.create({
  monthRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg,
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 6,
  },
  monthNav: { width: 32, height: 32, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  monthLabel: { flex: 1, textAlign: 'center', color: colors.onSurface, fontWeight: '700', fontSize: 13 },
  glance: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  glanceCell: {
    flex: 1, backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, paddingVertical: spacing.sm, alignItems: 'center',
  },
  glanceValue: { color: colors.brandPrimary, fontSize: 16, fontWeight: '800' },
  glanceLabel: { color: colors.mutedText, fontSize: 10, marginTop: 2 },
  netRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginTop: spacing.md,
  },
  netRowPaid: { backgroundColor: colors.success, borderColor: colors.onSuccess },
  netLabel: { color: colors.brandSecondary, fontSize: 10, letterSpacing: 0.6 },
  netVal: { color: colors.onSurface, fontSize: 20, fontWeight: '800', marginTop: 2 },
  detailBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md,
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md,
  },
  detailBtnText: { flex: 1, color: colors.onSurface, fontWeight: '600', fontSize: 13 },
});

function SectionTitle({ text }: { text: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <Text style={styles.detailSection}>{text}</Text>;
}
function DetailRow({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  centered: { flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  loadingHeader: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  backBtnBig: { marginTop: spacing.md, backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.xl, paddingVertical: 12, borderRadius: radius.md },

  cover: { height: 220, backgroundColor: colors.surfaceSecondary, position: 'relative' },
  coverTop: { flexDirection: 'row', paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  avatarWrap: { position: 'absolute', bottom: -36, left: spacing.lg },
  bigAvatar: {
    width: 88, height: 88, borderRadius: 44, backgroundColor: colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.surface,
  },
  bigAvatarText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 32 },
  bigAvatarPhoto: {
    width: 88, height: 88, borderRadius: 44, backgroundColor: colors.surfaceTertiary,
    borderWidth: 3, borderColor: colors.surface,
  },

  nameBlock: { paddingHorizontal: spacing.lg, paddingTop: spacing.xxl + spacing.md, paddingBottom: spacing.md },
  name: {
    color: colors.onSurface, fontSize: 28, fontWeight: '600',
    fontFamily: fonts.display,
  },
  designation: { color: colors.onSurfaceTertiary, fontSize: 14, marginTop: 4 },
  metaRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, alignItems: 'center' },
  actionLinkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  ledgerLink: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.brandPrimary, paddingVertical: 10, paddingHorizontal: spacing.md,
    borderRadius: radius.md, alignSelf: 'flex-start',
  },
  ledgerLinkText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 13 },
  shareCredsLink: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.brand,
    paddingVertical: 10, paddingHorizontal: spacing.md, borderRadius: radius.md, alignSelf: 'flex-start',
  },
  shareCredsLinkText: { color: colors.brandSecondary, fontWeight: '700', fontSize: 13 },
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

  proofRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, paddingVertical: 10, paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  proofName: { flex: 1, color: colors.onSurface, fontSize: 13 },
  proofDelBtn: {
    width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.error, borderColor: colors.onError, borderWidth: 1,
  },
  uploadBtn: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.brandPrimary, borderStyle: 'dashed',
    paddingVertical: 12, marginTop: spacing.xs,
  },
  uploadBtnText: { color: colors.brandPrimary, fontWeight: '700', fontSize: 13 },

  salaryHero: {
    backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary, borderWidth: 1,
    borderRadius: radius.md, padding: spacing.lg, alignItems: 'center',
  },
  salaryLabel: { color: colors.brandSecondary, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase' },
  salaryValue: {
    color: colors.onSurface, fontSize: 32, fontWeight: '700', marginTop: 4,
    fontFamily: fonts.display,
  },
  infoBox: {
    marginTop: spacing.lg, flexDirection: 'row', gap: spacing.sm, alignItems: 'center',
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  infoText: { color: colors.onSurfaceTertiary, fontSize: 12, flex: 1 },
});
