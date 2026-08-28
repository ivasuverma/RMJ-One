import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { getPushPermission, isSubscribed, subscribeToPush } from '@/src/utils/push';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

// A prominent, self-removing onboarding banner shown to employees until they:
//   1. install the app to their Home Screen, and
//   2. turn on notifications.
// It walks them through whichever step is still pending with clear, device-
// specific instructions, and disappears entirely once both are done. It is
// deliberately NOT dismissible — the whole point is to get everyone set up.

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

type Mode = 'install' | 'notify' | 'done';

export function AppSetupBanner() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [mode, setMode] = useState<Mode>('done');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  const recompute = useCallback(async () => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') { setMode('done'); return; }
    if (!isStandalone()) { setMode('install'); return; }
    const granted = getPushPermission() === 'granted';
    const subbed = granted && (await isSubscribed());
    setMode(granted && subbed ? 'done' : 'notify');
  }, []);

  useFocusEffect(useCallback(() => { recompute(); }, [recompute]));

  // Android/Chrome: capture the native install prompt so we can offer a
  // one-tap "Install" button instead of only written steps.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const handler = (e: any) => { e.preventDefault(); setDeferredPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    const onInstalled = () => recompute();
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [recompute]);

  const install = async () => {
    if (!deferredPrompt) return;
    try {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      setTimeout(recompute, 500);
    } catch { /* ignore */ }
  };

  const enableNotifications = async () => {
    setBusy(true);
    setErr('');
    const res = await subscribeToPush();
    if (!res.ok && res.reason) setErr(res.reason);
    await recompute();
    setBusy(false);
  };

  if (mode === 'done') return null;

  if (mode === 'install') {
    const ios = isIOS();
    return (
      <View style={styles.card} testID="app-setup-banner">
        <View style={styles.headRow}>
          <View style={styles.iconRing}><Ionicons name="phone-portrait-outline" size={18} color={colors.onBrandPrimary} /></View>
          <Text style={styles.title}>Install RMJ One on your phone</Text>
        </View>
        <Text style={styles.sub}>Add it to your Home Screen so it opens like a real app and can send you notifications.</Text>

        {ios ? (
          <View style={styles.steps}>
            <Step n={1} styles={styles}>Tap the <Ionicons name="share-outline" size={13} color={colors.onSurface} /> Share button in the Safari toolbar (bottom of the screen).</Step>
            <Step n={2} styles={styles}>Scroll down and tap <Text style={styles.bold}>Add to Home Screen</Text>.</Step>
            <Step n={3} styles={styles}>Tap <Text style={styles.bold}>Add</Text>, then open <Text style={styles.bold}>RMJ One</Text> from the new Home Screen icon.</Step>
          </View>
        ) : deferredPrompt ? (
          <Pressable onPress={install} style={styles.primaryBtn} testID="app-setup-install-btn">
            <Ionicons name="download-outline" size={16} color={colors.onBrandPrimary} />
            <Text style={styles.primaryBtnText}>Install app</Text>
          </Pressable>
        ) : (
          <View style={styles.steps}>
            <Step n={1} styles={styles}>Open the browser menu <Ionicons name="ellipsis-vertical" size={13} color={colors.onSurface} /> (top-right).</Step>
            <Step n={2} styles={styles}>Tap <Text style={styles.bold}>Install app</Text> (or <Text style={styles.bold}>Add to Home screen</Text>).</Step>
            <Step n={3} styles={styles}>Open <Text style={styles.bold}>RMJ One</Text> from your Home Screen.</Step>
          </View>
        )}
      </View>
    );
  }

  // mode === 'notify'
  return (
    <View style={styles.card} testID="app-setup-banner">
      <View style={styles.headRow}>
        <View style={styles.iconRing}><Ionicons name="notifications-outline" size={18} color={colors.onBrandPrimary} /></View>
        <Text style={styles.title}>Turn on notifications</Text>
      </View>
      <Text style={styles.sub}>Get alerts for tasks, approvals and reminders. Tap the button, then choose <Text style={styles.bold}>Allow</Text> when your phone asks.</Text>
      {!!err && <Text style={styles.err}>{err}</Text>}
      <Pressable onPress={enableNotifications} disabled={busy} style={[styles.primaryBtn, busy && { opacity: 0.6 }]} testID="app-setup-notify-btn">
        {busy ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <Ionicons name="notifications" size={16} color={colors.onBrandPrimary} />}
        <Text style={styles.primaryBtnText}>{busy ? 'Enabling…' : 'Turn on notifications'}</Text>
      </Pressable>
    </View>
  );
}

function Step({ n, children, styles }: { n: number; children: React.ReactNode; styles: any }) {
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepNum}><Text style={styles.stepNumText}>{n}</Text></View>
      <Text style={styles.stepText}>{children}</Text>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  card: {
    backgroundColor: colors.brandTertiary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.brandPrimary,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconRing: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: colors.onSurface, fontSize: 15, fontWeight: '800', fontFamily: fonts.display },
  sub: { color: colors.onSurfaceSecondary, fontSize: 12.5, lineHeight: 18, marginTop: spacing.sm },
  steps: { marginTop: spacing.md, gap: spacing.sm },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  stepNum: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  stepNumText: { color: colors.onBrandPrimary, fontSize: 11, fontWeight: '800' },
  stepText: { flex: 1, color: colors.onSurface, fontSize: 12.5, lineHeight: 18 },
  bold: { fontWeight: '800', color: colors.onSurface },
  err: { color: colors.onError, fontSize: 12, marginTop: spacing.sm },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 12, marginTop: spacing.md,
  },
  primaryBtnText: { color: colors.onBrandPrimary, fontSize: 14, fontWeight: '800' },
});
