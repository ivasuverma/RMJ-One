import { Platform, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/src/theme/ThemeContext';

// Bottom-right floating quick-capture button — sits above the employee tab
// bar (46 + safe-area-bottom tall, see (emp)/_layout.tsx) on any screen that
// renders it. Purely the button; each screen owns its own QuickDocCapture
// sheet + visibility state, same as the existing top-bar capture icon on
// the Work tab did.
//
// position: 'fixed' on web — a `flex: 1` ancestor chain (SafeAreaView >
// ScrollView) can collapse to content height in a browser instead of
// filling the viewport, which would push an `absolute` sibling's computed
// `bottom` far past what's actually visible without scrolling. `fixed`
// pins to the viewport itself regardless of any ancestor's real height.
// RN's own type only allows 'absolute'/'relative', so this is cast through
// as a plain style object rather than typed against ViewStyle.
const FAB_POSITION = Platform.OS === 'web' ? 'fixed' : 'absolute';

export function FloatingCaptureButton({ onPress, testID }: { onPress: () => void; testID?: string }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.fab,
        {
          position: FAB_POSITION as 'absolute',
          bottom: 46 + Math.max(insets.bottom, 20) + 16,
          backgroundColor: colors.brandPrimary, shadowColor: '#000',
        },
      ]}
      testID={testID}
      hitSlop={8}
    >
      <Ionicons name="camera" size={24} color={colors.onBrandPrimary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    right: 20, width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center', zIndex: 50,
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
});
