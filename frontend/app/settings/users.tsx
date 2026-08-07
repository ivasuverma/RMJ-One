import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, Platform, KeyboardAvoidingView, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { colors, spacing, radius } from '@/src/theme';

type U = { id: string; username: string; name: string; role: 'owner' | 'admin' | 'accountant' };

export default function UsersScreen() {
  const router = useRouter();
  const [items, setItems] = useState<U[]>([]);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'accountant'>('admin');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await api.get<U[]>('/users')); }
    catch (_e) { setItems([]); }
    finally { setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const add = async () => {
    if (!name.trim() || !username.trim() || password.length < 4) {
      Alert.alert('Missing', 'Name, username and a password of 4+ chars are required'); return;
    }
    setSaving(true);
    try {
      await api.post('/users', { name: name.trim(), username: username.trim(), password, role });
      setName(''); setUsername(''); setPassword(''); await load();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); }
  };

  const remove = (u: U) => {
    Alert.alert('Delete user', `Remove ${u.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try { await api.del(`/users/${u.id}`); await load(); }
          catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="users-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>User Management</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          <Text style={styles.section}>Add User</Text>
          <TextInput testID="new-user-name" value={name} onChangeText={setName} placeholder="Full name" placeholderTextColor={colors.mutedText} style={styles.input} />
          <TextInput testID="new-user-username" value={username} onChangeText={(v) => setUsername(v.toLowerCase().replace(/\s/g, ''))} placeholder="Username" placeholderTextColor={colors.mutedText} style={styles.input} autoCapitalize="none" />
          <TextInput testID="new-user-password" value={password} onChangeText={setPassword} placeholder="Temporary password" placeholderTextColor={colors.mutedText} secureTextEntry style={styles.input} />
          <View style={styles.roleRow}>
            {(['admin', 'accountant'] as const).map((r) => (
              <Pressable
                key={r} testID={`role-${r}`}
                onPress={() => setRole(r)}
                style={[styles.roleBtn, role === r && styles.roleBtnActive]}
              >
                <Text style={[styles.roleText, role === r && styles.roleTextActive]}>{r.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={[styles.addBtn, saving && { opacity: 0.6 }]} disabled={saving} onPress={add} testID="add-user-btn">
            {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><Ionicons name="person-add-outline" size={16} color={colors.onBrandPrimary} /><Text style={styles.addBtnText}>Create User</Text></>}
          </Pressable>

          <Text style={[styles.section, { marginTop: spacing.xl }]}>Existing</Text>
          {items.map((u) => (
            <View key={u.id} style={styles.row} testID={`user-${u.id}`}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{(u.name || u.username)[0]?.toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.userName}>{u.name}</Text>
                <Text style={styles.userMeta}>@{u.username} · {u.role.toUpperCase()}</Text>
              </View>
              {u.role !== 'owner' && (
                <Pressable onPress={() => remove(u)} style={styles.delBtn} hitSlop={10} testID={`del-user-${u.id}`}>
                  <Ionicons name="trash-outline" size={16} color="#F1A9A9" />
                </Pressable>
              )}
            </View>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  title: {
    flex: 1, color: colors.onSurface, fontSize: 22, fontWeight: '600',
    fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }),
  },
  section: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md,
    paddingVertical: 12, fontSize: 14, marginBottom: spacing.sm,
  },
  roleRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  roleBtn: {
    flex: 1, paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center',
  },
  roleBtnActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  roleText: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: '700' },
  roleTextActive: { color: colors.onBrandPrimary },
  addBtn: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14,
  },
  addBtnText: { color: colors.onBrandPrimary, fontWeight: '700' },

  row: {
    flexDirection: 'row', gap: spacing.md, alignItems: 'center',
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  avatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand,
  },
  avatarText: { color: colors.brandSecondary, fontWeight: '700' },
  userName: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  userMeta: { color: colors.onSurfaceTertiary, fontSize: 11, marginTop: 2 },
  delBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(122,40,40,0.15)',
    borderColor: colors.error, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
});
