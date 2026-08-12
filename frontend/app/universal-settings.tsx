import { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

// Settings that apply across the whole business, not to one module — reached from
// the hub (gear icon next to the profile row), not from any single module's own
// Settings tab. Module-specific config (Shifts/Holidays for Employee Management,
// Repair Types for Repairs, etc.) lives inside that module instead.
export default function UniversalSettingsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="universal-settings-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Universal Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
        <Text style={styles.hint}>These apply across every module — Employee Management, Repairs, and anything added later.</Text>

        <View style={styles.card}>
          <Pressable testID="us-store-btn" onPress={() => router.push('/store-settings')}>
            <Row icon="storefront-outline" label="Store Settings" sub="Name, location, geofence" />
          </Pressable>
          <Divider />
          <Pressable testID="us-user-roles-btn" onPress={() => router.push('/settings/user-roles' as any)}>
            <Row icon="shield-outline" label="User Roles" sub="Who can see which module" />
          </Pressable>
          <Divider />
          <Pressable testID="us-staff-btn" onPress={() => router.push('/settings/users')}>
            <Row icon="people-circle-outline" label="Staff Accounts" sub="Admin & accountant logins" />
          </Pressable>
          <Divider />
          <Pressable testID="us-audit-btn" onPress={() => router.push('/settings/audit')}>
            <Row icon="document-lock-outline" label="Audit Log" sub="Every entry, who made it, when" />
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ icon, label, sub }: { icon: any; label: string; sub: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}><Ionicons name={icon} size={18} color={colors.brandSecondary} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.mutedText} />
    </View>
  );
}

function Divider() {
  const { colors } = useTheme();
  return <View style={{ height: 1, backgroundColor: colors.divider, marginHorizontal: spacing.lg }} />;
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
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '600', fontFamily: fonts.display },
  hint: { color: colors.mutedText, fontSize: 12, marginBottom: spacing.lg },
  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: spacing.lg, gap: spacing.md },
  rowIcon: {
    width: 34, height: 34, borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center',
  },
  rowLabel: { color: colors.onSurfaceSecondary, fontSize: 14, fontWeight: '600' },
  rowSub: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
});
