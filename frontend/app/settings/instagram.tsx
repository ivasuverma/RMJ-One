import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api, getToken } from '@/src/api/client';
import { confirmAction } from '@/src/utils/confirm';
import { istDisplayDateTime } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';
import { GlassButton } from '@/src/components/ui/GlassButton';

type AuditJob = { status?: 'running' | 'ready' | 'failed'; started_at?: string | null; finished_at?: string | null; post_count?: number | null; error?: string | null };
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
  const [exporting, setExporting] = useState(false);
  const [job, setJob] = useState<AuditJob>({});

  const loadJob = useCallback(async () => {
    try { setJob(await api.get<AuditJob>('/instagram/audit-export/status')); } catch { /* ignore */ }
  }, []);
  const load = useCallback(async () => {
    try { setStatus(await api.get<Status>('/instagram/status')); } catch { /* ignore */ }
    loadJob();
  }, [loadJob]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // While a file is being prepared, check back every 15s so the screen flips
  // to "ready" on its own if the owner keeps it open; the notification covers
  // the case where they don't.
  useEffect(() => {
    if (job.status !== 'running') return;
    const t = setInterval(loadJob, 15000);
    return () => clearInterval(t);
  }, [job.status, loadJob]);

  const connect = async () => {
    setBusy(true);
    try {
      const { url } = await api.get<{ url: string }>('/instagram/auth-url');
      if (Platform.OS === 'web') window.open(url, '_blank');
      toast.success('Complete sign-in in the new tab, then tap Refresh');
    } catch (e: any) { toast.error(e?.detail || 'Could not start Instagram sign-in'); }
    finally { setBusy(false); }
  };

  // Owner's audit file: recent posts with likes, comments, reach, saves,
  // shares, views, captions and hashtags. Prepared in the background
  // (backend instagram_service.start_audit_job), which notifies the owner
  // when it's ready; Download then fetches the finished file with the bearer
  // token and saves it — same fetch-then-blob approach as reports/generate.tsx.
  const prepareAudit = async () => {
    setExporting(true);
    try {
      setJob(await api.post<AuditJob>('/instagram/audit-export/start', {}));
      toast.success("Preparing your audit file. We'll notify you when it's ready.");
    } catch (e: any) { toast.error(e?.detail || 'Could not start the export'); }
    finally { setExporting(false); }
  };

  const downloadAudit = async () => {
    setExporting(true);
    try {
      const base = process.env.EXPO_PUBLIC_BACKEND_URL || '';
      const token = (await getToken()) || '';
      const res = await fetch(`${base}/api/instagram/audit-export/file`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        let detail = `Download failed (${res.status})`;
        try { detail = (await res.json())?.detail || detail; } catch { /* ignore */ }
        throw new Error(detail);
      }
      if (Platform.OS === 'web') {
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `instagram-audit-${(job.finished_at || new Date().toISOString()).slice(0, 10)}.json`;
        a.click();
        toast.success('Audit file downloaded');
      }
    } catch (e: any) { toast.error(e?.message || 'Could not download'); }
    finally { setExporting(false); }
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
        <GlassButton onPress={() => router.back()} style={styles.iconBtn} hitSlop={12} testID="back-btn" accessibilityRole="button" accessibilityLabel="Back"><Ionicons name="chevron-back" size={22} color={colors.onSurface} /></GlassButton>
        <Text style={styles.title}>Instagram</Text>
        <GlassButton onPress={load} style={styles.iconBtn} hitSlop={12} testID="instagram-refresh" accessibilityRole="button" accessibilityLabel="Refresh"><Ionicons name="refresh" size={19} color={colors.onSurface} /></GlassButton>
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

            {status.connected && (
              <>
                {job.status === 'running' ? (
                  <View style={styles.jobCard} testID="instagram-audit-running">
                    <ActivityIndicator color={colors.brandPrimary} />
                    <Text style={styles.jobText}>Preparing your audit file{job.started_at ? ` (started ${istDisplayDateTime(job.started_at)})` : ''}. You&apos;ll get a notification when it&apos;s ready, so you can close the app.</Text>
                  </View>
                ) : (
                  <Pressable onPress={prepareAudit} disabled={exporting} style={[job.status === 'ready' ? styles.reconnectBtn : styles.connectBtn, exporting && { opacity: 0.5 }]} testID="instagram-audit-prepare">
                    <Ionicons name="hourglass-outline" size={18} color={job.status === 'ready' ? colors.onSurface : colors.onBrandPrimary} />
                    <Text style={job.status === 'ready' ? styles.reconnectText : styles.connectText}>{job.status === 'ready' ? 'Prepare a fresh audit file' : 'Prepare audit file'}</Text>
                  </Pressable>
                )}
                {job.status === 'ready' && (
                  <Pressable onPress={downloadAudit} disabled={exporting} style={[styles.connectBtn, exporting && { opacity: 0.5 }]} testID="instagram-audit-download">
                    {exporting ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><Ionicons name="download-outline" size={18} color={colors.onBrandPrimary} /><Text style={styles.connectText}>Download audit file{job.post_count != null ? ` (${job.post_count} posts${job.finished_at ? `, ${istDisplayDateTime(job.finished_at)}` : ''})` : ''}</Text></>}
                  </Pressable>
                )}
                {job.status === 'failed' && !!job.error && (
                  <View style={styles.warn}>
                    <Ionicons name="warning-outline" size={16} color={colors.onWarning} />
                    <Text style={styles.warnText}>The last audit file failed: {job.error}</Text>
                  </View>
                )}
                <Text style={styles.note}>Your recent posts with likes, comments, reach, saves, shares, views, captions and hashtags, as one file. It&apos;s prepared in the background and can take a few minutes; you&apos;ll be notified when it&apos;s ready. If reach and views come out empty, tap Reconnect once to allow insights.</Text>
                <Pressable onPress={connect} disabled={busy || !status.env_ready} style={[styles.reconnectBtn, (busy || !status.env_ready) && { opacity: 0.5 }]} testID="instagram-reconnect">
                  <Ionicons name="refresh-outline" size={18} color={colors.onSurface} />
                  <Text style={styles.reconnectText}>Reconnect</Text>
                </Pressable>
              </>
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
  reconnectBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: 13, marginTop: spacing.lg },
  reconnectText: { color: colors.onSurface, fontSize: 15, fontWeight: '700' },
  jobCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: spacing.lg },
  jobText: { flex: 1, color: colors.onSurface, fontSize: 13, lineHeight: 19 },
  disconnectBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.error, paddingVertical: 13, marginTop: spacing.lg },
  disconnectText: { color: colors.onError, fontSize: 15, fontWeight: '700' },
  note: { color: colors.mutedText, fontSize: 12, marginTop: spacing.lg, lineHeight: 18 },
});
