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

  // Calendar moved to a Home tile — it no longer needs its own tab. Transactions
  // takes its place, but only for an employee an owner has actually assigned one
  // of the employee-assignable modules to (repairs/tasks/approvals); otherwise
  // there's nothing behind that tab, so it stays hidden like Leaves.
  const EMPLOYEE_TRANSACTION_MODULES = ['repairs', 'tasks', 'approvals'];
  const hasTransactionsAccess = (user.modules || []).some((m) => EMPLOYEE_TRANSACTION_MODULES.includes(m));

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surfaceSecondary, borderTopColor: colors.border, borderTopWidth: 1,
          height: 68, paddingBottom: 10, paddingTop: 8,
        },
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.mutedText,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600', letterSpacing: 0.3 },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{ title: 'Home', tabBarButtonTestID: 'tab-home', tabBarIcon: ({ color, size }) => <Ionicons name="scan-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="calendar"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="leaves"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          title: 'Transactions',
          href: hasTransactionsAccess ? undefined : null,
          tabBarButtonTestID: 'tab-transactions',
          tabBarIcon: ({ color, size }) => <Ionicons name="swap-horizontal-outline" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{ title: 'Tasks', tabBarButtonTestID: 'tab-tasks', tabBarIcon: ({ color, size }) => <Ionicons name="checkbox-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profile', tabBarButtonTestID: 'tab-profile', tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} /> }}
      />
    </Tabs>
  );
}
