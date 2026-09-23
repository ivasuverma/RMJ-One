import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Switch, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';

// Server shape
type ServerItem = { key: string; label: string; base: 'gold' | 'silver'; percent: number; enabled: boolean };
// Editing shape: the percentage is kept as text while typing so "91." doesn't get mangled.
type Item = { key: string; label: string; base: 'gold' | 'silver'; percent: string; enabled: boolean };
type Computed = { key: string; rate: number | null; error: string | null; base_value: number };
type State = { items: ServerItem[]; base: { gold: number; silver: number; date: string } | null; defaults: ServerItem[]; computed: Computed[] };

type Daily = {
  fetch_time: string; gold_margin: string; silver_margin: string;
  gold_buy_margin: string; silver_buy_margin: string;
  skip_weekend_fetch: boolean; auto_send_enabled: boolean;
  chatbot_refresh_enabled: boolean; chatbot_refresh_interval_min: string; chatbot_refresh_start: string; chatbot_refresh_end: string;
};
const DAILY_DEFAULT: Daily = {
  fetch_time: '12:30', gold_margin: '0', silver_margin: '0', gold_buy_margin: '0', silver_buy_margin: '0',
  skip_weekend_fetch: true, auto_send_enabled: false,
  chatbot_refresh_enabled: true, chatbot_refresh_interval_min: '120', chatbot_refresh_start: '12:30', chatbot_refresh_end: '19:00',
};
const inr = (n: number) => n.toLocaleString('en-IN');
const toEdit = (i: ServerItem): Item => ({ key: i.key, label: i.label, base: i.base, percent: String(i.percent), enabled: i.enabled });
const toServer = (i: Item) => ({ key: i.key, label: i.label, percent: parseFloat(i.percent) || 0, enabled: i.enabled });

export default function RateMasterScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';

  const [items, setItems] = useState<Item[]>([]);
  const [defaults, setDefaults] = useState<ServerItem[]>([]);
  const [base, setBase] = useState<State['base']>(null);
  const [computed, setComputed] = useState<Computed[]>([]);
  const [tryGold, setTryGold] = useState('');
  const [trySilver, setTrySilver] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  // Daily rate settings (when to fetch, the margin on top, automatic sending, chatbot freshness). Saved
  // separately from the percentages; the broadcast message template is carried through untouched.
  const [daily, setDaily] = useState<Daily>(DAILY_DEFAULT);
  const [broadcastTemplate, setBroadcastTemplate] = useState('');
  const [dailyDirty, setDailyDirty] = useState(false);
  const [dailySaving, setDailySaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api.get<State>('/rate-master');
      setItems(s.items.map(toEdit)); setDefaults(s.defaults); setBase(s.base); setComputed(s.computed); setDirty(false);
      setTryGold(s.base ? String(s.base.gold) : ''); setTrySilver(s.base ? String(s.base.silver) : '');
      try {
        const g = await api.get<any>('/settings/gold-rate');
        setBroadcastTemplate(g.template || '');
        setDaily({
          fetch_time: g.fetch_time || '12:30', gold_margin: String(g.gold_margin ?? 0), silver_margin: String(g.silver_margin ?? 0),
          gold_buy_margin: String(g.gold_buy_margin ?? 0), silver_buy_margin: String(g.silver_buy_margin ?? 0),
          skip_weekend_fetch: g.skip_weekend_fetch !== false, auto_send_enabled: g.auto_send_enabled === true,
          chatbot_refresh_enabled: g.chatbot_refresh_enabled !== false, chatbot_refresh_interval_min: String(g.chatbot_refresh_interval_min ?? 120),
          chatbot_refresh_start: g.chatbot_refresh_start || '12:30', chatbot_refresh_end: g.chatbot_refresh_end || '19:00',
        });
        setDailyDirty(false);
      } catch { /* leave the defaults */ }
    } catch (e: any) { toast.error(e?.detail || 'Could not load'); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Live results for whatever is typed (saved or not), against the base rates shown above.
  const seq = useRef(0);
  useEffect(() => {
    if (loading || !items.length) return;
    const g = parseInt(tryGold, 10), s = parseInt(trySilver, 10);
    if (!g || !s) { setComputed([]); return; }
    const my = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await api.post<{ computed: Computed[] }>('/rate-master/preview', { items: items.map(toServer), gold: g, silver: s });
        if (my === seq.current) setComputed(r.computed);
      } catch { /* keep the last results */ }
    }, 350);
    return () => clearTimeout(t);
  }, [items, tryGold, trySilver, loading]);

  const patch = (key: string, p: Partial<Item>) => { setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...p } : i))); setDirty(true); };
  const resetOne = (key: string) => { const d = defaults.find((x) => x.key === key); if (d) patch(key, toEdit(d)); };
  const setD = (p: Partial<Daily>) => { setDaily((d) => ({ ...d, ...p })); setDailyDirty(true); };
  const saveDaily = async () => {
    setDailySaving(true);
    try {
      await api.put('/settings/gold-rate/config', {
        fetch_time: daily.fetch_time, gold_margin: parseInt(daily.gold_margin, 10) || 0, silver_margin: parseInt(daily.silver_margin, 10) || 0,
        gold_buy_margin: parseInt(daily.gold_buy_margin, 10) || 0, silver_buy_margin: parseInt(daily.silver_buy_margin, 10) || 0,
        template: broadcastTemplate || undefined, skip_weekend_fetch: daily.skip_weekend_fetch, auto_send_enabled: daily.auto_send_enabled,
        chatbot_refresh_enabled: daily.chatbot_refresh_enabled, chatbot_refresh_interval_min: parseInt(daily.chatbot_refresh_interval_min, 10) || 120,
        chatbot_refresh_start: daily.chatbot_refresh_start, chatbot_refresh_end: daily.chatbot_refresh_end,
      });
      toast.success('Daily rate settings saved'); setDailyDirty(false);
    } catch (e: any) { toast.error(e?.detail || 'Could not save'); }
    finally { setDailySaving(false); }
  };
  const save = async () => {
    setSaving(true);
    try { await api.put('/rate-master', { items: items.map(toServer) }); toast.success('Rate master saved'); await load(); }
    catch (e: any) { toast.error(e?.detail || 'Could not save'); }
    finally { setSaving(false); }
  };

  if (loading) return <SafeAreaView style={styles.centered}><ActivityIndicator color={colors.brandPrimary} /></SafeAreaView>;
  const byKey = Object.fromEntries(computed.map((c) => [c.key, c]));
  const changedBase = !!base && (String(base.gold) !== tryGold || String(base.silver) !== trySilver);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="rate-master-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} hitSlop={12} testID="back-btn"><Ionicons name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.title}>Rate Master</Text>
        <Pressable onPress={load} style={styles.iconBtn} hitSlop={12}><Ionicons name="refresh" size={18} color={colors.onSurface} /></Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}>

        <View style={styles.card} testID="rm-daily-card">
          <Text style={styles.cardTitle}>Daily rate</Text>
          <Text style={styles.hint}>How the base gold and silver rate is fetched each day. Sending it is done on the Rate Updater screen.</Text>
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Fetch time (24h, IST)</Text>
              <TextInput value={daily.fetch_time} onChangeText={(v) => setD({ fetch_time: v })} editable={isOwner} placeholder="12:30" placeholderTextColor={colors.mutedText} style={styles.input} testID="gold-rate-fetch-time" />
            </View>
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
            <View style={{ flex: 1 }}><Text style={styles.label}>Skip Saturday &amp; Sunday</Text><Text style={styles.hint}>The market is closed — no fetch on weekends, and never an automatic send.</Text></View>
            <Switch value={daily.skip_weekend_fetch} onValueChange={(v) => setD({ skip_weekend_fetch: v })} disabled={!isOwner} trackColor={{ true: colors.brandPrimary, false: colors.border }} thumbColor={colors.surface} testID="gold-rate-skip-weekend-toggle" />
          </View>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}><Text style={styles.label}>Fully automatic — fetch &amp; send daily</Text><Text style={styles.hint}>Each day's fetch goes straight out, with no review. Off means it waits for you on the Rate Updater screen.</Text></View>
            <Switch value={daily.auto_send_enabled} onValueChange={(v) => setD({ auto_send_enabled: v })} disabled={!isOwner} trackColor={{ true: colors.brandPrimary, false: colors.border }} thumbColor={colors.surface} testID="gold-rate-auto-send-toggle" />
          </View>

          <Text style={[styles.cardTitle, { marginTop: spacing.md }]}>Chatbot rate freshness</Text>
          <Text style={styles.hint}>Keeps the rate the WhatsApp chatbot quotes topped up through the day, until you confirm today's rate.</Text>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}><Text style={styles.label}>Auto-refresh for the chatbot</Text></View>
            <Switch value={daily.chatbot_refresh_enabled} onValueChange={(v) => setD({ chatbot_refresh_enabled: v })} disabled={!isOwner} trackColor={{ true: colors.brandPrimary, false: colors.border }} thumbColor={colors.surface} testID="gold-rate-refresh-enabled-toggle" />
          </View>
          <View style={[styles.row2, !daily.chatbot_refresh_enabled && { opacity: 0.5 }]}>
            <View style={{ flex: 1 }}><Text style={styles.label}>Every (minutes)</Text><TextInput value={daily.chatbot_refresh_interval_min} onChangeText={(v) => setD({ chatbot_refresh_interval_min: v.replace(/\D/g, '') })} editable={isOwner && daily.chatbot_refresh_enabled} keyboardType="numeric" style={styles.input} testID="gold-rate-refresh-interval" /></View>
            <View style={{ flex: 1 }}><Text style={styles.label}>From</Text><TextInput value={daily.chatbot_refresh_start} onChangeText={(v) => setD({ chatbot_refresh_start: v })} editable={isOwner && daily.chatbot_refresh_enabled} placeholder="12:30" placeholderTextColor={colors.mutedText} style={styles.input} testID="gold-rate-refresh-start" /></View>
            <View style={{ flex: 1 }}><Text style={styles.label}>To</Text><TextInput value={daily.chatbot_refresh_end} onChangeText={(v) => setD({ chatbot_refresh_end: v })} editable={isOwner && daily.chatbot_refresh_enabled} placeholder="19:00" placeholderTextColor={colors.mutedText} style={styles.input} testID="gold-rate-refresh-end" /></View>
          </View>

          {isOwner ? (
            <Pressable onPress={saveDaily} disabled={dailySaving || !dailyDirty} style={[styles.primaryBtn, (dailySaving || !dailyDirty) && { opacity: 0.5 }]} testID="gold-rate-save-config">
              {dailySaving ? <ActivityIndicator color={colors.onBrandPrimary} size="small" /> : <Text style={styles.primaryBtnText}>{dailyDirty ? 'Save daily rate settings' : 'Saved'}</Text>}
            </Pressable>
          ) : null}
        </View>

        <View style={styles.infoBox}>
          <Ionicons name="calculator-outline" size={16} color={colors.brandSecondary} />
          <Text style={styles.infoText}>Each rate is a percentage of the rate you confirm every day — for example 18K = 75% of the 24K rate. Gold purities use the 24K rate, silver uses the silver rate. The margin (₹ added or subtracted) is set above, with the daily rate. Results here are rounded the same way as the base rate (gold to ₹50, silver to ₹100).</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Try with these rates</Text>
          <Text style={styles.hint}>{base ? `Filled with the latest confirmed rates (${base.date}). Change them to test — nothing is saved.` : 'No rate confirmed yet — enter two rates to see the results.'}</Text>
          <View style={styles.row2}>
            <View style={{ flex: 1 }}><Text style={styles.label}>Gold 24K</Text><TextInput value={tryGold} onChangeText={setTryGold} keyboardType="numeric" style={styles.input} testID="rm-try-gold" /></View>
            <View style={{ flex: 1 }}><Text style={styles.label}>Silver</Text><TextInput value={trySilver} onChangeText={setTrySilver} keyboardType="numeric" style={styles.input} testID="rm-try-silver" /></View>
          </View>
          {changedBase && base ? <Pressable onPress={() => { setTryGold(String(base.gold)); setTrySilver(String(base.silver)); }}><Text style={styles.link}>Use the confirmed rates again</Text></Pressable> : null}
        </View>

        {items.map((it) => {
          const c = byKey[it.key];
          const def = defaults.find((d) => d.key === it.key);
          const isDefault = !!def && String(def.percent) === it.percent;
          const baseName = it.base === 'gold' ? '24K rate' : 'silver rate';
          const pct = parseFloat(it.percent);
          return (
            <View key={it.key} style={[styles.card, !it.enabled && { opacity: 0.6 }]} testID={`rm-item-${it.key}`}>
              <View style={styles.rowHead}>
                <Text style={styles.cardTitle}>{it.label}</Text>
                <Text style={[styles.result, c?.error && { color: colors.onError }]}>{c && c.rate ? `₹${inr(c.rate)}` : '—'}</Text>
              </View>
              {c?.base_value && pct ? (
                <Text style={styles.hint}>{pct}% of ₹{inr(c.base_value)}</Text>
              ) : null}

              <Text style={styles.label}>% of the {baseName}</Text>
              <TextInput value={it.percent} onChangeText={(v) => patch(it.key, { percent: v.replace(/[^0-9.]/g, '') })} editable={isOwner} keyboardType="decimal-pad"
                style={[styles.input, c?.error ? styles.inputBad : null]} placeholder="e.g. 75" placeholderTextColor={colors.mutedText} testID={`rm-percent-${it.key}`} />
              {c?.error ? <Text style={styles.err}>{c.error}</Text> : null}

              <View style={styles.switchRow}>
                <Text style={[styles.hint, { flex: 1 }]}>Show this rate (LED board placeholder: <Text style={styles.code}>{`{${it.key}}`}</Text>)</Text>
                <Switch value={it.enabled} onValueChange={(v) => patch(it.key, { enabled: v })} disabled={!isOwner} trackColor={{ true: colors.brandPrimary, false: colors.border }} thumbColor={colors.surface} />
              </View>
              {!isDefault && isOwner && def ? <Pressable onPress={() => resetOne(it.key)}><Text style={styles.link}>Reset to standard ({def.percent}%)</Text></Pressable> : null}
            </View>
          );
        })}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Related settings</Text>
          <Pressable onPress={() => router.push('/settings/whatsapp-templates' as any)} hitSlop={6}><Text style={styles.link}>The WhatsApp message text → Settings › WhatsApp Messages</Text></Pressable>
          <Pressable onPress={() => router.push('/settings/led-board' as any)} hitSlop={6}><Text style={styles.link}>Show these rates on the shop display → Settings › LED Rate Board</Text></Pressable>
        </View>

        {isOwner ? (
          <Pressable onPress={save} disabled={saving || !dirty} style={[styles.primaryBtn, (saving || !dirty) && { opacity: 0.5 }]} testID="rm-save">
            {saving ? <ActivityIndicator color={colors.onBrandPrimary} size="small" /> : <Text style={styles.primaryBtnText}>{dirty ? 'Save' : 'Saved'}</Text>}
          </Pressable>
        ) : <Text style={styles.hint}>Only the owner can change these.</Text>}
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
