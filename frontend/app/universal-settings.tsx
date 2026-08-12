import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/src/theme/ThemeContext';

// Universal settings now live directly on the Utility tab as tiles instead of
// behind this intermediate screen — kept as a redirect so any old link/bookmark
// still lands somewhere sensible.
export default function UniversalSettingsRedirect() {
  const router = useRouter();
  const { colors } = useTheme();
  useEffect(() => { router.replace('/(tabs)/utility' as any); }, [router]);
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={colors.brandPrimary} />
    </View>
  );
}
