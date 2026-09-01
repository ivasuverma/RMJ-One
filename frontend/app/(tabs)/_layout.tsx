import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect } from 'react';
import { useTheme } from '@/src/theme/ThemeContext';
import { useAuth } from '@/src/auth/AuthContext';

export default function OwnerTabsLayout() {
  const { user, loading } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
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
      screenOptions={{
        headerShown: false,
        // Seamless bar that matches the app background — no translucent band or
        // divider line above it.
        // Compact bar. The installed PWA often reports a 0 bottom inset, which
        // let the labels get clipped by the home indicator — so clamp the
        // bottom padding to at least 20px to always clear it, while keeping the
        // content band itself short.
        tabBarStyle: {
          backgroundColor: colors.surface, borderTopWidth: 0, elevation: 0,
          height: 46 + Math.max(insets.bottom, 20),
          paddingBottom: Math.max(insets.bottom, 20), paddingTop: 6,
        },
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.mutedText,
        tabBarLabelStyle: { fontSize: 10.5, fontWeight: '600', letterSpacing: 0.3 },
      }}
    >
      {/* Three tabs (v2 IA): Dashboard, Work, Settings. */}
      <Tabs.Screen
        name="dashboard"
        options={{ title: 'Home', tabBarButtonTestID: 'tab-dashboard', tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="work"
        options={{ title: 'Work', tabBarButtonTestID: 'tab-work', tabBarIcon: ({ color, size }) => <Ionicons name="briefcase-outline" color={color} size={size} /> }}
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
