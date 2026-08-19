import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, ActivityIndicator } from 'react-native';
import { useEffect } from 'react';
import { useTheme } from '@/src/theme/ThemeContext';
import { useAuth } from '@/src/auth/AuthContext';

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
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface, borderTopColor: colors.border, borderTopWidth: 1,
          height: 72, paddingBottom: 12, paddingTop: 10,
        },
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.mutedText,
        tabBarLabelStyle: { fontSize: 10.5, fontWeight: '600', letterSpacing: 0.3 },
      }}
    >
      {/* Three tabs (v2 IA): Dashboard (the check-in home), Work, Settings
          (profile). Work is always shown now — even an employee with no
          granted operations modules still has My Tasks and My Ledger there. */}
      <Tabs.Screen
        name="home"
        options={{ title: 'Home', tabBarButtonTestID: 'tab-home', tabBarIcon: ({ color, size }) => <Ionicons name="scan-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="work"
        options={{ title: 'Work', tabBarButtonTestID: 'tab-work', tabBarIcon: ({ color, size }) => <Ionicons name="briefcase-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Settings', tabBarButtonTestID: 'tab-profile', tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" color={color} size={size} /> }}
      />
      {/* Still routable via deep links / tiles, but no longer their own tab.
          Calendar & Leaves are reached from the Home quick actions; Tasks &
          Transactions content now lives in the Work hub. */}
      <Tabs.Screen name="calendar" options={{ href: null }} />
      <Tabs.Screen name="leaves" options={{ href: null }} />
      <Tabs.Screen name="tasks" options={{ href: null }} />
      <Tabs.Screen name="transactions" options={{ href: null }} />
    </Tabs>
  );
}
