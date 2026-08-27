import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { istDisplayDateTime } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';

type BackupFile = { name: string; size: number; created: string };
type Status = {
  auto_enabled: boolean; drive_connected: boolean; last_at?: string | null; last_file?: string | null;
  last_size?: number | null; last_total?: number | null; last_error?: string | null; retention: number; recent: BackupFile[];
};

const fmtSize = (b?: number | null) => {
  if (!b) return '';
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};

export default function BackupScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setStatus(await api.get<Status>('/backup/status')); } catch { /* owner-only */ }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const runNow = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; file?: string; documents?: number; error?: string }>('/backup/run', {});
      if (res.ok) toast.success(`Backed up ${res.documents ?? ''} records to Drive`);
      else toast.error(res.error || 'Backup failed');
      await load();
    } catch (e: any) { toast.error(e?.detail || 'Backup failed'); }
    finally { setBusy(false); }
  };

  const toggleAuto = async (v: boolean) => {
    setStatus((s) => (s ? { ...s, auto_enabled: v } : s));
    try { await api.put('/backup/settings', { auto_enabled: v }); } catch { load(); }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="backup-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} hitSlop={12} testID="back-btn"><Ionicons name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.title}>Backup</Text>
        <Pressable onPress={load} style={styles.iconBtn} hitSlop={12}><Ionicons name="refresh" size={19} color={colors.onSurface} /></Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        {!status ? (
          <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 40 }} />
        ) : (
          <>
            <Text style={styles.intro}>A full copy of the whole database is uploaded to Google Drive (folder “RMJ One Backups”). Runs automatically each day and keeps the last {status.retention}.</Text>

            {!status.drive_connected && (
              <View style={styles.warn}>
                <Ionicons name="warning-outline" size={16} color={colors.onWarning} />
                <Text style={styles.warnText}>Connect Google Drive first — backups need it. Go to Settings › Google Drive.</Text>
              </View>
            )}

            <View style={styles.card}>
              <View style={[styles.dot, { backgroundColor: status.last_at ? colors.onSuccess : colors.mutedText }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{status.last_at ? 'Last backup' : 'No backup yet'}</Text>
                <Text style={styles.cardSub}>
                  {status.last_at
                    ? `${istDisplayDateTime(status.last_at)} · ${status.last_total ?? '—'} records · ${fmtSize(status.last_size)}`
                    : 'Run one now, or it will run automatically once Drive is connected.'}
                </Text>
                {status.last_error ? <Text style={styles.err}>Last error: {status.last_error}</Text> : null}
              </View>
            </View>

            <Pressable onPress={runNow} disabled={busy || !status.drive_connected} style={[styles.runBtn, (busy || !status.drive_connected) && { opacity: 0.5 }]} testID="backup-run">
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><Ionicons name="cloud-upload-outline" size={18} color={colors.onBrandPrimary} /><Text style={styles.runText}>Back up now</Text></>}
            </Pressable>

            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchTitle}>Automatic daily backup</Text>
                <Text style={styles.switchSub}>Runs in the background each day</Text>
              </View>
              <Switch value={status.auto_enabled} onValueChange={toggleAuto} trackColor={{ true: colors.brandPrimary, false: colors.border }} thumbColor={colors.surface} testID="backup-auto" />
            </View>

            {status.recent.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>Recent backups in Drive</Text>
                {status.recent.map((f) => (
                  <View key={f.name} style={styles.fileRow}>
                    <Ionicons name="document-outline" size={16} color={colors.brandSecondary} />
                    <Text style={styles.fileName} numberOfLines={1}>{f.name}</Text>
                    <Text style={styles.fileMeta}>{fmtSize(f.size)}</Text>
                  </View>
                ))}
              </>
            )}

            <Text style={styles.note}>To restore, download a backup from the “RMJ One Backups” Drive folder and run scripts/restore_backup.py on the server. This backs up all business data; document images are also kept in Drive separately.</Text>
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
  intro: { color: colors.mutedText, fontSize: 13, lineHeight: 19, marginBottom: spacing.md },
  warn: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: colors.warning, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  warnText: { flex: 1, color: colors.onWarning, fontSize: 12.5, lineHeight: 18 },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  dot: { width: 12, height: 12, borderRadius: 6 },
  cardTitle: { color: colors.onSurface, fontSize: 16, fontWeight: '700' },
  cardSub: { color: colors.mutedText, fontSize: 12.5, marginTop: 3, lineHeight: 18 },
  err: { color: colors.onError, fontSize: 12, marginTop: 4 },
  runBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, marginTop: spacing.lg },
  runText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: '700' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg, paddingVertical: 6 },
  switchTitle: { color: colors.onSurface, fontSize: 15, fontWeight: '600' },
  switchSub: { color: colors.mutedText, fontSize: 12, marginTop: 2 },
  sectionLabel: { color: colors.mutedText, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: spacing.xl, marginBottom: spacing.sm },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  fileName: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 13 },
  fileMeta: { color: colors.mutedText, fontSize: 12 },
  note: { color: colors.mutedText, fontSize: 12, marginTop: spacing.xl, lineHeight: 18 },
});
