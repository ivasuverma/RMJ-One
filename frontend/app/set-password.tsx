import { useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, KeyboardAvoidingView,
  Platform, ActivityIndicator, ScrollView, Keyboard,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, saveToken, isSessionOnly } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

// Shown once, right after a new employee's first login — their default
// password is just the last 4 digits of their employee code (10,000
// possible combinations), so this forces a real password before they can
// use the rest of the app. Gated at two points: the initial redirect in
// index.tsx, and defensively in (emp)/_layout.tsx too, in case a deep link
// or a resumed session lands directly on a tab screen.
export default function SetPasswordScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { refresh } = useAuth();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [secure, setSecure] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const submittingRef = useRef(false);

  const onSubmit = async () => {
    if (submittingRef.current) return;
    if (password.length < 4) { setError('Password must be at least 4 characters'); return; }
    if (password !== confirm) { setError("Passwords don't match"); return; }
    submittingRef.current = true;
    Keyboard.dismiss();
    setError('');
    setLoading(true);
    try {
      const remember = !(await isSessionOnly());
      const res = await api.post<{ ok: boolean; access_token: string }>('/auth/employee/set-password', { new_password: password });
      await saveToken(res.access_token, remember);
      await refresh();
      router.replace('/(emp)/home');
    } catch (e: any) {
      setError(e?.detail || 'Could not set your password. Please try again.');
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  return (
    <View style={styles.root} testID="set-password-screen">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.iconWrap}>
            <Ionicons name="shield-checkmark-outline" size={32} color={colors.brandPrimary} />
          </View>
          <Text style={styles.title}>Set a password</Text>
          <Text style={styles.subtitle}>
            You're signed in with a temporary default password. Choose a new one before continuing — only you should know it.
          </Text>

          <View style={styles.formCard}>
            <Text style={styles.label}>New password</Text>
            <View style={styles.passwordRow}>
              <TextInput
                testID="set-password-new"
                value={password} onChangeText={setPassword}
                secureTextEntry={secure} placeholder="At least 4 characters" placeholderTextColor={colors.mutedText}
                autoCapitalize="none" autoCorrect={false}
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
              />
              <Pressable testID="set-password-toggle" onPress={() => setSecure((s) => !s)} style={styles.eyeBtn} hitSlop={12}>
                <Ionicons name={secure ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.onSurfaceTertiary} />
              </Pressable>
            </View>

            <Text style={styles.label}>Confirm password</Text>
            <TextInput
              testID="set-password-confirm"
              value={confirm} onChangeText={setConfirm}
              secureTextEntry={secure} placeholder="Re-enter password" placeholderTextColor={colors.mutedText}
              autoCapitalize="none" autoCorrect={false}
              style={styles.input}
              onSubmitEditing={onSubmit}
            />

            {!!error && <Text style={styles.errorText} testID="set-password-error">{error}</Text>}

            <Pressable
              testID="set-password-submit" onPress={onSubmit}
              disabled={loading}
              style={({ pressed }) => [styles.cta, loading && { opacity: 0.6 }, pressed && { transform: [{ scale: 0.99 }] }]}
            >
              {loading ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.ctaText}>Save and continue</Text>}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
  iconWrap: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: colors.brandTertiary,
    borderWidth: 1, borderColor: colors.brand, alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center', marginBottom: spacing.lg,
  },
  title: { color: colors.onSurface, fontSize: 22, fontWeight: '600', fontFamily: fonts.display, textAlign: 'center' },
  subtitle: { color: colors.onSurfaceTertiary, fontSize: 13, textAlign: 'center', marginTop: spacing.sm, marginBottom: spacing.xl, lineHeight: 19 },

  formCard: {
    backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.lg, padding: spacing.xl,
  },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: spacing.xs, marginTop: spacing.md },
  input: {
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, color: colors.onSurface,
    paddingHorizontal: spacing.lg, paddingVertical: 14, fontSize: 15, marginBottom: spacing.xs,
  },
  passwordRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  eyeBtn: {
    width: 46, height: 46, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  errorText: { color: colors.onError, marginTop: spacing.md, fontSize: 13 },
  cta: {
    marginTop: spacing.lg, backgroundColor: colors.brandPrimary, borderRadius: radius.md,
    paddingVertical: 16, alignItems: 'center', justifyContent: 'center',
  },
  ctaText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 16, letterSpacing: 0.5 },
});
