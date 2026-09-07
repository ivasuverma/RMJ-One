import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, ActivityIndicator } from 'react-native';
import { useEffect } from 'react';
import { useTheme } from '@/src/theme/ThemeContext';
import { useAuth } from '@/src/auth/AuthContext';
import { OwnerTabBar } from '@/src/components/OwnerTabBar';

export default function OwnerTabsLayout() {
  const { user, loading } = useAuth();
  const { colors } = useTheme();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/login');
    else if (user.role === 'employee') router.replace('/(emp)/home');
  }, [user, loading, router]);

  if (loading || !user || user.role === 'employee') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.brandPrimary} size="large" />
      </View>
    );
  }

  return (
    <Tabs
      // Custom tabBar (OwnerTabBar) replaces the default bar entirely — it
      // renders Dashboard/Work/Ledger/Settings plus a 5th, unrouted center
      // capture button, which the default BottomTabBar has no slot for.
      // screenOptions here still matter: OwnerTabBar reads title/tabBarIcon/
      // tabBarButtonTestID/tabBarStyle off each route's own options.
      tabBar={(props) => <OwnerTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      {/* Four tabs (v3 IA): Dashboard, Work, Ledger, Settings — plus the
          center capture button OwnerTabBar renders between Work and Ledger.
          Ledger consolidates the four account ledgers that used to live only
          under Settings > Reports. */}
      <Tabs.Screen
        name="dashboard"
        options={{ title: 'Home', tabBarButtonTestID: 'tab-dashboard', tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="work"
        options={{ title: 'Work', tabBarButtonTestID: 'tab-work', tabBarIcon: ({ color, size }) => <Ionicons name="briefcase-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="ledger"
        options={{ title: 'Ledger', tabBarButtonTestID: 'tab-ledger', tabBarIcon: ({ color, size }) => <Ionicons name="book-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="utility"
        options={{ title: 'Settings', tabBarButtonTestID: 'tab-utility', tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" color={color} size={size} /> }}
      />
      {/* Still routable (Work tiles + deep links point into these, and old
          /(tabs)/transactions and /(tabs)/reports links still resolve) but no
          longer their own bottom tab — the v2 IA groups by action type, not by
          module. Transactions/Reports content now lives in the Work hub.
          Each has its own back button, so the root tab bar is hidden while
          it's active (href: null alone only drops the tappable icon, not
          the bar itself) — it would otherwise sit redundantly under a
          screen that already has its own way back. */}
      <Tabs.Screen name="transactions" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="reports" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="attendance" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="employees" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="payroll" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="settings" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      <Tabs.Screen name="masters" options={{ href: null }} />
    </Tabs>
  );
}
