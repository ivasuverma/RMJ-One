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
        // Compact bar: a fixed content band sitting exactly on top of the
        // device's bottom safe area (home-indicator gap). Basing the height on
        // the inset — instead of a hardcoded number — keeps labels from being
        // clipped into the home indicator, while staying as short as possible.
        tabBarStyle: {
          backgroundColor: colors.surface, borderTopWidth: 0, elevation: 0,
          height: 52 + insets.bottom, paddingBottom: insets.bottom + 4, paddingTop: 6,
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
          module. Transactions/Reports content now lives in the Work hub. */}
      <Tabs.Screen name="transactions" options={{ href: null }} />
      <Tabs.Screen name="reports" options={{ href: null }} />
      <Tabs.Screen name="attendance" options={{ href: null }} />
      <Tabs.Screen name="employees" options={{ href: null }} />
      <Tabs.Screen name="payroll" options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ href: null }} />
      <Tabs.Screen name="masters" options={{ href: null }} />
    </Tabs>
  );
}
