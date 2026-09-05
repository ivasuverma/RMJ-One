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
  const toast = useToast();
  const [form, setForm] = useState<Form>(EMPTY);
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  // Gold rate fetch settings — moved here from the Gold Rate Channel screen
  // (Work tab): fetching/sending is a task an employee can be assigned, but
  // the schedule + margins are pricing policy, so they live in owner-only
  // Settings instead. Templates themselves (repair_ready_template,
  // chatbot_rate_template, goldRateTemplate) still load/save here — this
  // screen just doesn't render their editors any more (see
  // settings/whatsapp-templates.tsx) — but PUT replaces the whole doc, so
  // the loaded values must still be carried through on every save below.
  const [fetchTime, setFetchTime] = useState('12:30');
  const [goldMargin, setGoldMargin] = useState('0');
  const [silverMargin, setSilverMargin] = useState('0');
  const [goldRateTemplate, setGoldRateTemplate] = useState('');
  const [grSaving, setGrSaving] = useState(false);

  // Chatbot live-rate refresh — how often gold_rate_live is topped up so
  // RATE stays close to accurate through the day, independent of fetchTime
  // above (which is only the once-daily broadcast fetch).
  const [refreshEnabled, setRefreshEnabled] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState('120');
  const [refreshStart, setRefreshStart] = useState('12:30');
  const [refreshEnd, setRefreshEnd] = useState('19:00');
  const [autoSendEnabled, setAutoSendEnabled] = useState(false);
  const [skipWeekendFetch, setSkipWeekendFetch] = useState(true);

  const load = async () => {
    try {
      const w = await api.get<any>('/settings/whatsapp');
      setForm({
        enabled: w.enabled !== false, repair_ready_notice: w.repair_ready_notice !== false,
        repair_ready_template: w.repair_ready_template || '',
        repair_received_notice: w.repair_received_notice !== false, repair_received_template: w.repair_received_template || '',
        chatbot_enabled: w.chatbot_enabled === true,
        chatbot_rate_template: w.chatbot_rate_template || '',
        chatbot_rate_enabled: w.chatbot_rate_enabled !== false, chatbot_status_enabled: w.chatbot_status_enabled !== false,
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
      setRefreshEnabled(g.chatbot_refresh_enabled !== false);
      setRefreshInterval(String(g.chatbot_refresh_interval_min ?? 120));
      setRefreshStart(g.chatbot_refresh_start || '12:30');
      setRefreshEnd(g.chatbot_refresh_end || '19:00');
      setAutoSendEnabled(g.auto_send_enabled === true);
      setSkipWeekendFetch(g.skip_weekend_fetch !== false);
    } catch { /* not an owner, or gold-rate not reachable — leave defaults */ }
  };
  useEffect(() => { load(); }, []);

  const saveGoldRateConfig = async () => {
    setGrSaving(true);
    try {
      const gm = parseInt(goldMargin, 10) || 0;
      const sm = parseInt(silverMargin, 10) || 0;
      const ri = parseInt(refreshInterval, 10) || 120;
      await api.put('/settings/gold-rate/config', {
        fetch_time: fetchTime, gold_margin: gm, silver_margin: sm, template: goldRateTemplate || undefined,
        chatbot_refresh_enabled: refreshEnabled, chatbot_refresh_interval_min: ri,
        chatbot_refresh_start: refreshStart, chatbot_refresh_end: refreshEnd,
        auto_send_enabled: autoSendEnabled,
        skip_weekend_fetch: skipWeekendFetch,
      });
      toast.success('Fetch settings saved');
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

        <Pressable onPress={() => router.push('/settings/whatsapp-templates' as any)} style={styles.navRow} testID="whatsapp-templates-link">
          <View style={styles.navIcon}><Ionicons name="document-text-outline" size={20} color={colors.brandSecondary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleLabel}>Message Templates</Text>
            <Text style={styles.toggleSub}>Repair notice, chatbot RATE reply, and gold rate broadcast text</Text>
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
          <View style={[styles.switch, form.enabled && styles.switchOn]}>
            <View style={[styles.switchKnob, form.enabled && styles.switchKnobOn]} />
          </View>
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
            <View style={[styles.switch, form.enabled && form.repair_ready_notice && styles.switchOn]}>
              <View style={[styles.switchKnob, form.enabled && form.repair_ready_notice && styles.switchKnobOn]} />
            </View>
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
            <View style={[styles.switch, form.enabled && form.repair_received_notice && styles.switchOn]}>
              <View style={[styles.switchKnob, form.enabled && form.repair_received_notice && styles.switchKnobOn]} />
            </View>
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
            <View style={[styles.switch, form.enabled && form.chatbot_enabled && styles.switchOn]}>
              <View style={[styles.switchKnob, form.enabled && form.chatbot_enabled && styles.switchKnobOn]} />
            </View>
          </Pressable>
          <View style={styles.row2}>
            <Pressable
              onPress={() => form.enabled && form.chatbot_enabled && setForm((f) => ({ ...f, chatbot_rate_enabled: !f.chatbot_rate_enabled }))}
              style={[styles.keywordToggle, (!form.enabled || !form.chatbot_enabled) && { opacity: 0.5 }]}
              disabled={!form.enabled || !form.chatbot_enabled}
              testID="whatsapp-chatbot-rate-keyword-toggle"
            >
              <Text style={styles.toggleLabel}>RATE</Text>
              <View style={[styles.switch, form.enabled && form.chatbot_enabled && form.chatbot_rate_enabled && styles.switchOn]}>
                <View style={[styles.switchKnob, form.enabled && form.chatbot_enabled && form.chatbot_rate_enabled && styles.switchKnobOn]} />
              </View>
            </Pressable>
            <Pressable
              onPress={() => form.enabled && form.chatbot_enabled && setForm((f) => ({ ...f, chatbot_status_enabled: !f.chatbot_status_enabled }))}
              style={[styles.keywordToggle, (!form.enabled || !form.chatbot_enabled) && { opacity: 0.5 }]}
              disabled={!form.enabled || !form.chatbot_enabled}
              testID="whatsapp-chatbot-status-keyword-toggle"
            >
              <Text style={styles.toggleLabel}>STATUS</Text>
              <View style={[styles.switch, form.enabled && form.chatbot_enabled && form.chatbot_status_enabled && styles.switchOn]}>
                <View style={[styles.switchKnob, form.enabled && form.chatbot_enabled && form.chatbot_status_enabled && styles.switchKnobOn]} />
              </View>
            </Pressable>
          </View>
        </View>

        {/* ---------------- Gold Rate ---------------- */}
        <View style={[styles.groupCard, !form.enabled && { opacity: 0.5 }]}>
          <View style={styles.groupHeader}>
            <View style={styles.groupHeaderIcon}><Ionicons name="pricetag-outline" size={17} color={colors.brandSecondary} /></View>
            <Text style={styles.groupHeaderTitle}>Gold Rate</Text>
          </View>
          <Text style={styles.hint}>When the daily rate auto-fetches, and the margin added on top — fetching/sending itself happens on the Work tab.</Text>
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Fetch time (24h, IST)</Text>
              <TextInput value={fetchTime} onChangeText={setFetchTime} placeholder="12:30" placeholderTextColor={colors.mutedText} style={styles.input} testID="gold-rate-fetch-time" />
            </View>
          </View>
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Gold margin (₹, rounds to ₹50)</Text>
              <TextInput value={goldMargin} onChangeText={setGoldMargin} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} testID="gold-rate-gold-margin" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Silver margin (₹, rounds to ₹100)</Text>
              <TextInput value={silverMargin} onChangeText={setSilverMargin} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} testID="gold-rate-silver-margin" />
            </View>
          </View>
          <Pressable
            onPress={() => setSkipWeekendFetch((v) => !v)}
            style={styles.toggleRow}
            testID="gold-rate-skip-weekend-toggle"
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Skip Saturday &amp; Sunday</Text>
              <Text style={styles.toggleSub}>Commodity market is closed — don't fetch on weekends, and never auto-send even if a fetch happens anyway.</Text>
            </View>
            <View style={[styles.switch, skipWeekendFetch && styles.switchOn]}>
              <View style={[styles.switchKnob, skipWeekendFetch && styles.switchKnobOn]} />
            </View>
          </Pressable>

          <View style={styles.groupDivider} />
          <Text style={styles.fieldLabel}>Chatbot rate freshness</Text>
          <Text style={styles.hint}>Keeps a separate rate cache topped up through the day so RATE replies close to accurate, without disturbing the daily broadcast above.</Text>
          <Pressable
            onPress={() => setRefreshEnabled((v) => !v)}
            style={styles.toggleRow}
            testID="gold-rate-refresh-enabled-toggle"
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Auto-refresh for chatbot</Text>
              <Text style={styles.toggleSub}>Off means RATE always answers with whatever the daily broadcast last fetched</Text>
            </View>
            <View style={[styles.switch, refreshEnabled && styles.switchOn]}>
              <View style={[styles.switchKnob, refreshEnabled && styles.switchKnobOn]} />
            </View>
          </Pressable>
          <View style={[styles.row2, !refreshEnabled && { opacity: 0.5 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Every (minutes)</Text>
              <TextInput value={refreshInterval} onChangeText={setRefreshInterval} keyboardType="numeric" editable={refreshEnabled} placeholder="120" placeholderTextColor={colors.mutedText} style={styles.input} testID="gold-rate-refresh-interval" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>From</Text>
              <TextInput value={refreshStart} onChangeText={setRefreshStart} editable={refreshEnabled} placeholder="12:30" placeholderTextColor={colors.mutedText} style={styles.input} testID="gold-rate-refresh-start" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>To</Text>
              <TextInput value={refreshEnd} onChangeText={setRefreshEnd} editable={refreshEnabled} placeholder="19:00" placeholderTextColor={colors.mutedText} style={styles.input} testID="gold-rate-refresh-end" />
            </View>
          </View>

          <View style={styles.groupDivider} />
          <Pressable
            onPress={() => setAutoSendEnabled((v) => !v)}
            style={[styles.toggleRow, autoSendEnabled && styles.toggleRowWarn]}
            testID="gold-rate-auto-send-toggle"
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Fully automatic — fetch &amp; send daily, no review</Text>
              <Text style={styles.toggleSub}>Every day's fetch goes straight to the Channel with no confirm step. Off means the Work-tab screen always waits for Confirm &amp; Send.</Text>
            </View>
            <View style={[styles.switch, autoSendEnabled && styles.switchOn]}>
              <View style={[styles.switchKnob, autoSendEnabled && styles.switchKnobOn]} />
            </View>
          </Pressable>

          <Pressable onPress={saveGoldRateConfig} disabled={grSaving} style={[styles.altBtn, grSaving && { opacity: 0.6 }]} testID="gold-rate-save-config">
            {grSaving ? <ActivityIndicator color={colors.brandSecondary} size="small" /> : <Text style={styles.altBtnText}>Save Gold Rate Settings</Text>}
          </Pressable>
        </View>

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
