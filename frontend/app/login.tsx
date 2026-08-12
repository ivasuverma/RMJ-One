import { useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, KeyboardAvoidingView,
  Platform, ActivityIndicator, ScrollView, Keyboard,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/auth/AuthContext';
import { spacing, radius, images, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Mode = 'owner' | 'employee';

export default function LoginScreen() {
  const { colors, scheme } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Dark, translucent scrim over the hero photo in dark mode; a light ivory
  // scrim in light mode so the card still reads as "Ivory boutique".
  const gradientColors = scheme === 'light'
    ? ['rgba(247,241,230,0.15)', 'rgba(247,241,230,0.75)', 'rgba(247,241,230,0.98)'] as const
    : ['rgba(13,13,13,0.15)', 'rgba(13,13,13,0.7)', 'rgba(13,13,13,0.98)'] as const;
  const [mode, setMode] = useState<Mode>('employee');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [secure, setSecure] = useState(true);
  const { loginOwner, loginEmployee } = useAuth();
  const router = useRouter();
  const submittingRef = useRef(false);

  const onSubmit = async () => {
    if (submittingRef.current) return; // guards rapid double/triple taps
    submittingRef.current = true;
    Keyboard.dismiss();
    setError('');
    setLoading(true);
    try {
      if (mode === 'owner') {
        await loginOwner(username.trim(), password, remember);
      } else {
        await loginEmployee(username.trim(), password, remember);
      }
      // Let the root layout / index router pick the right destination based on the actual role
      router.replace('/');
    } catch (e: any) {
      setError(e?.detail || 'Login failed');
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  return (
    <View style={styles.root} testID="login-screen">
      <Image source={images.loginHero} style={StyleSheet.absoluteFill} contentFit="cover" transition={400} />
      <LinearGradient
        colors={gradientColors}
        locations={[0, 0.45, 0.9]}
        style={StyleSheet.absoluteFill}
      />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.brand}>
            <Image source={images.logo} style={styles.brandLogo} contentFit="contain" testID="brand-logo" />
            <Text style={styles.brandTitle}>RMJ-One</Text>
            <Text style={styles.brandTag}>One system for the entire business.</Text>
          </View>

          <View style={styles.formCard} testID="login-form">
            {/* Mode switcher */}
            <View style={styles.modeRow} testID="login-mode-row">
              <Pressable
                testID="mode-employee"
                onPress={() => { setMode('employee'); setError(''); setUsername(''); setPassword(''); }}
                style={[styles.modeBtn, mode === 'employee' && styles.modeBtnActive]}
              >
                <Ionicons name="people-outline" size={16} color={mode === 'employee' ? colors.onBrandPrimary : colors.onSurfaceTertiary} />
                <Text style={[styles.modeText, mode === 'employee' && styles.modeTextActive]}>Employee</Text>
              </Pressable>
              <Pressable
                testID="mode-owner"
                onPress={() => { setMode('owner'); setError(''); setUsername(''); setPassword(''); }}
                style={[styles.modeBtn, mode === 'owner' && styles.modeBtnActive]}
              >
                <Ionicons name="key-outline" size={16} color={mode === 'owner' ? colors.onBrandPrimary : colors.onSurfaceTertiary} />
                <Text style={[styles.modeText, mode === 'owner' && styles.modeTextActive]}>Owner</Text>
              </Pressable>
            </View>

            <Text style={styles.formTitle}>{mode === 'owner' ? 'Welcome back' : 'Punch in'}</Text>
            <Text style={styles.formSubtitle}>
              {mode === 'owner' ? 'Sign in to your workspace' : 'Sign in with your username and password'}
            </Text>

            <Text style={styles.label}>Username</Text>
            <TextInput
              testID={mode === 'owner' ? 'login-username' : 'emp-username-input'}
              value={username} onChangeText={setUsername}
              autoCapitalize="none" autoCorrect={false}
              placeholder={mode === 'owner' ? 'owner' : 'rmj001'} placeholderTextColor={colors.mutedText}
              style={styles.input}
            />
            <Text style={styles.label}>Password</Text>
            <View style={styles.passwordRow}>
              <TextInput
                testID={mode === 'owner' ? 'login-password' : 'emp-password-input'}
                value={password} onChangeText={setPassword}
                secureTextEntry={secure} placeholder="••••••••" placeholderTextColor={colors.mutedText}
                autoCapitalize="none" autoCorrect={false}
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                onSubmitEditing={onSubmit}
              />
              <Pressable testID="login-toggle-password" onPress={() => setSecure((s) => !s)} style={styles.eyeBtn} hitSlop={12}>
                <Ionicons name={secure ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.onSurfaceTertiary} />
              </Pressable>
            </View>

            <Pressable
              testID="login-remember-toggle"
              onPress={() => setRemember((r) => !r)}
              style={styles.rememberRow}
              hitSlop={8}
            >
              <View style={[styles.checkbox, remember && styles.checkboxChecked]}>
                {remember && <Ionicons name="checkmark" size={13} color={colors.onBrandPrimary} />}
              </View>
              <Text style={styles.rememberText}>Keep me signed in on this device</Text>
            </Pressable>

            {!!error && <Text style={styles.errorText} testID="login-error">{error}</Text>}

            <Pressable
              testID="login-submit" onPress={onSubmit}
              disabled={loading}
              style={({ pressed }) => [styles.cta, loading && { opacity: 0.6 }, pressed && { transform: [{ scale: 0.99 }] }]}
            >
              {loading ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.ctaText}>Sign in</Text>}
            </Pressable>

            <Text style={styles.hint}>
              {mode === 'employee' ? 'Ask your manager if you’ve forgotten your login.' : 'Contact your admin if you’ve lost access.'}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { flexGrow: 1, justifyContent: 'space-between', padding: spacing.xl, paddingTop: 60, paddingBottom: 40 },
  brand: { alignItems: 'flex-start' },
  brandLogo: {
    width: 56, height: 56, borderRadius: radius.md, marginBottom: spacing.md,
  },
  brandTitle: { color: colors.onSurface, fontSize: 44, fontFamily: fonts.display, letterSpacing: 0.5 },
  brandTag: { color: colors.brandSecondary, marginTop: spacing.xs, fontSize: 14, letterSpacing: 0.3 },

  formCard: {
    backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.lg, padding: spacing.xl, marginTop: spacing.xxl,
  },
  modeRow: {
    flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg,
    backgroundColor: colors.surfaceTertiary, padding: 4, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border,
  },
  modeBtn: {
    flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 8, borderRadius: radius.pill,
  },
  modeBtnActive: { backgroundColor: colors.brandPrimary },
  modeText: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: '600' },
  modeTextActive: { color: colors.onBrandPrimary },

  formTitle: { color: colors.onSurface, fontSize: 22, fontWeight: '600', marginBottom: spacing.xs },
  formSubtitle: { color: colors.onSurfaceTertiary, fontSize: 12, marginBottom: spacing.lg },
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
  rememberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  checkbox: {
    width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  rememberText: { color: colors.onSurfaceSecondary, fontSize: 13 },
  errorText: { color: colors.onError, marginTop: spacing.md, fontSize: 13 },
  cta: {
    marginTop: spacing.lg, backgroundColor: colors.brandPrimary, borderRadius: radius.md,
    paddingVertical: 16, alignItems: 'center', justifyContent: 'center',
  },
  ctaText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 16, letterSpacing: 0.5 },
  hint: { color: colors.mutedText, fontSize: 12, marginTop: spacing.lg, textAlign: 'center' },
});
