import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { GlassSurface } from './GlassSurface';

export type DialogButton = { label: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void };
type DialogSpec = { title: string; message?: string; buttons: DialogButton[] };

// Module-level bridge so plain helpers (confirmAction, promptChoice) can open
// the dialog without a hook — DialogHost registers itself on mount.
let open: ((d: DialogSpec) => void) | null = null;

/** Returns false when no DialogHost is mounted, so callers can fall back. */
export function showDialog(d: DialogSpec): boolean {
  if (!open) return false;
  open(d);
  return true;
}

/** iOS-style alert: centred card, dimmed backdrop, side-by-side buttons for
 * two actions (stacked for more), cancel in regular weight, destructive in red. */
export function DialogHost() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);

  useEffect(() => {
    open = setDialog;
    return () => { open = null; };
  }, []);

  const press = (b?: DialogButton) => {
    if (b?.style === 'destructive' && Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }
    setDialog(null);
    b?.onPress?.();
  };
  const cancel = dialog?.buttons.find((b) => b.style === 'cancel');

  // Escape cancels, as the modal did on web.
  useEffect(() => {
    if (Platform.OS !== 'web' || !dialog || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && cancel) press(cancel); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog]); // eslint-disable-line react-hooks/exhaustive-deps
  const row = (dialog?.buttons.length ?? 0) <= 2;

  const content = (
    <Pressable style={styles.backdrop} onPress={() => cancel && press(cancel)} accessibilityLabel="Dismiss">
      <Pressable style={styles.cardWrap} accessibilityRole="alert" onPress={() => {}}>
       <GlassSurface material="thick" style={styles.card}>
        <View style={styles.body}>
          <Text style={styles.title}>{dialog?.title}</Text>
          {!!dialog?.message && <Text style={styles.message}>{dialog.message}</Text>}
        </View>
        <View style={[styles.buttons, row && styles.buttonsRow]}>
          {dialog?.buttons.map((b, i) => (
            <Pressable
              key={b.label}
              onPress={() => press(b)}
              accessibilityRole="button"
              accessibilityLabel={b.label}
              style={({ pressed }) => [
                styles.btn, row && styles.btnRow, i > 0 && (row ? styles.sepLeft : styles.sepTop),
                pressed && { backgroundColor: colors.surfaceTertiary },
              ]}
            >
              <Text style={[
                styles.btnText,
                b.style === 'destructive' && { color: colors.onError },
                b.style !== 'cancel' && { fontWeight: '600' },
              ]}>{b.label}</Text>
            </Pressable>
          ))}
        </View>
       </GlassSurface>
      </Pressable>
    </Pressable>
  );

  // Web: every Modal is its own layer on the page, stacked in the order they
  // were first created — this host is created at app start, so a dialog
  // opened from inside another modal (e.g. deleting from the document viewer)
  // appeared BEHIND it. So on web it's drawn straight on the page, above
  // every modal.
  if (Platform.OS === 'web') {
    if (!dialog || typeof document === 'undefined') return null;
    return createPortal(<View style={styles.webLayer}>{content}</View>, document.body);
  }
  return (
    <Modal visible={!!dialog} transparent animationType="fade" onRequestClose={() => press(cancel)}>
      {content}
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  webLayer: { position: 'fixed' as any, top: 0, left: 0, right: 0, bottom: 0, zIndex: 100000 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  cardWrap: { width: 290, maxWidth: '100%' },
  card: { borderRadius: 16, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  body: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 18, alignItems: 'center', gap: 6 },
  title: { color: colors.onSurface, fontSize: 17, fontWeight: '600', textAlign: 'center', fontFamily: fonts.display },
  message: { color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  buttons: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  buttonsRow: { flexDirection: 'row' },
  btn: { minHeight: 46, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  btnRow: { flex: 1 },
  sepLeft: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
  sepTop: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  btnText: { color: colors.brandPrimary, fontSize: 17 },
});
