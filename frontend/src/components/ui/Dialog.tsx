import { useEffect, useMemo, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

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
  const row = (dialog?.buttons.length ?? 0) <= 2;

  return (
    <Modal visible={!!dialog} transparent animationType="fade" onRequestClose={() => press(cancel)}>
      <Pressable style={styles.backdrop} onPress={() => cancel && press(cancel)} accessibilityLabel="Dismiss">
        <Pressable style={styles.card} accessibilityRole="alert" onPress={() => {}}>
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
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: 290, maxWidth: '100%', backgroundColor: colors.surfaceSecondary, borderRadius: 16, overflow: 'hidden' },
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
