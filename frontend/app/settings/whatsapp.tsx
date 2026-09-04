import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { notify } from '@/src/utils/notify';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

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
const DEFAULT_TEMPLATE = 'Hi {customer_name}, your item {item_code} ({description}) is ready for pickup at {shop_name}. {amount_line} Thank you!';

export default function WhatsAppSettingsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [form, setForm] = useState<Form>(EMPTY);
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  const load = async () => {
    try {
      const w = await api.get<any>('/settings/whatsapp');
      setForm({ enabled: w.enabled !== false, repair_ready_notice: w.repair_ready_notice !== false, repair_ready_template: w.repair_ready_template || '' });
      setStatus({ configured: !!w.configured, connected: !!w.connected, phone: w.phone || null });
    } catch (_e) { /* ignore — form stays at defaults */ }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

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
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14, marginBottom: spacing.md,
  },
  inputMultiline: { minHeight: 90, textAlignVertical: 'top' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 16, alignItems: 'center' },
  saveText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 15 },
});
