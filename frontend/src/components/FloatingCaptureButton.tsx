import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/src/theme/ThemeContext';

// Bottom-right floating quick-capture button — sits above the employee tab
// bar (46 + safe-area-bottom tall, see (emp)/_layout.tsx) on any screen that
// renders it. Purely the button; each screen owns its own QuickDocCapture
// sheet + visibility state, same as the existing top-bar capture icon on
// the Work tab did.
//
// Rendered inside a transparent Modal rather than a plain absolutely (or
// even fixed-) positioned View: on web, a `flex: 1` SafeAreaView/ScrollView
// ancestor can collapse to content height instead of filling the viewport,
// and any ancestor with a transform/filter establishes a new containing
// block that `position: fixed` would then be trapped inside instead of the
// real viewport — either way the button ends up positioned somewhere
// invisible. Modal is the pattern every other overlay in this app already
// uses (see Sheet.tsx) precisely because it portals above all of that
// instead of being laid out inside the screen's own view tree.
// pointerEvents="box-none" on the wrapping layer lets touches pass through
// to the screen underneath everywhere except the button itself.
export function FloatingCaptureButton({ onPress, testID }: { onPress: () => void; testID?: string }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <Pressable
          onPress={onPress}
          style={[
            styles.fab,
            { bottom: 46 + Math.max(insets.bottom, 20) + 16, backgroundColor: colors.brandPrimary },
          ]}
          testID={testID}
          hitSlop={8}
        >
          <Ionicons name="camera" size={24} color={colors.onBrandPrimary} />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute', right: 20, width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
});
