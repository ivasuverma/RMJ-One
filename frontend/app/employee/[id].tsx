import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, Platform, RefreshControl, Share, Modal, Linking,
} from 'react-native';
import { notify } from '@/src/utils/notify';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, TOKEN_KEY } from '@/src/api/client';
import { storage } from '@/src/utils/storage';
import { useAuth } from '@/src/auth/AuthContext';
import { confirmAction } from '@/src/utils/confirm';
import { displayDateOnly, todayIST } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Sheet } from '@/src/components/ui';
import { SegmentedControl } from '@/src/components/ui/SegmentedControl';
import { DateField } from '@/src/components/DateField';
import { PhotoCaptureModal } from '@/src/components/PhotoCaptureModal';
import { useAccessEditor } from '@/src/hooks/use-access-editor';
import { EmployeeAccessAlerts } from '@/src/components/EmployeeAccessAlerts';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || '';

type IdDoc = { id: string; created_at: string; file: { mime: string } };

type Emp = {
  id: string; name: string; employee_code: string; department: string; location_id?: string | null;
  designation: string; shift: string; salary: number; joining_date?: string; biometric_id?: string;
  mobile: string; address: string; gender?: string | null; guardian_name?: string; date_of_birth?: string;
  aadhaar: string; pan: string;
  bank_account: string; bank_ifsc: string; bank_name: string;
  status: 'active' | 'inactive' | 'on_leave'; notes: string; photo?: string;
  auto_advance_amount?: number | null; auto_advance_day?: number | null;
  left_date?: string | null;
};
type Location = { id: string; name: string };

const STATUS_LABEL: Record<Emp['status'], string> = { active: 'Active', on_leave: 'On Leave', inactive: 'Inactive' };

function maskAadhaar(v?: string): string {
  const digits = (v || '').replace(/\D/g, '');
  if (!digits) return 'Not added';
  const last4 = digits.slice(-4);
  const masked = 'X'.repeat(Math.max(0, digits.length - 4)).match(/.{1,4}/g) || [];
  return [...masked, last4].join(' ');
}

const digitsOnly = (v: string) => v.replace(/\D/g, '');

export default function EmployeeProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [emp, setEmp] = useState<Emp | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sharingCreds, setSharingCreds] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [locations, setLocations] = useState<Location[]>([]);
  const [tab, setTab] = useState<'details' | 'access'>('details');
  const [menuOpen, setMenuOpen] = useState(false);
  const [leftFlowOpen, setLeftFlowOpen] = useState(false);
  const [leftDate, setLeftDate] = useState(todayIST());
  const [markingLeft, setMarkingLeft] = useState(false);
  const [addressOpen, setAddressOpen] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [idDocs, setIdDocs] = useState<IdDoc[]>([]);
  const [idToken, setIdToken] = useState('');
  const [captureOpen, setCaptureOpen] = useState(false);
  const [uploadingProof, setUploadingProof] = useState(false);

  // Access & Alerts editor — shared with Settings > Users' per-person editor
  // (settings/person/[id].tsx) so the two never drift on the underlying data.
  const editor = useAccessEditor(isOwner ? id : undefined);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ employee: Emp }>(`/employees/${id}`);
      setEmp(res.employee);
    } catch (_e) {
      setEmp(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  const loadIdDocs = useCallback(async () => {
    if (!id) return;
    try {
      const res = await api.get<{ items: IdDoc[] }>(`/documents?category=ids&status=done&linked_ref_type=employee&linked_ref_id=${id}`);
      setIdDocs(res.items || []);
    } catch { setIdDocs([]); }
  }, [id]);

  const loadBalance = useCallback(async () => {
    if (!id) return;
    try { setBalance((await api.get<{ closing_balance?: number }>(`/ledger/${id}`)).closing_balance ?? 0); }
    catch { setBalance(null); }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); loadIdDocs(); loadBalance(); }, [load, loadIdDocs, loadBalance]));
  useEffect(() => { api.get<Location[]>('/locations').then(setLocations).catch(() => setLocations([])); }, []);
  useEffect(() => { storage.secureGet<string>(TOKEN_KEY, '').then((t) => setIdToken(t || '')); }, []);

  const saveAccess = async () => {
    const res = await editor.save();
    if (res.ok) notify('Saved', 'Access & alert settings updated.');
    else notify('Failed', res.error);
  };

  // Active employee: primary action is "Deactivate" (opens the Mark as Left
  // sheet below), not delete — a real employee's history must never be
  // destroyable. Already-inactive employee: the same menu item becomes a
  // real delete, which the backend only allows when there's no attendance/
  // payroll/ledger history to lose (a same-day mistake, essentially).
  const onDeactivatePress = () => {
    setMenuOpen(false);
    if (emp?.status === 'active') { setLeftDate(todayIST()); setLeftFlowOpen(true); return; }
    confirmAction('Delete employee', 'This cannot be undone.', 'Delete', async () => {
      try { await api.del(`/employees/${id}`); router.replace('/(tabs)/employees'); }
      catch (e: any) { notify('Failed', e?.detail || 'Could not delete this employee. Please try again.'); }
    });
  };

  const confirmMarkLeft = async () => {
    if (!emp || !leftDate) return;
    setMarkingLeft(true);
    try {
      await api.put(`/employees/${id}`, { ...emp, status: 'inactive', left_date: leftDate });
      setLeftFlowOpen(false);
      await load();
      notify('Marked as Left', `${emp.name} is now inactive as of ${displayDateOnly(leftDate)}.`);
    } catch (e: any) {
      notify('Failed', e?.detail || 'Could not update this employee. Please try again.');
    } finally {
      setMarkingLeft(false);
    }
  };

  const onShareCredentials = () => {
    if (!emp) return;
    setMenuOpen(false);
    const name = emp.name;
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
          notify('Failed', e?.detail || 'Could not reset credentials. Please try again.');
        } finally {
          setSharingCreds(false);
        }
      },
    );
  };

  const onResetPassword = () => {
    setMenuOpen(false);
    router.push(`/employee/set-credentials/${id}` as any);
  };

  const onSignOutAll = () => {
    if (!emp) return;
    setMenuOpen(false);
    confirmAction(
      'Sign out all devices',
      `${emp.name} will be signed out everywhere and need to log in again — their password stays the same.`,
      'Sign Out',
      async () => {
        setSigningOut(true);
        try { await api.post(`/employees/${id}/sign-out`, {}); notify('Done', 'Signed out on every device.'); }
        catch (e: any) { notify('Failed', e?.detail || 'Please try again.'); }
        finally { setSigningOut(false); }
      },
    );
  };

  const addIdProof = async (dataUri: string) => {
    setCaptureOpen(false);
    if (!emp) return;
    setUploadingProof(true);
    try {
      const blob = await (await fetch(dataUri)).blob();
      const form = new FormData();
      form.append('file', blob as any, `id-${Date.now()}.jpg`);
      form.append('category_key', 'ids');
      const doc = await api.upload<{ id: string }>('/documents', form);
      await api.patch(`/documents/${doc.id}/record`, {
        linked_ref_type: 'employee', linked_ref_id: emp.id, linked_ref_label: emp.name,
      });
      await loadIdDocs();
    } catch (e: any) {
      notify('Failed', e?.detail || 'Could not add this document');
    } finally {
      setUploadingProof(false);
    }
  };

  const docFileUri = (docId: string, thumb = false) => `${BASE}/api/documents/${docId}/file${thumb ? '?thumb=1' : '?full=1'}`;
  const openIdDoc = async (docId: string) => {
    try {
      const res = await fetch(docFileUri(docId), { headers: { Authorization: `Bearer ${idToken}` } });
      if (!res.ok) throw new Error();
      if (Platform.OS === 'web') window.open(URL.createObjectURL(await res.blob()), '_blank');
    } catch { /* ignore */ }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.headerBar}>
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
  if (!emp) {
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

  const initials = emp.name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('');
  const locationName = locations.find((l) => l.id === emp.location_id)?.name || '—';
  const statusDotColor = emp.status === 'active' ? colors.onSuccess : emp.status === 'on_leave' ? colors.brandPrimary : colors.mutedText;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="employee-profile">
      <View style={styles.headerBar}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => router.push(`/employee/edit/${emp.id}`)} style={styles.editLink} testID="edit-btn" hitSlop={12}>
          <Text style={styles.editLinkText}>Edit</Text>
        </Pressable>
        <Pressable onPress={() => setMenuOpen(true)} style={[styles.iconBtn, { marginLeft: spacing.sm }]} testID="menu-btn" hitSlop={12}>
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.onSurface} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); loadIdDocs(); loadBalance(); editor.reload(); }} tintColor={colors.brandPrimary} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.identity}>
          {emp.photo ? (
            <Image source={{ uri: emp.photo }} style={styles.bigAvatarPhoto} />
          ) : (
            <View style={styles.bigAvatar}><Text style={styles.bigAvatarText}>{initials}</Text></View>
          )}
          <Text style={styles.name} numberOfLines={2}>{emp.name}</Text>
          <Text style={styles.designation}>{emp.designation || '—'} · {emp.department || '—'}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.metaChip}>{emp.employee_code}</Text>
            <Text style={styles.statusLine}>
              <Text style={{ color: statusDotColor }}>● </Text>
              {STATUS_LABEL[emp.status]}
            </Text>
          </View>
        </View>

        <View style={styles.actionsRow}>
          <QuickAction icon="call-outline" label="Call" disabled={!emp.mobile} onPress={() => Linking.openURL(`tel:${emp.mobile}`)} testID="act-call" />
          <QuickAction icon="logo-whatsapp" label="WhatsApp" disabled={!emp.mobile} onPress={() => Linking.openURL(`https://wa.me/91${digitsOnly(emp.mobile)}`)} testID="act-whatsapp" />
          <QuickAction icon="key-outline" label="Share login" loading={sharingCreds} onPress={onShareCredentials} testID="act-share-login" />
          <QuickAction icon="calendar-outline" label="Attendance" onPress={() => router.push(`/attendance/calendar/${emp.id}` as any)} testID="act-attendance" />
        </View>

        {isOwner && (
          <View style={{ paddingHorizontal: spacing.lg, marginTop: spacing.lg }}>
            <SegmentedControl
              options={[{ key: 'details', label: 'Details' }, { key: 'access', label: 'Access & Alerts' }]}
              value={tab} onChange={(k) => setTab(k as any)} testID="profile-tabs"
            />
          </View>
        )}

        <View style={{ paddingHorizontal: spacing.lg, marginTop: spacing.lg }}>
          {(tab === 'details' || !isOwner) && (
            <>
              <GroupTitle text="Pay" />
              <Group>
                <Row label="Salary" value={`₹${Math.round(emp.salary || 0).toLocaleString('en-IN')} / month`} valueColor={colors.onSuccess} />
                <Row label="Advances & ledger" value={balance == null ? '…' : `₹${Math.round(balance).toLocaleString('en-IN')}`} chevron onPress={() => router.push(`/ledger/${emp.id}` as any)} testID="open-ledger-row" />
              </Group>

              <GroupTitle text="Contact" />
              <Group>
                <Row label="Mobile" value={emp.mobile || '—'} />
                <Row label="Address" value={emp.address || '—'} valueLines={addressOpen ? undefined : 1} chevron onPress={() => setAddressOpen((v) => !v)} testID="address-row" />
              </Group>

              <GroupTitle text="Personal" />
              <Group>
                <Row label="Gender" value={emp.gender ? emp.gender.charAt(0).toUpperCase() + emp.gender.slice(1) : '—'} />
                <Row label="Guardian" value={emp.guardian_name || '—'} />
                <Row label="Date of birth" value={emp.date_of_birth ? displayDateOnly(emp.date_of_birth) : 'Not added'} />
              </Group>

              <GroupTitle text="Work" />
              <Group>
                <Row label="Department" value={emp.department || '—'} />
                <Row label="Location" value={locationName} />
                <Row label="Shift" value={emp.shift || '—'} />
              </Group>

              <GroupTitle text="Identity" />
              <Group>
                <Row label="Aadhaar" value={maskAadhaar(emp.aadhaar)} />
                <Row label="PAN" value={emp.pan || 'Not added'} />
                <Row label="＋ Add ID proof or photo" value="" labelColor={colors.brandPrimary} chevron onPress={() => setCaptureOpen(true)} testID="add-id-proof-row" />
              </Group>
              {uploadingProof && <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.sm }} />}
              {idDocs.length > 0 && (
                <View style={styles.docGrid}>
                  {idDocs.map((d) => (
                    <Pressable key={d.id} onPress={() => openIdDoc(d.id)} style={styles.docTile} testID={`id-doc-${d.id}`}>
                      {idToken ? <Image source={{ uri: docFileUri(d.id, true), headers: { Authorization: `Bearer ${idToken}` } }} style={styles.docImg} contentFit="cover" /> : null}
                    </Pressable>
                  ))}
                </View>
              )}
              <Text style={styles.foot}>ID proofs are stored in Documents and backed up to Google Drive.</Text>
            </>
          )}

          {tab === 'access' && isOwner && (
            editor.loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginVertical: spacing.lg }} /> : editor.loadError ? (
              <ErrorNote onRetry={editor.reload} />
            ) : (
              <EmployeeAccessAlerts editor={editor} onSave={saveAccess} />
            )
          )}
        </View>
      </ScrollView>

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title={emp.name} testID="employee-menu-sheet">
        <MenuRow icon="key-outline" label="Share login details" onPress={onShareCredentials} />
        <MenuRow icon="refresh-outline" label="Reset password" onPress={onResetPassword} />
        <MenuRow icon="log-out-outline" label="Sign out all devices" onPress={onSignOutAll} loading={signingOut} />
        <MenuRow icon={emp.status === 'active' ? 'remove-circle-outline' : 'trash-outline'} label={emp.status === 'active' ? 'Deactivate employee' : 'Delete employee'} onPress={onDeactivatePress} danger />
      </Sheet>

      <Modal visible={leftFlowOpen} animationType="slide" transparent onRequestClose={() => setLeftFlowOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Mark {emp.name} as Left</Text>
            <DateField label="Last working day" value={leftDate} onChange={setLeftDate} testID="left-date-field" />
            <Text style={styles.modalHint}>This will:</Text>
            <View style={styles.modalList}>
              <Text style={styles.modalListItem}>• Turn off their login</Text>
              <Text style={styles.modalListItem}>• Stop attendance being expected from this date on</Text>
              <Text style={styles.modalListItem}>• Stop auto-paid Sundays after this date</Text>
              <Text style={styles.modalListItem}>• Turn off their notifications</Text>
              <Text style={styles.modalListItem}>• Prorate this month&apos;s salary up to this date</Text>
            </View>
            <Text style={styles.modalHint}>Once their final salary is paid and the ledger is settled, they&apos;ll move to the Left filter in Employees.</Text>
            <View style={styles.modalActions}>
              <Pressable onPress={() => setLeftFlowOpen(false)} style={styles.modalCancelBtn} testID="left-flow-cancel">
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={confirmMarkLeft} disabled={markingLeft || !leftDate} style={[styles.modalConfirmBtn, (markingLeft || !leftDate) && { opacity: 0.6 }]} testID="left-flow-confirm">
                {markingLeft ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.modalConfirmText}>Mark as Left</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <PhotoCaptureModal visible={captureOpen} title="ID proof or photo" onClose={() => setCaptureOpen(false)} onCapture={addIdProof} highRes />
    </SafeAreaView>
  );
}

function ErrorNote({ onRetry }: { onRetry: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={{ alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg }}>
      <Text style={{ color: colors.onError, fontSize: 13, textAlign: 'center' }}>Couldn&apos;t load this — check your connection.</Text>
      <Pressable onPress={onRetry} style={styles.saveAccessBtn} testID="access-retry-btn">
        <Text style={styles.saveAccessText}>Retry</Text>
      </Pressable>
    </View>
  );
}

function QuickAction({ icon, label, onPress, disabled, loading, testID }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; disabled?: boolean; loading?: boolean; testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable onPress={onPress} disabled={disabled || loading} style={[styles.actTile, disabled && { opacity: 0.4 }]} testID={testID}>
      {loading ? <ActivityIndicator size="small" color={colors.brandSecondary} /> : <Ionicons name={icon} size={19} color={colors.brandSecondary} />}
      <Text style={styles.actLabel} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function MenuRow({ icon, label, onPress, danger, loading }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; danger?: boolean; loading?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable onPress={onPress} disabled={loading} style={styles.menuRow} testID={`menu-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      {loading ? <ActivityIndicator size="small" color={colors.mutedText} /> : <Ionicons name={icon} size={19} color={danger ? colors.onError : colors.onSurface} />}
      <Text style={[styles.menuRowText, danger && { color: colors.onError }]}>{label}</Text>
    </Pressable>
  );
}

function GroupTitle({ text }: { text: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <Text style={styles.groupTitle}>{text}</Text>;
}

function Group({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <View style={styles.group}>{children}</View>;
}

function Row({ label, value, chevron, onPress, valueColor, labelColor, valueLines, testID }: {
  label: string; value: string; chevron?: boolean; onPress?: () => void; valueColor?: string; labelColor?: string; valueLines?: number; testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const Wrap = onPress ? Pressable : View;
  return (
    <Wrap onPress={onPress} style={styles.row} testID={testID}>
      <Text style={[styles.rowLabel, labelColor && { color: labelColor }]}>{label}</Text>
      {!!value && <Text style={[styles.rowValue, valueColor && { color: valueColor }]} numberOfLines={valueLines}>{value}</Text>}
      {chevron && <Ionicons name="chevron-forward" size={16} color={colors.mutedText} />}
    </Wrap>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  centered: { flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  backBtnBig: { marginTop: spacing.md, backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.xl, paddingVertical: 12, borderRadius: radius.md },

  headerBar: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm, paddingBottom: spacing.sm,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  editLink: { paddingHorizontal: spacing.sm, height: 40, alignItems: 'center', justifyContent: 'center' },
  editLinkText: { color: colors.brandSecondary, fontSize: 16, fontWeight: '600' },

  identity: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md, alignItems: 'center' },
  bigAvatar: {
    width: 88, height: 88, borderRadius: 44, backgroundColor: colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
  },
  bigAvatarText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 32 },
  bigAvatarPhoto: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.surfaceTertiary },

  name: {
    color: colors.onSurface, fontSize: 26, fontWeight: '600',
    fontFamily: fonts.display, marginTop: spacing.md, letterSpacing: -0.4, textAlign: 'center',
  },
  designation: { color: colors.onSurfaceTertiary, fontSize: 15, marginTop: 4, textAlign: 'center' },
  metaRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, alignItems: 'center' },
  metaChip: {
    color: colors.brandSecondary, fontSize: 12, fontWeight: '600',
    backgroundColor: colors.brandTertiary, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill,
  },
  statusLine: { color: colors.mutedText, fontSize: 13 },

  actionsRow: {
    flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, marginTop: spacing.md,
  },
  actTile: {
    flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingVertical: 12, alignItems: 'center', gap: 5,
  },
  actLabel: { color: colors.brandSecondary, fontSize: 11, fontWeight: '700' },

  groupTitle: {
    color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase',
    marginTop: spacing.lg, marginBottom: spacing.sm,
  },
  group: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider,
  },
  rowLabel: { color: colors.onSurfaceSecondary, fontSize: 14.5, flex: 1 },
  rowValue: { color: colors.onSurface, fontSize: 14.5, textAlign: 'right', flexShrink: 1 },
  foot: { color: colors.mutedText, fontSize: 11.5, marginTop: spacing.sm, lineHeight: 16 },

  docGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  docTile: { width: 76, height: 76, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surfaceTertiary },
  docImg: { width: '100%', height: '100%' },

  menuRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 14 },
  menuRowText: { color: colors.onSurface, fontSize: 16, fontWeight: '500' },

  saveAccessBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg },
  saveAccessText: { color: colors.onBrandPrimary, fontSize: 14, fontWeight: '700' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.sm,
  },
  modalTitle: { color: colors.onSurface, fontSize: 18, fontWeight: '700', fontFamily: fonts.display, marginBottom: spacing.xs },
  modalHint: { color: colors.mutedText, fontSize: 12.5, marginTop: spacing.sm, lineHeight: 18 },
  modalList: { gap: 4 },
  modalListItem: { color: colors.onSurfaceSecondary, fontSize: 13 },
  modalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  modalCancelBtn: { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  modalCancelText: { color: colors.onSurfaceSecondary, fontWeight: '700', fontSize: 14 },
  modalConfirmBtn: { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: radius.md, backgroundColor: colors.onWarning },
  modalConfirmText: { color: colors.surface, fontWeight: '700', fontSize: 14 },
});
