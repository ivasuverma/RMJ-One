import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { notify } from '@/src/utils/notify';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { ToggleSwitch } from '@/src/components/ui/ToggleSwitch';

type Form = {
  enabled: boolean; repair_ready_notice: boolean; repair_ready_template: string;
  repair_received_notice: boolean; repair_received_template: string;
  chatbot_enabled: boolean; chatbot_rate_template: string;
  chatbot_rate_enabled: boolean; chatbot_status_enabled: boolean;
};
const EMPTY: Form = {
  enabled: true, repair_ready_notice: true, repair_ready_template: '',
  repair_received_notice: true, repair_received_template: '',
  chatbot_enabled: false, chatbot_rate_template: '',
  chatbot_rate_enabled: true, chatbot_status_enabled: true,
};
type WhatsAppStatus = { configured: boolean; connected: boolean; phone: string | null };

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
      setForm({
        enabled: w.enabled !== false,
        repair_ready_notice: w.repair_ready_notice !== false,
        repair_ready_template: w.repair_ready_template || '',
        repair_received_notice: w.repair_received_notice !== false, repair_received_template: w.repair_received_template || '',
        chatbot_enabled: w.chatbot_enabled === true,
        chatbot_rate_template: w.chatbot_rate_template || '',
        chatbot_rate_enabled: w.chatbot_rate_enabled !== false, chatbot_status_enabled: w.chatbot_status_enabled !== false,
      });
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
          <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}>
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
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>WhatsApp</Text>
        <Pressable onPress={load} style={styles.iconBtn} testID="whatsapp-refresh-btn" hitSlop={12} accessibilityRole="button" accessibilityLabel="Refresh">
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

        <Pressable onPress={() => router.push('/settings/whatsapp-templates' as any)} style={styles.navRow} testID="whatsapp-templates-link">
          <View style={styles.navIcon}><Ionicons name="document-text-outline" size={20} color={colors.brandSecondary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleLabel}>Message Templates</Text>
            <Text style={styles.toggleSub}>Repair notice, chatbot RATE reply, and gold rate broadcast text</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
        </Pressable>

        <Pressable onPress={() => router.push('/settings/whatsapp-messages' as any)} style={styles.navRow} testID="whatsapp-messages-link">
          <View style={styles.navIcon}><Ionicons name="list-outline" size={20} color={colors.brandSecondary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleLabel}>Sent Messages Log</Text>
            <Text style={styles.toggleSub}>Every WhatsApp send — shop number and broadcasts — with real delivery status</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
        </Pressable>

        <Pressable
          onPress={() => setForm((f) => ({ ...f, enabled: !f.enabled }))}
          style={styles.toggleRow}
          testID="whatsapp-enabled-toggle"
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleLabel}>Enable WhatsApp notices</Text>
            <Text style={styles.toggleSub}>Master switch — off disables every group below, whatever their own toggles say</Text>
          </View>
          <ToggleSwitch value={!!(form.enabled)} />
        </Pressable>

        {/* ---------------- Repair ---------------- */}
        <View style={[styles.groupCard, !form.enabled && { opacity: 0.5 }]}>
          <View style={styles.groupHeader}>
            <View style={styles.groupHeaderIcon}><Ionicons name="construct-outline" size={17} color={colors.brandSecondary} /></View>
            <Text style={styles.groupHeaderTitle}>Repair</Text>
          </View>
          <Pressable
            onPress={() => form.enabled && setForm((f) => ({ ...f, repair_ready_notice: !f.repair_ready_notice }))}
            style={styles.toggleRow}
            disabled={!form.enabled}
            testID="whatsapp-repair-ready-toggle"
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Ready-for-pickup notice</Text>
              <Text style={styles.toggleSub}>Lets staff send a "your item is ready" WhatsApp message from a billed tag's detail screen</Text>
            </View>
            <ToggleSwitch value={!!(form.enabled && form.repair_ready_notice)} />
          </Pressable>
          <Pressable
            onPress={() => form.enabled && setForm((f) => ({ ...f, repair_received_notice: !f.repair_received_notice }))}
            style={styles.toggleRow}
            disabled={!form.enabled}
            testID="whatsapp-repair-received-toggle"
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Item received notice</Text>
              <Text style={styles.toggleSub}>Lets staff send a "we've received your item" WhatsApp message from a freshly-intake tag's detail screen</Text>
            </View>
            <ToggleSwitch value={!!(form.enabled && form.repair_received_notice)} />
          </Pressable>
        </View>

        {/* ---------------- Chatbot ---------------- */}
        <View style={[styles.groupCard, !form.enabled && { opacity: 0.5 }]}>
          <View style={styles.groupHeader}>
            <View style={styles.groupHeaderIcon}><Ionicons name="chatbubble-ellipses-outline" size={17} color={colors.brandSecondary} /></View>
            <Text style={styles.groupHeaderTitle}>Chatbot</Text>
          </View>
          <Pressable
            onPress={() => form.enabled && setForm((f) => ({ ...f, chatbot_enabled: !f.chatbot_enabled }))}
            style={styles.toggleRow}
            disabled={!form.enabled}
            testID="whatsapp-chatbot-toggle"
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Auto-reply chatbot</Text>
              <Text style={styles.toggleSub}>Customers who message the shop's number and reply RATE or STATUS get an automatic reply — no AI, fixed answers only</Text>
            </View>
            <ToggleSwitch value={!!(form.enabled && form.chatbot_enabled)} />
          </Pressable>
          <View style={styles.row2}>
            <Pressable
              onPress={() => form.enabled && form.chatbot_enabled && setForm((f) => ({ ...f, chatbot_rate_enabled: !f.chatbot_rate_enabled }))}
              style={[styles.keywordToggle, (!form.enabled || !form.chatbot_enabled) && { opacity: 0.5 }]}
              disabled={!form.enabled || !form.chatbot_enabled}
              testID="whatsapp-chatbot-rate-keyword-toggle"
            >
              <Text style={styles.toggleLabel}>RATE</Text>
              <ToggleSwitch value={!!(form.enabled && form.chatbot_enabled && form.chatbot_rate_enabled)} />
            </Pressable>
            <Pressable
              onPress={() => form.enabled && form.chatbot_enabled && setForm((f) => ({ ...f, chatbot_status_enabled: !f.chatbot_status_enabled }))}
              style={[styles.keywordToggle, (!form.enabled || !form.chatbot_enabled) && { opacity: 0.5 }]}
              disabled={!form.enabled || !form.chatbot_enabled}
              testID="whatsapp-chatbot-status-keyword-toggle"
            >
              <Text style={styles.toggleLabel}>STATUS</Text>
              <ToggleSwitch value={!!(form.enabled && form.chatbot_enabled && form.chatbot_status_enabled)} />
            </Pressable>
          </View>
        </View>

        {/* The official Meta number now lives in Rate Broadcast — it sends nothing else. */}
        <Pressable onPress={() => router.push('/settings/rate-broadcast/number' as any)} style={styles.navRow} testID="whatsapp-meta-link">
          <View style={styles.navIcon}><Ionicons name="megaphone-outline" size={20} color={colors.brandSecondary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleLabel}>Official WhatsApp (Meta)</Text>
            <Text style={styles.toggleSub}>Used only for Rate Broadcast — rates and offers to customers. Set up in Rate Broadcast › Official number.</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
        </Pressable>

        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={16} color={colors.brandSecondary} />
          <Text style={styles.infoText}>More WhatsApp flows (gold loan reminders, etc.) will get their own group here as they're added.</Text>
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
  navRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, marginBottom: spacing.lg,
  },
  navIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  groupCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  groupHeaderIcon: { width: 32, height: 32, borderRadius: 9, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  groupHeaderTitle: { color: colors.onSurface, fontSize: 15, fontWeight: '700', fontFamily: fonts.display },
  groupDivider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.md },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md,
  },
  toggleLabel: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  toggleSub: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  toggleRowWarn: { borderColor: colors.warning },
  keywordToggle: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md,
  },
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
  row2: { flexDirection: 'row', gap: spacing.sm },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14, marginBottom: spacing.md,
  },
  altBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12,
    borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
  },
  altBtnText: { color: colors.brandSecondary, fontSize: 13.5, fontWeight: '700' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 16, alignItems: 'center' },
  saveText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 15 },
});
