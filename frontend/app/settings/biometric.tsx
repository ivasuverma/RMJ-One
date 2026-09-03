import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Platform, KeyboardAvoidingView, RefreshControl,
} from 'react-native';
import { notify } from '@/src/utils/notify';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { confirmAction } from '@/src/utils/confirm';
import { istDisplayDateTime, istDate, istTime, displayDateOnlyWithWeekday } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Device = { id: string; serial: string; label: string; last_seen: string | null; status: string };
type Log = { id: string; serial: string; user_id: string; timestamp: string; event_type: string; result: string; reason?: string; employee_name?: string; action?: string };

const fmtWhen = (iso?: string | null) => (iso ? istDisplayDateTime(iso) : '—');

export default function BiometricScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [serial, setSerial] = useState('');
  const [label, setLabel] = useState('');
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pulling, setPulling] = useState<string | null>(null);
  const [tab, setTab] = useState<'devices' | 'logs'>('devices');
  const [webhookUrl, setWebhookUrl] = useState('');

  // Group the sync log by the punch's IST date, newest day first, so it reads
  // day-by-day like the attendance Live feed instead of one flat stream.
  const logsByDate = useMemo(() => {
    const groups: { date: string; items: Log[] }[] = [];
    const m = new Map<string, Log[]>();
    for (const l of logs) {
      const d = istDate(l.timestamp) || '—';
      if (!m.has(d)) { m.set(d, []); groups.push({ date: d, items: m.get(d)! }); }
      m.get(d)!.push(l);
    }
    return groups;
  }, [logs]);

  const load = useCallback(async () => {
    try {
      const [d, l, s] = await Promise.all([
        api.get<Device[]>('/biometric/devices').catch(() => []),
        api.get<Log[]>('/biometric/logs?limit=100').catch(() => []),
        api.get<any>('/settings/store').catch(() => null),
      ]);
      setDevices(d); setLogs(l);
      const base = process.env.EXPO_PUBLIC_BACKEND_URL || '';
      const path = `${base}/api/biometric/ebioserver-webhook`;
      const key = s?.biometric_webhook_secret;
      setWebhookUrl(key ? `${path}?key=${encodeURIComponent(key)}` : path);
    } finally { setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const submittingRef = useRef(false);
  const add = async () => {
    if (submittingRef.current) return;
    if (!serial.trim() || !label.trim() || !secret.trim()) {
      notify('Missing', 'Serial, label and secret are all required'); return;
    }
    submittingRef.current = true;
    setSaving(true);
    try {
      await api.post('/biometric/devices', { serial: serial.trim(), label: label.trim(), secret });
      setSerial(''); setLabel(''); setSecret(''); await load();
    } catch (e: any) { notify('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); submittingRef.current = false; }
  };

  const remove = (d: Device) => {
    confirmAction('Delete device', `Remove ${d.label} (${d.serial})?`, 'Delete', async () => {
      try { await api.del(`/biometric/devices/${d.id}`); await load(); }
      catch (e: any) { notify('Failed', e?.detail || 'Could not delete this device. Please try again.'); }
    });
  };

  const pull = async (d: Device) => {
    setPulling(d.id);
    try {
      const r = await api.post<{ note?: string }>(`/biometric/devices/${d.id}/pull`, {});
      notify('Sync requested', r?.note || 'The device will re-send its recent punches shortly. Check the Logs tab in a few seconds.');
    } catch (e: any) { notify('Failed', e?.detail || 'Could not request a sync.'); }
    finally { setPulling(null); }
  };


  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="biometric-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Biometric Devices</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.segRow}>
        {(['devices', 'logs'] as const).map((t) => (
          <Pressable key={t} testID={`bio-tab-${t}`} onPress={() => setTab(t)} style={[styles.segBtn, tab === t && styles.segBtnActive]}>
            <Text style={[styles.segText, tab === t && styles.segTextActive]}>{t.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          {tab === 'devices' ? (
            <>
              <View style={styles.pushCard}>
                <Ionicons name="link-outline" size={18} color={colors.brandSecondary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.pushLabel}>On the device: Comm → Cloud Server Settings — leave Server Mode as ADMS, just set:</Text>
                  <Text style={styles.pushUrl}>Server Address: your server's LAN IP</Text>
                  <Text style={styles.pushUrl}>Server Port: 8000 (backend's local port)</Text>
                </View>
              </View>

              <Pressable style={styles.pushCard} onPress={() => router.push('/store-settings' as any)} testID="ebioserver-webhook-card">
                <Ionicons name="finger-print-outline" size={18} color={colors.brandSecondary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.pushLabel}>Or, if using eSSL's eBioServer app: in its Master Settings, set Web URL to this (leave Symmetric Key blank), and set each employee's Biometric ID on their profile:</Text>
                  <Text style={styles.pushUrl} selectable>{webhookUrl}</Text>
                  <Text style={[styles.pushLabel, { marginTop: 6 }]}>Tap to change the secret in Store Settings →</Text>
                </View>
              </Pressable>

              <Text style={styles.section}>Register Device</Text>
              <TextInput testID="dev-serial" value={serial} onChangeText={setSerial} placeholder="Device serial" placeholderTextColor={colors.mutedText} style={styles.input} autoCapitalize="characters" />
              <TextInput testID="dev-label" value={label} onChangeText={setLabel} placeholder="Label (e.g. Front Gate)" placeholderTextColor={colors.mutedText} style={styles.input} />
              <TextInput testID="dev-secret" value={secret} onChangeText={setSecret} placeholder="Shared secret" placeholderTextColor={colors.mutedText} style={styles.input} secureTextEntry />
              <Pressable style={[styles.addBtn, saving && { opacity: 0.6 }]} disabled={saving} onPress={add} testID="add-device-btn">
                {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><Ionicons name="add" size={16} color={colors.onBrandPrimary} /><Text style={styles.addBtnText}>Register Device</Text></>}
              </Pressable>

              <Text style={[styles.section, { marginTop: spacing.xl }]}>Registered Devices</Text>
              {devices.length === 0 ? (
                <View style={styles.empty}><Text style={styles.emptyText}>No devices registered</Text></View>
              ) : devices.map((d) => (
                <View key={d.id} style={styles.card} testID={`device-${d.id}`}>
                  <View style={styles.iconBox}><Ionicons name="hardware-chip-outline" size={18} color={colors.brandSecondary} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cName}>{d.label}</Text>
                    <Text style={styles.cMeta}>Serial: {d.serial}</Text>
                    <Text style={styles.cMeta}>Last seen: {fmtWhen(d.last_seen)}</Text>
                  </View>
                  <Pressable onPress={() => pull(d)} disabled={pulling === d.id} style={styles.syncBtn} hitSlop={10} testID={`pull-device-${d.id}`}>
                    {pulling === d.id ? <ActivityIndicator size="small" color={colors.brandSecondary} /> : <Ionicons name="sync-outline" size={16} color={colors.brandSecondary} />}
                  </Pressable>
                  <Pressable onPress={() => remove(d)} style={styles.delBtn} hitSlop={10} testID={`del-device-${d.id}`}>
                    <Ionicons name="trash-outline" size={16} color={colors.onError} />
                  </Pressable>
                </View>
              ))}
            </>
          ) : (
            logs.length === 0 ? (
              <View style={styles.empty}><Ionicons name="pulse-outline" size={40} color={colors.mutedText} /><Text style={styles.emptyText}>No sync logs yet</Text></View>
            ) : logsByDate.map((g) => (
              <View key={g.date}>
                <Text style={styles.logDateHeader}>{g.date === '—' ? 'Unknown date' : displayDateOnlyWithWeekday(g.date)}</Text>
                {g.items.map((l) => (
                  <View key={l.id} style={styles.logRow} testID={`bio-log-${l.id}`}>
                    <View style={[styles.logDot, { backgroundColor: l.result === 'accepted' ? colors.onSuccess : l.result === 'skipped' ? colors.onWarning : colors.onError }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.logText}>
                        <Text style={{ color: colors.onSurface, fontWeight: '700' }}>{l.employee_name || l.user_id}</Text>
                        <Text> · {(l.action || l.event_type || '').replace('_', ' ')}</Text>
                      </Text>
                      <Text style={styles.logMeta}>{l.serial} · {l.result}{l.reason ? ` · ${l.reason}` : ''}</Text>
                    </View>
                    <Text style={styles.logTime}>{istTime(l.timestamp)}</Text>
                  </View>
                ))}
              </View>
            ))
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  title: {
    flex: 1, color: colors.onSurface, fontSize: 22, fontWeight: '600',
    fontFamily: fonts.display,
  },
  segRow: {
    flexDirection: 'row', margin: spacing.lg, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill, padding: 4, borderWidth: 1, borderColor: colors.border,
  },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.pill },
  segBtnActive: { backgroundColor: colors.brandPrimary },
  segText: { color: colors.onSurfaceTertiary, fontWeight: '600', fontSize: 12 },
  segTextActive: { color: colors.onBrandPrimary },
  pushCard: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', backgroundColor: colors.brandTertiary,
    borderColor: colors.brandPrimary, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg,
  },
  pushLabel: { color: colors.brandSecondary, fontSize: 11 },
  pushUrl: { color: colors.onSurface, fontSize: 11, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), marginTop: 4 },
  section: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md,
    paddingVertical: 12, fontSize: 14, marginBottom: spacing.sm,
  },
  addBtn: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, marginTop: spacing.sm,
  },
  addBtnText: { color: colors.onBrandPrimary, fontWeight: '700' },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  iconBox: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand,
  },
  cName: { color: colors.onSurface, fontWeight: '700', fontSize: 14 },
  cMeta: { color: colors.onSurfaceTertiary, fontSize: 11, marginTop: 2 },
  syncBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.brandTertiary,
    borderColor: colors.brand, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm,
  },
  delBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.error,
    borderColor: colors.onError, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  logRow: {
    flexDirection: 'row', gap: spacing.md, alignItems: 'center',
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  logDot: { width: 8, height: 8, borderRadius: 4 },
  logText: { color: colors.onSurfaceSecondary, fontSize: 13 },
  logMeta: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  logTime: { color: colors.onSurface, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  logDateHeader: { color: colors.mutedText, fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: spacing.lg, marginBottom: spacing.sm },
  empty: { alignItems: 'center', paddingVertical: 40, gap: spacing.sm },
  emptyText: { color: colors.onSurfaceTertiary },
});
