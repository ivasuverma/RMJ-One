import { ReactNode, useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { istDisplayDateTime } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Dot = 'ok' | 'warn' | 'bad' | 'off';

type Health = {
  generated_at: string;
  system: { uptime_seconds: number; platform: string };
  services: { name: string; label: string; status: string }[];
  mongodb: { ok: boolean; latency_ms: number | null; data_size_bytes: number | null; storage_size_bytes: number | null; error: string | null };
  whatsapp: { configured: boolean; connected: boolean; phone: string | null; last_disconnected_alert_at: string | null };
  printer: { configured: boolean; ip: string | null; port: number | null; reachable: boolean | null; last_failure_at: string | null };
  google_drive: { connected: boolean; email: string | null; env_ready: boolean; connected_at: string | null; auth_error?: string | null; last_disconnected_alert_at: string | null; last_upload_failure_at: string | null };
  sync_queue: { photos: Record<string, number>; documents: Record<string, number> };
  biometric: { devices: { id: string; serial: string; label: string; status: string; last_seen: string | null }[]; offline_count: number; offline_threshold_hours: number; last_offline_alert_at: string | null };
  push_notifications: { enabled: boolean };
};

const fmtWhen = (iso?: string | null) => (iso ? istDisplayDateTime(iso) : '—');
const fmtBytes = (n?: number | null) => {
  if (n == null) return '—';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};
const fmtUptime = (sec: number) => {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};
const SERVICE_LABEL: Record<string, string> = {
  running: 'Running', stopped: 'Stopped', paused: 'Paused/crashing', pending: 'Starting…', not_installed: 'Not installed', unknown: 'Unknown',
};

export default function SystemHealthScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (opts?: { showChecking?: boolean }) => {
    if (opts?.showChecking) setChecking(true);
    try {
      const h = await api.get<Health>('/system/health');
      setData(h);
      setError(null);
    } catch (e: any) {
      setError(e?.detail || 'Could not load system health.');
    } finally {
      setLoading(false); setChecking(false); setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="system-health-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>System Health</Text>
        <Pressable
          onPress={() => load({ showChecking: true })}
          disabled={checking}
          style={[styles.checkNowBtn, checking && { opacity: 0.6 }]}
          testID="check-now-btn"
        >
          {checking ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <Ionicons name="refresh" size={16} color={colors.onBrandPrimary} />}
          <Text style={styles.checkNowText}>Check Now</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.brandPrimary} size="large" /></View>
      ) : error && !data ? (
        <View style={styles.centered}>
          <Ionicons name="warning-outline" size={40} color={colors.onError} />
          <Text style={styles.emptyText}>{error}</Text>
        </View>
      ) : !data ? null : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          <Text style={styles.lastChecked}>Last checked {fmtWhen(data.generated_at)}</Text>

          <SectionTitle text="System" />
          <Card>
            <Row label="Backend uptime" value={fmtUptime(data.system.uptime_seconds)} dot="ok" />
            <Row label="Platform" value={data.system.platform} dot="off" last />
          </Card>

          {data.services.length > 0 && (
            <>
              <SectionTitle text="Services" />
              <Card>
                {data.services.map((s, i) => (
                  <Row
                    key={s.name}
                    label={s.label}
                    value={SERVICE_LABEL[s.status] || s.status}
                    dot={s.status === 'running' ? 'ok' : s.status === 'not_installed' ? 'off' : 'bad'}
                    last={i === data.services.length - 1}
                  />
                ))}
              </Card>
            </>
          )}

          <SectionTitle text="MongoDB" />
          <Card>
            <Row label="Connection" value={data.mongodb.ok ? `OK · ${data.mongodb.latency_ms}ms` : (data.mongodb.error || 'Unreachable')} dot={data.mongodb.ok ? 'ok' : 'bad'} />
            <Row label="Data size" value={fmtBytes(data.mongodb.data_size_bytes)} dot="off" />
            <Row label="Storage size" value={fmtBytes(data.mongodb.storage_size_bytes)} dot="off" last />
          </Card>

          <SectionTitle text="WhatsApp" />
          <Card>
            {!data.whatsapp.configured ? (
              <Row label="Gateway" value="Not configured" dot="off" last />
            ) : (
              <>
                <Row label="Gateway" value={data.whatsapp.connected ? `Connected${data.whatsapp.phone ? ` · ${data.whatsapp.phone}` : ''}` : 'Disconnected'} dot={data.whatsapp.connected ? 'ok' : 'bad'} />
                <Row label="Last disconnect alert" value={fmtWhen(data.whatsapp.last_disconnected_alert_at)} dot="off" last />
              </>
            )}
          </Card>

          <SectionTitle text="Thermal Printer" />
          <Card>
            {!data.printer.configured ? (
              <Row label="Printer" value="Not configured" dot="off" last onPress={() => router.push('/settings/printer' as any)} />
            ) : (
              <>
                <Row label={`${data.printer.ip}:${data.printer.port}`} value={data.printer.reachable ? 'Reachable' : 'Unreachable'} dot={data.printer.reachable ? 'ok' : 'bad'} onPress={() => router.push('/settings/printer' as any)} />
                <Row label="Last print failure" value={fmtWhen(data.printer.last_failure_at)} dot="off" last />
              </>
            )}
          </Card>

          <SectionTitle text="Google Drive" />
          <Card>
            <Row
              label="Connection"
              value={!data.google_drive.env_ready ? 'Not configured on server' : data.google_drive.auth_error ? 'Sign-in expired — reconnect' : data.google_drive.connected ? `Connected${data.google_drive.email ? ` · ${data.google_drive.email}` : ''}` : 'Not connected'}
              dot={!data.google_drive.env_ready ? 'off' : data.google_drive.auth_error ? 'bad' : data.google_drive.connected ? 'ok' : 'bad'}
              onPress={() => router.push('/settings/google-drive' as any)}
            />
            <Row label="Photos queued/failed" value={`${data.sync_queue.photos.queued + data.sync_queue.photos.uploading} queued · ${data.sync_queue.photos.failed} failed`} dot={data.sync_queue.photos.failed > 0 ? 'warn' : 'ok'} />
            <Row label="Documents queued/failed" value={`${data.sync_queue.documents.queued + data.sync_queue.documents.uploading} queued · ${data.sync_queue.documents.failed} failed`} dot={data.sync_queue.documents.failed > 0 ? 'warn' : 'ok'} last />
          </Card>

          <SectionTitle text="Biometric Devices" />
          <Card>
            {data.biometric.devices.length === 0 ? (
              <Row label="Devices" value="None registered" dot="off" last onPress={() => router.push('/settings/biometric' as any)} />
            ) : (
              data.biometric.devices.map((d, i) => (
                <Row
                  key={d.id}
                  label={d.label || d.serial}
                  value={d.status === 'offline' ? `Offline · last seen ${fmtWhen(d.last_seen)}` : 'Online'}
                  dot={d.status === 'offline' ? 'bad' : 'ok'}
                  last={i === data.biometric.devices.length - 1}
                  onPress={() => router.push('/settings/biometric' as any)}
                />
              ))
            )}
          </Card>

          <SectionTitle text="Push Notifications" />
          <Card>
            <Row label="Browser push" value={data.push_notifications.enabled ? 'Configured' : 'Not configured'} dot={data.push_notifications.enabled ? 'ok' : 'off'} last />
          </Card>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function SectionTitle({ text }: { text: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <Text style={styles.section}>{text}</Text>;
}

function Card({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <View style={styles.card}>{children}</View>;
}

function Row({ label, value, dot, last, onPress }: { label: string; value: string; dot: Dot; last?: boolean; onPress?: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const dotColor = dot === 'ok' ? colors.onSuccess : dot === 'warn' ? colors.onWarning : dot === 'bad' ? colors.onError : colors.mutedText;
  const content = (
    <View style={[styles.row, !last && styles.rowDivider]}>
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <Text style={styles.rowLabel} numberOfLines={1}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
      {onPress && <Ionicons name="chevron-forward" size={16} color={colors.mutedText} style={{ marginLeft: 4 }} />}
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{content}</Pressable> : content;
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '600', fontFamily: fonts.display },
  checkNowBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.brandPrimary,
    borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 8,
  },
  checkNowText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 12 },
  lastChecked: { color: colors.mutedText, fontSize: 12, marginBottom: spacing.lg, textAlign: 'center' },
  section: {
    color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase',
    marginBottom: spacing.sm, marginTop: spacing.lg,
  },
  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowLabel: { color: colors.onSurface, fontSize: 13, flex: 1 },
  rowValue: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: '600', maxWidth: '55%', textAlign: 'right' },
  emptyText: { color: colors.onSurfaceTertiary, textAlign: 'center' },
});
