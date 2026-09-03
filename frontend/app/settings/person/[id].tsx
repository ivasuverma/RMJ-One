import { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput,
} from 'react-native';
import { notify } from '@/src/utils/notify';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useToast } from '@/src/components/ui';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useAuth } from '@/src/auth/AuthContext';
import { useAccessEditor } from '@/src/hooks/use-access-editor';
import { NotificationsSection, AccessSection } from '@/src/components/AccessEditorSections';
import { api } from '@/src/api/client';
import { confirmAction } from '@/src/utils/confirm';

const ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin', accountant: 'Accountant', employee: 'Sales / Staff' };

export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const { user: me } = useAuth();

  const editor = useAccessEditor(id);
  const acc = editor.acc;
  const isOwner = editor.isOwner;
  const isEmployee = editor.isEmployee;
  const [newPass, setNewPass] = useState('');
  const [deleting, setDeleting] = useState(false);

  const save = async () => {
    const res = await editor.save({ newPassword: newPass });
    if (res.ok) {
      toast.success('Saved');
      setNewPass('');
      router.back();
    } else {
      notify('Failed', res.error);
    }
  };

  // Staff logins only (owner/admin/accountant) — employees are deleted/marked
  // Left from their own profile (employee/[id].tsx), not here. Owner and the
  // account you're logged in as can never be deleted, matching the backend's
  // guard, so the button doesn't even show for those.
  const canDelete = !!acc && acc.account_type === 'user' && !isOwner && acc.id !== me?.id;

  const onDelete = () => {
    if (!acc) return;
    confirmAction('Delete user', `Delete ${acc.name}'s login? This cannot be undone.`, 'Delete', async () => {
      setDeleting(true);
      try {
        await api.del(`/users/${acc.id}`);
        router.replace('/settings/user-roles' as any);
      } catch (e: any) {
        notify('Failed', e?.detail || 'Could not delete this user. Please try again.');
      } finally {
        setDeleting(false);
      }
    });
  };

  if (editor.loading) {
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
        <Text style={styles.empty}>{editor.loadError ? "Couldn't load this account — check your connection." : 'This account could not be loaded.'}</Text>
        {editor.loadError && (
          <Pressable onPress={editor.reload} style={[styles.saveBtn, { marginHorizontal: spacing.lg, marginTop: spacing.md }]} testID="person-retry-btn">
            <Text style={styles.saveText}>Retry</Text>
          </Pressable>
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID={`person-${acc.id}`}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} hitSlop={12} testID="back-btn"><Ionicons name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.title} numberOfLines={1}>{acc.name}</Text>
        {canDelete ? (
          <Pressable onPress={onDelete} disabled={deleting} style={styles.iconBtn} hitSlop={12} testID="delete-user-btn">
            {deleting ? <ActivityIndicator size="small" color={colors.onError} /> : <Ionicons name="trash-outline" size={20} color={colors.onError} />}
          </Pressable>
        ) : (
          <View style={styles.iconBtn} />
        )}
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

        <Section title="Notifications">
          <NotificationsSection editor={editor} testIdPrefix="person" />
        </Section>

        <Section title="Access">
          <AccessSection editor={editor} testIdPrefix="person" />
        </Section>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable onPress={save} disabled={editor.saving} style={[styles.saveBtn, editor.saving && { opacity: 0.6 }]} testID="person-save">
          {editor.saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Save changes</Text>}
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

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg, paddingTop: spacing.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 15, alignItems: 'center' },
  saveText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: '700' },
});
