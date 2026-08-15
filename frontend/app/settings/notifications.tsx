import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type ModuleCfg = { label: string; enabled: boolean; roles: string[]; user_ids: string[] };
type ModulesMap = Record<string, ModuleCfg>;
type Account = { id: string; name: string; role: string; account_type: 'user' | 'employee'; designation?: string };

// Fixed display order — matches backend/server.py's NOTIFICATION_MODULES.
const MODULE_ORDER = ['attendance', 'tasks', 'payroll', 'repairs', 'samples'];
const ROLES: { key: string; label: string }[] = [
  { key: 'owner', label: 'Owner' },
  { key: 'admin', label: 'Admin' },
  { key: 'accountant', label: 'Accountant' },
  { key: 'employee', label: 'Employee' },
];

export default function NotificationSettingsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [modules, setModules] = useState<ModulesMap>({});
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedPeople, setExpandedPeople] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([
        api.get<{ modules: ModulesMap }>('/settings/notifications'),
        api.get<Account[]>('/access/accounts').catch(() => []),
      ]);
      setModules(s.modules || {});
      setAccounts(a || []);
    } catch (_e) { /* owner-only endpoint; non-owners just see nothing */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const patchModule = (key: string, patch: Partial<ModuleCfg>) => {
    setModules((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const toggleEnabled = (key: string) => patchModule(key, { enabled: !modules[key]?.enabled });

  const toggleRole = (key: string, role: string) => {
    const cur = modules[key]?.roles || [];
    const next = cur.includes(role) ? cur.filter((r) => r !== role) : [...cur, role];
    patchModule(key, { roles: next });
  };

  const togglePerson = (key: string, accId: string) => {
    const cur = modules[key]?.user_ids || [];
    const next = cur.includes(accId) ? cur.filter((id) => id !== accId) : [...cur, accId];
    patchModule(key, { user_ids: next });
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload: Record<string, { enabled: boolean; roles: string[]; user_ids: string[] }> = {};
      for (const key of Object.keys(modules)) {
        const m = modules[key];
        payload[key] = { enabled: m.enabled, roles: m.roles, user_ids: m.user_ids };
      }
      const res = await api.put<{ modules: ModulesMap }>('/settings/notifications', { modules: payload });
      setModules(res.modules || {});
      Alert.alert('Saved', 'Notification settings updated.');
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Could not save. Please try again.'); }
    finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="notification-settings-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Notification Settings</Text>
        <Pressable onPress={save} disabled={saving} style={[styles.saveAllBtn, saving && { opacity: 0.6 }]} testID="save-all-btn">
          {saving ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <Text style={styles.saveAllText}>Save</Text>}
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
            Turn a module off to stop its staff-facing alerts entirely (e.g. &quot;someone checked in&quot;). This
            never affects a person&apos;s own notifications about their own record — leave decisions, salary paid,
            and task assignments always reach the person concerned. Pick roles and/or specific people to receive
            each module&apos;s alerts.
          </Text>

          {MODULE_ORDER.filter((k) => modules[k]).map((key) => {
            const m = modules[key];
            const isExpanded = !!expandedPeople[key];
            const peopleCount = m.user_ids.length;
            return (
              <View key={key} style={styles.card} testID={`notif-module-${key}`}>
                <Pressable onPress={() => toggleEnabled(key)} style={styles.moduleHeader} testID={`notif-toggle-${key}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.moduleLabel}>{m.label}</Text>
                    <Text style={styles.moduleSub}>{m.enabled ? 'Notifications on' : 'Notifications off'}</Text>
                  </View>
                  <View style={[styles.switch, m.enabled && styles.switchOn]}>
                    <View style={[styles.switchKnob, m.enabled && styles.switchKnobOn]} />
                  </View>
                </Pressable>

                {m.enabled && (
                  <View style={styles.body}>
                    <Text style={styles.subhead}>Notify roles</Text>
                    <View style={styles.chipsRow}>
                      {ROLES.map((r) => {
                        const on = m.roles.includes(r.key);
                        return (
                          <Pressable
                            key={r.key}
                            onPress={() => toggleRole(key, r.key)}
                            style={[styles.chip, on && styles.chipOn]}
                            testID={`notif-role-${key}-${r.key}`}
                          >
                            <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={13} color={on ? colors.onBrandPrimary : colors.mutedText} />
                            <Text style={[styles.chipText, on && styles.chipTextOn]}>{r.label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    <Pressable
                      onPress={() => setExpandedPeople((prev) => ({ ...prev, [key]: !prev[key] }))}
                      style={styles.peopleToggle}
                      testID={`notif-people-toggle-${key}`}
                    >
                      <Text style={styles.subhead}>
                        Also notify specific people{peopleCount ? ` (${peopleCount})` : ''}
                      </Text>
                      <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedText} />
                    </Pressable>
                    {isExpanded && (
                      <View style={styles.chipsRow}>
                        {accounts.length === 0 ? (
                          <Text style={styles.emptyPeople}>No staff accounts found</Text>
                        ) : accounts.map((acc) => {
                          const on = m.user_ids.includes(acc.id);
                          return (
                            <Pressable
                              key={acc.id}
                              onPress={() => togglePerson(key, acc.id)}
                              style={[styles.chip, on && styles.chipOn]}
                              testID={`notif-person-${key}-${acc.id}`}
                            >
                              <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={13} color={on ? colors.onBrandPrimary : colors.mutedText} />
                              <Text style={[styles.chipText, on && styles.chipTextOn]}>{acc.name}</Text>
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
  saveAllBtn: {
    height: 40, minWidth: 64, paddingHorizontal: 16, borderRadius: 20, backgroundColor: colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
  },
  saveAllText: { color: colors.onBrandPrimary, fontSize: 13, fontWeight: '700' },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hint: { color: colors.mutedText, fontSize: 12, marginBottom: spacing.lg, lineHeight: 17 },
  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm, overflow: 'hidden',
  },
  moduleHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  moduleLabel: { color: colors.onSurface, fontWeight: '700', fontSize: 14 },
  moduleSub: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  switch: {
    width: 44, height: 26, borderRadius: 13, backgroundColor: colors.surfaceTertiary,
    borderWidth: 1, borderColor: colors.border, padding: 2, justifyContent: 'center',
  },
  switchOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  switchKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.onSurfaceTertiary },
  switchKnobOn: { backgroundColor: colors.onBrandPrimary, transform: [{ translateX: 18 }] },
  body: { borderTopWidth: 1, borderTopColor: colors.divider, padding: spacing.md, backgroundColor: colors.surfaceTertiary },
  subhead: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm, marginBottom: spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.mutedText, fontSize: 11, fontWeight: '600' },
  chipTextOn: { color: colors.onBrandPrimary },
  peopleToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  emptyPeople: { color: colors.mutedText, fontSize: 12 },
});
