import { useCallback, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, Platform, KeyboardAvoidingView, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { colors, spacing, radius, fonts } from '@/src/theme';

type Device = { id: string; serial: string; label: string; last_seen: string | null; status: string };
type Log = { id: string; serial: string; user_id: string; timestamp: string; event_type: string; result: string; reason?: string; employee_name?: string; action?: string };

const fmtWhen = (iso?: string | null) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
};

export default function BiometricScreen() {
  const router = useRouter();
  const [devices, setDevices] = useState<Device[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [serial, setSerial] = useState('');
  const [label, setLabel] = useState('');
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'devices' | 'logs'>('devices');

  const load = useCallback(async () => {
    try {
      const [d, l] = await Promise.all([
        api.get<Device[]>('/biometric/devices').catch(() => []),
        api.get<Log[]>('/biometric/logs?limit=100').catch(() => []),
      ]);
      setDevices(d); setLogs(l);
    } finally { setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const submittingRef = useRef(false);
  const add = async () => {
    if (submittingRef.current) return;
    if (!serial.trim() || !label.trim() || !secret.trim()) {
      Alert.alert('Missing', 'Serial, label and secret are all required'); return;
    }
    submittingRef.current = true;
    setSaving(true);
    try {
      await api.post('/biometric/devices', { serial: serial.trim(), label: label.trim(), secret });
      setSerial(''); setLabel(''); setSecret(''); await load();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); submittingRef.current = false; }
  };

  const remove = (d: Device) => {
    Alert.alert('Delete device', `Remove ${d.label} (${d.serial})?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { try { await api.del(`/biometric/devices/${d.id}`); await load(); } catch (_e) {} } },
    ]);
  };

  const pushUrl = `${process.env.EXPO_PUBLIC_BACKEND_URL || ''}/api/biometric/push`;

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
                  <Text style={styles.pushLabel}>Configure this URL in eSSL Web UI → Cloud Server / ADMS:</Text>
                  <Text style={styles.pushUrl} numberOfLines={2}>{pushUrl}</Text>
                </View>
              </View>

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
                  <Pressable onPress={() => remove(d)} style={styles.delBtn} hitSlop={10} testID={`del-device-${d.id}`}>
                    <Ionicons name="trash-outline" size={16} color="#F1A9A9" />
                  </Pressable>
                </View>
              ))}
            </>
          ) : (
            logs.length === 0 ? (
              <View style={styles.empty}><Ionicons name="pulse-outline" size={40} color={colors.mutedText} /><Text style={styles.emptyText}>No sync logs yet</Text></View>
            ) : logs.map((l) => (
              <View key={l.id} style={styles.logRow} testID={`bio-log-${l.id}`}>
                <View style={[styles.logDot, { backgroundColor: l.result === 'accepted' ? '#B7EFC5' : l.result === 'skipped' ? '#F1D890' : '#F1A9A9' }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.logText}>
                    <Text style={{ color: colors.onSurface, fontWeight: '700' }}>{l.employee_name || l.user_id}</Text>
                    <Text> · {(l.action || l.event_type || '').replace('_', ' ')}</Text>
                  </Text>
                  <Text style={styles.logMeta}>{l.serial} · {l.result}{l.reason ? ` · ${l.reason}` : ''}</Text>
                </View>
                <Text style={styles.logTime}>{fmtWhen(l.timestamp)}</Text>
              </View>
            ))
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
  delBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(122,40,40,0.15)',
    borderColor: colors.error, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  logRow: {
    flexDirection: 'row', gap: spacing.md, alignItems: 'center',
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  logDot: { width: 8, height: 8, borderRadius: 4 },
  logText: { color: colors.onSurfaceSecondary, fontSize: 13 },
  logMeta: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  logTime: { color: colors.mutedText, fontSize: 10 },
  empty: { alignItems: 'center', paddingVertical: 40, gap: spacing.sm },
  emptyText: { color: colors.onSurfaceTertiary },
});
