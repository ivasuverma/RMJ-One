import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Item = {
  id: string; item_code: string; description: string; customer_name: string; karigar_name: string | null;
  current_issue_weight: number | null; current_issue_fine_weight?: number | null; purity?: number;
};

function round3(n: number) { return Math.round(n * 1000) / 1000; }

export default function ReceiveFromKarigarScreen() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [weight, setWeight] = useState('');
  const [note, setNote] = useState('');
  const [adjAmount, setAdjAmount] = useState('');
  const [adjNote, setAdjNote] = useState('');
  const [chargeTo, setChargeTo] = useState<'customer' | 'karigar' | 'none'>('none');
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ item: Item }>(`/repair-items/${itemId}`);
      setItem(res.item);
    } catch (_e) { /* ignore */ }
    finally { setLoading(false); }
  }, [itemId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const submit = async () => {
    if (submittingRef.current) return;
    const w = parseFloat(weight);
    if (!w || w <= 0) { Alert.alert('Invalid', 'Enter the weight received back'); return; }
    submittingRef.current = true; setBusy(true);
    try {
      await api.post(`/repair-items/${itemId}/receive`, {
        weight: w, note, adjustment_amount: parseFloat(adjAmount) || 0,
        adjustment_note: adjNote, charge_to: chargeTo,
      });
      router.back();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setBusy(false); submittingRef.current = false; }
  };

  if (loading || !item) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }} />
        </View>
        <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
      </SafeAreaView>
    );
  }

  const issuedWeight = item.current_issue_weight || 0;
  const purity = item.purity ?? 100;
  const weightNum = parseFloat(weight) || 0;
  const liveDiff = weight ? round3(weightNum - issuedWeight) : null;
  const liveFineDiff = weight ? round3(weightNum * purity / 100 - (item.current_issue_fine_weight ?? issuedWeight * purity / 100)) : null;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="receive-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Receive from Karigar</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <View style={styles.pickedCard}>
            <Text style={styles.cName}>{item.item_code} · {item.customer_name}</Text>
            <Text style={styles.cMeta}>{item.description}{item.karigar_name ? ` · with ${item.karigar_name}` : ''}</Text>
          </View>

          <Text style={styles.hint}>Issued weight was {issuedWeight.toFixed(3)}g. Enter what came back — you decide any wastage or charge manually.</Text>
          <Text style={styles.label}>Weight received (g)</Text>
          <TextInput testID="receive-weight" value={weight} onChangeText={(v) => setWeight(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0.000" placeholderTextColor={colors.mutedText} style={styles.input} />
          {liveDiff != null && (
            <View style={[styles.balancePreview, liveDiff < 0 && styles.balancePreviewNegative]} testID="receive-balance-preview">
              <Ionicons name={liveDiff >= 0 ? 'trending-up-outline' : 'trending-down-outline'} size={14} color={liveDiff >= 0 ? colors.onSuccess : colors.onError} />
              <Text style={[styles.balancePreviewText, { color: liveDiff >= 0 ? colors.onSuccess : colors.onError }]}>
                Balance vs issued: {liveDiff >= 0 ? '+' : ''}{liveDiff.toFixed(3)}g (fine {liveFineDiff != null && liveFineDiff >= 0 ? '+' : ''}{liveFineDiff?.toFixed(3)}g)
              </Text>
            </View>
          )}
          <Text style={styles.label}>Note (optional)</Text>
          <TextInput testID="receive-note" value={note} onChangeText={setNote} placeholder="Notes" placeholderTextColor={colors.mutedText} style={styles.input} />

          <Text style={[styles.label, { marginTop: spacing.md }]}>Charge any wastage/adjustment to</Text>
          <View style={styles.chipRow}>
            {(['none', 'customer', 'karigar'] as const).map((c) => (
              <Pressable key={c} onPress={() => setChargeTo(c)} style={[styles.chip, chargeTo === c && styles.chipActive]} testID={`charge-${c}`}>
                <Text style={[styles.chipText, chargeTo === c && styles.chipTextActive]}>{c[0].toUpperCase() + c.slice(1)}</Text>
              </Pressable>
            ))}
          </View>
          {chargeTo !== 'none' && (
            <>
              <Text style={styles.label}>Adjustment amount (₹)</Text>
              <TextInput testID="adj-amount" value={adjAmount} onChangeText={(v) => setAdjAmount(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />
              <Text style={styles.label}>Reason (optional)</Text>
              <TextInput testID="adj-note" value={adjNote} onChangeText={setAdjNote} placeholder="e.g. melting loss" placeholderTextColor={colors.mutedText} style={styles.input} />
            </>
          )}
          <Pressable onPress={submit} disabled={busy} style={[styles.saveBtn, busy && { opacity: 0.6 }]} testID="receive-save-btn">
            {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>Receive</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  title: { flex: 1, color: colors.onSurface, fontSize: 18, fontWeight: '600', fontFamily: fonts.display },

  pickedCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.lg },
  cName: { color: colors.onSurface, fontWeight: '700', fontSize: 13 },
  cMeta: { color: colors.onSurfaceTertiary, fontSize: 11, marginTop: 2 },

  hint: { color: colors.mutedText, fontSize: 12, marginBottom: spacing.sm, lineHeight: 17 },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },
  balancePreview: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.success,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 8, marginTop: 6,
  },
  balancePreviewNegative: { backgroundColor: colors.error },
  balancePreviewText: { fontSize: 12, fontWeight: '700' },

  chipRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm, flexWrap: 'wrap' },
  chip: { flexGrow: 1, alignItems: 'center', paddingVertical: 10, paddingHorizontal: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: colors.onBrandPrimary },

  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 13, alignItems: 'center', marginTop: spacing.lg },
  saveBtnText: { color: colors.onBrandPrimary, fontWeight: '700' },
});
