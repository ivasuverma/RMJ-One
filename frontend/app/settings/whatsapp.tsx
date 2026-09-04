import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { notify } from '@/src/utils/notify';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';

type Form = { enabled: boolean; repair_ready_notice: boolean; repair_ready_template: string; chatbot_enabled: boolean };
const EMPTY: Form = { enabled: true, repair_ready_notice: true, repair_ready_template: '', chatbot_enabled: false };
type WhatsAppStatus = { configured: boolean; connected: boolean; phone: string | null };

const TEMPLATE_SAMPLE: Record<string, string> = {
  customer_name: 'Ramesh Kumar', item_code: 'RJ-0231', description: 'Gold ring repair',
  shop_name: 'Ram Murti Jewellers', amount_line: 'Bill amount: Rs.500.',
};
function renderTemplatePreview(tpl: string): string {
  return (tpl || '').replace(/\{(\w+)\}/g, (m, k) => (k in TEMPLATE_SAMPLE ? TEMPLATE_SAMPLE[k] : m));
}
const DEFAULT_TEMPLATE = 'Hi {customer_name}, your item {item_code} ({description}) is ready for pickup at {shop_name}. {amount_line} Thank you!';

const GOLD_RATE_SAMPLE: Record<string, string> = { gold_rate: '151050', silver_rate: '242200' };
function renderGoldRatePreview(tpl: string): string {
  return (tpl || '').replace(/\{(\w+)\}/g, (m, k) => (k in GOLD_RATE_SAMPLE ? GOLD_RATE_SAMPLE[k] : m));
}
const DEFAULT_GOLD_RATE_TEMPLATE = 'Today approx. rate update: \nGold 24k: {gold_rate} /tola\nSilver : {silver_rate} /kg\n\nClick bell icon above for notification \u{1F514}';

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

  // Gold rate fetch settings — moved here from the Gold Rate Channel screen
  // (Work tab): fetching/sending is a task an employee can be assigned, but
  // the schedule + margins are pricing policy, so they live in owner-only
  // Settings instead.
  const [fetchTime, setFetchTime] = useState('12:30');
  const [goldMargin, setGoldMargin] = useState('0');
  const [silverMargin, setSilverMargin] = useState('0');
  const [goldRateTemplate, setGoldRateTemplate] = useState('');
  const [grSaving, setGrSaving] = useState(false);

  const load = async () => {
    try {
      const w = await api.get<any>('/settings/whatsapp');
      setForm({
        enabled: w.enabled !== false, repair_ready_notice: w.repair_ready_notice !== false,
        repair_ready_template: w.repair_ready_template || '', chatbot_enabled: w.chatbot_enabled === true,
      });
      setStatus({ configured: !!w.configured, connected: !!w.connected, phone: w.phone || null });
    } catch (_e) { /* ignore — form stays at defaults */ }
    finally { setLoading(false); }
    try {
      const g = await api.get<any>('/settings/gold-rate');
      setFetchTime(g.fetch_time || '12:30');
      setGoldMargin(String(g.gold_margin ?? 0));
      setSilverMargin(String(g.silver_margin ?? 0));
      setGoldRateTemplate(g.template || '');
    } catch { /* not an owner, or gold-rate not reachable — leave defaults */ }
  };
  useEffect(() => { load(); }, []);

  const saveGoldRateConfig = async () => {
    setGrSaving(true);
    try {
      const gm = parseInt(goldMargin, 10) || 0;
      const sm = parseInt(silverMargin, 10) || 0;
      await api.put('/settings/gold-rate/config', { fetch_time: fetchTime, gold_margin: gm, silver_margin: sm, template: goldRateTemplate || undefined });
      toast.success('Fetch time, margins & template saved');
    } catch (e: any) { toast.error(e?.detail || 'Could not save'); }
    finally { setGrSaving(false); }
  };

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
        <Pressable onPress={load} style={styles.iconBtn} testID="whatsapp-refresh-btn" hitSlop={12}>
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

        <Pressable
          onPress={() => form.enabled && setForm((f) => ({ ...f, chatbot_enabled: !f.chatbot_enabled }))}
          style={[styles.toggleRow, !form.enabled && { opacity: 0.5 }]}
          disabled={!form.enabled}
          testID="whatsapp-chatbot-toggle"
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleLabel}>Auto-reply chatbot</Text>
            <Text style={styles.toggleSub}>Customers who message the shop's WhatsApp number and reply RATE or STATUS get an automatic reply — no AI, fixed answers only. Off means no auto-reply of any kind.</Text>
          </View>
          <View style={[styles.switch, form.enabled && form.chatbot_enabled && styles.switchOn]}>
            <View style={[styles.switchKnob, form.enabled && form.chatbot_enabled && styles.switchKnobOn]} />
          </View>
        </Pressable>

        <Text style={styles.section}>Repair Ready — Message Template</Text>
        <Text style={styles.hint}>Placeholders: {'{customer_name}'} {'{item_code}'} {'{description}'} {'{shop_name}'} {'{amount_line}'}</Text>
        <TextInput
          value={form.repair_ready_template}
          onChangeText={(t) => setForm((f) => ({ ...f, repair_ready_template: t }))}
          placeholder={DEFAULT_TEMPLATE}
          placeholderTextColor={colors.mutedText}
          multiline
          style={[styles.input, styles.inputMultiline]}
          testID="whatsapp-repair-template-input"
        />
        <Text style={styles.fieldLabel}>Preview</Text>
        <View style={styles.infoBox}>
          <Ionicons name="eye-outline" size={16} color={colors.brandSecondary} />
          <Text style={styles.infoText} testID="whatsapp-repair-template-preview">
            {renderTemplatePreview(form.repair_ready_template || DEFAULT_TEMPLATE)}
          </Text>
        </View>

        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={16} color={colors.brandSecondary} />
          <Text style={styles.infoText}>More WhatsApp flows (gold loan reminders, etc.) will get their own toggle here as they're added. The daily gold rate broadcast now lives on the Work tab, under "Gold Rate Channel".</Text>
        </View>

        <View style={styles.divider} />
        <Text style={styles.section}>Gold Rate — Fetch Settings</Text>
        <Text style={styles.hint}>When the daily rate auto-fetches, and the margin added on top of the scraped rate — fetching/sending itself happens on the Work tab.</Text>
        <View style={styles.row2}>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Fetch time (24h, IST)</Text>
            <TextInput value={fetchTime} onChangeText={setFetchTime} placeholder="12:30" placeholderTextColor={colors.mutedText} style={styles.input} testID="gold-rate-fetch-time" />
          </View>
        </View>
        <View style={styles.row2}>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Gold margin (₹, +/-, rounds to ₹50)</Text>
            <TextInput value={goldMargin} onChangeText={setGoldMargin} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} testID="gold-rate-gold-margin" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Silver margin (₹, +/-, rounds to ₹100)</Text>
            <TextInput value={silverMargin} onChangeText={setSilverMargin} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} testID="gold-rate-silver-margin" />
          </View>
        </View>
        <Text style={styles.fieldLabel}>Broadcast message template</Text>
        <Text style={styles.hint}>Placeholders: {'{gold_rate}'} {'{silver_rate}'}</Text>
        <TextInput
          value={goldRateTemplate}
          onChangeText={setGoldRateTemplate}
          placeholder={DEFAULT_GOLD_RATE_TEMPLATE}
          placeholderTextColor={colors.mutedText}
          multiline
          style={[styles.input, styles.inputMultiline]}
          testID="gold-rate-template-input"
        />
        <Text style={styles.fieldLabel}>Preview</Text>
        <View style={styles.infoBox}>
          <Ionicons name="eye-outline" size={16} color={colors.brandSecondary} />
          <Text style={styles.infoText} testID="gold-rate-template-preview">
            {renderGoldRatePreview(goldRateTemplate || DEFAULT_GOLD_RATE_TEMPLATE)}
          </Text>
        </View>

        <Pressable onPress={saveGoldRateConfig} disabled={grSaving} style={[styles.altBtn, grSaving && { opacity: 0.6 }]} testID="gold-rate-save-config">
          {grSaving ? <ActivityIndicator color={colors.brandSecondary} size="small" /> : <Text style={styles.altBtnText}>Save Fetch Settings</Text>}
        </Pressable>
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
  divider: { height: 1, backgroundColor: colors.divider, marginTop: spacing.lg },
  row2: { flexDirection: 'row', gap: spacing.sm },
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
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 16, alignItems: 'center' },
  saveText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 15 },
});
