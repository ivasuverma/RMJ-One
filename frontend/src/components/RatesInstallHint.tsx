import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

const DISMISSED_KEY = 'rmj.rates_install_dismissed';

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    (window.navigator as any).standalone === true ||
    (!!window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
  );
}
function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /iphone|ipad|ipod/i.test(ua) || ((navigator as any).platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// Dismissible nudge, public rates page only — customers checking today's rate
// get offered a Home Screen shortcut so next time it's one tap, no browser/
// WhatsApp link needed. Unlike AppSetupBanner (employees, not dismissible,
// also walks through notifications), this is for a stranger with no account:
// no notification step, and dismissing it sticks (localStorage) so a regular
// visitor isn't nagged every single day.
export function RatesInstallHint() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [dismissed, setDismissed] = useState(true);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    if (isStandalone()) return;
    try { if (window.localStorage.getItem(DISMISSED_KEY) === '1') return; } catch { /* ignore */ }
    setDismissed(false);
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const handler = (e: any) => { e.preventDefault(); setDeferredPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try { window.localStorage.setItem(DISMISSED_KEY, '1'); } catch { /* ignore */ }
  }, []);

  const install = async () => {
    if (!deferredPrompt) return;
    try {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      dismiss();
    } catch { /* ignore */ }
  };

  if (dismissed) return null;

  const ios = isIOS();
  return (
    <View style={styles.card} testID="rates-install-hint">
      <View style={styles.headRow}>
        <Ionicons name="phone-portrait-outline" size={16} color={colors.brandSecondary} />
        <Text style={styles.title}>Add this page to your Home Screen</Text>
        <Pressable onPress={dismiss} hitSlop={10} testID="rates-install-dismiss">
          <Ionicons name="close" size={18} color={colors.mutedText} />
        </Pressable>
      </View>
      {ios ? (
        <Text style={styles.body}>
          Tap the Share button <Ionicons name="share-outline" size={12} color={colors.onSurfaceSecondary} /> in Safari, then{' '}
          <Text style={styles.bold}>Add to Home Screen</Text> — one tap next time to check today's rate.
        </Text>
      ) : deferredPrompt ? (
        <>
          <Text style={styles.body}>One tap next time to check today's rate — no need to reopen the link.</Text>
          <Pressable onPress={install} style={styles.installBtn} testID="rates-install-btn">
            <Ionicons name="download-outline" size={14} color={colors.onBrandPrimary} />
            <Text style={styles.installBtnText}>Add to Home Screen</Text>
          </Pressable>
        </>
      ) : (
        <Text style={styles.body}>
          Open the browser menu <Ionicons name="ellipsis-vertical" size={12} color={colors.onSurfaceSecondary} /> and tap{' '}
          <Text style={styles.bold}>Add to Home screen</Text> — one tap next time to check today's rate.
        </Text>
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, color: colors.onSurface, fontSize: 13.5, fontWeight: '800', fontFamily: fonts.display },
  body: { color: colors.onSurfaceSecondary, fontSize: 12, lineHeight: 17, marginTop: 6 },
  bold: { fontWeight: '800', color: colors.onSurface },
  installBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 10, marginTop: spacing.sm,
  },
  installBtnText: { color: colors.onBrandPrimary, fontSize: 13, fontWeight: '800' },
});
