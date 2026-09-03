import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator, Platform, KeyboardAvoidingView, Share,
} from 'react-native';
import { notify } from '@/src/utils/notify';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

export default function SetEmployeeCredentials() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [empName, setEmpName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<{ employee: { name: string; username?: string } }>(`/employees/${id}`);
        setEmpName(res.employee?.name || '');
        if (res.employee?.username) setUsername(res.employee.username);
      } catch (_e) { /* ignore — name is just for display/share text */ }
    })();
  }, [id]);

  const submit = async () => {
    if (submittingRef.current) return;
    if (!username.trim()) { notify('Invalid', 'Username is required'); return; }
    if (password.length < 4) { notify('Invalid', 'Password must be at least 4 characters'); return; }
    if (password !== confirm) { notify('Mismatch', 'Password and confirmation don\'t match'); return; }
    submittingRef.current = true;
    setSaving(true);
    try {
      await api.post(`/employees/${id}/set-credentials`, { username: username.trim(), password });
      router.back();
      Share.share({
        message: `RMJ-One login${empName ? ` for ${empName}` : ''}\nUsername: ${username.trim()}\nPassword: ${password}`,
      }).catch(() => {});
    } catch (e: any) {
      notify('Failed', e?.detail || 'Please try again');
    } finally { setSaving(false); submittingRef.current = false; }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="set-credentials-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Set Login Credentials</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={{ padding: spacing.xl }}>
          <Text style={styles.info}>
            {empName ? `Set the username and password ${empName} will use to log in.` : 'Set the username and password this employee will use to log in.'}
            {' '}You'll get a share prompt with the new login once it's saved.
          </Text>

          <Text style={styles.label}>Username</Text>
          <TextInput
            testID="cred-username-input"
            value={username} onChangeText={setUsername}
            autoCapitalize="none" autoCorrect={false}
            placeholder="rmj001" placeholderTextColor={colors.mutedText}
            style={styles.input}
          />

          <Text style={styles.label}>New Password</Text>
          <TextInput
            testID="cred-password-input"
            value={password} onChangeText={setPassword}
            secureTextEntry autoCapitalize="none" autoCorrect={false}
            placeholder="••••••••" placeholderTextColor={colors.mutedText}
            style={styles.input}
          />

          <Text style={styles.label}>Confirm Password</Text>
          <TextInput
            testID="cred-confirm-input"
            value={confirm} onChangeText={setConfirm}
            secureTextEntry autoCapitalize="none" autoCorrect={false}
            placeholder="••••••••" placeholderTextColor={colors.mutedText}
            style={styles.input}
          />

          <Pressable onPress={submit} disabled={saving} style={[styles.submit, saving && { opacity: 0.6 }]} testID="cred-save-btn">
            {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.submitText}>Save Credentials</Text>}
          </Pressable>
        </View>
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
  info: { color: colors.onSurfaceTertiary, fontSize: 13, marginBottom: spacing.lg },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6, marginTop: spacing.md },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.lg,
    paddingVertical: 14, fontSize: 15,
  },
  submit: { marginTop: spacing.xl, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 16, alignItems: 'center' },
  submitText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 15 },
});
