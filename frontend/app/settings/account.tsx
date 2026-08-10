import { useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/auth/AuthContext';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

export default function MyAccountScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user, updateMyAccount } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newUsername, setNewUsername] = useState(user?.username || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [secure, setSecure] = useState(true);
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  const save = async () => {
    if (submittingRef.current) return;
    if (!currentPassword) {
      Alert.alert('Missing', 'Enter your current password to confirm changes.'); return;
    }
    const usernameChanged = newUsername.trim().toLowerCase() !== (user?.username || '');
    const passwordChanged = newPassword.length > 0;
    if (!usernameChanged && !passwordChanged) {
      Alert.alert('No changes', 'Enter a new username or new password to update.'); return;
    }
    if (passwordChanged) {
      if (newPassword.length < 4) { Alert.alert('Too short', 'New password must be 4+ characters.'); return; }
      if (newPassword !== confirmPassword) { Alert.alert('Mismatch', 'New password and confirmation don’t match.'); return; }
    }
    submittingRef.current = true;
    setSaving(true);
    try {
      await updateMyAccount(currentPassword, usernameChanged ? newUsername.trim() : undefined, passwordChanged ? newPassword : undefined);
      router.back();
    } catch (e: any) {
      Alert.alert('Failed', e?.detail || 'Please try again');
    } finally { setSaving(false); submittingRef.current = false; }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="account-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>My Account</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={16} color={colors.brandSecondary} />
            <Text style={styles.infoText}>Change your own login username and/or password. Your current password is required to confirm.</Text>
          </View>

          <Text style={styles.label}>Username</Text>
          <TextInput
            testID="acc-username" value={newUsername} onChangeText={(v) => setNewUsername(v.toLowerCase().replace(/\s/g, ''))}
            autoCapitalize="none" autoCorrect={false} style={styles.input}
          />

          <Text style={styles.label}>New Password</Text>
          <View style={styles.passwordRow}>
            <TextInput
              testID="acc-new-password" value={newPassword} onChangeText={setNewPassword}
              secureTextEntry={secure} placeholder="Leave blank to keep current password"
              placeholderTextColor={colors.mutedText} style={[styles.input, { flex: 1, marginBottom: 0 }]}
            />
            <Pressable onPress={() => setSecure((s) => !s)} style={styles.eyeBtn} hitSlop={12} testID="acc-toggle-secure">
              <Ionicons name={secure ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.onSurfaceTertiary} />
            </Pressable>
          </View>

          <Text style={styles.label}>Confirm New Password</Text>
          <TextInput
            testID="acc-confirm-password" value={confirmPassword} onChangeText={setConfirmPassword}
            secureTextEntry={secure} placeholder="Repeat new password"
            placeholderTextColor={colors.mutedText} style={styles.input}
          />

          <Text style={[styles.label, { marginTop: spacing.xl }]}>Current Password</Text>
          <TextInput
            testID="acc-current-password" value={currentPassword} onChangeText={setCurrentPassword}
            secureTextEntry placeholder="Required to save changes"
            placeholderTextColor={colors.mutedText} style={styles.input}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={styles.footer}>
        <Pressable onPress={save} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]} testID="acc-save-btn">
          {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Save Changes</Text>}
        </Pressable>
      </View>
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
  title: { flex: 1, color: colors.onSurface, fontSize: 22, fontWeight: '600', fontFamily: fonts.display },
  infoBox: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.lg,
  },
  infoText: { color: colors.onSurfaceTertiary, fontSize: 12, flex: 1 },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6, marginTop: spacing.md, fontWeight: '600' },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md,
    paddingVertical: 12, fontSize: 14, marginBottom: spacing.xs,
  },
  passwordRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  eyeBtn: {
    width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 16, alignItems: 'center' },
  saveText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 15 },
});
