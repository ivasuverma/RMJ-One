import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/auth/AuthContext';
import { useTheme } from '@/src/theme/ThemeContext';

// Pure redirect — RMJ-One no longer stops here on a module-picker screen.
// Owner/admin/accountant land straight on the Home tab (the old Dashboard
// screen); employees keep going to their own tab group. Universal settings
// (Store, User Roles, Staff Accounts) now live directly on the Utility tab
// instead of behind a hub gear icon.
export default function Index() {
  const { user, loading } = useAuth();
  const { colors } = useTheme();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace('/login'); return; }
    if (user.role === 'employee') router.replace('/(emp)/home');
    else router.replace('/(tabs)/dashboard');
  }, [user, loading, router]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }} testID="splash-loader">
      <ActivityIndicator color={colors.brandPrimary} size="large" />
    </View>
  );
}
