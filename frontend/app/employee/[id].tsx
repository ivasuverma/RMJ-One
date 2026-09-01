import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, Platform, RefreshControl, Alert, Share, Switch,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { confirmAction } from '@/src/utils/confirm';
import { displayDateOnly } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { RecordPhotos } from '@/src/components/RecordPhotos';
import { SegmentedControl } from '@/src/components/ui/SegmentedControl';

type IdProof = { id: string; name: string; uploaded_at: string };
type Location = { id: string; name: string };

type Emp = {
  id: string; name: string; employee_code: string; department: string; location_id?: string | null;
  designation: string; shift: string; salary: number; joining_date?: string; biometric_id?: string;
  mobile: string; address: string; gender?: string | null; guardian_name?: string;
  aadhaar: string; pan: string;
  bank_account: string; bank_ifsc: string; bank_name: string;
  status: 'active' | 'inactive' | 'on_leave'; notes: string; photo?: string;
  id_proofs?: IdProof[];
  auto_advance_amount?: number | null; auto_advance_day?: number | null;
};

// Access/notifications editor, imported here from Settings > People & Roles
// (settings/person/[id].tsx) so an owner can manage a person's access right
// from their profile instead of a separate screen.
type ModuleDef = { key: string; label: string; default_roles: string[]; employee_assignable?: boolean };
type Rights = { edit?: boolean; delete?: boolean };
type Counter = { id: string; name: string };
type NotifModule = { key: string; label: string; default_roles: string[]; events?: { key: string; label: string }[] };
type AccessAccount = {
  id: string; module_access: string[] | null; resolved_modules: string[];
  module_rights?: Record<string, Rights>; cashbook_counter_ids?: string[];
  notifications_enabled?: boolean; notif_prefs?: Record<string, boolean>;
};

type Tab = 'profile' | 'legal' | 'notifications' | 'access';
const TABS: { key: Tab; label: string }[] = [
  { key: 'profile', label: 'Profile' }, { key: 'legal', label: 'Legal & Bank' },
];
const OWNER_TABS: { key: Tab; label: string }[] = [
  ...TABS, { key: 'notifications', label: 'Notifications' }, { key: 'access', label: 'Access' },
];

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
const fmtGender = (g?: string | null) => (g ? g.charAt(0).toUpperCase() + g.slice(1) : '—');

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
  const [locations, setLocations] = useState<Location[]>([]);
  const [tab, setTab] = useState<Tab>('profile');

  // Access tab state
  const [modules, setModules] = useState<ModuleDef[]>([]);
  const [notifModules, setNotifModules] = useState<NotifModule[]>([]);
  const [counters, setCounters] = useState<Counter[]>([]);
  const [mods, setMods] = useState<Set<string>>(new Set());
  const [rights, setRights] = useState<Record<string, Rights>>({});
  const [counterSel, setCounterSel] = useState<Set<string>>(new Set());
  const [notifOn, setNotifOn] = useState(true);
  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>({});
  const [savingAccess, setSavingAccess] = useState(false);

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

  const loadAccess = useCallback(async () => {
    if (!isOwner || !id) return;
    try {
      const [accts, m, nm, c] = await Promise.all([
        api.get<AccessAccount[]>('/access/accounts'),
        api.get<ModuleDef[]>('/access/modules'),
        api.get<NotifModule[]>('/access/notification-modules').catch(() => []),
        api.get<Counter[]>('/cashbook/counters').catch(() => []),
      ]);
      setModules(m); setNotifModules(nm); setCounters(c);
      const a = accts.find((x) => x.id === id);
      if (a) {
        setMods(new Set(a.resolved_modules));
        setRights({ ...(a.module_rights || {}) });
        setCounterSel(new Set(a.cashbook_counter_ids || []));
        setNotifOn(a.notifications_enabled !== false);
        const prefs: Record<string, boolean> = {};
        for (const nmod of nm) {
          prefs[nmod.key] = a.notif_prefs && nmod.key in a.notif_prefs
            ? !!a.notif_prefs[nmod.key]
            : nmod.default_roles.includes('employee');
        }
        setNotifPrefs(prefs);
      }
    } catch { /* owner-only endpoint */ }
  }, [id, isOwner]);

  useFocusEffect(useCallback(() => { load(); loadAccess(); }, [load, loadAccess]));
  useEffect(() => { api.get<Location[]>('/locations').then(setLocations).catch(() => setLocations([])); }, []);

  const availableModules = useMemo(() => modules.filter((m) => m.employee_assignable), [modules]);
  const toggleMod = (k: string) => setMods((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggleCounter = (cid: string) => setCounterSel((p) => { const n = new Set(p); n.has(cid) ? n.delete(cid) : n.add(cid); return n; });
  const toggleRight = (k: string, which: 'edit' | 'delete') => setRights((p) => {
    const r = { ...(p[k] || {}) }; r[which] = !r[which]; return { ...p, [k]: r };
  });

  const saveAccess = async () => {
    if (!emp || savingAccess) return;
    setSavingAccess(true);
    try {
      const mr: Record<string, Rights> = {};
      for (const m of availableModules) {
        if (!mods.has(m.key)) continue;
        const r = rights[m.key];
        if (r) mr[m.key] = { edit: !!r.edit, delete: !!r.delete };
      }
      await api.put(`/access/accounts/${emp.id}`, {
        notifications_enabled: notifOn, notif_prefs: notifPrefs,
        module_access: Array.from(mods), module_rights: mr,
        cashbook_counter_ids: mods.has('cash_book') ? Array.from(counterSel) : [],
      });
      Alert.alert('Saved', 'Access & notification settings updated.');
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setSavingAccess(false); }
  };

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
  const locationName = locations.find((l) => l.id === emp.location_id)?.name || '—';
  const tabsList = isOwner ? OWNER_TABS : TABS;

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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); loadAccess(); }} tintColor={colors.brandPrimary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Identity block — photo, name, status. Actions live in the tabs below. */}
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

          <Pressable onPress={onShareCredentials} disabled={sharingCreds} style={styles.shareCredsLink} testID="share-credentials-btn">
            {sharingCreds ? <ActivityIndicator size="small" color={colors.brandSecondary} /> : <Ionicons name="key-outline" size={16} color={colors.brandSecondary} />}
            <Text style={styles.shareCredsLinkText}>Share Credentials</Text>
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: spacing.lg, marginTop: spacing.md }}>
          <SegmentedControl options={tabsList.map((t) => ({ key: t.key, label: t.label }))} value={tab} onChange={(k) => setTab(k as Tab)} testID="profile-tabs" />
        </View>

        <View style={{ paddingHorizontal: spacing.lg, marginTop: spacing.lg }}>
          <View style={styles.detailCard}>
            {tab === 'profile' && (
              <>
                <SectionTitle text="Basic" />
                <DetailRow label="Mobile" value={emp.mobile || '—'} />
                <DetailRow label="Address" value={emp.address || '—'} />
                <DetailRow label="Gender" value={fmtGender(emp.gender)} />
                <DetailRow label="Guardian's Name" value={emp.guardian_name || '—'} />
                {!!emp.notes && (
                  <>
                    <SectionTitle text="Notes" />
                    <Text style={styles.notes}>{emp.notes}</Text>
                  </>
                )}

                <SectionTitle text="Work" />
                <DetailRow label="Department" value={emp.department || '—'} />
                <DetailRow label="Location / Branch" value={locationName} />
                <DetailRow label="Designation" value={emp.designation || '—'} />
                <DetailRow label="Shift" value={emp.shift || '—'} />
                <DetailRow label="Joined" value={fmtJoinDate(emp.joining_date)} />
                <DetailRow label="Biometric ID" value={emp.biometric_id || '—'} />

                <SectionTitle text="Salary" />
                <DetailRow label="Base Salary" value={`₹${Math.round(emp.salary || 0).toLocaleString('en-IN')}/mo`} />
                <DetailRow label="Auto Advance" value={emp.auto_advance_amount ? `₹${Math.round(emp.auto_advance_amount).toLocaleString('en-IN')} on day ${emp.auto_advance_day}` : 'Off'} />
                <Pressable onPress={() => router.push(`/ledger/${emp.id}`)} style={styles.ledgerLink} testID="open-ledger-btn">
                  <Ionicons name="book-outline" size={16} color={colors.onBrandPrimary} />
                  <Text style={styles.ledgerLinkText}>Open Ledger</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.onBrandPrimary} />
                </Pressable>
              </>
            )}
            {tab === 'legal' && (
              <>
                <SectionTitle text="Legal" />
                <DetailRow label="Aadhaar" value={emp.aadhaar || '—'} />
                <DetailRow label="PAN" value={emp.pan || '—'} />
                <SectionTitle text="ID Proofs" />
                <IdProofsSection empId={emp.id} proofs={emp.id_proofs || []} onChange={load} />
                <RecordPhotos refType="employee" refId={emp.id} label="Photos" />

                <SectionTitle text="Bank" />
                <DetailRow label="Bank" value={emp.bank_name || '—'} />
                <DetailRow label="Account" value={emp.bank_account || '—'} />
                <DetailRow label="IFSC" value={emp.bank_ifsc || '—'} />
              </>
            )}
            {tab === 'notifications' && isOwner && (
              <>
                <SectionTitle text="Notifications" />
                <View style={styles.switchRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.switchTitle}>Allow notifications</Text>
                    <Text style={styles.switchSub}>Push &amp; in-app alerts for this person</Text>
                  </View>
                  <Switch value={notifOn} onValueChange={setNotifOn} trackColor={{ true: colors.brandPrimary, false: colors.border }} thumbColor={colors.surface} testID="emp-notif-master" />
                </View>
                {notifOn && notifModules.map((nm) => {
                  const on = notifPrefs[nm.key] !== false;
                  return (
                    <View key={nm.key}>
                      <View style={styles.switchRow}>
                        <Text style={styles.notifModLabel}>{nm.label}</Text>
                        <Switch
                          value={on}
                          onValueChange={(v) => setNotifPrefs((p) => ({ ...p, [nm.key]: v }))}
                          trackColor={{ true: colors.brandPrimary, false: colors.border }}
                          thumbColor={colors.surface}
                          testID={`emp-notif-${nm.key}`}
                        />
                      </View>
                      {on && (nm.events || []).length > 0 && (
                        <View style={styles.eventList}>
                          {(nm.events || []).map((ev) => (
                            <View key={ev.key} style={styles.eventRow}>
                              <Ionicons name="ellipse" size={5} color={colors.brandSecondary} />
                              <Text style={styles.eventText}>{ev.label}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  );
                })}

                <Pressable onPress={saveAccess} disabled={savingAccess} style={[styles.saveAccessBtn, savingAccess && { opacity: 0.6 }]} testID="emp-save-notifications">
                  {savingAccess ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveAccessText}>Save notifications</Text>}
                </Pressable>
              </>
            )}
            {tab === 'access' && isOwner && (
              <>
                <SectionTitle text="Access" />
                {availableModules.map((m) => {
                  const on = mods.has(m.key);
                  const showRights = on && m.employee_assignable;
                  const r = rights[m.key] || {};
                  return (
                    <View key={m.key}>
                      <Pressable onPress={() => toggleMod(m.key)} style={styles.modRow} testID={`emp-mod-${m.key}`}>
                        <View style={[styles.checkbox, on && styles.checkboxOn]}>{on && <Ionicons name="checkmark" size={13} color={colors.onBrandPrimary} />}</View>
                        <Text style={styles.modLabel}>{m.label}</Text>
                      </Pressable>
                      {showRights && (
                        <View style={styles.chipRow}>
                          <Pressable onPress={() => toggleRight(m.key, 'edit')} style={[styles.chip, r.edit && styles.chipOn]} testID={`emp-edit-${m.key}`}>
                            <Ionicons name={r.edit ? 'checkmark-circle' : 'ellipse-outline'} size={13} color={r.edit ? colors.onBrandPrimary : colors.mutedText} />
                            <Text style={[styles.chipText, r.edit && styles.chipTextOn]}>Edit</Text>
                          </Pressable>
                          <Pressable onPress={() => toggleRight(m.key, 'delete')} style={[styles.chip, r.delete && styles.chipOn]} testID={`emp-delete-${m.key}`}>
                            <Ionicons name={r.delete ? 'checkmark-circle' : 'ellipse-outline'} size={13} color={r.delete ? colors.onBrandPrimary : colors.mutedText} />
                            <Text style={[styles.chipText, r.delete && styles.chipTextOn]}>Delete</Text>
                          </Pressable>
                        </View>
                      )}
                      {on && m.key === 'cash_book' && (
                        <View style={styles.countersBox}>
                          <Text style={styles.countersLabel}>{counters.length === 0 ? 'No Cash Book counters yet' : 'Counters this person can see'}</Text>
                          <View style={styles.chipRow}>
                            {counters.map((c) => {
                              const con = counterSel.has(c.id);
                              return (
                                <Pressable key={c.id} onPress={() => toggleCounter(c.id)} style={[styles.chip, con && styles.chipOn]} testID={`emp-counter-${c.id}`}>
                                  <Ionicons name={con ? 'checkmark-circle' : 'ellipse-outline'} size={13} color={con ? colors.onBrandPrimary : colors.mutedText} />
                                  <Text style={[styles.chipText, con && styles.chipTextOn]}>{c.name}</Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        </View>
                      )}
                    </View>
                  );
                })}

                <Pressable onPress={saveAccess} disabled={savingAccess} style={[styles.saveAccessBtn, savingAccess && { opacity: 0.6 }]} testID="emp-save-access">
                  {savingAccess ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveAccessText}>Save access</Text>}
                </Pressable>
              </>
            )}
          </View>
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

  identity: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md, alignItems: 'center' },
  bigAvatar: {
    width: 88, height: 88, borderRadius: 44, backgroundColor: colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
  },
  bigAvatarText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 32 },
  bigAvatarPhoto: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.surfaceTertiary },

  name: {
    color: colors.onSurface, fontSize: 28, fontWeight: '600',
    fontFamily: fonts.display, marginTop: spacing.md, letterSpacing: -0.5, textAlign: 'center',
  },
  designation: { color: colors.onSurfaceTertiary, fontSize: 14, marginTop: 4, textAlign: 'center' },
  metaRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, alignItems: 'center' },
  ledgerLink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.brandPrimary, paddingVertical: 12, paddingHorizontal: spacing.md,
    borderRadius: radius.md, marginTop: spacing.sm,
  },
  ledgerLinkText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 13 },
  shareCredsLink: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.brand,
    paddingVertical: 10, paddingHorizontal: spacing.md, borderRadius: radius.md, marginTop: spacing.md,
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
  detailLabel: { color: colors.mutedText, fontSize: 13, width: 120 },
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

  // Access tab
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  switchTitle: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  switchSub: { color: colors.mutedText, fontSize: 11.5, marginTop: 2 },
  notifModLabel: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 14 },
  eventList: { paddingLeft: 4, paddingBottom: 10, gap: 5 },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eventText: { color: colors.mutedText, fontSize: 12.5, flex: 1 },

  modRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 9 },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  checkboxOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  modLabel: { color: colors.onSurface, fontSize: 14.5 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingLeft: 28, paddingBottom: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.mutedText, fontSize: 11, fontWeight: '600' },
  chipTextOn: { color: colors.onBrandPrimary },
  countersBox: { paddingLeft: 28, paddingBottom: 6 },
  countersLabel: { color: colors.mutedText, fontSize: 10.5, fontWeight: '600', marginBottom: 6 },

  saveAccessBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg },
  saveAccessText: { color: colors.onBrandPrimary, fontSize: 14, fontWeight: '700' },
});
