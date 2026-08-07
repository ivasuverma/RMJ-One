import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Keyboard,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/auth/AuthContext';
import { colors, spacing, radius, images } from '@/src/theme';

export default function LoginScreen() {
  const [username, setUsername] = useState('owner');
  const [password, setPassword] = useState('Owner@123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [secure, setSecure] = useState(true);
  const { login } = useAuth();
  const router = useRouter();

  const onSubmit = async () => {
    Keyboard.dismiss();
    setError('');
    setLoading(true);
    try {
      await login(username.trim(), password);
      router.replace('/(tabs)/dashboard');
    } catch (e: any) {
      setError(e?.detail || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root} testID="login-screen">
      <Image source={images.loginHero} style={StyleSheet.absoluteFill} contentFit="cover" transition={400} />
      <LinearGradient
        colors={['rgba(13,13,13,0.15)', 'rgba(13,13,13,0.7)', 'rgba(13,13,13,0.98)']}
        locations={[0, 0.45, 0.9]}
        style={StyleSheet.absoluteFill}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brand}>
            <View style={styles.brandBadge}>
              <Text style={styles.brandBadgeText}>RMJ</Text>
            </View>
            <Text style={styles.brandTitle}>RMJ One</Text>
            <Text style={styles.brandTag}>One system for the entire business.</Text>
          </View>

          <View style={styles.formCard} testID="login-form">
            <Text style={styles.formTitle}>Welcome back</Text>
            <Text style={styles.formSubtitle}>Sign in to your workspace</Text>

            <Text style={styles.label}>Username</Text>
            <TextInput
              testID="login-username"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="owner"
              placeholderTextColor={colors.mutedText}
              style={styles.input}
            />

            <Text style={styles.label}>Password</Text>
            <View style={styles.passwordRow}>
              <TextInput
                testID="login-password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={secure}
                placeholder="••••••••"
                placeholderTextColor={colors.mutedText}
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
              />
              <Pressable
                testID="login-toggle-password"
                onPress={() => setSecure((s) => !s)}
                style={styles.eyeBtn}
                hitSlop={12}
              >
                <Ionicons
                  name={secure ? 'eye-off-outline' : 'eye-outline'}
                  size={20}
                  color={colors.onSurfaceTertiary}
                />
              </Pressable>
            </View>

            {!!error && (
              <Text style={styles.errorText} testID="login-error">
                {error}
              </Text>
            )}

            <Pressable
              testID="login-submit"
              onPress={onSubmit}
              disabled={loading || !username || !password}
              style={({ pressed }) => [
                styles.cta,
                (loading || !username || !password) && { opacity: 0.6 },
                pressed && { transform: [{ scale: 0.99 }] },
              ]}
            >
              {loading ? (
                <ActivityIndicator color={colors.onBrandPrimary} />
              ) : (
                <Text style={styles.ctaText}>Sign in</Text>
              )}
            </Pressable>

            <Text style={styles.hint}>Demo: owner / Owner@123</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { flexGrow: 1, justifyContent: 'space-between', padding: spacing.xl, paddingTop: 80, paddingBottom: 40 },
  brand: { alignItems: 'flex-start' },
  brandBadge: {
    width: 56, height: 56, borderRadius: radius.md,
    backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.md,
  },
  brandBadgeText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 18, letterSpacing: 1 },
  brandTitle: { color: colors.onSurface, fontSize: 44, fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }), letterSpacing: 0.5 },
  brandTag: { color: colors.brandSecondary, marginTop: spacing.xs, fontSize: 14, letterSpacing: 0.3 },

  formCard: {
    backgroundColor: 'rgba(28,28,28,0.92)',
    borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.lg, padding: spacing.xl,
    marginTop: spacing.xxxl,
  },
  formTitle: { color: colors.onSurface, fontSize: 24, fontWeight: '600', marginBottom: spacing.xs },
  formSubtitle: { color: colors.onSurfaceTertiary, fontSize: 13, marginBottom: spacing.xl },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: spacing.xs, marginTop: spacing.md },
  input: {
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface,
    paddingHorizontal: spacing.lg, paddingVertical: 14, fontSize: 15,
    marginBottom: spacing.xs,
  },
  passwordRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  eyeBtn: {
    width: 46, height: 46, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  errorText: { color: '#F1A9A9', marginTop: spacing.md, fontSize: 13 },
  cta: {
    marginTop: spacing.xl, backgroundColor: colors.brandPrimary,
    borderRadius: radius.md, paddingVertical: 16, alignItems: 'center', justifyContent: 'center',
  },
  ctaText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 16, letterSpacing: 0.5 },
  hint: { color: colors.mutedText, fontSize: 12, marginTop: spacing.lg, textAlign: 'center' },
});
