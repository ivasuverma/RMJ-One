import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { confirmAction } from '@/src/utils/confirm';
import { istDisplayDateTime } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';

type Status = { connected: boolean; username?: string | null; env_ready: boolean; connected_at?: string | null; auth_error?: string | null };

// Mirrors settings/google-drive.tsx's connect/disconnect pattern — same
// 3-legged-OAuth-in-a-new-tab flow, just for Instagram (see
// backend/instagram_service.py). Feeds the "From Instagram" rail on the
// public website (website/index.html), not anything inside the app itself.
export default function InstagramScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setStatus(await api.get<Status>('/instagram/status')); } catch { /* ignore */ }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const connect = async () => {
    setBusy(true);
    try {
      const { url } = await api.get<{ url: string }>('/instagram/auth-url');
      if (Platform.OS === 'web') window.open(url, '_blank');
      toast.success('Complete sign-in in the new tab, then tap Refresh');
    } catch (e: any) { toast.error(e?.detail || 'Could not start Instagram sign-in'); }
    finally { setBusy(false); }
  };

  const disconnect = () => {
    confirmAction('Disconnect Instagram?', 'The feed will disappear from the website until you reconnect.', 'Disconnect', async () => {
      try { await api.post('/instagram/disconnect', {}); await load(); toast.success('Disconnected'); }
      catch (e: any) { toast.error(e?.detail || 'Could not disconnect'); }
    });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="instagram-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} hitSlop={12} testID="back-btn"><Ionicons name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.title}>Instagram</Text>
        <Pressable onPress={load} style={styles.iconBtn} hitSlop={12} testID="instagram-refresh"><Ionicons name="refresh" size={19} color={colors.onSurface} /></Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        {!status ? (
          <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 40 }} />
        ) : (
          <>
            <View style={styles.card}>
              <View style={[styles.statusDot, { backgroundColor: status.connected ? colors.onSuccess : colors.mutedText }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.statusTitle}>{status.connected ? 'Connected' : 'Not connected'}</Text>
                <Text style={styles.statusSub}>
                  {status.connected
                    ? `@${status.username || 'instagram account'}${status.connected_at ? ` · since ${istDisplayDateTime(status.connected_at)}` : ''}`
                    : 'The website’s "From Instagram" section stays hidden until this is connected.'}
                </Text>
              </View>
            </View>

            {!!status.auth_error && (
              <View style={styles.warn}>
                <Ionicons name="warning-outline" size={16} color={colors.onWarning} />
                <Text style={styles.warnText}>{status.auth_error}</Text>
              </View>
            )}

            {!status.env_ready && (
              <View style={styles.warn}>
                <Ionicons name="warning-outline" size={16} color={colors.onWarning} />
                <Text style={styles.warnText}>The server isn&apos;t set up for Instagram yet — an admin must add META_APP_ID, META_APP_SECRET and META_REDIRECT_URI to the backend before you can connect.</Text>
              </View>
            )}

            {status.connected ? (
              <Pressable onPress={disconnect} style={styles.disconnectBtn} testID="instagram-disconnect">
                <Ionicons name="log-out-outline" size={18} color={colors.onError} />
                <Text style={styles.disconnectText}>Disconnect</Text>
              </Pressable>
            ) : (
              <Pressable onPress={connect} disabled={busy || !status.env_ready} style={[styles.connectBtn, (busy || !status.env_ready) && { opacity: 0.5 }]} testID="instagram-connect">
                {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><Ionicons name="logo-instagram" size={18} color={colors.onBrandPrimary} /><Text style={styles.connectText}>Connect Instagram</Text></>}
              </Pressable>
            )}

            <Text style={styles.note}>Needs your Instagram to be a Business or Creator account linked to a Facebook Page — that&apos;s how Instagram Graph API works, not a choice this app makes. Shows your latest posts in a scrolling rail on rmj.co.in, refreshed automatically every 30 minutes.</Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '700', fontFamily: fonts.display },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  statusTitle: { color: colors.onSurface, fontSize: 16, fontWeight: '700' },
  statusSub: { color: colors.mutedText, fontSize: 12.5, marginTop: 3 },
  warn: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: colors.warning, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  warnText: { flex: 1, color: colors.onWarning, fontSize: 12.5, lineHeight: 18 },
  connectBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, marginTop: spacing.lg },
  connectText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: '700' },
  disconnectBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.error, paddingVertical: 13, marginTop: spacing.lg },
  disconnectText: { color: colors.onError, fontSize: 15, fontWeight: '700' },
  note: { color: colors.mutedText, fontSize: 12, marginTop: spacing.lg, lineHeight: 18 },
});
