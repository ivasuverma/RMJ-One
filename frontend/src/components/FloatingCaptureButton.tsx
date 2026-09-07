import { useEffect, useState } from 'react';
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
// pointerEvents="box-none" has to go on the <Modal> itself, not just the
// View inside it — RN Web's Modal renders its own full-screen backdrop div
// (position: fixed, inset: 0) around whatever you pass as children, and
// that div is what actually intercepts every touch/click on the page; a
// pointerEvents set only on a child inside it doesn't reach back out to
// that ancestor. Modal forwards unknown props straight to that div, so
// passing pointerEvents="box-none" there makes the backdrop transparent to
// touches everywhere except the Pressable, which stays interactive.
//
// Mounts only after the first client-side effect fires, rather than being
// visible from this component's very first render. This app builds as a
// static web export (app.json web.output: 'static') — every OTHER Modal
// here (Sheet.tsx and everything built on it) only ever flips visible in
// response to a later tap, i.e. always as a state change well after
// hydration; this is the only one meant to be showing from the moment the
// screen loads. react-native-web's Modal renders its very first pass at
// opacity 0 (before its own useEffect flips it visible next tick) — for a
// modal already settled into a later state that's imperceptible, but for
// one appearing during/right after hydration on a static build it's a
// plausible way to end up stuck invisible. Deferring the whole Modal one
// tick past mount makes this button behave like every other one instead
// of being the only Modal in the app shown from the first render.
export function FloatingCaptureButton({ onPress, testID }: { onPress: () => void; testID?: string }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent pointerEvents="box-none">
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
