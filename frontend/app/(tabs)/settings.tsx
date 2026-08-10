import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuth } from '@/src/auth/AuthContext';
import { colors, spacing, radius, fonts } from '@/src/theme';
import { isPushSupported, isSubscribed, subscribeToPush, unsubscribeFromPush } from '@/src/utils/push';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner', admin: 'Admin', accountant: 'Accountant', employee: 'Employee',
};

export default function SettingsScreen() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const isOwner = user?.role === 'owner';
  const isAdmin = user?.role === 'admin';
  const isAccountant = user?.role === 'accountant';

  useFocusEffect(useCallback(() => {
    if (isPushSupported()) isSubscribed().then(setPushOn);
  }, []));

  const togglePush = async () => {
    if (!isPushSupported()) {
      Alert.alert('Not supported', 'Notifications aren’t supported in this browser.');
      return;
    }
    setPushBusy(true);
    try {
      if (pushOn) {
        await unsubscribeFromPush();
        setPushOn(false);
      } else {
        const res = await subscribeToPush();
        if (res.ok) setPushOn(true);
        else Alert.alert('Couldn’t enable notifications', res.reason || 'Please try again');
      }
    } finally {
      setPushBusy(false);
    }
  };

  const onLogout = async () => {
    await logout();
    router.replace('/login');
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="settings-screen">
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Settings</Text>

        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(user?.name || 'O')[0]?.toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>{user?.name}</Text>
            <Text style={styles.role}>{ROLE_LABEL[user?.role || 'employee']}</Text>
            <Text style={styles.username}>@{user?.username}</Text>
          </View>
        </View>

        {isOwner && (
          <>
            <SectionLabel text="Business" />
            <View style={styles.card}>
              <Pressable testID="settings-store-btn" onPress={() => router.push('/store-settings')}>
                <Row icon="storefront-outline" label="Store Settings" trailing="Configure" />
              </Pressable>
              <Divider />
              <Pressable testID="settings-shifts-btn" onPress={() => router.push('/settings/shifts')}>
                <Row icon="time-outline" label="Shifts" trailing="Manage" />
              </Pressable>
              <Divider />
              <Pressable testID="settings-holidays-btn" onPress={() => router.push('/settings/holidays')}>
                <Row icon="calendar-outline" label="Holidays" trailing="Calendar" />
              </Pressable>
              <Divider />
              <Pressable testID="settings-users-btn" onPress={() => router.push('/settings/users')}>
                <Row icon="people-circle-outline" label="Users & Roles" trailing="Manage" />
              </Pressable>
              <Divider />
              <Pressable testID="settings-biometric-btn" onPress={() => router.push('/settings/biometric')}>
                <Row icon="hardware-chip-outline" label="Biometric Devices" trailing="eSSL" />
              </Pressable>
              <Divider />
              <Pressable testID="settings-audit-btn" onPress={() => router.push('/settings/audit')}>
                <Row icon="shield-checkmark-outline" label="Audit Logs" trailing="Owner" />
              </Pressable>
            </View>
          </>
        )}

        {(isOwner || isAdmin || isAccountant) && (
          <>
            <SectionLabel text="Reports & Reviews" />
            <View style={styles.card}>
              {(isOwner || isAdmin) && (
                <>
                  <Pressable testID="settings-approvals-btn" onPress={() => router.push('/approvals')}>
                    <Row icon="checkmark-done-outline" label="Approvals" trailing="Review" />
                  </Pressable>
                  <Divider />
                </>
              )}
              <Pressable testID="settings-reports-btn" onPress={() => router.push('/reports')}>
                <Row icon="document-text-outline" label="Reports" trailing="Export PDF" />
              </Pressable>
            </View>
          </>
        )}

        <SectionLabel text="Preferences" />
        <View style={styles.card}>
          <Pressable testID="settings-notifications-toggle" onPress={togglePush} disabled={pushBusy}>
            <View style={styles.row}>
              <View style={styles.rowIcon}>
                <Ionicons name="notifications-outline" size={18} color={colors.brandSecondary} />
              </View>
              <Text style={styles.rowLabel}>Notifications</Text>
              {pushBusy ? <ActivityIndicator size="small" color={colors.brandSecondary} /> : (
                <Text style={[styles.rowTrail, pushOn && { color: colors.success }]}>{pushOn ? 'On' : 'Off'}</Text>
              )}
            </View>
          </Pressable>
          <Divider />
          <Row icon="language-outline" label="Language" trailing="English" />
          <Divider />
          <Row icon="moon-outline" label="Theme" trailing="Dark" />
        </View>

        <SectionLabel text="About" />
        <View style={styles.card}>
          <Row icon="information-circle-outline" label="Version" trailing="1.0.0" />
          <Divider />
          <Row icon="business-outline" label="Business" trailing="Ram Murti Jewellers" />
        </View>

        <Pressable testID="logout-btn" style={styles.logout} onPress={onLogout}>
          <Ionicons name="log-out-outline" size={20} color="#F1A9A9" />
          <Text style={styles.logoutText}>Sign out</Text>
        </Pressable>

        <Text style={styles.footer}>RMJ One · One system for the entire business</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionLabel({ text }: { text: string }) {
  return <Text style={styles.sectionLabel}>{text}</Text>;
}

function Row({ icon, label, trailing }: { icon: any; label: string; trailing?: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={18} color={colors.brandSecondary} />
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
      {!!trailing && <Text style={styles.rowTrail}>{trailing}</Text>}
    </View>
  );
}

function Divider() { return <View style={styles.divider} />; }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, paddingBottom: 120 },
  title: {
    color: colors.onSurface, fontSize: 30, fontWeight: '600', marginBottom: spacing.lg,
    fontFamily: fonts.display,
  },
  profileCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.brandTertiary, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.brandPrimary,
    padding: spacing.lg,
  },
  avatar: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: colors.onBrandPrimary, fontSize: 24, fontWeight: '800' },
  name: { color: colors.onSurface, fontSize: 18, fontWeight: '700' },
  role: { color: colors.brandSecondary, fontSize: 13, marginTop: 2 },
  username: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },

  sectionLabel: {
    color: colors.mutedText, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase',
    marginTop: spacing.xl, marginBottom: spacing.sm, paddingHorizontal: spacing.xs,
  },
  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: spacing.lg, gap: spacing.md },
  rowIcon: {
    width: 32, height: 32, borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center',
  },
  rowLabel: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 14 },
  rowTrail: { color: colors.mutedText, fontSize: 13 },
  divider: { height: 1, backgroundColor: colors.divider, marginHorizontal: spacing.lg },

  logout: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    marginTop: spacing.xl, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.error,
    paddingVertical: 14,
  },
  logoutText: { color: '#F1A9A9', fontWeight: '700', fontSize: 15 },
  footer: { color: colors.mutedText, fontSize: 11, textAlign: 'center', marginTop: spacing.xl },
});
