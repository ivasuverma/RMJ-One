import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { notify } from '@/src/utils/notify';
import { confirmAction } from '@/src/utils/confirm';
import { istTime } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';

type Form = { enabled: boolean; repair_ready_notice: boolean; repair_ready_template: string };
const EMPTY: Form = { enabled: true, repair_ready_notice: true, repair_ready_template: '' };
type WhatsAppStatus = { configured: boolean; connected: boolean; phone: string | null };

const TEMPLATE_SAMPLE: Record<string, string> = {
  customer_name: 'Ramesh Kumar', item_code: 'RJ-0231', description: 'Gold ring repair',
  shop_name: 'Ram Murti Jewellers', amount_line: 'Bill amount: Rs.500.',
};
function renderTemplatePreview(tpl: string): string {
  return (tpl || '').replace(/\{(\w+)\}/g, (m, k) => (k in TEMPLATE_SAMPLE ? TEMPLATE_SAMPLE[k] : m));
}

type GoldRateToday = {
  date: string; rate: number | null; fetched_rate: number | null; margin_applied: number | null;
  error: string | null; manual: boolean; confirmed: boolean; sent_at: string | null; message: string | null;
} | null;

export default function WhatsAppSettingsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const [form, setForm] = useState<Form>(EMPTY);
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  // ---- Gold Rate broadcast ----
  const [grFetchTime, setGrFetchTime] = useState('12:30');
  const [grMargin, setGrMargin] = useState('0');
  const [grChannelConnected, setGrChannelConnected] = useState(false);
  const [grToday, setGrToday] = useState<GoldRateToday>(null);
  const [grMessage, setGrMessage] = useState('');
  const [grManualRate, setGrManualRate] = useState('');
  const [grBusy, setGrBusy] = useState<'refetch' | 'send' | 'config' | 'manual' | null>(null);

  const load = async () => {
    try {
      const w = await api.get<any>('/settings/whatsapp');
      setForm({ enabled: w.enabled !== false, repair_ready_notice: w.repair_ready_notice !== false, repair_ready_template: w.repair_ready_template || '' });
      setStatus({ configured: !!w.configured, connected: !!w.connected, phone: w.phone || null });
    } catch (_e) { /* ignore — form stays at defaults */ }
    finally { setLoading(false); }
  };
  const loadGoldRate = async () => {
    try {
      const g = await api.get<any>('/settings/gold-rate');
      setGrFetchTime(g.fetch_time || '12:30');
      setGrMargin(String(g.margin ?? 0));
      setGrChannelConnected(!!g.channel_connected);
      setGrToday(g.today || null);
      setGrMessage(g.today?.message || '');
    } catch { /* ignore — stays at defaults */ }
  };
  useEffect(() => { load(); loadGoldRate(); }, []);

  const save = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSaving(true);
    try {
      const w = await api.put<any>('/settings/whatsapp', form);
      setStatus({ configured: !!w.configured, connected: !!w.connected, phone: w.phone || null });
      router.back();
    } catch (e: any) {
      notify('Failed', e?.detail || 'Please try again');
    } finally { setSaving(false); submittingRef.current = false; }
  };

  const saveGoldRateConfig = async () => {
    setGrBusy('config');
    try {
      const margin = parseInt(grMargin, 10) || 0;
      await api.put('/settings/gold-rate/config', { fetch_time: grFetchTime, margin });
      toast.success('Fetch time & margin saved');
    } catch (e: any) { toast.error(e?.detail || 'Could not save'); }
    finally { setGrBusy(null); }
  };

  const refetchGoldRate = async () => {
    setGrBusy('refetch');
    try {
      const doc = await api.post<any>('/settings/gold-rate/refetch', {});
      setGrToday(doc); setGrMessage(doc.message || '');
      if (doc.error) toast.error(doc.error); else toast.success(`Fetched ₹${doc.rate?.toLocaleString('en-IN')}`);
    } catch (e: any) { toast.error(e?.detail || 'Could not fetch'); }
    finally { setGrBusy(null); }
  };

  const saveManualRate = async () => {
    const n = parseInt(grManualRate, 10);
    if (!n) { toast.error('Enter a valid rate'); return; }
    setGrBusy('manual');
    try {
      const doc = await api.put<any>('/settings/gold-rate', { rate: n });
      setGrToday(doc); setGrMessage(doc.message || ''); setGrManualRate('');
      toast.success('Rate set');
    } catch (e: any) { toast.error(e?.detail || 'Could not save'); }
    finally { setGrBusy(null); }
  };

  const sendGoldRate = () => confirmAction(
    'Send to Channel?',
    "This broadcasts today's rate to everyone following the Ram Murti Jewellers WhatsApp Channel. Make sure the message looks right.",
    'Send',
    async () => {
      setGrBusy('send');
      try {
        await api.post('/settings/gold-rate/send', { message: grMessage });
        toast.success('Sent to Channel');
        loadGoldRate();
      } catch (e: any) { toast.error(e?.detail || 'Could not send'); }
      finally { setGrBusy(null); }
    },
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }} />
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.centered}><ActivityIndicator color={colors.brandPrimary} size="large" /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="whatsapp-settings-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>WhatsApp</Text>
        <Pressable onPress={() => { load(); loadGoldRate(); }} style={styles.iconBtn} testID="whatsapp-refresh-btn" hitSlop={12}>
          <Ionicons name="refresh" size={18} color={colors.onSurface} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <View style={[styles.infoBox, status?.connected ? styles.infoBoxOk : styles.infoBoxWarn]} testID="whatsapp-status">
          <Ionicons name={status?.connected ? 'logo-whatsapp' : 'alert-circle-outline'} size={18} color={status?.connected ? colors.onSuccess : colors.onWarning} />
          <Text style={[styles.infoText, { color: status?.connected ? colors.onSuccess : colors.onWarning }]}>
            {status === null ? 'Checking connection…'
              : !status.configured ? 'WhatsApp gateway not configured on the server.'
              : status.connected ? `Connected — sending as ${status.phone}`
              : 'Gateway configured but not connected — scan the QR again in the WhatsApp dashboard.'}
          </Text>
        </View>

        <Text style={styles.section}>Toggles</Text>
        <Pressable
          onPress={() => setForm((f) => ({ ...f, enabled: !f.enabled }))}
          style={styles.toggleRow}
          testID="whatsapp-enabled-toggle"
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleLabel}>Enable WhatsApp notices</Text>
            <Text style={styles.toggleSub}>Master switch for every customer-facing WhatsApp message below</Text>
          </View>
          <View style={[styles.switch, form.enabled && styles.switchOn]}>
            <View style={[styles.switchKnob, form.enabled && styles.switchKnobOn]} />
          </View>
        </Pressable>

        <Pressable
          onPress={() => form.enabled && setForm((f) => ({ ...f, repair_ready_notice: !f.repair_ready_notice }))}
          style={[styles.toggleRow, !form.enabled && { opacity: 0.5 }]}
          disabled={!form.enabled}
          testID="whatsapp-repair-ready-toggle"
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleLabel}>Repair ready-for-pickup notice</Text>
            <Text style={styles.toggleSub}>Lets staff send a "your item is ready" WhatsApp message from a billed tag's detail screen</Text>
          </View>
          <View style={[styles.switch, form.enabled && form.repair_ready_notice && styles.switchOn]}>
            <View style={[styles.switchKnob, form.enabled && form.repair_ready_notice && styles.switchKnobOn]} />
          </View>
        </Pressable>

        <Text style={styles.section}>Repair Ready — Message Template</Text>
        <Text style={styles.hint}>Placeholders: {'{customer_name}'} {'{item_code}'} {'{description}'} {'{shop_name}'} {'{amount_line}'}</Text>
        <TextInput
          value={form.repair_ready_template}
          onChangeText={(t) => setForm((f) => ({ ...f, repair_ready_template: t }))}
          placeholder="Hi {customer_name}, your item {item_code} ({description}) is ready for pickup at {shop_name}. {amount_line} Thank you!"
          placeholderTextColor={colors.mutedText}
          multiline
          style={[styles.input, styles.inputMultiline]}
          testID="whatsapp-repair-template-input"
        />
        <Text style={styles.fieldLabel}>Preview</Text>
        <View style={styles.infoBox}>
          <Ionicons name="eye-outline" size={16} color={colors.brandSecondary} />
          <Text style={styles.infoText} testID="whatsapp-repair-template-preview">
            {renderTemplatePreview(form.repair_ready_template || 'Hi {customer_name}, your item {item_code} ({description}) is ready for pickup at {shop_name}. {amount_line} Thank you!')}
          </Text>
        </View>

        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={16} color={colors.brandSecondary} />
          <Text style={styles.infoText}>More WhatsApp flows (gold loan reminders, etc.) will get their own toggle here as they're added.</Text>
        </View>

        <View style={styles.divider} />

        <Text style={styles.section}>Gold Rate Broadcast</Text>
        <View style={styles.infoBox}>
          <Ionicons name="pricetag-outline" size={16} color={colors.brandSecondary} />
          <Text style={styles.infoText}>Fetches a reference rate from your supplier once a day. You confirm — and can adjust the rate or message — before it's sent to the "Ram Murti Jewellers" WhatsApp Channel.</Text>
        </View>

        <View style={styles.row2}>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Fetch time (24h, IST)</Text>
            <TextInput value={grFetchTime} onChangeText={setGrFetchTime} placeholder="12:30" placeholderTextColor={colors.mutedText} style={styles.input} testID="gold-rate-fetch-time" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Margin (₹, can be negative)</Text>
            <TextInput value={grMargin} onChangeText={setGrMargin} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} testID="gold-rate-margin" />
          </View>
        </View>
        <Pressable onPress={saveGoldRateConfig} disabled={grBusy === 'config'} style={[styles.altBtn, grBusy === 'config' && { opacity: 0.6 }]} testID="gold-rate-save-config">
          {grBusy === 'config' ? <ActivityIndicator color={colors.brandSecondary} size="small" /> : <Text style={styles.altBtnText}>Save Time &amp; Margin</Text>}
        </Pressable>

        {grToday?.error ? (
          <View style={[styles.infoBox, styles.infoBoxWarn]}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.onWarning} />
            <Text style={[styles.infoText, { color: colors.onWarning }]}>Couldn't fetch today: {grToday.error}. Enter today's rate manually below.</Text>
          </View>
        ) : grToday?.rate ? (
          <View style={[styles.infoBox, styles.infoBoxOk]}>
            <Ionicons name="checkmark-circle-outline" size={16} color={colors.onSuccess} />
            <Text style={[styles.infoText, { color: colors.onSuccess }]}>
              Today's rate: ₹{grToday.rate.toLocaleString('en-IN')}
              {grToday.manual ? ' (entered manually)' : ` (fetched ₹${grToday.fetched_rate?.toLocaleString('en-IN')} + margin ${grToday.margin_applied})`}
              {grToday.sent_at ? ` · sent at ${istTime(grToday.sent_at)}` : ' · not sent yet'}
            </Text>
          </View>
        ) : (
          <Text style={styles.hint}>Not fetched yet today — will auto-fetch at {grFetchTime} IST, or tap Fetch Now.</Text>
        )}

        <Pressable onPress={refetchGoldRate} disabled={grBusy === 'refetch'} style={[styles.altBtn, grBusy === 'refetch' && { opacity: 0.6 }]} testID="gold-rate-refetch">
          {grBusy === 'refetch' ? <ActivityIndicator color={colors.brandSecondary} size="small" /> : <><Ionicons name="refresh" size={15} color={colors.brandSecondary} /><Text style={styles.altBtnText}>Fetch Now</Text></>}
        </Pressable>

        <Text style={styles.fieldLabel}>Enter rate manually (₹ per 10g)</Text>
        <View style={styles.row2}>
          <TextInput value={grManualRate} onChangeText={setGrManualRate} keyboardType="numeric" placeholder="e.g. 151220" placeholderTextColor={colors.mutedText} style={[styles.input, { flex: 1 }]} testID="gold-rate-manual-input" />
          <Pressable onPress={saveManualRate} disabled={grBusy === 'manual'} style={[styles.altBtn, { flexGrow: 0, paddingHorizontal: spacing.lg }, grBusy === 'manual' && { opacity: 0.6 }]} testID="gold-rate-manual-set">
            {grBusy === 'manual' ? <ActivityIndicator color={colors.brandSecondary} size="small" /> : <Text style={styles.altBtnText}>Set</Text>}
          </Pressable>
        </View>

        {!!grToday?.rate && (
          <>
            <Text style={styles.fieldLabel}>Message to send</Text>
            <TextInput value={grMessage} onChangeText={setGrMessage} multiline style={[styles.input, styles.inputMultiline]} testID="gold-rate-message" />
            <Pressable onPress={sendGoldRate} disabled={grBusy === 'send' || !grChannelConnected} style={[styles.opt, styles.optPrimary, (grBusy === 'send' || !grChannelConnected) && { opacity: 0.5 }]} testID="gold-rate-send">
              {grBusy === 'send' ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><Ionicons name="send" size={17} color={colors.onBrandPrimary} /><Text style={styles.optPrimaryText}>Confirm &amp; Send to Channel</Text></>}
            </Pressable>
            {!grChannelConnected && <Text style={styles.hint}>WhatsApp not connected — check the status banner above.</Text>}
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable onPress={save} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]} testID="whatsapp-save-btn">
          {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Save Settings</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  centered: { flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  title: { flex: 1, color: colors.onSurface, fontSize: 22, fontWeight: '600', fontFamily: fonts.display },
  section: {
    color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase',
    marginTop: spacing.lg, marginBottom: spacing.sm,
  },
  divider: { height: 1, backgroundColor: colors.divider, marginTop: spacing.lg },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md,
  },
  toggleLabel: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  toggleSub: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  switch: {
    width: 44, height: 26, borderRadius: 13, backgroundColor: colors.surfaceTertiary,
    borderWidth: 1, borderColor: colors.border, padding: 2, justifyContent: 'center',
  },
  switchOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  switchKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.onSurfaceTertiary },
  switchKnobOn: { backgroundColor: colors.onBrandPrimary, transform: [{ translateX: 18 }] },
  infoBox: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
  },
  infoBoxOk: { backgroundColor: colors.success, borderColor: colors.success },
  infoBoxWarn: { backgroundColor: colors.warning, borderColor: colors.warning },
  infoText: { color: colors.onSurfaceTertiary, fontSize: 12, flex: 1 },
  hint: { color: colors.mutedText, fontSize: 12, marginBottom: spacing.md },
  fieldLabel: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  row2: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm, alignItems: 'flex-end' },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14, marginBottom: spacing.md,
  },
  inputMultiline: { minHeight: 90, textAlignVertical: 'top' },
  altBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12,
    borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
  },
  altBtnText: { color: colors.brandSecondary, fontSize: 13.5, fontWeight: '700' },
  opt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 15, borderRadius: radius.md, marginBottom: spacing.sm },
  optPrimary: { backgroundColor: colors.brandPrimary },
  optPrimaryText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: '700' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 16, alignItems: 'center' },
  saveText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 15 },
});
