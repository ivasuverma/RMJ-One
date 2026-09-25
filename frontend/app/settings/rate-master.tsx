import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Switch, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';

type Daily = {
  gold_margin: string; silver_margin: string;
  gold_buy_margin: string; silver_buy_margin: string;
  skip_weekend_fetch: boolean; auto_send_enabled: boolean; auto_send_time: string;
  refresh_enabled: boolean; refresh_interval_min: string; refresh_start: string; refresh_end: string;
};
const DAILY_DEFAULT: Daily = {
  gold_margin: '0', silver_margin: '0', gold_buy_margin: '0', silver_buy_margin: '0',
  skip_weekend_fetch: true, auto_send_enabled: false, auto_send_time: '12:30',
  refresh_enabled: true, refresh_interval_min: '120', refresh_start: '12:30', refresh_end: '19:00',
};
type LiveDebug = {
  fetched_at: string | null; error: string | null;
  fetched_gold: number | null; fetched_silver: number | null;
  gold_row_text: string | null; silver_row_text: string | null;
  xau_row_text: string | null; xag_row_text: string | null;
} | null;

const inr = (n: number) => n.toLocaleString('en-IN');

export default function RateMasterScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Daily rate settings (when to fetch, the margin on top, automatic sending, chatbot freshness). The
  // broadcast message template is carried through untouched.
  const [daily, setDaily] = useState<Daily>(DAILY_DEFAULT);
  const [broadcastTemplate, setBroadcastTemplate] = useState('');
  const [dailyDirty, setDailyDirty] = useState(false);
  const [dailySaving, setDailySaving] = useState(false);
  const [live, setLive] = useState<LiveDebug>(null);
  const [refetching, setRefetching] = useState(false);

  const load = useCallback(async () => {
    try {
      const g = await api.get<any>('/settings/gold-rate');
      setBroadcastTemplate(g.template || '');
      setDaily({
        gold_margin: String(g.gold_margin ?? 0), silver_margin: String(g.silver_margin ?? 0),
        gold_buy_margin: String(g.gold_buy_margin ?? 0), silver_buy_margin: String(g.silver_buy_margin ?? 0),
        skip_weekend_fetch: g.skip_weekend_fetch !== false, auto_send_enabled: g.auto_send_enabled === true,
        auto_send_time: g.auto_send_time || '12:30',
        refresh_enabled: g.refresh_enabled !== false, refresh_interval_min: String(g.refresh_interval_min ?? 120),
        refresh_start: g.refresh_start || '12:30', refresh_end: g.refresh_end || '19:00',
      });
      setDailyDirty(false);
      setLive(g.live || null);
    } catch (e: any) { toast.error(e?.detail || 'Could not load'); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const setD = (p: Partial<Daily>) => { setDaily((d) => ({ ...d, ...p })); setDailyDirty(true); };
  const saveDaily = async () => {
    setDailySaving(true);
    try {
      await api.put('/settings/gold-rate/config', {
        gold_margin: parseInt(daily.gold_margin, 10) || 0, silver_margin: parseInt(daily.silver_margin, 10) || 0,
        gold_buy_margin: parseInt(daily.gold_buy_margin, 10) || 0, silver_buy_margin: parseInt(daily.silver_buy_margin, 10) || 0,
        template: broadcastTemplate || undefined, skip_weekend_fetch: daily.skip_weekend_fetch,
        auto_send_enabled: daily.auto_send_enabled, auto_send_time: daily.auto_send_time,
        refresh_enabled: daily.refresh_enabled, refresh_interval_min: parseInt(daily.refresh_interval_min, 10) || 120,
        refresh_start: daily.refresh_start, refresh_end: daily.refresh_end,
      });
      toast.success('Daily rate settings saved'); setDailyDirty(false);
    } catch (e: any) { toast.error(e?.detail || 'Could not save'); }
    finally { setDailySaving(false); }
  };
  const refetchNow = async () => {
    setRefetching(true);
    try {
      await api.post('/settings/gold-rate/refetch');
      toast.success('Refetched');
      await load();
    } catch (e: any) { toast.error(e?.detail || 'Refetch failed'); }
    finally { setRefetching(false); }
  };

  if (loading) return <SafeAreaView style={styles.centered}><ActivityIndicator color={colors.brandPrimary} /></SafeAreaView>;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="rate-master-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} hitSlop={12} testID="back-btn" accessibilityRole="button" accessibilityLabel="Back"><Ionicons name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.title}>Rate Master</Text>
        <Pressable onPress={load} style={styles.iconBtn} hitSlop={12}><Ionicons name="refresh" size={18} color={colors.onSurface} /></Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}>

        <View style={styles.card} testID="rm-daily-card">
          <Text style={styles.cardTitle}>Auto-fetch schedule</Text>
          <Text style={styles.hint}>
            One shared refresh schedule for the WhatsApp broadcast draft, the RATE chatbot reply, the public rates
            page, and the dashboard tile. Fetches every N minutes in the window below — once you confirm or send
            today's rate, it stops touching that draft for the rest of the day, but keeps the others fresh. If
            "Fully automatic" below is on, the actual send still only happens once a day, at its own time.
          </Text>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}><Text style={styles.label}>Auto-fetch enabled</Text></View>
            <Switch value={daily.refresh_enabled} onValueChange={(v) => setD({ refresh_enabled: v })} disabled={!isOwner} trackColor={{ true: colors.brandPrimary, false: colors.border }} thumbColor={colors.surface} {...({ activeThumbColor: colors.surface } as object)} testID="gold-rate-refresh-enabled-toggle" />
          </View>
          <View style={[styles.row2, !daily.refresh_enabled && { opacity: 0.5 }]}>
            <View style={{ flex: 1 }}><Text style={styles.label}>Every (minutes)</Text><TextInput value={daily.refresh_interval_min} onChangeText={(v) => setD({ refresh_interval_min: v.replace(/\D/g, '') })} editable={isOwner && daily.refresh_enabled} keyboardType="numeric" style={styles.input} testID="gold-rate-refresh-interval" /></View>
            <View style={{ flex: 1 }}><Text style={styles.label}>From</Text><TextInput value={daily.refresh_start} onChangeText={(v) => setD({ refresh_start: v })} editable={isOwner && daily.refresh_enabled} placeholder="12:30" placeholderTextColor={colors.mutedText} style={styles.input} testID="gold-rate-refresh-start" /></View>
            <View style={{ flex: 1 }}><Text style={styles.label}>To</Text><TextInput value={daily.refresh_end} onChangeText={(v) => setD({ refresh_end: v })} editable={isOwner && daily.refresh_enabled} placeholder="19:00" placeholderTextColor={colors.mutedText} style={styles.input} testID="gold-rate-refresh-end" /></View>
          </View>
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Gold margin (₹, rounds to ₹50)</Text>
              <TextInput value={daily.gold_margin} onChangeText={(v) => setD({ gold_margin: v.replace(/[^0-9\-]/g, '') })} editable={isOwner} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} testID="gold-rate-gold-margin" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Silver margin (₹, rounds to ₹100)</Text>
              <TextInput value={daily.silver_margin} onChangeText={(v) => setD({ silver_margin: v.replace(/[^0-9\-]/g, '') })} editable={isOwner} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} testID="gold-rate-silver-margin" />
            </View>
          </View>
          <Text style={styles.hint}>Buyback rate (shown on the public rates page) is the sell rate above minus this spread — independent of the margins above.</Text>
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Gold buyback spread (₹)</Text>
              <TextInput value={daily.gold_buy_margin} onChangeText={(v) => setD({ gold_buy_margin: v.replace(/[^0-9\-]/g, '') })} editable={isOwner} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} testID="gold-rate-gold-buy-margin" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Silver buyback spread (₹)</Text>
              <TextInput value={daily.silver_buy_margin} onChangeText={(v) => setD({ silver_buy_margin: v.replace(/[^0-9\-]/g, '') })} editable={isOwner} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} testID="gold-rate-silver-buy-margin" />
            </View>
          </View>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}><Text style={styles.label}>Skip Sunday</Text><Text style={styles.hint}>The market is closed — no fetch on Sunday, and never an automatic send.</Text></View>
            <Switch value={daily.skip_weekend_fetch} onValueChange={(v) => setD({ skip_weekend_fetch: v })} disabled={!isOwner} trackColor={{ true: colors.brandPrimary, false: colors.border }} thumbColor={colors.surface} {...({ activeThumbColor: colors.surface } as object)} testID="gold-rate-skip-weekend-toggle" />
          </View>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}><Text style={styles.label}>Fully automatic — fetch &amp; send daily</Text><Text style={styles.hint}>Sends once a day, at the time below, straight out with no review. Off means it waits for you on the Rate Updater screen.</Text></View>
            <Switch value={daily.auto_send_enabled} onValueChange={(v) => setD({ auto_send_enabled: v })} disabled={!isOwner} trackColor={{ true: colors.brandPrimary, false: colors.border }} thumbColor={colors.surface} {...({ activeThumbColor: colors.surface } as object)} testID="gold-rate-auto-send-toggle" />
          </View>
          {daily.auto_send_enabled && (
            <View style={{ flex: 1, maxWidth: 160 }}>
              <Text style={styles.label}>Send time (24h, IST)</Text>
              <TextInput value={daily.auto_send_time} onChangeText={(v) => setD({ auto_send_time: v })} editable={isOwner} placeholder="12:30" placeholderTextColor={colors.mutedText} style={styles.input} testID="gold-rate-auto-send-time" />
            </View>
          )}

          {isOwner ? (
            <Pressable onPress={saveDaily} disabled={dailySaving || !dailyDirty} style={[styles.primaryBtn, (dailySaving || !dailyDirty) && { opacity: 0.5 }]} testID="gold-rate-save-config">
              {dailySaving ? <ActivityIndicator color={colors.onBrandPrimary} size="small" /> : <Text style={styles.primaryBtnText}>{dailyDirty ? 'Save daily rate settings' : 'Saved'}</Text>}
            </Pressable>
          ) : null}
        </View>

        <View style={styles.card} testID="rm-diagnostics-card">
          <View style={styles.rowHead}>
            <Text style={styles.cardTitle}>Last scrape (diagnostics)</Text>
            {isOwner && (
              <Pressable onPress={refetchNow} disabled={refetching} style={styles.iconBtn} hitSlop={10} testID="gold-rate-refetch-now">
                {refetching ? <ActivityIndicator color={colors.onSurface} size="small" /> : <Ionicons name="cloud-download-outline" size={17} color={colors.onSurface} />}
              </Pressable>
            )}
          </View>
          <Text style={styles.hint}>
            What was actually read off the source page last time — useful when a rate looks stuck or wrong. Tap the
            icon to refetch right now.
          </Text>
          {!live ? (
            <Text style={styles.hint}>No scrape recorded yet.</Text>
          ) : (
            <>
              <Text style={styles.hint}>
                {live.fetched_at ? new Date(live.fetched_at).toLocaleString() : 'Never'}
                {live.error ? ` — failed: ${live.error}` : ''}
              </Text>
              <Text style={styles.label}>Gold {live.fetched_gold != null ? `→ ₹${inr(live.fetched_gold)}` : ''}</Text>
              <Text style={styles.diagText}>{live.gold_row_text || '—'}</Text>
              <Text style={styles.label}>Silver {live.fetched_silver != null ? `→ ₹${inr(live.fetched_silver)}` : ''}</Text>
              <Text style={styles.diagText}>{live.silver_row_text || '—'}</Text>
              <Text style={styles.label}>Gold spot (XAU)</Text>
              <Text style={styles.diagText}>{live.xau_row_text || '—'}</Text>
              <Text style={styles.label}>Silver spot (XAG)</Text>
              <Text style={styles.diagText}>{live.xag_row_text || '—'}</Text>
            </>
          )}
        </View>

        <Pressable onPress={() => router.push('/settings/rate-formulas' as any)} style={styles.navRow} testID="rm-formulas-link">
          <View style={styles.navIcon}><Ionicons name="calculator-outline" size={20} color={colors.brandSecondary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Purity Formulas</Text>
            <Text style={styles.hint}>22K, 18K, 14K and silver rates as a % of the daily rate</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Related settings</Text>
          <Pressable onPress={() => router.push('/settings/whatsapp-templates' as any)} hitSlop={6}><Text style={styles.link}>The WhatsApp message text → Settings › WhatsApp Messages</Text></Pressable>
          <Pressable onPress={() => router.push('/settings/led-board' as any)} hitSlop={6}><Text style={styles.link}>Show these rates on the shop display → Settings › LED Rate Board</Text></Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  centered: { flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '600', fontFamily: fonts.display, textAlign: 'center' },
  infoBox: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  infoText: { color: colors.onSurfaceTertiary, fontSize: 12, flex: 1, lineHeight: 18 },
  code: { fontFamily: 'monospace', color: colors.brandPrimary, fontWeight: '700' },
  diagText: { fontFamily: 'monospace', color: colors.onSurfaceSecondary, fontSize: 11.5, lineHeight: 16 },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md },
  navIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md, gap: 4 },
  cardTitle: { color: colors.onSurface, fontSize: 15, fontWeight: '800' },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  result: { color: colors.onSurface, fontSize: 20, fontWeight: '800' },
  hint: { color: colors.mutedText, fontSize: 12 },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600', marginTop: spacing.sm, marginBottom: 4 },
  row2: { flexDirection: 'row', gap: spacing.sm },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 11, fontSize: 14 },
  inputBad: { borderColor: colors.onError },
  err: { color: colors.onError, fontSize: 12, marginTop: 2 },
  seg: { flexDirection: 'row', gap: 6 },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  segOn: { backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary },
  segText: { color: colors.mutedText, fontSize: 12.5, fontWeight: '600' },
  segTextOn: { color: colors.brandPrimary },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  link: { color: colors.brandPrimary, fontSize: 12.5, fontWeight: '600', marginTop: 6 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, marginTop: spacing.sm },
  primaryBtnText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 14 },
});
