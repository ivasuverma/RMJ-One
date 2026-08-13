import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, RefreshControl,
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
type Account = {
  id: string; name: string; username?: string; role: string; account_type: 'user' | 'employee';
  designation?: string; status?: string; module_access: string[] | null; resolved_modules: string[];
  module_rights?: Record<string, Rights>;
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

  const load = useCallback(async () => {
    try {
      const [m, a] = await Promise.all([
        api.get<ModuleDef[]>('/access/modules'),
        api.get<Account[]>('/access/accounts'),
      ]);
      setModules(m);
      setAccounts(a);
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
          await Promise.all(customizable.map((a) => api.put(`/access/accounts/${a.id}`, { module_access: null, module_rights: null })));
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

  const toggleRight = (accId: string, key: string, right: 'edit' | 'delete') => {
    setRights((prev) => {
      const accRights = { ...(prev[accId] || {}) };
      const modRights = { ...(accRights[key] || {}) };
      modRights[right] = !modRights[right];
      accRights[key] = modRights;
      return { ...prev, [accId]: accRights };
    });
  };

  const save = async (acc: Account) => {
    setSavingId(acc.id);
    try {
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
      await api.put(`/access/accounts/${acc.id}`, { module_access: Array.from(sel), module_rights: moduleRights });
      await load();
      setExpandedId(null);
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Could not save. Please try again.'); }
    finally { setSavingId(null); }
  };

  const resetToDefault = async (acc: Account) => {
    setSavingId(acc.id);
    try {
      await api.put(`/access/accounts/${acc.id}`, { module_access: null, module_rights: null });
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
        <Text style={styles.title}>User Roles</Text>
        <Pressable onPress={resetAll} disabled={resettingAll} style={styles.resetAllBtn} testID="reset-all-btn">
          {resettingAll ? <ActivityIndicator size="small" color={colors.onSurfaceSecondary} /> : <Text style={styles.resetAllText}>Reset All</Text>}
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          <Text style={styles.hint}>
            Owner always has full access. Everyone else gets their role's default modules unless you customize
            them here — a custom list always overrides the default, even if you uncheck everything. For an
            employee, ticking Repairs, Tasks, or Approvals lets them do that module's everyday work — Edit and
            Delete are separate switches, off by default, so they can't change or remove existing records unless
            you turn them on.
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
                    {modules.map((m) => {
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
                        </View>
                      );
                    })}
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
  rightsRow: { flexDirection: 'row', gap: spacing.sm, paddingLeft: 28, paddingBottom: 8, marginTop: -2 },
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
});
