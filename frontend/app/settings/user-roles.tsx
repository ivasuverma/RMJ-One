import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, RefreshControl, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { confirmAction } from '@/src/utils/confirm';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Account = {
  id: string; name: string; username?: string; role: string; account_type: 'user' | 'employee';
  designation?: string; status?: string; module_access: string[] | null; resolved_modules: string[];
  notifications_enabled?: boolean;
};

const ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin', accountant: 'Accountant', employee: 'Sales / Staff' };

// People — one clean list of everyone. Tapping a person opens their own full
// page (account, password, notifications, access & document rights).
export default function PeopleScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Add-staff form (owner/admin/accountant logins).
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addUser, setAddUser] = useState('');
  const [addPass, setAddPass] = useState('');
  const [addRole, setAddRole] = useState<'admin' | 'accountant'>('admin');
  const [adding, setAdding] = useState(false);
  const [resettingAll, setResettingAll] = useState(false);

  const load = useCallback(async () => {
    try { setAccounts(await api.get<Account[]>('/access/accounts')); }
    catch { /* owner-only */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

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

  const resetAll = () => {
    const customizable = accounts.filter((a) => a.role !== 'owner' && a.module_access !== null);
    if (customizable.length === 0) { Alert.alert('Nothing to reset', 'Everyone is already on their role default.'); return; }
    confirmAction('Reset all to default', `Clear custom access for ${customizable.length} account${customizable.length === 1 ? '' : 's'} and fall back to role defaults?`, 'Reset All', async () => {
      setResettingAll(true);
      try {
        await Promise.all(customizable.map((a) => api.put(`/access/accounts/${a.id}`, { module_access: null, module_rights: null, cashbook_counter_ids: null })));
        await load();
      } catch (e: any) { Alert.alert('Failed', e?.detail || 'Some accounts could not be reset.'); }
      finally { setResettingAll(false); }
    });
  };

  const staff = accounts.filter((a) => a.account_type === 'user');
  const team = accounts.filter((a) => a.account_type === 'employee');

  const renderRow = (a: Account) => {
    const isOwner = a.role === 'owner';
    const muted = a.notifications_enabled === false;
    const sub = isOwner
      ? 'Full access'
      : `${a.resolved_modules.length} module${a.resolved_modules.length === 1 ? '' : 's'}${a.module_access !== null ? ' · custom' : ''}`;
    return (
      <Pressable key={a.id} onPress={() => router.push(`/settings/person/${a.id}` as any)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]} testID={`people-row-${a.id}`}>
        <View style={styles.avatar}><Ionicons name={isOwner ? 'star' : a.account_type === 'employee' ? 'person-outline' : 'people-outline'} size={18} color={colors.brandSecondary} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.name} numberOfLines={1}>{a.name}{a.status === 'inactive' ? '  · inactive' : ''}</Text>
          <Text style={styles.meta} numberOfLines={1}>{ROLE_LABEL[a.role] || a.role}{a.username ? ` · @${a.username}` : ''} · {sub}</Text>
        </View>
        {muted && <Ionicons name="notifications-off-outline" size={15} color={colors.mutedText} style={{ marginRight: 4 }} />}
        <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="people-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}><Ionicons name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.title}>Users</Text>
        <Pressable onPress={() => setShowAdd((v) => !v)} style={[styles.iconBtn, styles.addBtn]} testID="add-staff-btn" hitSlop={12}><Ionicons name={showAdd ? 'close' : 'add'} size={22} color={colors.onBrandPrimary} /></Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          {showAdd && (
            <View style={styles.addCard} testID="add-staff-form">
              <Text style={styles.sectionLabel}>New staff login</Text>
              <TextInput value={addName} onChangeText={setAddName} placeholder="Full name" placeholderTextColor={colors.mutedText} style={styles.input} testID="add-name" />
              <TextInput value={addUser} onChangeText={(v) => setAddUser(v.toLowerCase().replace(/\s/g, ''))} placeholder="Username" placeholderTextColor={colors.mutedText} autoCapitalize="none" style={[styles.input, { marginTop: spacing.sm }]} testID="add-username" />
              <TextInput value={addPass} onChangeText={setAddPass} placeholder="Temporary password" placeholderTextColor={colors.mutedText} secureTextEntry style={[styles.input, { marginTop: spacing.sm }]} testID="add-password" />
              <View style={styles.roleRow}>
                {(['admin', 'accountant'] as const).map((r) => (
                  <Pressable key={r} onPress={() => setAddRole(r)} style={[styles.roleBtn, addRole === r && styles.roleBtnOn]} testID={`add-role-${r}`}>
                    <Text style={[styles.roleBtnText, addRole === r && styles.roleBtnTextOn]}>{ROLE_LABEL[r]}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable onPress={createStaff} disabled={adding} style={[styles.primaryBtn, adding && { opacity: 0.6 }]} testID="create-staff-btn">
                {adding ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <Text style={styles.primaryBtnText}>Create staff account</Text>}
              </Pressable>
            </View>
          )}

          <View style={styles.topRow}>
            <Text style={styles.hint}>Tap a person to set their access, notifications, document rights and password.</Text>
            <Pressable onPress={resetAll} disabled={resettingAll} style={styles.resetBtn} testID="reset-all-btn">
              {resettingAll ? <ActivityIndicator size="small" color={colors.onSurfaceSecondary} /> : <Text style={styles.resetText}>Reset All</Text>}
            </Pressable>
          </View>

          <Text style={styles.groupLabel}>Staff logins</Text>
          {staff.map(renderRow)}
          <Text style={styles.groupLabel}>Employees</Text>
          {team.length === 0 ? <Text style={styles.emptyText}>No employees yet</Text> : team.map(renderRow)}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  addBtn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '700', fontFamily: fonts.display },

  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  hint: { flex: 1, color: colors.mutedText, fontSize: 12.5, lineHeight: 17 },
  resetBtn: { height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  resetText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },

  groupLabel: { color: colors.mutedText, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: spacing.lg, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand },
  name: { color: colors.onSurface, fontSize: 15, fontWeight: '600' },
  meta: { color: colors.mutedText, fontSize: 12, marginTop: 2 },
  emptyText: { color: colors.mutedText, fontSize: 13, paddingVertical: spacing.sm },

  addCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.lg },
  sectionLabel: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: '800', marginBottom: spacing.sm },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 11, fontSize: 14 },
  roleRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  roleBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  roleBtnOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  roleBtnText: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: '700' },
  roleBtnTextOn: { color: colors.onBrandPrimary },
  primaryBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 13, alignItems: 'center', marginTop: spacing.md },
  primaryBtnText: { color: colors.onBrandPrimary, fontSize: 14, fontWeight: '700' },
});
