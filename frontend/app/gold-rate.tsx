import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput } from 'react-native';
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
  error: string | null; manual: boolean; confirmed: boolean; sent_at: string | null; message: string | null;
} | null;

// Mirrors gold_rate.default_message() in the backend exactly — kept in sync
// here so editing a rate field can regenerate the message instantly, without
// a round trip.
function buildMessage(goldRate: number, silverRate: number): string {
  return `Today approx. rate update: \nGold 24k: ${goldRate} /tola\nSilver : ${silverRate} /kg\n\nClick bell icon above for notification \u{1F514}`;
}

export default function GoldRateScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [fetchTime, setFetchTime] = useState('12:30');
  const [channelConnected, setChannelConnected] = useState(false);
  const [today, setToday] = useState<Today>(null);
  const [goldRate, setGoldRate] = useState('');
  const [silverRate, setSilverRate] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<'refetch' | 'send' | 'auto' | null>(null);

  const applyToday = (doc: Today) => {
    setToday(doc);
    setGoldRate(doc?.gold_rate != null ? String(doc.gold_rate) : '');
    setSilverRate(doc?.silver_rate != null ? String(doc.silver_rate) : '');
    setMessage(doc?.message || '');
  };

  const load = async () => {
    try {
      const g = await api.get<any>('/settings/gold-rate');
      setFetchTime(g.fetch_time || '12:30');
      setChannelConnected(!!g.channel_connected);
      applyToday(g.today || null);
    } catch (e: any) { toast.error(e?.detail || 'Could not load'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  // Editing either rate regenerates the message from the template — the
  // message is derived from the rates, not tracked separately, so it can
  // never drift from what the two fields actually show.
  const onRateChange = (which: 'gold' | 'silver', v: string) => {
    if (which === 'gold') setGoldRate(v); else setSilverRate(v);
    const g = parseInt(which === 'gold' ? v : goldRate, 10);
    const s = parseInt(which === 'silver' ? v : silverRate, 10);
    if (g && s) setMessage(buildMessage(g, s));
  };

  const refetch = async () => {
    setBusy('refetch');
    try {
      const doc = await api.post<any>('/settings/gold-rate/refetch', {});
      applyToday(doc);
      if (doc.error) toast.error(doc.error); else toast.success(`Fetched — Gold ₹${doc.gold_rate?.toLocaleString('en-IN')}, Silver ₹${doc.silver_rate?.toLocaleString('en-IN')}`);
    } catch (e: any) { toast.error(e?.detail || 'Could not fetch'); }
    finally { setBusy(null); }
  };

  const send = () => confirmAction(
    'Send to Channel?',
    'This broadcasts the message below to everyone following the Ram Murti Jewellers WhatsApp Channel. Make sure it looks right.',
    'Send',
    async () => {
      setBusy('send');
      try {
        const g = parseInt(goldRate, 10);
        const s = parseInt(silverRate, 10);
        await api.post('/settings/gold-rate/send', { message, gold_rate: g || undefined, silver_rate: s || undefined });
        toast.success('Sent to Channel');
        load();
      } catch (e: any) { toast.error(e?.detail || 'Could not send'); }
      finally { setBusy(null); }
    },
  );

  // One-tap path for when you trust today's number and don't need to review
  // it first — still a deliberate tap + confirm, not a silent background
  // send (that stays off; see gold_rate.py).
  const fetchAndSend = () => confirmAction(
    'Fetch & Send?',
    "Fetches today's rate and immediately sends it to the Channel — skips the separate review step.",
    'Fetch & Send',
    async () => {
      setBusy('auto');
      try {
        const doc = await api.post<any>('/settings/gold-rate/refetch', {});
        applyToday(doc);
        if (doc.error) { toast.error(doc.error); return; }
        await api.post('/settings/gold-rate/send', { message: doc.message, gold_rate: doc.gold_rate, silver_rate: doc.silver_rate });
        toast.success('Fetched and sent to Channel');
        load();
      } catch (e: any) { toast.error(e?.detail || 'Could not fetch/send'); }
      finally { setBusy(null); }
    },
  );

  const canSend = !!parseInt(goldRate, 10) && !!parseInt(silverRate, 10) && !!message.trim();

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
    <SafeAreaView style={styles.root} edges={['top']} testID="gold-rate-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Gold Rate Channel</Text>
        <Pressable onPress={load} style={styles.iconBtn} testID="gold-rate-refresh-btn" hitSlop={12}>
          <Ionicons name="refresh" size={18} color={colors.onSurface} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <View style={styles.infoBox}>
          <Ionicons name="pricetag-outline" size={16} color={colors.brandSecondary} />
          <Text style={styles.infoText}>Fetches a reference rate from your supplier once a day. Confirm — and adjust the rates or message if needed — before it's sent to the "Ram Murti Jewellers" WhatsApp Channel.</Text>
        </View>

        {today?.error ? (
          <View style={[styles.infoBox, styles.infoBoxWarn]}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.onWarning} />
            <Text style={[styles.infoText, { color: colors.onWarning }]}>Couldn't fetch today: {today.error}. Enter today's rates below.</Text>
          </View>
        ) : today?.sent_at ? (
          <View style={[styles.infoBox, styles.infoBoxOk]}>
            <Ionicons name="checkmark-circle-outline" size={16} color={colors.onSuccess} />
            <Text style={[styles.infoText, { color: colors.onSuccess }]}>Sent at {istTime(today.sent_at)}{today.manual ? ' (entered manually)' : ''}</Text>
          </View>
        ) : today?.gold_rate ? (
          <Text style={styles.hint}>Fetched — not sent yet.</Text>
        ) : (
          <Text style={styles.hint}>Not fetched yet today — will auto-fetch at {fetchTime} IST, or tap Fetch Now.</Text>
        )}

        <View style={styles.row2}>
          <Pressable onPress={refetch} disabled={!!busy} style={[styles.altBtn, { flex: 1 }, busy === 'refetch' && { opacity: 0.6 }]} testID="gold-rate-refetch">
            {busy === 'refetch' ? <ActivityIndicator color={colors.brandSecondary} size="small" /> : <><Ionicons name="refresh" size={15} color={colors.brandSecondary} /><Text style={styles.altBtnText}>Fetch Now</Text></>}
          </Pressable>
          <Pressable onPress={fetchAndSend} disabled={!!busy || !channelConnected} style={[styles.altBtn, styles.autoBtn, { flex: 1 }, (busy === 'auto' || !channelConnected) && { opacity: 0.6 }]} testID="gold-rate-fetch-and-send">
            {busy === 'auto' ? <ActivityIndicator color={colors.onBrandPrimary} size="small" /> : <><Ionicons name="flash" size={15} color={colors.onBrandPrimary} /><Text style={[styles.altBtnText, styles.autoBtnText]}>Fetch &amp; Send</Text></>}
          </Pressable>
        </View>

        <Text style={styles.fieldLabel}>Rates (editable — changes update the message below)</Text>
        <View style={styles.row2}>
          <View style={{ flex: 1 }}>
            <Text style={styles.colLabel}>Gold (₹/tola)</Text>
            <TextInput value={goldRate} onChangeText={(v) => onRateChange('gold', v)} keyboardType="numeric" placeholder="e.g. 151050" placeholderTextColor={colors.mutedText} style={styles.input} testID="gold-rate-gold-input" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.colLabel}>Silver (₹/kg)</Text>
            <TextInput value={silverRate} onChangeText={(v) => onRateChange('silver', v)} keyboardType="numeric" placeholder="e.g. 242200" placeholderTextColor={colors.mutedText} style={styles.input} testID="gold-rate-silver-input" />
          </View>
        </View>

        <Text style={styles.fieldLabel}>Message to send</Text>
        <TextInput value={message} onChangeText={setMessage} multiline style={[styles.input, styles.inputMultiline]} testID="gold-rate-message" />
        <Pressable onPress={send} disabled={busy === 'send' || !channelConnected || !canSend} style={[styles.opt, styles.optPrimary, (busy === 'send' || !channelConnected || !canSend) && { opacity: 0.5 }]} testID="gold-rate-send">
          {busy === 'send' ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><Ionicons name="send" size={17} color={colors.onBrandPrimary} /><Text style={styles.optPrimaryText}>Confirm &amp; Send to Channel</Text></>}
        </Pressable>
        {!channelConnected && <Text style={styles.hint}>WhatsApp not connected — check Settings &gt; WhatsApp.</Text>}
      </ScrollView>
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
  infoBox: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
  },
  infoBoxOk: { backgroundColor: colors.success, borderColor: colors.success },
  infoBoxWarn: { backgroundColor: colors.warning, borderColor: colors.warning },
  infoText: { color: colors.onSurfaceTertiary, fontSize: 12, flex: 1 },
  hint: { color: colors.mutedText, fontSize: 12, marginBottom: spacing.md },
  fieldLabel: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  colLabel: { color: colors.mutedText, fontSize: 11, fontWeight: '600', marginBottom: 4 },
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
  autoBtn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  autoBtnText: { color: colors.onBrandPrimary },
  opt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 15, borderRadius: radius.md, marginBottom: spacing.sm },
  optPrimary: { backgroundColor: colors.brandPrimary },
  optPrimaryText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: '700' },
});
