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
type ServerItem = { key: string; label: string; base: 'gold' | 'silver'; percent: number; enabled: boolean; buy_percent?: number | null };
// Editing shape: the percentage is kept as text while typing so "91." doesn't get mangled.
type Item = { key: string; label: string; base: 'gold' | 'silver'; percent: string; enabled: boolean; buyPercent: string };
type Computed = { key: string; rate: number | null; error: string | null; base_value: number; buy_rate?: number | null };
// Purities that take their own buyback percentage (see backend routers/rate_master.py).
const BUY_KEYS = ['gold_22k', 'gold_18k', 'gold_14k'];
type State = { items: ServerItem[]; base: { gold: number; silver: number; date: string } | null; defaults: ServerItem[]; computed: Computed[] };

const inr = (n: number) => n.toLocaleString('en-IN');
const toEdit = (i: ServerItem): Item => ({
  key: i.key, label: i.label, base: i.base, percent: String(i.percent), enabled: i.enabled,
  buyPercent: i.buy_percent != null ? String(i.buy_percent) : '',
});
const toServer = (i: Item) => ({
  key: i.key, label: i.label, percent: parseFloat(i.percent) || 0, enabled: i.enabled,
  buy_percent: BUY_KEYS.includes(i.key) && parseFloat(i.buyPercent) > 0 ? parseFloat(i.buyPercent) : null,
});

export default function RateFormulasScreen() {
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

  const load = useCallback(async () => {
    try {
      const s = await api.get<State>('/rate-master');
      setItems(s.items.map(toEdit)); setDefaults(s.defaults); setBase(s.base); setComputed(s.computed); setDirty(false);
      setTryGold(s.base ? String(s.base.gold) : ''); setTrySilver(s.base ? String(s.base.silver) : '');
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
  const resetOne = (key: string) => { const d = defaults.find((x) => x.key === key); if (d) patch(key, { percent: String(d.percent) }); };
  const save = async () => {
    setSaving(true);
    try { await api.put('/rate-master', { items: items.map(toServer) }); toast.success('Formulas saved'); await load(); }
    catch (e: any) { toast.error(e?.detail || 'Could not save'); }
    finally { setSaving(false); }
  };

  // Same root container as the loaded screen — swapping roots left the dark theme background behind on web.
  if (loading) return <SafeAreaView style={styles.root} edges={['top']}><View style={styles.centered}><ActivityIndicator color={colors.brandPrimary} /></View></SafeAreaView>;
  const byKey = Object.fromEntries(computed.map((c) => [c.key, c]));
  const changedBase = !!base && (String(base.gold) !== tryGold || String(base.silver) !== trySilver);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="rate-formulas-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} hitSlop={12} testID="back-btn" accessibilityRole="button" accessibilityLabel="Back"><Ionicons name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.title}>Purity Formulas</Text>
        <Pressable onPress={load} style={styles.iconBtn} hitSlop={12}><Ionicons name="refresh" size={18} color={colors.onSurface} /></Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}>

        <View style={styles.infoBox}>
          <Ionicons name="calculator-outline" size={16} color={colors.brandSecondary} />
          <Text style={styles.infoText}>Each rate is a percentage of the rate you confirm every day — for example 18K = 75% of the 24K rate. Gold purities use the 24K rate, silver uses the silver rate. For 22K, 18K and 14K you can also set a buyback percentage of the same 24K rate; left blank, their buyback is the 24K buyback rate times the sell percentage. The margin (₹ added or subtracted) is set on the Rate Master page, with the daily rate. Results here are rounded the same way as the base rate (gold to ₹50, silver to ₹100).</Text>
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

              {BUY_KEYS.includes(it.key) ? (
                <>
                  <View style={[styles.rowHead, { marginTop: spacing.sm }]}>
                    <Text style={styles.label}>Buyback: % of the 24K rate</Text>
                    <Text style={styles.buyResult}>{c?.buy_rate ? `₹${inr(c.buy_rate)}` : ''}</Text>
                  </View>
                  <TextInput value={it.buyPercent} onChangeText={(v) => patch(it.key, { buyPercent: v.replace(/[^0-9.]/g, '') })} editable={isOwner} keyboardType="decimal-pad"
                    style={styles.input} placeholder="e.g. 89 (optional)" placeholderTextColor={colors.mutedText} testID={`rm-buy-percent-${it.key}`} />
                </>
              ) : null}

              <View style={styles.switchRow}>
                <Text style={[styles.hint, { flex: 1 }]}>Show this rate (LED board placeholder: <Text style={styles.code}>{`{${it.key}}`}</Text>)</Text>
                <Switch value={it.enabled} onValueChange={(v) => patch(it.key, { enabled: v })} disabled={!isOwner} trackColor={{ true: colors.brandPrimary, false: colors.border }} thumbColor={colors.surface} {...({ activeThumbColor: colors.surface } as object)} />
              </View>
              {!isDefault && isOwner && def ? <Pressable onPress={() => resetOne(it.key)}><Text style={styles.link}>Reset to standard ({def.percent}%)</Text></Pressable> : null}
            </View>
          );
        })}

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
  buyResult: { color: colors.onSurfaceSecondary, fontSize: 15, fontWeight: '800', marginTop: spacing.sm },
  hint: { color: colors.mutedText, fontSize: 12 },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600', marginTop: spacing.sm, marginBottom: 4 },
  row2: { flexDirection: 'row', gap: spacing.sm },
  // minWidth/width: a web <input> otherwise keeps an intrinsic width that can push the page wider than a phone.
  input: { minWidth: 0, width: '100%', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 11, fontSize: 14 },
  inputBad: { borderColor: colors.onError },
  err: { color: colors.onError, fontSize: 12, marginTop: 2 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  link: { color: colors.brandPrimary, fontSize: 12.5, fontWeight: '600', marginTop: 6 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, marginTop: spacing.sm },
  primaryBtnText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 14 },
});
