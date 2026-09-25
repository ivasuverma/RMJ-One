import { Tabs, useRouter } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { useEffect } from 'react';
import { useTheme } from '@/src/theme/ThemeContext';
import { useAuth } from '@/src/auth/AuthContext';
import { EmployeeTabBar } from '@/src/components/EmployeeTabBar';

export default function EmployeeTabsLayout() {
  const { user, loading } = useAuth();
  const { colors } = useTheme();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/login');
    else if (user.role !== 'employee') router.replace('/(tabs)/dashboard');
    else if (user.must_change_password) router.replace('/set-password' as any);
  }, [user, loading, router]);

  if (loading || !user || user.role !== 'employee' || user.must_change_password) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.brandPrimary} size="large" />
      </View>
    );
  }

  return (
    // Custom bar, same layout as the owner/admin one: Home, Work, a centre
    // camera button, Ledger, Settings — with Work, Ledger and the camera each
    // shown only when the owner has enabled something behind them (see
    // EmployeeTabBar). It navigates by href rather than off this navigator's
    // state, so the identical bar can also sit under the shared module
    // screens that live in the (tabs) group.
    <Tabs
      tabBar={() => <EmployeeTabBar />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.surface } }}
    >
      <Tabs.Screen name="home" options={{ title: 'Home' }} />
      <Tabs.Screen name="work" options={{ title: 'Work' }} />
      <Tabs.Screen name="ledger" options={{ title: 'Ledger' }} />
      <Tabs.Screen name="profile" options={{ title: 'Settings' }} />
      {/* Still routable via deep links / tiles, but not tabs of their own.
          Calendar & Leaves are reached from the Home quick actions; Tasks &
          Transactions content lives in the Work hub. */}
      <Tabs.Screen name="edit-profile" options={{ href: null }} />
      <Tabs.Screen name="calendar" options={{ href: null }} />
      <Tabs.Screen name="leaves" options={{ href: null }} />
      <Tabs.Screen name="tasks" options={{ href: null }} />
      <Tabs.Screen name="transactions" options={{ href: null }} />
    </Tabs>
  );
}
