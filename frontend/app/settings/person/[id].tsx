import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Switch, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { useToast } from '@/src/components/ui';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type ModuleDef = { key: string; label: string; default_roles: string[]; employee_assignable?: boolean };
type Rights = { edit?: boolean; delete?: boolean };
type DocRight = { view?: boolean; record?: boolean };
type Counter = { id: string; name: string };
type DocCategory = { key: string; label: string };
type NotifModule = { key: string; label: string; default_roles: string[] };
type Account = {
  id: string; name: string; username?: string; role: string; account_type: 'user' | 'employee';
  designation?: string; status?: string; module_access: string[] | null; resolved_modules: string[];
  module_rights?: Record<string, Rights>; cashbook_counter_ids?: string[];
  notifications_enabled?: boolean; notif_prefs?: Record<string, boolean>;
  doc_category_rights?: Record<string, DocRight>; doc_see_done?: boolean;
};

const ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin', accountant: 'Accountant', employee: 'Sales / Staff' };

export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();

  const [acc, setAcc] = useState<Account | null>(null);
  const [modules, setModules] = useState<ModuleDef[]>([]);
  const [counters, setCounters] = useState<Counter[]>([]);
  const [docCats, setDocCats] = useState<DocCategory[]>([]);
  const [notifModules, setNotifModules] = useState<NotifModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Editable state
  const [mods, setMods] = useState<Set<string>>(new Set());
  const [rights, setRights] = useState<Record<string, Rights>>({});
  const [counterSel, setCounterSel] = useState<Set<string>>(new Set());
  const [notifOn, setNotifOn] = useState(true);
  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>({});
  const [docRights, setDocRights] = useState<Record<string, DocRight>>({});
  const [seeDone, setSeeDone] = useState(true);
  const [newPass, setNewPass] = useState('');

  const load = useCallback(async () => {
    try {
      const [accts, m, c, dc, nm] = await Promise.all([
        api.get<Account[]>('/access/accounts'),
        api.get<ModuleDef[]>('/access/modules'),
        api.get<Counter[]>('/cashbook/counters').catch(() => []),
        api.get<DocCategory[]>('/document-categories?all=1').catch(() => []),
        api.get<NotifModule[]>('/access/notification-modules').catch(() => []),
      ]);
      const a = accts.find((x) => x.id === id) || null;
      setAcc(a); setModules(m); setCounters(c); setDocCats(dc); setNotifModules(nm);
      if (a) {
        setMods(new Set(a.resolved_modules));
        setRights({ ...(a.module_rights || {}) });
        setCounterSel(new Set(a.cashbook_counter_ids || []));
        setNotifOn(a.notifications_enabled !== false);
        // Seed each module toggle from saved prefs, else its role default.
        const prefs: Record<string, boolean> = {};
        for (const nmod of nm) {
          prefs[nmod.key] = a.notif_prefs && nmod.key in a.notif_prefs
            ? !!a.notif_prefs[nmod.key]
            : nmod.default_roles.includes(a.role);
        }
        setNotifPrefs(prefs);
        setDocRights({ ...(a.doc_category_rights || {}) });
        setSeeDone(a.doc_see_done !== false);
      }
    } catch { /* owner-only endpoint */ }
    finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const isOwner = acc?.role === 'owner';
  const isEmployee = acc?.account_type === 'employee';
  const availableModules = useMemo(
    () => (isEmployee ? modules.filter((m) => m.employee_assignable) : modules),
    [modules, isEmployee],
  );

  const toggleMod = (k: string) => setMods((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggleCounter = (cid: string) => setCounterSel((p) => { const n = new Set(p); n.has(cid) ? n.delete(cid) : n.add(cid); return n; });
  const toggleRight = (k: string, which: 'edit' | 'delete') => setRights((p) => {
    const r = { ...(p[k] || {}) }; r[which] = !r[which]; return { ...p, [k]: r };
  });
  const toggleDoc = (k: string, which: 'view' | 'record') => setDocRights((p) => {
    const r = { ...(p[k] || {}) }; r[which] = !r[which];
    if (which === 'record' && r.record) r.view = true;
    if (which === 'view' && !r.view) r.record = false;
    return { ...p, [k]: r };
  });

  const save = async () => {
    if (!acc || saving) return;
    setSaving(true);
    try {
      if (newPass.trim() && acc.account_type === 'user') {
        if (newPass.trim().length < 4) { Alert.alert('Too short', 'Password must be 4+ characters.'); setSaving(false); return; }
        await api.put(`/users/${acc.id}`, { name: acc.name, username: acc.username, role: acc.role, password: newPass.trim() });
      }
      const payload: any = { notifications_enabled: notifOn, notif_prefs: notifPrefs };
      if (!isOwner) {
        const mr: Record<string, Rights> = {};
        if (isEmployee) {
          for (const m of availableModules) {
            if (!mods.has(m.key)) continue;
            const r = rights[m.key];
            if (r) mr[m.key] = { edit: !!r.edit, delete: !!r.delete };
          }
        }
        const docPayload: Record<string, DocRight> = {};
        for (const [k, v] of Object.entries(docRights)) {
          if (v && (v.view || v.record)) docPayload[k] = { view: !!v.view, record: !!v.record };
        }
        payload.module_access = Array.from(mods);
        payload.module_rights = mr;
        payload.cashbook_counter_ids = isEmployee && mods.has('cash_book') ? Array.from(counterSel) : [];
        payload.doc_category_rights = docPayload;
        payload.doc_see_done = seeDone;
      }
      await api.put(`/access/accounts/${acc.id}`, payload);
      toast.success('Saved');
      setNewPass('');
      router.back();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}><Pressable onPress={() => router.back()} style={styles.iconBtn} hitSlop={12}><Ionicons name="chevron-back" size={22} color={colors.onSurface} /></Pressable><Text style={styles.title}>Person</Text><View style={styles.iconBtn} /></View>
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }
  if (!acc) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}><Pressable onPress={() => router.back()} style={styles.iconBtn} hitSlop={12}><Ionicons name="chevron-back" size={22} color={colors.onSurface} /></Pressable><Text style={styles.title}>Person</Text><View style={styles.iconBtn} /></View>
        <Text style={styles.empty}>This account could not be loaded.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID={`person-${acc.id}`}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} hitSlop={12} testID="back-btn"><Ionicons name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.title} numberOfLines={1}>{acc.name}</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
        <View style={styles.idCard}>
          <View style={styles.avatar}><Ionicons name={isOwner ? 'star' : isEmployee ? 'person' : 'people'} size={20} color={colors.brandSecondary} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.idName}>{acc.name}</Text>
            <Text style={styles.idMeta}>{ROLE_LABEL[acc.role] || acc.role}{acc.username ? ` · @${acc.username}` : ''}{acc.designation ? ` · ${acc.designation}` : ''}</Text>
          </View>
        </View>

        {/* Account / password (staff logins) */}
        {acc.account_type === 'user' && (
          <Section title="Account">
            <Text style={styles.fieldLabel}>Reset password</Text>
            <TextInput value={newPass} onChangeText={setNewPass} placeholder="New password (leave blank to keep current)" placeholderTextColor={colors.mutedText} secureTextEntry style={styles.input} testID="person-password" />
          </Section>
        )}

        {/* Notifications */}
        <Section title="Notifications">
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.switchTitle}>Allow notifications</Text>
              <Text style={styles.switchSub}>Push & in-app alerts for this person</Text>
            </View>
            <Switch value={notifOn} onValueChange={setNotifOn} trackColor={{ true: colors.brandPrimary, false: colors.border }} thumbColor={colors.surface} testID="person-notif-master" />
          </View>
          {notifOn && notifModules.map((nm) => (
            <View key={nm.key} style={styles.switchRow}>
              <Text style={styles.notifModLabel}>{nm.label}</Text>
              <Switch
                value={notifPrefs[nm.key] !== false}
                onValueChange={(v) => setNotifPrefs((p) => ({ ...p, [nm.key]: v }))}
                trackColor={{ true: colors.brandPrimary, false: colors.border }}
                thumbColor={colors.surface}
                testID={`person-notif-${nm.key}`}
              />
            </View>
          ))}
        </Section>

        {isOwner ? (
          <Text style={styles.ownerNote}>The owner always has full access to every module and document. There&apos;s nothing to restrict here.</Text>
        ) : (
          <>
            {/* Access / roles */}
            <Section title="Access">
              {availableModules.map((m) => {
                const on = mods.has(m.key);
                const showRights = on && m.employee_assignable && isEmployee;
                const r = rights[m.key] || {};
                return (
                  <View key={m.key}>
                    <Pressable onPress={() => toggleMod(m.key)} style={styles.modRow} testID={`person-mod-${m.key}`}>
                      <View style={[styles.checkbox, on && styles.checkboxOn]}>{on && <Ionicons name="checkmark" size={13} color={colors.onBrandPrimary} />}</View>
                      <Text style={styles.modLabel}>{m.label}</Text>
                    </Pressable>
                    {showRights && (
                      <View style={styles.chipRow}>
                        <Pressable onPress={() => toggleRight(m.key, 'edit')} style={[styles.chip, r.edit && styles.chipOn]} testID={`person-edit-${m.key}`}>
                          <Ionicons name={r.edit ? 'checkmark-circle' : 'ellipse-outline'} size={13} color={r.edit ? colors.onBrandPrimary : colors.mutedText} />
                          <Text style={[styles.chipText, r.edit && styles.chipTextOn]}>Edit</Text>
                        </Pressable>
                        <Pressable onPress={() => toggleRight(m.key, 'delete')} style={[styles.chip, r.delete && styles.chipOn]} testID={`person-delete-${m.key}`}>
                          <Ionicons name={r.delete ? 'checkmark-circle' : 'ellipse-outline'} size={13} color={r.delete ? colors.onBrandPrimary : colors.mutedText} />
                          <Text style={[styles.chipText, r.delete && styles.chipTextOn]}>Delete</Text>
                        </Pressable>
                      </View>
                    )}
                    {on && m.key === 'cash_book' && isEmployee && (
                      <View style={styles.countersBox}>
                        <Text style={styles.countersLabel}>{counters.length === 0 ? 'No Cash Book counters yet' : 'Counters this person can see'}</Text>
                        <View style={styles.chipRow}>
                          {counters.map((c) => {
                            const con = counterSel.has(c.id);
                            return (
                              <Pressable key={c.id} onPress={() => toggleCounter(c.id)} style={[styles.chip, con && styles.chipOn]} testID={`person-counter-${c.id}`}>
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
            </Section>

            {/* Documents */}
            {docCats.length > 0 && (
              <Section title="Documents">
                {docCats.map((dc) => {
                  const dr = docRights[dc.key] || {};
                  return (
                    <View key={dc.key} style={styles.docRow}>
                      <Text style={styles.docLabel} numberOfLines={1}>{dc.label}</Text>
                      <Pressable onPress={() => toggleDoc(dc.key, 'view')} style={[styles.chip, dr.view && styles.chipOn]} testID={`person-docview-${dc.key}`}>
                        <Ionicons name={dr.view ? 'checkmark-circle' : 'ellipse-outline'} size={13} color={dr.view ? colors.onBrandPrimary : colors.mutedText} />
                        <Text style={[styles.chipText, dr.view && styles.chipTextOn]}>View</Text>
                      </Pressable>
                      <Pressable onPress={() => toggleDoc(dc.key, 'record')} style={[styles.chip, dr.record && styles.chipOn]} testID={`person-docrec-${dc.key}`}>
                        <Ionicons name={dr.record ? 'checkmark-circle' : 'ellipse-outline'} size={13} color={dr.record ? colors.onBrandPrimary : colors.mutedText} />
                        <Text style={[styles.chipText, dr.record && styles.chipTextOn]}>Record</Text>
                      </Pressable>
                    </View>
                  );
                })}
                <View style={styles.switchRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.switchTitle}>See “Done” folder</Text>
                    <Text style={styles.switchSub}>Browse filed documents</Text>
                  </View>
                  <Switch value={seeDone} onValueChange={setSeeDone} trackColor={{ true: colors.brandPrimary, false: colors.border }} thumbColor={colors.surface} testID="person-seedone" />
                </View>
                <Text style={styles.docHint}>Leave every category unchecked to fall back to this person&apos;s role defaults.</Text>
              </Section>
            )}
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable onPress={save} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]} testID="person-save">
          {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Save changes</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '700', fontFamily: fonts.display },
  empty: { color: colors.mutedText, textAlign: 'center', marginTop: 60 },

  idCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.lg },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand },
  idName: { color: colors.onSurface, fontSize: 17, fontWeight: '700' },
  idMeta: { color: colors.mutedText, fontSize: 12.5, marginTop: 2 },

  section: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md },
  sectionTitle: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: '800', marginBottom: spacing.sm },

  fieldLabel: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6 },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 11, fontSize: 14 },

  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  switchTitle: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  switchSub: { color: colors.mutedText, fontSize: 11.5, marginTop: 2 },
  notifModLabel: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 14 },

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

  docRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  docLabel: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 14 },
  docHint: { color: colors.mutedText, fontSize: 10.5, marginTop: 6, lineHeight: 15 },

  ownerNote: { color: colors.mutedText, fontSize: 13, lineHeight: 19, paddingHorizontal: spacing.sm, marginBottom: spacing.md },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg, paddingTop: spacing.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 15, alignItems: 'center' },
  saveText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: '700' },
});
