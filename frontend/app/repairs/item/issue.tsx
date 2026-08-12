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
  id: string; item_code: string; description: string; customer_name: string;
  gross_weight: number; purity?: number;
};
type Karigar = { id: string; name: string; mobile: string; is_employee: boolean };

type Mode = 'pick' | 'form';

export default function IssueToKarigarScreen() {
  const { itemId: routeItemId } = useLocalSearchParams<{ itemId: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [mode, setMode] = useState<Mode>(routeItemId ? 'form' : 'pick');
  const [item, setItem] = useState<Item | null>(null);
  const [pickList, setPickList] = useState<Item[]>([]);
  const [karigars, setKarigars] = useState<Karigar[]>([]);
  const [loading, setLoading] = useState(true);
  const [kPickerOpen, setKPickerOpen] = useState(false);
  const [pickedKarigar, setPickedKarigar] = useState<Karigar | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ks = await api.get<Karigar[]>('/karigars');
      setKarigars(ks);
      if (routeItemId) {
        const res = await api.get<{ item: Item }>(`/repair-items/${routeItemId}`);
        setItem(res.item);
        setMode('form');
      } else {
        setPickList(await api.get<Item[]>('/repair-items?status=received'));
        setMode('pick');
      }
    } catch (_e) { /* ignore */ }
    finally { setLoading(false); }
  }, [routeItemId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const pickItem = (it: Item) => { setItem(it); setMode('form'); };

  const submit = async () => {
    if (submittingRef.current || !item) return;
    if (!pickedKarigar) { Alert.alert('Missing', 'Pick a karigar'); return; }
    submittingRef.current = true; setBusy(true);
    try {
      await api.post(`/repair-items/${item.id}/issue`, { karigar_id: pickedKarigar.id, note });
      router.back();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setBusy(false); submittingRef.current = false; }
  };

  const onBack = () => {
    if (mode === 'form' && !routeItemId) { setItem(null); setPickedKarigar(null); setMode('pick'); return; }
    router.back();
  };

  const headerTitle = mode === 'pick' ? 'Select Tag to Issue' : 'Issue to Karigar';

  if (loading && mode === 'form' && !item) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={onBack} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }} />
        </View>
        <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="issue-screen">
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{headerTitle}</Text>
        <View style={{ width: 40 }} />
      </View>

      {mode === 'pick' ? (
        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <Text style={styles.hint}>Pick a tag that's ready to go out to a karigar.</Text>
          {loading ? (
            <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 40 }} />
          ) : pickList.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="checkmark-done-outline" size={36} color={colors.mutedText} />
              <Text style={styles.emptyText}>Nothing is waiting to be issued right now</Text>
            </View>
          ) : pickList.map((it) => (
            <Pressable key={it.id} onPress={() => pickItem(it)} style={styles.itemRow} testID={`pick-${it.id}`}>
              <View style={styles.iconBox}><Ionicons name="pricetag-outline" size={18} color={colors.brandSecondary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cName}>{it.item_code} · {it.customer_name}</Text>
                <Text style={styles.cMeta}>{it.description} · {it.gross_weight.toFixed(3)}g</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.mutedText} />
            </Pressable>
          ))}
        </ScrollView>
      ) : item ? (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
            <View style={styles.pickedCard}>
              <Text style={styles.cName}>{item.item_code} · {item.customer_name}</Text>
              <Text style={styles.cMeta}>{item.description}</Text>
            </View>

            <View style={styles.weightCard} testID="issue-weight-fixed">
              <Ionicons name="scale-outline" size={16} color={colors.brandSecondary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.weightLabel}>Weight to issue — same as tag</Text>
                <Text style={styles.weightValue}>{item.gross_weight.toFixed(3)}g{item.purity ? ` · ${item.purity}%` : ''}</Text>
              </View>
            </View>

            <Text style={styles.label}>Karigar</Text>
            <Pressable onPress={() => setKPickerOpen((v) => !v)} style={styles.picker} testID="issue-karigar-toggle">
              <Text style={pickedKarigar ? styles.pickerValue : styles.pickerPlaceholder}>{pickedKarigar ? pickedKarigar.name : 'Choose a karigar'}</Text>
              <Ionicons name={kPickerOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedText} />
            </Pressable>
            {kPickerOpen && (
              <View style={styles.pickerList}>
                {karigars.map((k) => (
                  <Pressable key={k.id} onPress={() => { setPickedKarigar(k); setKPickerOpen(false); }} style={styles.pickerRow} testID={`issue-karigar-${k.id}`}>
                    <Text style={styles.pickerRowName}>{k.name}</Text>
                    <Text style={styles.pickerRowMeta}>{k.is_employee ? 'In-house' : 'Outside'}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <Text style={styles.label}>Note (optional)</Text>
            <TextInput testID="issue-note" value={note} onChangeText={setNote} placeholder="Instructions for the karigar" placeholderTextColor={colors.mutedText} style={styles.input} />
            <Pressable onPress={submit} disabled={busy} style={[styles.saveBtn, busy && { opacity: 0.6 }]} testID="issue-save-btn">
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>Issue</Text>}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      ) : null}
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

  hint: { color: colors.mutedText, fontSize: 12, marginBottom: spacing.md },
  empty: { alignItems: 'center', paddingVertical: 40, gap: spacing.sm },
  emptyText: { color: colors.onSurfaceTertiary, textAlign: 'center', paddingHorizontal: spacing.xl },
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },

  pickedCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md },
  cName: { color: colors.onSurface, fontWeight: '700', fontSize: 13 },
  cMeta: { color: colors.onSurfaceTertiary, fontSize: 11, marginTop: 2 },

  weightCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.brandTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brand,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  weightLabel: { color: colors.brandSecondary, fontSize: 11 },
  weightValue: { color: colors.onSurface, fontSize: 18, fontWeight: '800', marginTop: 2, fontFamily: fonts.display },

  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },
  picker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 12,
  },
  pickerValue: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  pickerPlaceholder: { color: colors.mutedText, fontSize: 14 },
  pickerList: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginTop: spacing.xs, maxHeight: 220 },
  pickerRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: 10 },
  pickerRowName: { color: colors.onSurface, fontSize: 13, fontWeight: '600' },
  pickerRowMeta: { color: colors.mutedText, fontSize: 12 },

  iconBox: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand,
  },

  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 13, alignItems: 'center', marginTop: spacing.lg },
  saveBtnText: { color: colors.onBrandPrimary, fontWeight: '700' },
});
