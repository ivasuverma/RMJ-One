import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

// Bottom-right floating quick-capture button — sits above the employee tab
// bar (46 + safe-area-bottom tall, see (emp)/_layout.tsx) on any screen that
// renders it. Purely the button; each screen owns its own QuickDocCapture
// sheet + visibility state, same as the existing top-bar capture icon on
// the Work tab did.
//
// Three earlier approaches on web (plain position: absolute, then
// position: fixed, then wrapping it in a transparent RN Modal) each failed
// a different way: absolute/fixed got trapped by an ancestor's collapsed
// height or containing block and ended up invisible; the Modal version
// showed the button but its own full-screen backdrop div (which
// react-native-web renders around a Modal's children regardless of
// pointerEvents settings inside it) froze the rest of the page by
// swallowing every touch. This version sidesteps all of that by using a
// real DOM portal straight to <body> on web — a single element with no
// wrapping backdrop, so there is nothing else present to intercept clicks
// anywhere else on the page. Native just renders the button in place
// (position: absolute has never been the problem there).
function FabButton({ onPress, testID, bottom, colors }: { onPress: () => void; testID?: string; bottom: number; colors: ThemeColors }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.fab, { bottom, backgroundColor: colors.brandPrimary }]}
      testID={testID}
      hitSlop={8}
    >
      <Ionicons name="camera" size={24} color={colors.onBrandPrimary} />
    </Pressable>
  );
}

export function FloatingCaptureButton({ onPress, testID }: { onPress: () => void; testID?: string }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottom = 46 + Math.max(insets.bottom, 20) + 16;
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = document.createElement('div');
    document.body.appendChild(el);
    setPortalEl(el);
    return () => { document.body.removeChild(el); };
  }, []);

  if (Platform.OS !== 'web') {
    return <FabButton onPress={onPress} testID={testID} bottom={bottom} colors={colors} />;
  }
  if (!portalEl) return null;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ReactDOM = require('react-dom');
  return ReactDOM.createPortal(
    <FabButton onPress={onPress} testID={testID} bottom={bottom} colors={colors} />,
    portalEl,
  );
}

const styles = StyleSheet.create({
  fab: {
    position: Platform.OS === 'web' ? ('fixed' as 'absolute') : 'absolute',
    right: 20, width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
});
