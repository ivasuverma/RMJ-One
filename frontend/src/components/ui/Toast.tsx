import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { radius, spacing, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

export type ToastKind = 'success' | 'error' | 'info';
type ToastItem = { id: number; kind: ToastKind; message: string; title?: string };

type ToastApi = {
  success: (message: string) => void;
  error: (message: string) => void;
};

const ToastCtx = createContext<ToastApi>({ success: () => {}, error: () => {} });

// Module-level bridge so plain helpers (src/utils/notify) can raise a toast
// without a hook — ToastProvider registers itself on mount.
let externalPush: ((kind: ToastKind, message: string, title?: string) => void) | null = null;

/** Returns false when no ToastProvider is mounted, so callers can fall back. */
export function showToast(kind: ToastKind, message: string, title?: string): boolean {
  if (!externalPush) return false;
  externalPush(kind, message, title);
  return true;
}

/** `toast.success('Bill created')` / `toast.error('Failed to save')` from
 * anywhere in the tree. Mounted once at the root (app/_layout.tsx) so it
 * renders above everything, including the tab bar. Auto-dismisses after
 * 2.5s; a success toast also fires a light haptic tap (no-op on web —
 * expo-haptics already no-ops there, but we skip the call outright so
 * nothing is even attempted). */
export function useToast() {
  return useContext(ToastCtx);
}

const AUTO_DISMISS_MS = 2500;
// Longer text and errors stay up long enough to actually read.
const dismissAfter = (kind: ToastKind, text: string) =>
  Math.min(8000, Math.max(kind === 'error' ? 4000 : AUTO_DISMISS_MS, 1500 + text.length * 45));

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((kind: ToastKind, message: string, title?: string) => {
    const id = nextId.current++;
    setItems((prev) => [...prev.slice(-2), { id, kind, message, title }]);
    setTimeout(() => dismiss(id), dismissAfter(kind, `${title || ''} ${message}`));
    if (Platform.OS !== 'web') {
      if (kind === 'success') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      else if (kind === 'error') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
  }, [dismiss]);

  useEffect(() => {
    externalPush = push;
    return () => { externalPush = null; };
  }, [push]);

  const api = useMemo<ToastApi>(() => ({
    success: (message: string) => push('success', message),
    error: (message: string) => push('error', message),
  }), [push]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <ToastStack items={items} onDismiss={dismiss} />
    </ToastCtx.Provider>
  );
}

function ToastStack({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: number) => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (items.length === 0) return null;
  return (
    // 76px clears the tallest tab bar in the app on top of the safe-area
    // inset; toasts stack upward from there so newer ones don't cover older.
    <View pointerEvents="box-none" style={[styles.stack, { bottom: insets.bottom + 76 }]}>
      {items.map((t) => {
        const fg = t.kind === 'error' ? colors.onError : t.kind === 'success' ? colors.onSuccess : colors.onSurface;
        return (
          <View
            key={t.id}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={[styles.toast, t.kind === 'error' ? styles.toastError : t.kind === 'success' ? styles.toastSuccess : styles.toastInfo]}
          >
            <Ionicons
              name={t.kind === 'error' ? 'alert-circle' : t.kind === 'success' ? 'checkmark-circle' : 'information-circle'}
              size={18}
              color={fg}
            />
            <Text style={[styles.text, { color: fg }]} numberOfLines={4} onPress={() => onDismiss(t.id)}>
              {t.title ? <Text style={styles.title}>{t.title}  </Text> : null}
              {t.message}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  stack: {
    position: 'absolute', left: spacing.lg, right: spacing.lg,
    gap: spacing.sm, alignItems: 'center',
  },
  toast: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'stretch',
    borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: 12,
  },
  toastSuccess: { backgroundColor: colors.success, borderColor: colors.success },
  toastError: { backgroundColor: colors.error, borderColor: colors.error },
  toastInfo: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
  text: { flex: 1, fontSize: 14, fontWeight: '500', lineHeight: 19 },
  title: { fontWeight: '700' },
});
