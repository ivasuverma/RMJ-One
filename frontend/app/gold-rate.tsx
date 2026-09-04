import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { confirmAction } from '@/src/utils/confirm';
import { istTime } from '@/src/utils/datetime';
import { useAuth } from '@/src/auth/AuthContext';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';

type Today = {
  date: string; gold_rate: number | null; silver_rate: number | null;
  fetched_gold: number | null; fetched_silver: number | null;
  gold_margin_applied: number | null; silver_margin_applied: number | null;
  error: string | null; manual: boolean; confirmed: boolean; sent_at: string | null; message: string | null;
} | null;

export default function GoldRateScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';

  const [loading, setLoading] = useState(true);
  const [fetchTime, setFetchTime] = useState('12:30');
  const [goldMargin, setGoldMargin] = useState('0');
  const [silverMargin, setSilverMargin] = useState('0');
  const [channelConnected, setChannelConnected] = useState(false);
  const [today, setToday] = useState<Today>(null);
  const [message, setMessage] = useState('');
  const [manualGold, setManualGold] = useState('');
  const [manualSilver, setManualSilver] = useState('');
  const [busy, setBusy] = useState<'refetch' | 'send' | 'config' | 'manual' | null>(null);

  const load = async () => {
    try {
      const g = await api.get<any>('/settings/gold-rate');
      setFetchTime(g.fetch_time || '12:30');
      setGoldMargin(String(g.gold_margin ?? 0));
      setSilverMargin(String(g.silver_margin ?? 0));
      setChannelConnected(!!g.channel_connected);
      setToday(g.today || null);
      setMessage(g.today?.message || '');
    } catch (e: any) { toast.error(e?.detail || 'Could not load'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const saveConfig = async () => {
    setBusy('config');
    try {
      const gm = parseInt(goldMargin, 10) || 0;
      const sm = parseInt(silverMargin, 10) || 0;
      await api.put('/settings/gold-rate/config', { fetch_time: fetchTime, gold_margin: gm, silver_margin: sm });
      toast.success('Fetch time & margins saved');
    } catch (e: any) { toast.error(e?.detail || 'Could not save'); }
    finally { setBusy(null); }
  };

  const refetch = async () => {
    setBusy('refetch');
    try {
      const doc = await api.post<any>('/settings/gold-rate/refetch', {});
      setToday(doc); setMessage(doc.message || '');
      if (doc.error) toast.error(doc.error); else toast.success(`Fetched — Gold ₹${doc.gold_rate?.toLocaleString('en-IN')}, Silver ₹${doc.silver_rate?.toLocaleString('en-IN')}`);
    } catch (e: any) { toast.error(e?.detail || 'Could not fetch'); }
    finally { setBusy(null); }
  };

  const setManual = async () => {
    const g = parseInt(manualGold, 10);
    const s = parseInt(manualSilver, 10);
    if (!g || !s) { toast.error('Enter both gold and silver rates'); return; }
    setBusy('manual');
    try {
      const doc = await api.put<any>('/settings/gold-rate', { gold_rate: g, silver_rate: s });
      setToday(doc); setMessage(doc.message || ''); setManualGold(''); setManualSilver('');
      toast.success('Rates set');
    } catch (e: any) { toast.error(e?.detail || 'Could not save'); }
    finally { setBusy(null); }
  };

  const send = () => confirmAction(
    'Send to Channel?',
    'This broadcasts the message below to everyone following the Ram Murti Jewellers WhatsApp Channel. Make sure it looks right.',
    'Send',
    async () => {
      setBusy('send');
      try {
        await api.post('/settings/gold-rate/send', { message });
        toast.success('Sent to Channel');
        load();
      } catch (e: any) { toast.error(e?.detail || 'Could not send'); }
      finally { setBusy(null); }
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
          <Text style={styles.infoText}>Fetches a reference rate from your supplier once a day. Confirm — and adjust the rate or message if needed — before it's sent to the "Ram Murti Jewellers" WhatsApp Channel.</Text>
        </View>

        {today?.error ? (
          <View style={[styles.infoBox, styles.infoBoxWarn]}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.onWarning} />
            <Text style={[styles.infoText, { color: colors.onWarning }]}>Couldn't fetch today: {today.error}. Enter today's rates manually below.</Text>
          </View>
        ) : today?.gold_rate ? (
          <View style={[styles.infoBox, styles.infoBoxOk]}>
            <Ionicons name="checkmark-circle-outline" size={16} color={colors.onSuccess} />
            <Text style={[styles.infoText, { color: colors.onSuccess }]}>
              Gold ₹{today.gold_rate.toLocaleString('en-IN')} · Silver ₹{today.silver_rate?.toLocaleString('en-IN')}
              {today.manual ? ' (entered manually)' : ''}
              {today.sent_at ? ` · sent at ${istTime(today.sent_at)}` : ' · not sent yet'}
            </Text>
          </View>
        ) : (
          <Text style={styles.hint}>Not fetched yet today — will auto-fetch at {fetchTime} IST, or tap Fetch Now.</Text>
        )}

        <Pressable onPress={refetch} disabled={busy === 'refetch'} style={[styles.altBtn, busy === 'refetch' && { opacity: 0.6 }]} testID="gold-rate-refetch">
          {busy === 'refetch' ? <ActivityIndicator color={colors.brandSecondary} size="small" /> : <><Ionicons name="refresh" size={15} color={colors.brandSecondary} /><Text style={styles.altBtnText}>Fetch Now</Text></>}
        </Pressable>

        <Text style={styles.fieldLabel}>Enter rates manually</Text>
        <View style={styles.row2}>
          <TextInput value={manualGold} onChangeText={setManualGold} keyboardType="numeric" placeholder="Gold /tola" placeholderTextColor={colors.mutedText} style={[styles.input, { flex: 1 }]} testID="gold-rate-manual-gold" />
          <TextInput value={manualSilver} onChangeText={setManualSilver} keyboardType="numeric" placeholder="Silver /kg" placeholderTextColor={colors.mutedText} style={[styles.input, { flex: 1 }]} testID="gold-rate-manual-silver" />
          <Pressable onPress={setManual} disabled={busy === 'manual'} style={[styles.altBtn, { flexGrow: 0, paddingHorizontal: spacing.lg, marginBottom: spacing.md }, busy === 'manual' && { opacity: 0.6 }]} testID="gold-rate-manual-set">
            {busy === 'manual' ? <ActivityIndicator color={colors.brandSecondary} size="small" /> : <Text style={styles.altBtnText}>Set</Text>}
          </Pressable>
        </View>

        {!!today?.gold_rate && (
          <>
            <Text style={styles.fieldLabel}>Message to send</Text>
            <TextInput value={message} onChangeText={setMessage} multiline style={[styles.input, styles.inputMultiline]} testID="gold-rate-message" />
            <Pressable onPress={send} disabled={busy === 'send' || !channelConnected} style={[styles.opt, styles.optPrimary, (busy === 'send' || !channelConnected) && { opacity: 0.5 }]} testID="gold-rate-send">
              {busy === 'send' ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><Ionicons name="send" size={17} color={colors.onBrandPrimary} /><Text style={styles.optPrimaryText}>Confirm &amp; Send to Channel</Text></>}
            </Pressable>
            {!channelConnected && <Text style={styles.hint}>WhatsApp not connected — check Settings &gt; WhatsApp.</Text>}
          </>
        )}

        {isOwner && (
          <>
            <View style={styles.divider} />
            <Text style={styles.section}>Fetch Settings (Owner)</Text>
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
            <Pressable onPress={saveConfig} disabled={busy === 'config'} style={[styles.altBtn, busy === 'config' && { opacity: 0.6 }]} testID="gold-rate-save-config">
              {busy === 'config' ? <ActivityIndicator color={colors.brandSecondary} size="small" /> : <Text style={styles.altBtnText}>Save Fetch Settings</Text>}
            </Pressable>
          </>
        )}
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
  section: {
    color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase',
    marginTop: spacing.md, marginBottom: spacing.sm,
  },
  divider: { height: 1, backgroundColor: colors.divider, marginTop: spacing.lg },
  infoBox: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
  },
  infoBoxOk: { backgroundColor: colors.success, borderColor: colors.success },
  infoBoxWarn: { backgroundColor: colors.warning, borderColor: colors.warning },
  infoText: { color: colors.onSurfaceTertiary, fontSize: 12, flex: 1 },
  hint: { color: colors.mutedText, fontSize: 12, marginBottom: spacing.md },
  fieldLabel: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  row2: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' },
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
});
