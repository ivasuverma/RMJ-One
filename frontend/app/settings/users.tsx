import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, Platform, KeyboardAvoidingView, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { confirmAction } from '@/src/utils/confirm';
import { useAuth } from '@/src/auth/AuthContext';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type U = { id: string; username: string; name: string; role: 'owner' | 'admin' | 'accountant' };
const ROLES = ['owner', 'admin', 'accountant'] as const;

export default function UsersScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user: me } = useAuth();
  const [items, setItems] = useState<U[]>([]);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'owner' | 'admin' | 'accountant'>('admin');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setItems(await api.get<U[]>('/users')); }
    catch (_e) { setItems([]); }
    finally { setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const resetForm = () => { setEditingId(null); setName(''); setUsername(''); setPassword(''); setRole('admin'); };

  const startEdit = (u: U) => {
    setEditingId(u.id); setName(u.name); setUsername(u.username); setPassword('');
    setRole(u.role);
  };

  const submittingRef = useRef(false);
  const add = async () => {
    if (submittingRef.current) return;
    if (!name.trim() || !username.trim() || password.length < 4) {
      Alert.alert('Missing', 'Name, username and a password of 4+ chars are required'); return;
    }
    submittingRef.current = true;
    setSaving(true);
    try {
      await api.post('/users', { name: name.trim(), username: username.trim(), password, role });
      resetForm(); await load();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); submittingRef.current = false; }
  };

  const saveEdit = async () => {
    if (submittingRef.current || !editingId) return;
    if (!name.trim() || !username.trim()) {
      Alert.alert('Missing', 'Name and username are required'); return;
    }
    if (password && password.length < 4) {
      Alert.alert('Too short', 'New password must be 4+ characters, or leave it blank to keep the current one.'); return;
    }
    submittingRef.current = true;
    setSaving(true);
    try {
      await api.put(`/users/${editingId}`, {
        name: name.trim(), username: username.trim(), role,
        password: password || undefined,
      });
      resetForm(); await load();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); submittingRef.current = false; }
  };

  const remove = (u: U) => {
    confirmAction('Delete user', `Remove ${u.name}?`, 'Delete', async () => {
      try { await api.del(`/users/${u.id}`); if (editingId === u.id) resetForm(); await load(); }
      catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    });
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
          <View style={styles.sectionRow}>
            <Text style={styles.section}>{editingId ? 'Edit User' : 'Add User'}</Text>
            {editingId && (
              <Pressable onPress={resetForm} testID="cancel-edit-btn">
                <Text style={styles.cancelEditText}>Cancel</Text>
              </Pressable>
            )}
          </View>
          <TextInput testID="new-user-name" value={name} onChangeText={setName} placeholder="Full name" placeholderTextColor={colors.mutedText} style={styles.input} />
          <TextInput testID="new-user-username" value={username} onChangeText={(v) => setUsername(v.toLowerCase().replace(/\s/g, ''))} placeholder="Username" placeholderTextColor={colors.mutedText} style={styles.input} autoCapitalize="none" />
          <TextInput
            testID="new-user-password" value={password} onChangeText={setPassword}
            placeholder={editingId ? 'New password (leave blank to keep current)' : 'Temporary password'}
            placeholderTextColor={colors.mutedText} secureTextEntry style={styles.input}
          />
          <View style={styles.roleRow}>
            {ROLES.map((r) => (
              <Pressable
                key={r} testID={`role-${r}`}
                onPress={() => setRole(r)}
                style={[styles.roleBtn, role === r && styles.roleBtnActive]}
              >
                <Text style={[styles.roleText, role === r && styles.roleTextActive]}>{r.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            style={[styles.addBtn, saving && { opacity: 0.6 }]} disabled={saving}
            onPress={editingId ? saveEdit : add} testID={editingId ? 'save-user-edit-btn' : 'add-user-btn'}
          >
            {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
              <>
                <Ionicons name={editingId ? 'checkmark-outline' : 'person-add-outline'} size={16} color={colors.onBrandPrimary} />
                <Text style={styles.addBtnText}>{editingId ? 'Save Changes' : 'Create User'}</Text>
              </>
            )}
          </Pressable>

          <Text style={[styles.section, { marginTop: spacing.xl }]}>Existing</Text>
          {items.map((u) => (
            <View key={u.id} style={[styles.row, editingId === u.id && styles.rowEditing]} testID={`user-${u.id}`}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{(u.name || u.username)[0]?.toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.userName}>{u.name}</Text>
                <Text style={styles.userMeta}>@{u.username} · {u.role.toUpperCase()}</Text>
              </View>
              <Pressable onPress={() => startEdit(u)} style={styles.editBtn} hitSlop={10} testID={`edit-user-${u.id}`}>
                <Ionicons name="create-outline" size={16} color={colors.brandSecondary} />
              </Pressable>
              {u.id !== me?.id && (
                <Pressable onPress={() => remove(u)} style={styles.delBtn} hitSlop={10} testID={`del-user-${u.id}`}>
                  <Ionicons name="trash-outline" size={16} color={colors.onError} />
                </Pressable>
              )}
            </View>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
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
  title: {
    flex: 1, color: colors.onSurface, fontSize: 22, fontWeight: '600',
    fontFamily: fonts.display,
  },
  section: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cancelEditText: { color: colors.mutedText, fontSize: 12, fontWeight: '700', marginBottom: spacing.sm },
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
  rowEditing: { borderColor: colors.brandPrimary },
  editBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.brandTertiary,
    borderColor: colors.brand, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  avatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand,
  },
  avatarText: { color: colors.brandSecondary, fontWeight: '700' },
  userName: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  userMeta: { color: colors.onSurfaceTertiary, fontSize: 11, marginTop: 2 },
  delBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.error,
    borderColor: colors.onError, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
});
