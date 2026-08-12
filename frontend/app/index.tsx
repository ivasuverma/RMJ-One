import { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/auth/AuthContext';
import { spacing, radius, fonts, images, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Module = {
  key: string;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  route?: string;
  comingSoon?: boolean;
};

const MODULES: Module[] = [
  {
    key: 'employees', title: 'Employee Management', subtitle: 'Attendance, payroll, team',
    icon: 'people-outline', route: '/(tabs)/dashboard',
  },
  {
    key: 'repairs', title: 'Repairs', subtitle: 'Coming soon',
    icon: 'construct-outline', comingSoon: true,
  },
  {
    key: 'samples', title: 'Sample In/Out', subtitle: 'Coming soon',
    icon: 'swap-horizontal-outline', comingSoon: true,
  },
];

export default function Index() {
  const { user, loading, logout } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/login');
    else if (user.role === 'employee') router.replace('/(emp)/home');
  }, [user, loading, router]);

  if (loading || !user || user.role === 'employee') {
    return (
      <View style={styles.loaderRoot} testID="splash-loader">
        <ActivityIndicator color={colors.brandPrimary} size="large" />
      </View>
    );
  }

  const onLogout = async () => { await logout(); router.replace('/login'); };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="hub-screen">
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Image source={images.logo} style={styles.logo} contentFit="contain" testID="hub-logo" />
          <Text style={styles.brand}>RMJ-One</Text>
          <Text style={styles.tagline}>One system for the entire business.</Text>
        </View>

        <View style={styles.profileRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(user.name || 'O')[0]?.toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName} numberOfLines={1}>{user.name}</Text>
            <Text style={styles.profileRole}>{user.role.charAt(0).toUpperCase() + user.role.slice(1)}</Text>
          </View>
          {user.role === 'owner' && (
            <Pressable onPress={() => router.push('/universal-settings' as any)} style={styles.settingsBtn} testID="hub-universal-settings-btn" hitSlop={10}>
              <Ionicons name="settings-outline" size={20} color={colors.brandPrimary} />
            </Pressable>
          )}
          <Pressable onPress={onLogout} style={styles.logoutBtn} testID="hub-logout-btn" hitSlop={10}>
            <Ionicons name="log-out-outline" size={20} color={colors.onError} />
          </Pressable>
        </View>

        <Text style={styles.sectionLabel}>Modules</Text>
        <View style={styles.grid}>
          {MODULES.map((m) => (
            <Pressable
              key={m.key}
              testID={`module-${m.key}`}
              disabled={m.comingSoon}
              onPress={() => m.route && router.push(m.route as any)}
              style={({ pressed }) => [
                styles.tile,
                m.comingSoon && styles.tileDisabled,
                pressed && !m.comingSoon && { opacity: 0.85 },
              ]}
            >
              <View style={[styles.tileIcon, m.comingSoon && styles.tileIconDisabled]}>
                <Ionicons name={m.icon} size={26} color={m.comingSoon ? colors.mutedText : colors.brandPrimary} />
              </View>
              <Text style={[styles.tileTitle, m.comingSoon && styles.tileTitleDisabled]}>{m.title}</Text>
              <Text style={styles.tileSubtitle}>{m.subtitle}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.footer}>More modules land here as they're built.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  loaderRoot: { flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },

  header: { alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.xl },
  logo: { width: 64, height: 64, borderRadius: radius.md, marginBottom: spacing.md },
  brand: { color: colors.onSurface, fontSize: 28, fontFamily: fonts.display, letterSpacing: 0.5 },
  tagline: { color: colors.brandSecondary, fontSize: 13, marginTop: 4 },

  profileRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.brandTertiary, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.brandPrimary, padding: spacing.lg, marginBottom: spacing.xl,
  },
  avatar: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: colors.onBrandPrimary, fontSize: 18, fontWeight: '800' },
  profileName: { color: colors.onSurface, fontSize: 15, fontWeight: '700' },
  profileRole: { color: colors.brandSecondary, fontSize: 12, marginTop: 2 },
  logoutBtn: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.error, borderColor: colors.onError, borderWidth: 1,
  },
  settingsBtn: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary, borderWidth: 1,
  },

  sectionLabel: {
    color: colors.mutedText, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.md,
  },
  grid: { gap: spacing.md },
  tile: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.lg,
  },
  tileDisabled: { opacity: 0.55 },
  tileIcon: {
    width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.brand,
  },
  tileIconDisabled: { backgroundColor: colors.surfaceTertiary, borderColor: colors.border },
  tileTitle: { color: colors.onSurface, fontSize: 17, fontWeight: '700', fontFamily: fonts.display },
  tileTitleDisabled: { color: colors.onSurfaceTertiary },
  tileSubtitle: { color: colors.mutedText, fontSize: 12, marginTop: 4 },

  footer: { color: colors.mutedText, fontSize: 11, textAlign: 'center', marginTop: spacing.xl },
});
