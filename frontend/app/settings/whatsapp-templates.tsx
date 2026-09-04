import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';

const REPAIR_SAMPLE: Record<string, string> = {
  customer_name: 'Ramesh Kumar', item_code: 'RJ-0231', description: 'Gold ring repair',
  shop_name: 'Ram Murti Jewellers', amount_line: 'Bill amount: Rs.500.',
};
const DEFAULT_REPAIR_TEMPLATE = 'Hi {customer_name}, your item {item_code} ({description}) is ready for pickup at {shop_name}. {amount_line} Thank you!';

const REPAIR_RECEIVED_SAMPLE: Record<string, string> = {
  customer_name: 'Ramesh Kumar', item_code: 'RJ-0231', description: 'Gold ring repair',
  shop_name: 'Ram Murti Jewellers', due_date: '10 Sep 2026',
};
const DEFAULT_REPAIR_RECEIVED_TEMPLATE = "Hi {customer_name}, we've received your item {item_code} ({description}) at {shop_name} for repair. Expected by {due_date}. We'll notify you once it's ready. Thank you!";

const CHATBOT_RATE_SAMPLE: Record<string, string> = { gold_rate: '151050', silver_rate: '242200', date: '04 Sep 2026', time: '12:30 PM' };
const DEFAULT_CHATBOT_RATE_TEMPLATE = "Today's approx rate (as on {date}, {time}):\nGold 24k: Rs.{gold_rate} /tola\nSilver: Rs.{silver_rate} /kg";

const GOLD_RATE_SAMPLE: Record<string, string> = { gold_rate: '151050', silver_rate: '242200', date: '04 Sep 2026', time: '12:30 PM' };
const DEFAULT_GOLD_RATE_TEMPLATE = 'Today approx. rate update: \nGold 24k: {gold_rate} /tola\nSilver : {silver_rate} /kg\n\nClick bell icon above for notification \u{1F514}';

function renderPreview(tpl: string, sample: Record<string, string>, fallback: string): string {
  return (tpl || fallback).replace(/\{(\w+)\}/g, (m, k) => (k in sample ? sample[k] : m));
}

export default function WhatsAppTemplatesScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Full underlying docs, carried through untouched on save — both PUT
  // endpoints replace their whole doc, so saving just a template here must
  // still resend every toggle/schedule field this screen doesn't show.
  const [waSettings, setWaSettings] = useState<any>(null);
  const [grConfig, setGrConfig] = useState<any>(null);

  const [repairTemplate, setRepairTemplate] = useState('');
  const [repairReceivedTemplate, setRepairReceivedTemplate] = useState('');
  const [chatbotTemplate, setChatbotTemplate] = useState('');
  const [goldRateTemplate, setGoldRateTemplate] = useState('');

  const load = async () => {
    try {
      const [wa, gr] = await Promise.all([
        api.get<any>('/settings/whatsapp'),
        api.get<any>('/settings/gold-rate'),
      ]);
      setWaSettings(wa);
      setGrConfig(gr);
      setRepairTemplate(wa.repair_ready_template || '');
      setRepairReceivedTemplate(wa.repair_received_template || '');
      setChatbotTemplate(wa.chatbot_rate_template || '');
      setGoldRateTemplate(gr.template || '');
    } catch (e: any) { toast.error(e?.detail || 'Could not load'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!waSettings || !grConfig) return;
    setSaving(true);
    try {
      await Promise.all([
        api.put('/settings/whatsapp', {
          enabled: waSettings.enabled, repair_ready_notice: waSettings.repair_ready_notice,
          repair_received_notice: waSettings.repair_received_notice,
          chatbot_enabled: waSettings.chatbot_enabled,
          chatbot_rate_enabled: waSettings.chatbot_rate_enabled, chatbot_status_enabled: waSettings.chatbot_status_enabled,
          repair_ready_template: repairTemplate || undefined, repair_received_template: repairReceivedTemplate || undefined,
          chatbot_rate_template: chatbotTemplate || undefined,
        }),
        api.put('/settings/gold-rate/config', {
          fetch_time: grConfig.fetch_time, gold_margin: grConfig.gold_margin, silver_margin: grConfig.silver_margin,
          template: goldRateTemplate || undefined,
          chatbot_refresh_enabled: grConfig.chatbot_refresh_enabled, chatbot_refresh_interval_min: grConfig.chatbot_refresh_interval_min,
          chatbot_refresh_start: grConfig.chatbot_refresh_start, chatbot_refresh_end: grConfig.chatbot_refresh_end,
          auto_send_enabled: grConfig.auto_send_enabled,
        }),
      ]);
      toast.success('Templates saved');
      router.back();
    } catch (e: any) { toast.error(e?.detail || 'Could not save'); }
    finally { setSaving(false); }
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
    <SafeAreaView style={styles.root} edges={['top']} testID="whatsapp-templates-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Message Templates</Text>
        <Pressable onPress={load} style={styles.iconBtn} testID="templates-refresh-btn" hitSlop={12}>
          <Ionicons name="refresh" size={18} color={colors.onSurface} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.section}>Repair Ready — Message Template</Text>
        <Text style={styles.hint}>Placeholders: {'{customer_name}'} {'{item_code}'} {'{description}'} {'{shop_name}'} {'{amount_line}'}</Text>
        <TextInput
          value={repairTemplate}
          onChangeText={setRepairTemplate}
          placeholder={DEFAULT_REPAIR_TEMPLATE}
          placeholderTextColor={colors.mutedText}
          multiline
          style={[styles.input, styles.inputMultiline]}
          testID="whatsapp-repair-template-input"
        />
        <Text style={styles.fieldLabel}>Preview</Text>
        <View style={styles.infoBox}>
          <Ionicons name="eye-outline" size={16} color={colors.brandSecondary} />
          <Text style={styles.infoText} testID="whatsapp-repair-template-preview">
            {renderPreview(repairTemplate, REPAIR_SAMPLE, DEFAULT_REPAIR_TEMPLATE)}
          </Text>
        </View>

        <View style={styles.divider} />
        <Text style={styles.section}>Item Received — Message Template</Text>
        <Text style={styles.hint}>Placeholders: {'{customer_name}'} {'{item_code}'} {'{description}'} {'{shop_name}'} {'{due_date}'}</Text>
        <TextInput
          value={repairReceivedTemplate}
          onChangeText={setRepairReceivedTemplate}
          placeholder={DEFAULT_REPAIR_RECEIVED_TEMPLATE}
          placeholderTextColor={colors.mutedText}
          multiline
          style={[styles.input, styles.inputMultiline]}
          testID="whatsapp-repair-received-template-input"
        />
        <Text style={styles.fieldLabel}>Preview</Text>
        <View style={styles.infoBox}>
          <Ionicons name="eye-outline" size={16} color={colors.brandSecondary} />
          <Text style={styles.infoText} testID="whatsapp-repair-received-template-preview">
            {renderPreview(repairReceivedTemplate, REPAIR_RECEIVED_SAMPLE, DEFAULT_REPAIR_RECEIVED_TEMPLATE)}
          </Text>
        </View>

        <View style={styles.divider} />
        <Text style={styles.section}>Chatbot — RATE Reply Template</Text>
        <Text style={styles.hint}>Placeholders: {'{gold_rate}'} {'{silver_rate}'} {'{date}'} {'{time}'} — date/time are when the rate was fetched, not when the customer texts.</Text>
        <TextInput
          value={chatbotTemplate}
          onChangeText={setChatbotTemplate}
          placeholder={DEFAULT_CHATBOT_RATE_TEMPLATE}
          placeholderTextColor={colors.mutedText}
          multiline
          style={[styles.input, styles.inputMultiline]}
          testID="whatsapp-chatbot-rate-template-input"
        />
        <Text style={styles.fieldLabel}>Preview</Text>
        <View style={styles.infoBox}>
          <Ionicons name="eye-outline" size={16} color={colors.brandSecondary} />
          <Text style={styles.infoText} testID="whatsapp-chatbot-rate-template-preview">
            {renderPreview(chatbotTemplate, CHATBOT_RATE_SAMPLE, DEFAULT_CHATBOT_RATE_TEMPLATE)}
          </Text>
        </View>

        <View style={styles.divider} />
        <Text style={styles.section}>Gold Rate Channel — Broadcast Template</Text>
        <Text style={styles.hint}>Placeholders: {'{gold_rate}'} {'{silver_rate}'} {'{date}'} {'{time}'} — date/time are when the rate was fetched.</Text>
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
            {renderPreview(goldRateTemplate, GOLD_RATE_SAMPLE, DEFAULT_GOLD_RATE_TEMPLATE)}
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable onPress={save} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]} testID="templates-save-btn">
          {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Save Templates</Text>}
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
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '600', fontFamily: fonts.display, textAlign: 'center' },
  section: {
    color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase',
    marginTop: spacing.md, marginBottom: spacing.sm,
  },
  divider: { height: 1, backgroundColor: colors.divider, marginTop: spacing.lg },
  infoBox: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
  },
  infoText: { color: colors.onSurfaceTertiary, fontSize: 12, flex: 1 },
  hint: { color: colors.mutedText, fontSize: 12, marginBottom: spacing.md },
  fieldLabel: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14, marginBottom: spacing.md,
  },
  inputMultiline: { minHeight: 90, textAlignVertical: 'top' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 16, alignItems: 'center' },
  saveText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 15 },
});
