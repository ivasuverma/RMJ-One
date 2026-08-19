import { createContext, ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { radius, spacing, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type ToastKind = 'success' | 'error';
type ToastItem = { id: number; kind: ToastKind; message: string };

type ToastApi = {
  success: (message: string) => void;
  error: (message: string) => void;
};

const ToastCtx = createContext<ToastApi>({ success: () => {}, error: () => {} });

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

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = nextId.current++;
    setItems((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    if (kind === 'success' && Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  }, [dismiss]);

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
      {items.map((t) => (
        <View key={t.id} style={[styles.toast, t.kind === 'error' ? styles.toastError : styles.toastSuccess]}>
          <Ionicons
            name={t.kind === 'error' ? 'alert-circle' : 'checkmark-circle'}
            size={16}
            color={t.kind === 'error' ? colors.onError : colors.onSuccess}
          />
          <Text
            style={[styles.text, { color: t.kind === 'error' ? colors.onError : colors.onSuccess }]}
            numberOfLines={2}
            onPress={() => onDismiss(t.id)}
          >
            {t.message}
          </Text>
        </View>
      ))}
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
  text: { flex: 1, fontSize: 13, fontWeight: '600' },
});
