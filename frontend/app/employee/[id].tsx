import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, Platform, RefreshControl, Alert, Share,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/src/api/client';
import { confirmAction } from '@/src/utils/confirm';
import { displayDateOnly } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { RecordPhotos } from '@/src/components/RecordPhotos';

type IdProof = { id: string; name: string; uploaded_at: string };

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

const fmtJoinDate = (ds?: string) => (ds ? displayDateOnly(ds) : '—');

export default function EmployeeProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [emp, setEmp] = useState<Emp | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sharingCreds, setSharingCreds] = useState(false);

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

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onDelete = () => {
    confirmAction('Delete employee', 'This cannot be undone.', 'Delete', async () => {
      try { await api.del(`/employees/${id}`); router.replace('/(tabs)/employees'); }
      catch (e: any) { Alert.alert('Failed', e?.detail || 'Could not delete this employee. Please try again.'); }
    });
  };

  // Actually share credentials: generate a fresh temporary password and open
  // the share sheet with the login details — this is the working flow (the
  // button used to just open the set-password form and do nothing).
  const onShareCredentials = () => {
    if (!emp) return;
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

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="employee-profile">
      {/* Clean top bar — no gradient/textured cover */}
      <View style={styles.headerBar}>
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

      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Identity block */}
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
            <StatusChip status={emp.status} />
          </View>

          <View style={styles.actionLinkRow}>
            <Pressable onPress={() => router.push(`/ledger/${emp.id}`)} style={styles.ledgerLink} testID="open-ledger-btn">
              <Ionicons name="book-outline" size={16} color={colors.onBrandPrimary} />
              <Text style={styles.ledgerLinkText}>Open Ledger</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.onBrandPrimary} />
            </Pressable>

            <Pressable onPress={onShareCredentials} disabled={sharingCreds} style={styles.shareCredsLink} testID="share-credentials-btn">
              {sharingCreds ? <ActivityIndicator size="small" color={colors.brandSecondary} /> : <Ionicons name="key-outline" size={16} color={colors.brandSecondary} />}
              <Text style={styles.shareCredsLinkText}>Share Credentials</Text>
            </Pressable>
          </View>
        </View>

        <View style={{ paddingHorizontal: spacing.lg }}>
          <DetailsCard emp={emp} onReload={load} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatusChip({ status }: { status: Emp['status'] }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const map = {
    active: { bg: colors.success, bd: colors.onSuccess, fg: colors.onSuccess, label: 'Active' },
    on_leave: { bg: colors.warning, bd: colors.onWarning, fg: colors.onWarning, label: 'On Leave' },
    inactive: { bg: colors.error, bd: colors.onError, fg: colors.onError, label: 'Inactive' },
  } as const;
  const s = map[status] || map.active;
  return (
    <View style={[styles.statusChip, { backgroundColor: s.bg, borderColor: s.bd }]}>
      <Text style={[styles.statusChipText, { color: s.fg }]}>{s.label}</Text>
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

      <RecordPhotos refType="employee" refId={emp.id} label="Photos" />

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
  const [openingId, setOpeningId] = useState<string | null>(null);

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

  // The proof's base64 is no longer in the profile payload (kept out to speed
  // the page up) — fetch it on demand, then open it.
  const view = async (p: IdProof) => {
    setOpeningId(p.id);
    try {
      const res = await api.get<{ data_uri: string }>(`/employees/${empId}/id-proofs/${p.id}`);
      if (res.data_uri && Platform.OS === 'web' && typeof window !== 'undefined') window.open(res.data_uri, '_blank');
    } catch (e: any) {
      Alert.alert('Failed', e?.detail || 'Could not open this document');
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <View>
      {proofs.length === 0 && (
        <Text style={[styles.notes, { marginBottom: spacing.sm }]}>No ID proofs uploaded yet — Aadhaar, PAN, or any other document.</Text>
      )}
      {proofs.map((p) => (
        <Pressable key={p.id} onPress={() => view(p)} style={styles.proofRow} testID={`id-proof-${p.id}`}>
          {openingId === p.id
            ? <ActivityIndicator size="small" color={colors.brandSecondary} />
            : <Ionicons name="document-attach-outline" size={18} color={colors.brandSecondary} />}
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

  identity: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md },
  bigAvatar: {
    width: 88, height: 88, borderRadius: 44, backgroundColor: colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
  },
  bigAvatarText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 32 },
  bigAvatarPhoto: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.surfaceTertiary },

  name: {
    color: colors.onSurface, fontSize: 28, fontWeight: '600',
    fontFamily: fonts.display, marginTop: spacing.md, letterSpacing: -0.5,
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
});
