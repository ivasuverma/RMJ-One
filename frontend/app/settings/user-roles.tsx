import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, RefreshControl, Switch, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { confirmAction } from '@/src/utils/confirm';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type ModuleDef = { key: string; label: string; default_roles: string[]; employee_assignable?: boolean };
type Rights = { edit?: boolean; delete?: boolean };
type DocRight = { view?: boolean; record?: boolean };
type Counter = { id: string; name: string };
type DocCategory = { id: string; key: string; label: string };
type Account = {
  id: string; name: string; username?: string; role: string; account_type: 'user' | 'employee';
  designation?: string; status?: string; module_access: string[] | null; resolved_modules: string[];
  module_rights?: Record<string, Rights>; cashbook_counter_ids?: string[];
  notifications_enabled?: boolean; doc_category_rights?: Record<string, DocRight>; doc_see_done?: boolean;
};

const ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin', accountant: 'Accountant', employee: 'Employee' };

export default function UserRolesScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [modules, setModules] = useState<ModuleDef[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Record<string, Set<string>>>({});
  // Edit/delete rights, only meaningful for employee accounts on the three
  // employee-assignable modules (repairs/tasks/approvals). Access alone lets an
  // employee do that module's everyday actions; these toggles additionally let
  // them edit or delete records that already exist.
  const [rights, setRights] = useState<Record<string, Record<string, Rights>>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  // Cash Book counters (routers/cashbook.py) — a further sub-permission
  // within the 'cash_book' module: an employee only sees whichever
  // counters are explicitly checked here, not every counter in the shop.
  const [counters, setCounters] = useState<Counter[]>([]);
  const [counterSel, setCounterSel] = useState<Record<string, Set<string>>>({});
  // New per-person controls folded in from Staff Accounts + Notifications:
  // a master notification switch, and per-category document view/record rights
  // plus a "can browse Done folder" switch.
  const [docCategories, setDocCategories] = useState<DocCategory[]>([]);
  const [notifSel, setNotifSel] = useState<Record<string, boolean>>({});
  const [docRights, setDocRights] = useState<Record<string, Record<string, DocRight>>>({});
  const [docSeeDone, setDocSeeDone] = useState<Record<string, boolean>>({});
  const [newPassword, setNewPassword] = useState<Record<string, string>>({});
  // Create a new staff (owner/admin/accountant) login — folded in from the old
  // Staff Accounts screen so everything about people lives on one page.
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addUser, setAddUser] = useState('');
  const [addPass, setAddPass] = useState('');
  const [addRole, setAddRole] = useState<'admin' | 'accountant'>('admin');
  const [adding, setAdding] = useState(false);

  const createStaff = async () => {
    if (!addName.trim() || !addUser.trim() || addPass.length < 4) {
      Alert.alert('Missing', 'Name, username and a password of 4+ chars are required.'); return;
    }
    setAdding(true);
    try {
      await api.post('/users', { name: addName.trim(), username: addUser.trim(), password: addPass, role: addRole });
      setShowAdd(false); setAddName(''); setAddUser(''); setAddPass(''); setAddRole('admin');
      await load();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setAdding(false); }
  };

  const load = useCallback(async () => {
    try {
      const [m, a, c, dc] = await Promise.all([
        api.get<ModuleDef[]>('/access/modules'),
        api.get<Account[]>('/access/accounts'),
        api.get<Counter[]>('/cashbook/counters').catch(() => []),
        api.get<DocCategory[]>('/document-categories?all=1').catch(() => []),
      ]);
      setModules(m);
      setAccounts(a);
      setCounters(c);
      setDocCategories(dc);
    } catch (_e) { /* owner-only endpoint; non-owners just see nothing */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggleExpand = (acc: Account) => {
    if (acc.role === 'owner') return; // owner always has full access — nothing to customize
    if (expandedId === acc.id) { setExpandedId(null); return; }
    setExpandedId(acc.id);
    setSelection((prev) => ({ ...prev, [acc.id]: new Set(acc.resolved_modules) }));
    setRights((prev) => ({ ...prev, [acc.id]: { ...(acc.module_rights || {}) } }));
    setCounterSel((prev) => ({ ...prev, [acc.id]: new Set(acc.cashbook_counter_ids || []) }));
    setNotifSel((prev) => ({ ...prev, [acc.id]: acc.notifications_enabled !== false }));
    setDocRights((prev) => ({ ...prev, [acc.id]: { ...(acc.doc_category_rights || {}) } }));
    setDocSeeDone((prev) => ({ ...prev, [acc.id]: acc.doc_see_done !== false }));
    setNewPassword((prev) => ({ ...prev, [acc.id]: '' }));
  };

  const [resettingAll, setResettingAll] = useState(false);
  const resetAll = () => {
    const customizable = accounts.filter((a) => a.role !== 'owner' && a.module_access !== null);
    if (customizable.length === 0) { Alert.alert('Nothing to reset', 'Every account is already on its role default.'); return; }
    confirmAction(
      'Reset all to default',
      `Clear custom permissions for ${customizable.length} account${customizable.length === 1 ? '' : 's'} and fall back to their role's defaults?`,
      'Reset All',
      async () => {
        setResettingAll(true);
        try {
          await Promise.all(customizable.map((a) => api.put(`/access/accounts/${a.id}`, { module_access: null, module_rights: null, cashbook_counter_ids: null })));
          await load();
        } catch (e: any) { Alert.alert('Failed', e?.detail || 'Some accounts could not be reset.'); }
        finally { setResettingAll(false); }
      },
    );
  };

  const toggleModule = (accId: string, key: string) => {
    setSelection((prev) => {
      const next = new Set(prev[accId] || []);
      if (next.has(key)) next.delete(key); else next.add(key);
      return { ...prev, [accId]: next };
    });
  };

  const toggleCounter = (accId: string, counterId: string) => {
    setCounterSel((prev) => {
      const next = new Set(prev[accId] || []);
      if (next.has(counterId)) next.delete(counterId); else next.add(counterId);
      return { ...prev, [accId]: next };
    });
  };

  const toggleRight = (accId: string, key: string, right: 'edit' | 'delete') => {
    setRights((prev) => {
      const accRights = { ...(prev[accId] || {}) };
      const modRights = { ...(accRights[key] || {}) };
      modRights[right] = !modRights[right];
      accRights[key] = modRights;
      return { ...prev, [accId]: accRights };
    });
  };

  const toggleDocRight = (accId: string, key: string, which: 'view' | 'record') => {
    setDocRights((prev) => {
      const acc = { ...(prev[accId] || {}) };
      const cur = { ...(acc[key] || {}) };
      cur[which] = !cur[which];
      // Recording implies viewing — you can't file into a category you can't see.
      if (which === 'record' && cur.record) cur.view = true;
      if (which === 'view' && !cur.view) cur.record = false;
      acc[key] = cur;
      return { ...prev, [accId]: acc };
    });
  };

  const save = async (acc: Account) => {
    setSavingId(acc.id);
    try {
      // Optional password reset for a staff (user) account, folded in from the
      // old Staff Accounts screen. Employees keep their own edit flow.
      const pw = (newPassword[acc.id] || '').trim();
      if (pw && acc.account_type === 'user') {
        if (pw.length < 4) { Alert.alert('Too short', 'New password must be 4+ characters.'); setSavingId(null); return; }
        await api.put(`/users/${acc.id}`, { name: acc.name, username: acc.username, role: acc.role, password: pw });
      }
      const sel = selection[acc.id] || new Set<string>();
      // Only carry rights for modules that are both employee-assignable and
      // still selected — dropping access to a module drops its rights too.
      const moduleRights: Record<string, Rights> = {};
      if (acc.account_type === 'employee') {
        for (const m of modules) {
          if (!m.employee_assignable || !sel.has(m.key)) continue;
          const r = (rights[acc.id] || {})[m.key];
          if (r) moduleRights[m.key] = { edit: !!r.edit, delete: !!r.delete };
        }
      }
      // Counters are a further sub-permission of cash_book specifically —
      // only meaningful (and only sent) for an employee who still has that
      // module checked; dropping the module clears the counter grants too.
      const cashbookCounterIds = acc.account_type === 'employee' && sel.has('cash_book')
        ? Array.from(counterSel[acc.id] || [])
        : [];
      // Only persist doc rights that actually grant something, keeping the
      // stored map tidy. An empty map = "fall back to role-based visibility".
      const docRightsPayload: Record<string, DocRight> = {};
      for (const [k, v] of Object.entries(docRights[acc.id] || {})) {
        if (v && (v.view || v.record)) docRightsPayload[k] = { view: !!v.view, record: !!v.record };
      }
      await api.put(`/access/accounts/${acc.id}`, {
        module_access: Array.from(sel),
        module_rights: moduleRights,
        cashbook_counter_ids: cashbookCounterIds,
        notifications_enabled: notifSel[acc.id] !== false,
        doc_category_rights: docRightsPayload,
        doc_see_done: docSeeDone[acc.id] !== false,
      });
      await load();
      setExpandedId(null);
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Could not save. Please try again.'); }
    finally { setSavingId(null); }
  };

  const resetToDefault = async (acc: Account) => {
    setSavingId(acc.id);
    try {
      await api.put(`/access/accounts/${acc.id}`, { module_access: null, module_rights: null, cashbook_counter_ids: null });
      await load();
      setExpandedId(null);
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Could not save. Please try again.'); }
    finally { setSavingId(null); }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="user-roles-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>People</Text>
        <Pressable onPress={() => setShowAdd((v) => !v)} style={[styles.iconBtn, styles.addTopBtn]} testID="add-staff-btn" hitSlop={12}>
          <Ionicons name={showAdd ? 'close' : 'add'} size={22} color={colors.onBrandPrimary} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          {showAdd && (
            <View style={styles.addCard} testID="add-staff-form">
              <Text style={styles.docSectionTitle}>New staff login</Text>
              <TextInput value={addName} onChangeText={setAddName} placeholder="Full name" placeholderTextColor={colors.mutedText} style={styles.pwInput} testID="add-name" />
              <TextInput value={addUser} onChangeText={(v) => setAddUser(v.toLowerCase().replace(/\s/g, ''))} placeholder="Username" placeholderTextColor={colors.mutedText} autoCapitalize="none" style={[styles.pwInput, { marginTop: spacing.sm }]} testID="add-username" />
              <TextInput value={addPass} onChangeText={setAddPass} placeholder="Temporary password" placeholderTextColor={colors.mutedText} secureTextEntry style={[styles.pwInput, { marginTop: spacing.sm }]} testID="add-password" />
              <View style={styles.addRoleRow}>
                {(['admin', 'accountant'] as const).map((r) => (
                  <Pressable key={r} onPress={() => setAddRole(r)} style={[styles.addRoleBtn, addRole === r && styles.rightChipOn]} testID={`add-role-${r}`}>
                    <Text style={[styles.rightChipText, addRole === r && styles.rightChipTextOn]}>{ROLE_LABEL[r]}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable onPress={createStaff} disabled={adding} style={[styles.saveBtn, { marginTop: spacing.md }, adding && { opacity: 0.6 }]} testID="create-staff-btn">
                {adding ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>Create staff account</Text>}
              </Pressable>
            </View>
          )}

          <View style={styles.topActions}>
            <Text style={[styles.hint, { flex: 1, marginBottom: 0 }]}>Tap a person to set their access, notifications, document rights and password.</Text>
            <Pressable onPress={resetAll} disabled={resettingAll} style={styles.resetAllBtn} testID="reset-all-btn">
              {resettingAll ? <ActivityIndicator size="small" color={colors.onSurfaceSecondary} /> : <Text style={styles.resetAllText}>Reset All</Text>}
            </Pressable>
          </View>

          <Text style={styles.hint}>
            Owner always has full access. Everyone else gets their role's default modules unless you customize
            them here — a custom list always overrides the default, even if you uncheck everything. For an
            employee, ticking Repairs, Tasks, or Approvals lets them do that module's everyday work — Edit and
            Delete are separate switches, off by default, so they can't change or remove existing records unless
            you turn them on. For Cash Book specifically, having the module alone isn't enough — an employee
            only sees the counters you check for them below it.
          </Text>

          {accounts.length === 0 ? (
            <View style={styles.empty}><Text style={styles.emptyText}>No accounts yet</Text></View>
          ) : accounts.map((acc) => {
            const isOwner = acc.role === 'owner';
            const isExpanded = expandedId === acc.id;
            const isCustom = acc.module_access !== null;
            const sel = selection[acc.id] || new Set(acc.resolved_modules);
            return (
              <View key={acc.id} style={styles.card} testID={`role-account-${acc.id}`}>
                <Pressable onPress={() => toggleExpand(acc)} style={styles.accRow} disabled={isOwner}>
                  <View style={styles.iconBox}>
                    <Ionicons name={isOwner ? 'star' : acc.account_type === 'employee' ? 'person-outline' : 'people-outline'} size={18} color={colors.brandSecondary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.accName}>{acc.name}</Text>
                    <Text style={styles.accMeta}>
                      {ROLE_LABEL[acc.role] || acc.role}{acc.designation ? ` · ${acc.designation}` : ''} · {isOwner ? 'full access' : `${acc.resolved_modules.length} module${acc.resolved_modules.length === 1 ? '' : 's'}${isCustom ? ' · custom' : ''}`}
                    </Text>
                  </View>
                  {!isOwner && <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.mutedText} />}
                </Pressable>

                {isExpanded && (
                  <View style={styles.expandBody}>
                    {/* Employee accounts can only ever be granted the four
                        employee-assignable modules (Repair, Repair Bill,
                        Customer Ledger, Karigar Ledger) — everything else
                        (Payroll, Store Settings, etc.) isn't shown as an
                        option for them at all, not just hidden behind a
                        rights toggle. User/admin/accountant accounts still
                        see the full module list. */}
                    {(acc.account_type === 'employee' ? modules.filter((m) => m.employee_assignable) : modules).map((m) => {
                      const checked = sel.has(m.key);
                      const showRights = checked && m.employee_assignable && acc.account_type === 'employee';
                      const modRights = (rights[acc.id] || {})[m.key] || {};
                      return (
                        <View key={m.key}>
                          <Pressable onPress={() => toggleModule(acc.id, m.key)} style={styles.modRow} testID={`mod-${acc.id}-${m.key}`}>
                            <View style={[styles.checkbox, checked && styles.checkboxOn]}>
                              {checked && <Ionicons name="checkmark" size={13} color={colors.onBrandPrimary} />}
                            </View>
                            <Text style={styles.modLabel}>{m.label}</Text>
                          </Pressable>
                          {showRights && (
                            <View style={styles.rightsRow} testID={`rights-${acc.id}-${m.key}`}>
                              <Pressable
                                onPress={() => toggleRight(acc.id, m.key, 'edit')}
                                style={[styles.rightChip, modRights.edit && styles.rightChipOn]}
                                testID={`right-edit-${acc.id}-${m.key}`}
                              >
                                <Ionicons name={modRights.edit ? 'checkmark-circle' : 'ellipse-outline'} size={13} color={modRights.edit ? colors.onBrandPrimary : colors.mutedText} />
                                <Text style={[styles.rightChipText, modRights.edit && styles.rightChipTextOn]}>Edit</Text>
                              </Pressable>
                              <Pressable
                                onPress={() => toggleRight(acc.id, m.key, 'delete')}
                                style={[styles.rightChip, modRights.delete && styles.rightChipOn]}
                                testID={`right-delete-${acc.id}-${m.key}`}
                              >
                                <Ionicons name={modRights.delete ? 'checkmark-circle' : 'ellipse-outline'} size={13} color={modRights.delete ? colors.onBrandPrimary : colors.mutedText} />
                                <Text style={[styles.rightChipText, modRights.delete && styles.rightChipTextOn]}>Delete</Text>
                              </Pressable>
                            </View>
                          )}
                          {checked && m.key === 'cash_book' && acc.account_type === 'employee' && (
                            <View style={styles.countersBox} testID={`cashbook-counters-${acc.id}`}>
                              <Text style={styles.countersLabel}>
                                {counters.length === 0 ? 'No Cash Book counters exist yet' : 'Counters this employee can see and use'}
                              </Text>
                              {counters.length > 0 && (
                                <View style={styles.countersChipsRow}>
                                  {counters.map((c) => {
                                    const on = (counterSel[acc.id] || new Set()).has(c.id);
                                    return (
                                      <Pressable
                                        key={c.id}
                                        onPress={() => toggleCounter(acc.id, c.id)}
                                        style={[styles.rightChip, on && styles.rightChipOn]}
                                        testID={`counter-${acc.id}-${c.id}`}
                                      >
                                        <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={13} color={on ? colors.onBrandPrimary : colors.mutedText} />
                                        <Text style={[styles.rightChipText, on && styles.rightChipTextOn]}>{c.name}</Text>
                                      </Pressable>
                                    );
                                  })}
                                </View>
                              )}
                            </View>
                          )}
                        </View>
                      );
                    })}
                    {/* Notifications master switch (folded in from the old
                        Notifications screen) — off means this person gets no
                        push and no in-app bell entries. */}
                    <View style={styles.sectionDivider} />
                    <View style={styles.switchRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.switchTitle}>Notifications</Text>
                        <Text style={styles.switchSub}>Push & in-app alerts for this person</Text>
                      </View>
                      <Switch
                        value={notifSel[acc.id] !== false}
                        onValueChange={(v) => setNotifSel((p) => ({ ...p, [acc.id]: v }))}
                        trackColor={{ true: colors.brandPrimary, false: colors.border }}
                        thumbColor={colors.surface}
                        testID={`notif-${acc.id}`}
                      />
                    </View>

                    {/* Per-category document permissions (replaces the role
                        chips that used to live on each category). */}
                    {docCategories.length > 0 && (
                      <>
                        <View style={styles.sectionDivider} />
                        <Text style={styles.docSectionTitle}>Documents — who can view &amp; record</Text>
                        {docCategories.map((dc) => {
                          const dr = (docRights[acc.id] || {})[dc.key] || {};
                          return (
                            <View key={dc.key} style={styles.docCatRow}>
                              <Text style={styles.docCatLabel} numberOfLines={1}>{dc.label}</Text>
                              <Pressable onPress={() => toggleDocRight(acc.id, dc.key, 'view')} style={[styles.rightChip, dr.view && styles.rightChipOn]} testID={`docview-${acc.id}-${dc.key}`}>
                                <Ionicons name={dr.view ? 'checkmark-circle' : 'ellipse-outline'} size={13} color={dr.view ? colors.onBrandPrimary : colors.mutedText} />
                                <Text style={[styles.rightChipText, dr.view && styles.rightChipTextOn]}>View</Text>
                              </Pressable>
                              <Pressable onPress={() => toggleDocRight(acc.id, dc.key, 'record')} style={[styles.rightChip, dr.record && styles.rightChipOn]} testID={`docrec-${acc.id}-${dc.key}`}>
                                <Ionicons name={dr.record ? 'checkmark-circle' : 'ellipse-outline'} size={13} color={dr.record ? colors.onBrandPrimary : colors.mutedText} />
                                <Text style={[styles.rightChipText, dr.record && styles.rightChipTextOn]}>Record</Text>
                              </Pressable>
                            </View>
                          );
                        })}
                        <View style={styles.switchRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.switchTitle}>See “Done” folder</Text>
                            <Text style={styles.switchSub}>Browse filed/recorded documents</Text>
                          </View>
                          <Switch
                            value={docSeeDone[acc.id] !== false}
                            onValueChange={(v) => setDocSeeDone((p) => ({ ...p, [acc.id]: v }))}
                            trackColor={{ true: colors.brandPrimary, false: colors.border }}
                            thumbColor={colors.surface}
                            testID={`docdone-${acc.id}`}
                          />
                        </View>
                        <Text style={styles.docHint}>Leave every category unchecked to fall back to this person&apos;s role defaults.</Text>
                      </>
                    )}

                    {/* Staff password reset (folded in from Staff Accounts). */}
                    {acc.account_type === 'user' && (
                      <>
                        <View style={styles.sectionDivider} />
                        <Text style={styles.docSectionTitle}>Account · @{acc.username}</Text>
                        <TextInput
                          value={newPassword[acc.id] || ''}
                          onChangeText={(v) => setNewPassword((p) => ({ ...p, [acc.id]: v }))}
                          placeholder="Set a new password (leave blank to keep)"
                          placeholderTextColor={colors.mutedText}
                          secureTextEntry
                          style={styles.pwInput}
                          testID={`pw-${acc.id}`}
                        />
                      </>
                    )}

                    <View style={styles.actionsRow}>
                      <Pressable
                        onPress={() => resetToDefault(acc)}
                        disabled={savingId === acc.id}
                        style={styles.resetBtn}
                        testID={`reset-${acc.id}`}
                      >
                        <Text style={styles.resetBtnText}>Reset to default</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => save(acc)}
                        disabled={savingId === acc.id}
                        style={[styles.saveBtn, savingId === acc.id && { opacity: 0.6 }]}
                        testID={`save-${acc.id}`}
                      >
                        {savingId === acc.id ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>Save</Text>}
                      </Pressable>
                    </View>
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}
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
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '600', fontFamily: fonts.display },
  resetAllBtn: {
    height: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  resetAllText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hint: { color: colors.mutedText, fontSize: 12, marginBottom: spacing.lg, lineHeight: 17 },
  empty: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { color: colors.onSurfaceTertiary },
  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm, overflow: 'hidden',
  },
  accRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  iconBox: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand,
  },
  accName: { color: colors.onSurface, fontWeight: '700', fontSize: 14 },
  accMeta: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  expandBody: { borderTopWidth: 1, borderTopColor: colors.divider, padding: spacing.md, backgroundColor: colors.surfaceTertiary },
  modRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8 },
  checkbox: {
    width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface,
  },
  checkboxOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  modLabel: { color: colors.onSurfaceSecondary, fontSize: 13 },
  rightsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingLeft: 28, paddingBottom: 8, marginTop: -2 },
  countersBox: { paddingLeft: 28, paddingBottom: 8 },
  countersLabel: { color: colors.mutedText, fontSize: 10.5, fontWeight: '600', marginBottom: 6 },
  countersChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  rightChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  rightChipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  rightChipText: { color: colors.mutedText, fontSize: 11, fontWeight: '600' },
  rightChipTextOn: { color: colors.onBrandPrimary },
  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  resetBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  resetBtnText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  saveBtn: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: radius.md, backgroundColor: colors.brandPrimary },
  saveBtnText: { color: colors.onBrandPrimary, fontSize: 12, fontWeight: '700' },
  addTopBtn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  addCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.lg },
  addRoleRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  addRoleBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  sectionDivider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.md },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 4 },
  switchTitle: { color: colors.onSurface, fontSize: 13, fontWeight: '700' },
  switchSub: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  docSectionTitle: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: '700', marginBottom: spacing.sm },
  docCatRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 5 },
  docCatLabel: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 13 },
  docHint: { color: colors.mutedText, fontSize: 10.5, marginTop: 6, lineHeight: 15 },
  pwInput: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 11, fontSize: 13,
  },
});
