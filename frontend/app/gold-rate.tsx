import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, RefreshControl, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { confirmAction } from '@/src/utils/confirm';
import { istTime } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';

type Today = {
  date: string; gold_rate: number | null; silver_rate: number | null;
  fetched_gold: number | null; fetched_silver: number | null;
  gold_margin_applied: number | null; silver_margin_applied: number | null;
  fetched_at: string | null;
  error: string | null; manual: boolean; confirmed: boolean; sent_at: string | null; message: string | null;
} | null;
type Purity = { key: string; label: string; rate: number | null; enabled: boolean };
type Led = { config: { enabled: boolean; auto_push: boolean; template: string }; status: { last_push_at: string | null; last_ok: boolean | null; last_error: string | null } };

const DEFAULT_TEMPLATE = 'Today approx. rate update: \nGold 24k: {gold_rate} /tola\nSilver : {silver_rate} /kg\n\nClick bell icon above for notification \u{1F514}';
const inr = (n: number) => n.toLocaleString('en-IN');

// (date, time) in IST for {date}/{time} placeholders — mirrors the backend's
// format_ist_date_time() closely enough for a live preview; the message
// actually sent always comes from the backend-rendered `message` field.
function istDateTimeParts(iso?: string | null): { date: string; time: string } {
  const d = iso ? new Date(iso) : new Date();
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }).format(d).replace(/ /g, ' ');
  const time = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
  return { date, time };
}

// Renders the (possibly owner-edited, see Settings > WhatsApp) template
// client-side so editing a rate field can regenerate the message instantly,
// without a round trip.
function buildMessage(template: string, goldRate: number, silverRate: number, fetchedAt?: string | null): string {
  const { date, time } = istDateTimeParts(fetchedAt);
  const vals: Record<string, string> = { gold_rate: String(goldRate), silver_rate: String(silverRate), date, time };
  return (template || DEFAULT_TEMPLATE).replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m));
}

// Rate Updater — ONE rate for the whole shop. Fetch it once, adjust it if needed, then send the same
// numbers to every place that shows them: the WhatsApp Channel, the LED board (and the WhatsApp
// chatbot answers with it too). What each place looks like is set up in Settings.
export default function RateUpdaterScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchTime, setFetchTime] = useState('12:30');
  const [template, setTemplate] = useState('');
  const [channelConnected, setChannelConnected] = useState(false);
  const [today, setToday] = useState<Today>(null);
  const [goldRate, setGoldRate] = useState('');
  const [silverRate, setSilverRate] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<'fetch' | 'send' | 'fetchsend' | null>(null);
  const [led, setLed] = useState<Led | null>(null);
  const [toWhatsapp, setToWhatsapp] = useState(true);
  const [toLed, setToLed] = useState(true);
  const [purities, setPurities] = useState<Purity[]>([]);
  const [ledPreview, setLedPreview] = useState<string | null>(null);
  const [showMessage, setShowMessage] = useState(false);

  // `currentTemplate` is passed explicitly rather than read from the `template` state: this can run in the
  // same tick as setTemplate() (see load() below), whose update isn't visible yet in this closure.
  const applyToday = (doc: Today, currentTemplate: string) => {
    setToday(doc);
    setGoldRate(doc?.gold_rate != null ? String(doc.gold_rate) : '');
    setSilverRate(doc?.silver_rate != null ? String(doc.silver_rate) : '');
    // Regenerated from the CURRENT template rather than the stored `doc.message`, which is a snapshot
    // from whenever it was fetched and goes stale the moment the template is edited.
    setMessage(
      doc?.gold_rate != null && doc?.silver_rate != null
        ? buildMessage(currentTemplate, doc.gold_rate, doc.silver_rate, doc.fetched_at)
        : (doc?.message || ''),
    );
  };

  const load = async () => {
    try {
      const g = await api.get<any>('/settings/gold-rate');
      setFetchTime(g.fetch_time || '12:30');
      setTemplate(g.template || '');
      setChannelConnected(!!g.channel_connected);
      applyToday(g.today || null, g.template || '');
      api.get<Led>('/led-board').then((l) => { setLed(l); setToLed(l.config.enabled); }).catch(() => setLed(null));
    } catch (e: any) { toast.error(e?.detail || 'Could not load'); }
    finally { setLoading(false); setRefreshing(false); }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { if (!channelConnected) setToWhatsapp(false); }, [channelConnected]);

  const g = parseInt(goldRate, 10), s = parseInt(silverRate, 10);

  // What the rate works out to for each purity (Rate Master percentages) and what the board will show —
  // recomputed as the two rates are typed.
  const seq = useRef(0);
  useEffect(() => {
    if (!g || !s) { setPurities([]); setLedPreview(null); return; }
    const my = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const rm = await api.post<{ computed: Purity[] }>('/rate-master/preview', { items: [], gold: g, silver: s });
        if (my === seq.current) setPurities(rm.computed);
      } catch { /* keep last */ }
      try {
        if (led?.config.template) {
          const p = await api.post<{ text: string | null }>('/led-board/preview', { template: led.config.template, gold_rate: g, silver_rate: s });
          if (my === seq.current) setLedPreview(p.text);
        }
      } catch { /* ignore */ }
    }, 350);
    return () => clearTimeout(t);
  }, [goldRate, silverRate, led?.config.template]);

  // Editing either rate regenerates the message from the template — the message is derived from the rates,
  // not tracked separately, so it can never drift from what the two fields actually show.
  const onRateChange = (which: 'gold' | 'silver', v: string) => {
    const clean = v.replace(/\D/g, '');
    if (which === 'gold') setGoldRate(clean); else setSilverRate(clean);
    const gg = parseInt(which === 'gold' ? clean : goldRate, 10);
    const ss = parseInt(which === 'silver' ? clean : silverRate, 10);
    if (gg && ss) setMessage(buildMessage(template, gg, ss, today?.fetched_at));
  };

  const fetchRates = async (): Promise<any | null> => {
    const doc = await api.post<any>('/settings/gold-rate/refetch', {});
    applyToday(doc, template);
    if (doc.error) { toast.error(doc.error); return null; }
    return doc;
  };

  const doFetch = async () => {
    setBusy('fetch');
    try {
      const doc = await fetchRates();
      if (doc) toast.success(`Fetched — Gold ₹${inr(doc.gold_rate)}, Silver ₹${inr(doc.silver_rate)}`);
    } catch (e: any) { toast.error(e?.detail || 'Could not fetch'); }
    finally { setBusy(null); }
  };

  const destinations = [toWhatsapp && 'the WhatsApp Channel', toLed && led?.config.enabled && 'the LED board'].filter(Boolean) as string[];
  const canSend = !!g && !!s && (toWhatsapp || (toLed && !!led?.config.enabled)) && !busy;

  const sendPayload = (gold: number, silver: number, msg: string) => ({
    message: msg, gold_rate: gold, silver_rate: silver,
    whatsapp: toWhatsapp, led: toLed && led?.config.enabled ? true : false,
  });
  const report = (r: any) => {
    if (r?.led && !r.led.ok) toast.error(`Sent, but the LED board did not update: ${r.led.error}`);
    else toast.success(`Sent to ${destinations.join(' and ')}`);
  };

  const send = () => confirmAction(
    'Send the rate?',
    `Gold ₹${inr(g || 0)} · Silver ₹${inr(s || 0)}\n\nThis goes to ${destinations.join(' and ')}.${toWhatsapp ? ' Everyone following the Ram Murti Jewellers WhatsApp Channel will see it.' : ''}`,
    'Send',
    async () => {
      setBusy('send');
      try { report(await api.post('/settings/gold-rate/send', sendPayload(g, s, message))); load(); }
      catch (e: any) { toast.error(e?.detail || 'Could not send'); }
      finally { setBusy(null); }
    },
  );

  // One tap for when you trust today's number: fetch, then send to the same places.
  const fetchAndSend = () => confirmAction(
    'Fetch & send?',
    `Fetches today's rate and immediately sends it to ${destinations.join(' and ') || 'nowhere — pick a destination first'}.`,
    'Fetch & send',
    async () => {
      setBusy('fetchsend');
      try {
        const doc = await fetchRates();
        if (!doc) return;
        report(await api.post('/settings/gold-rate/send', sendPayload(doc.gold_rate, doc.silver_rate, doc.message)));
        load();
      } catch (e: any) { toast.error(e?.detail || 'Could not fetch and send'); }
      finally { setBusy(null); }
    },
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}><Ionicons name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
          <View style={{ flex: 1 }} /><View style={{ width: 40 }} />
        </View>
        <View style={styles.centered}><ActivityIndicator color={colors.brandPrimary} size="large" /></View>
      </SafeAreaView>
    );
  }

  const sourceLine = today?.error
    ? `Couldn't fetch: ${today.error}`
    : today?.gold_rate
      ? `${today.manual ? 'Entered by hand' : 'Fetched'}${today.fetched_at ? ` at ${istTime(today.fetched_at)}` : ''}${today.fetched_gold != null && (today.gold_margin_applied || today.silver_margin_applied) ? ` · margin added` : ''}`
      : `Not fetched yet today — fetches by itself at ${fetchTime} IST`;
  const statusOk = !!today?.sent_at || !!today?.confirmed;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="gold-rate-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}><Ionicons name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.title}>Rate Updater</Text>
        <Pressable onPress={load} style={styles.iconBtn} testID="gold-rate-refresh-btn" hitSlop={12}><Ionicons name="refresh" size={18} color={colors.onSurface} /></Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}>

        {/* ---- 1. The rate (one for everything) ---- */}
        <View style={styles.card} testID="ru-rates-card">
          <View style={styles.cardHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Today's rate</Text>
              <Text style={[styles.sub, today?.error && { color: colors.onError }]}>{sourceLine}</Text>
            </View>
            <Pressable onPress={doFetch} disabled={!!busy} style={[styles.fetchBtn, !!busy && { opacity: 0.6 }]} testID="gold-rate-refetch">
              {busy === 'fetch' ? <ActivityIndicator color={colors.brandSecondary} size="small" /> : <><Ionicons name="refresh" size={15} color={colors.brandSecondary} /><Text style={styles.fetchBtnText}>Fetch</Text></>}
            </Pressable>
          </View>

          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Gold 24K (₹)</Text>
              <TextInput value={goldRate} onChangeText={(v) => onRateChange('gold', v)} keyboardType="numeric" placeholder="e.g. 151050" placeholderTextColor={colors.mutedText} style={styles.input} testID="gold-rate-gold-input" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Silver 99.99 (₹)</Text>
              <TextInput value={silverRate} onChangeText={(v) => onRateChange('silver', v)} keyboardType="numeric" placeholder="e.g. 242200" placeholderTextColor={colors.mutedText} style={styles.input} testID="gold-rate-silver-input" />
            </View>
          </View>

          {purities.filter((p) => p.enabled && p.rate).length ? (
            <View style={styles.purityRow} testID="ru-purities">
              {purities.filter((p) => p.enabled && p.rate && p.key !== 'gold_24k' && p.key !== 'silver_9999').map((p) => (
                <View key={p.key} style={styles.purityChip}><Text style={styles.purityLabel}>{p.label}</Text><Text style={styles.purityVal}>₹{inr(p.rate as number)}</Text></View>
              ))}
            </View>
          ) : null}
          <Text style={styles.hint}>This one rate is used everywhere — the WhatsApp Channel, the LED board and the WhatsApp chatbot. Other purities follow the percentages in Settings › Rate Master.</Text>
        </View>

        {/* ---- 2. Where it goes ---- */}
        <View style={styles.card} testID="ru-send-card">
          <Text style={styles.cardTitle}>Send to</Text>

          <View style={styles.destRow}>
            <Ionicons name="logo-whatsapp" size={20} color={colors.brandSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.destTitle}>WhatsApp Channel</Text>
              <Text style={styles.sub}>{channelConnected ? 'Connected' : 'Not connected — check Settings › WhatsApp'}</Text>
            </View>
            <Switch value={toWhatsapp} onValueChange={setToWhatsapp} disabled={!channelConnected} trackColor={{ true: colors.brandPrimary, false: colors.border }} thumbColor={colors.surface} testID="ru-to-whatsapp" />
          </View>
          {toWhatsapp ? (
            <View style={styles.destBody}>
              <Pressable onPress={() => setShowMessage((v) => !v)} hitSlop={6}><Text style={styles.link}>{showMessage ? 'Hide message' : 'Preview / edit message'}</Text></Pressable>
              {showMessage ? <TextInput value={message} onChangeText={setMessage} multiline style={[styles.input, styles.inputMultiline]} testID="gold-rate-message" /> : null}
            </View>
          ) : null}

          <View style={styles.divider} />

          <View style={styles.destRow}>
            <Ionicons name="tv-outline" size={20} color={colors.brandSecondary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.destTitle}>LED rate board</Text>
              <Text style={styles.sub}>
                {!led ? '…' : !led.config.enabled ? 'Switched off in Settings › LED Rate Board'
                  : led.status.last_push_at ? (led.status.last_ok ? `Last updated ${istTime(led.status.last_push_at)}` : `Last update failed: ${led.status.last_error}`) : 'Not updated yet'}
              </Text>
            </View>
            <Switch value={toLed && !!led?.config.enabled} onValueChange={setToLed} disabled={!led?.config.enabled} trackColor={{ true: colors.brandPrimary, false: colors.border }} thumbColor={colors.surface} testID="ru-to-led" />
          </View>
          {toLed && led?.config.enabled && ledPreview ? <Text style={styles.destBody}>Board shows: <Text style={{ fontWeight: '800', color: colors.onSurface }}>{ledPreview}</Text></Text> : null}

          <View style={styles.row2}>
            <Pressable onPress={send} disabled={!canSend} style={[styles.sendBtn, { flex: 1 }, !canSend && { opacity: 0.5 }]} testID="gold-rate-send">
              {busy === 'send' ? <ActivityIndicator color={colors.onBrandPrimary} size="small" /> : <><Ionicons name="paper-plane-outline" size={16} color={colors.onBrandPrimary} /><Text style={styles.sendBtnText}>Send</Text></>}
            </Pressable>
            <Pressable onPress={fetchAndSend} disabled={!!busy || !destinations.length} style={[styles.altBtn, { flex: 1 }, (!!busy || !destinations.length) && { opacity: 0.5 }]} testID="gold-rate-fetch-and-send">
              {busy === 'fetchsend' ? <ActivityIndicator color={colors.brandSecondary} size="small" /> : <><Ionicons name="flash" size={15} color={colors.brandSecondary} /><Text style={styles.altBtnText}>Fetch &amp; send</Text></>}
            </Pressable>
          </View>
          {statusOk ? (
            <Text style={styles.done}>✔ Sent today{today?.sent_at ? ` at ${istTime(today.sent_at)}` : ''}</Text>
          ) : g && s ? <Text style={styles.hint}>Not sent yet today.</Text> : null}
        </View>

        {/* ---- 3. Where each place is set up ---- */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Settings</Text>
          <Pressable onPress={() => router.push('/settings/rate-master' as any)} hitSlop={6}><Text style={styles.link}>Rate Master — fetch time, margin, automatic send, purity percentages</Text></Pressable>
          <Pressable onPress={() => router.push('/settings/led-board' as any)} hitSlop={6}><Text style={styles.link}>LED Rate Board — connection, text, templates</Text></Pressable>
          <Pressable onPress={() => router.push('/settings/whatsapp-templates' as any)} hitSlop={6}><Text style={styles.link}>WhatsApp Messages — the broadcast text</Text></Pressable>
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
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md, gap: 6 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardTitle: { color: colors.onSurface, fontSize: 16, fontWeight: '800' },
  sub: { color: colors.mutedText, fontSize: 12 },
  hint: { color: colors.mutedText, fontSize: 12, marginTop: 2 },
  done: { color: colors.success, fontSize: 12.5, fontWeight: '700', marginTop: 4 },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600', marginTop: spacing.sm, marginBottom: 4 },
  row2: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 16, fontWeight: '700' },
  inputMultiline: { minHeight: 110, textAlignVertical: 'top', fontSize: 14, fontWeight: '400', marginTop: 6 },
  fetchBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.brandSecondary },
  fetchBtnText: { color: colors.brandSecondary, fontWeight: '700', fontSize: 13 },
  purityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: spacing.sm },
  purityChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  purityLabel: { color: colors.mutedText, fontSize: 11.5, fontWeight: '600' },
  purityVal: { color: colors.onSurface, fontSize: 12.5, fontWeight: '800' },
  destRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 4 },
  destTitle: { color: colors.onSurface, fontSize: 14.5, fontWeight: '700' },
  destBody: { color: colors.mutedText, fontSize: 12.5, paddingLeft: 32 },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: 6 },
  sendBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14 },
  sendBtnText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 14.5 },
  altBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brandSecondary, paddingVertical: 14 },
  altBtnText: { color: colors.brandSecondary, fontWeight: '700', fontSize: 13.5 },
  link: { color: colors.brandPrimary, fontSize: 13, fontWeight: '600', marginTop: 4 },
});
