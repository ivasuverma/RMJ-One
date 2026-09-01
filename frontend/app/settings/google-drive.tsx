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

type Status = { connected: boolean; email?: string | null; env_ready: boolean; connected_at?: string | null };

export default function GoogleDriveScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setStatus(await api.get<Status>('/google-drive/status')); } catch { /* ignore */ }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const connect = async () => {
    setBusy(true);
    try {
      const { url } = await api.get<{ url: string }>('/google-drive/auth-url');
      if (Platform.OS === 'web') window.open(url, '_blank');
      toast.success('Complete sign-in in the new tab, then tap Refresh');
    } catch (e: any) { toast.error(e?.detail || 'Could not start Google sign-in'); }
    finally { setBusy(false); }
  };

  const disconnect = () => {
    confirmAction('Disconnect Google Drive?', 'New captures will stay on this device until you reconnect. Files already in Drive are untouched.', 'Disconnect', async () => {
      try { await api.post('/google-drive/disconnect', {}); await load(); toast.success('Disconnected'); }
      catch (e: any) { toast.error(e?.detail || 'Could not disconnect'); }
    });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="google-drive-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} hitSlop={12} testID="back-btn"><Ionicons name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.title}>Google Drive</Text>
        <Pressable onPress={load} style={styles.iconBtn} hitSlop={12} testID="drive-refresh"><Ionicons name="refresh" size={19} color={colors.onSurface} /></Pressable>
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
                    ? `${status.email || 'Google account'}${status.connected_at ? ` · since ${istDisplayDateTime(status.connected_at)}` : ''}`
                    : 'Captured documents stay on this device until Drive is connected.'}
                </Text>
              </View>
            </View>

            {!status.env_ready && (
              <View style={styles.warn}>
                <Ionicons name="warning-outline" size={16} color={colors.onWarning} />
                <Text style={styles.warnText}>The server isn&apos;t set up for Google yet — an admin must add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI to the backend before you can connect.</Text>
              </View>
            )}

            {status.connected ? (
              <Pressable onPress={disconnect} style={styles.disconnectBtn} testID="drive-disconnect">
                <Ionicons name="log-out-outline" size={18} color={colors.onError} />
                <Text style={styles.disconnectText}>Disconnect</Text>
              </Pressable>
            ) : (
              <Pressable onPress={connect} disabled={busy || !status.env_ready} style={[styles.connectBtn, (busy || !status.env_ready) && { opacity: 0.5 }]} testID="drive-connect">
                {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><Ionicons name="logo-google" size={18} color={colors.onBrandPrimary} /><Text style={styles.connectText}>Connect Google Drive</Text></>}
              </Pressable>
            )}

            <Text style={styles.note}>Documents are uploaded into a “RMJ One Documents” folder in the shop&apos;s Drive, one sub-folder per category. RMJ One can only see files it creates.</Text>
          </>
        )}

        <Pressable onPress={() => router.push('/settings/backup' as any)} style={styles.backupRow} testID="drive-backup-link">
          <Ionicons name="save-outline" size={20} color={colors.brandSecondary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.backupTitle}>Daily database backup</Text>
            <Text style={styles.backupSub}>Automatic backup of all data to Drive</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '700', fontFamily: fonts.display },
  backupRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xl, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  backupTitle: { color: colors.onSurface, fontSize: 15, fontWeight: '700' },
  backupSub: { color: colors.mutedText, fontSize: 12, marginTop: 2 },
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
