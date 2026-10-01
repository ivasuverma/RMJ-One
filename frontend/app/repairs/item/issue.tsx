import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { notify } from '@/src/utils/notify';
import { promptChoice } from '@/src/utils/choicePrompt';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { KarigarChooser, createKarigar, resolveKarigar } from '@/src/components/KarigarChooser';
import { mobileKey } from '@/src/utils/mobile';
import { DueBackField } from '@/src/components/DueBackField';
import { GlassButton } from '@/src/components/ui/GlassButton';

type Item = {
  id: string; item_code: string; description: string; customer_name: string;
  gross_weight: number; purity?: number;
};
type Karigar = { id: string; name: string; mobile: string; is_employee: boolean };
type Txn = { id: string; direction: 'issue' | 'receive'; karigar_id: string; note: string; due_back?: string | null };

type Mode = 'pick' | 'form' | 'bulk';

export default function IssueToKarigarScreen() {
  const { itemId: routeItemId, itemIds: routeItemIds, txnId } = useLocalSearchParams<{ itemId: string; itemIds?: string; txnId?: string }>();
  const isEdit = !!txnId;
  const bulkIds = useMemo(() => (routeItemIds ? routeItemIds.split(',').filter(Boolean) : []), [routeItemIds]);
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [mode, setMode] = useState<Mode>(bulkIds.length > 0 ? 'bulk' : routeItemId ? 'form' : 'pick');
  const [item, setItem] = useState<Item | null>(null);
  const [bulkItems, setBulkItems] = useState<Item[]>([]);
  const [pickList, setPickList] = useState<Item[]>([]);
  const [karigars, setKarigars] = useState<Karigar[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState('');
  const [dueBack, setDueBack] = useState('');   // when the karigar should bring it back (YYYY-MM-DD)
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);
  // Karigar, mobile first (see KarigarChooser): a saved number is that
  // karigar, an unknown one plus a name is a new karigar saved with the issue.
  const [kMobile, setKMobile] = useState('');
  const [kName, setKName] = useState('');
  const [kInHouse, setKInHouse] = useState<Karigar | null>(null);
  const kEntry = resolveKarigar(karigars, kMobile, kName, kInHouse);
  const setKarigarEntry = (k: Karigar | null) => {
    const byMobile = !!k && mobileKey(k.mobile).length >= 7;
    setKMobile(byMobile ? k!.mobile : ''); setKName(''); setKInHouse(k && !byMobile ? k : null);
  };

  /** The karigar to issue to (null = none entered), saving a new one first.
   * Returns undefined (after telling the user) if the entry is incomplete. */
  const getKarigar = async (): Promise<Karigar | null | undefined> => {
    if (kEntry.kind === 'none') return null;
    if (kEntry.kind === 'existing') return kEntry.party;
    if (kEntry.kind === 'error') { notify('Missing', kEntry.message); return undefined; }
    const k = await createKarigar(kEntry.name, kEntry.mobile) as Karigar;
    setKarigars((list) => [...list, k].sort((x, y) => x.name.localeCompare(y.name)));
    return k;
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ks = await api.get<Karigar[]>('/karigars');
      setKarigars(ks);
      if (bulkIds.length > 0) {
        const results = await Promise.all(bulkIds.map((bid) => api.get<{ item: Item }>(`/repair-items/${bid}`).then((r) => r.item).catch(() => null)));
        setBulkItems(results.filter((x): x is Item => !!x));
        setMode('bulk');
      } else if (routeItemId) {
        const res = await api.get<{ item: Item; history: Txn[] }>(`/repair-items/${routeItemId}`);
        setItem(res.item);
        if (txnId) {
          const txn = res.history.find((h) => h.id === txnId);
          if (txn) {
            setNote(txn.note || '');
            setDueBack(txn.due_back || '');
            setKarigarEntry(ks.find((k) => k.id === txn.karigar_id) || null);
          }
        }
        setMode('form');
      } else {
        setPickList(await api.get<Item[]>('/repair-items?status=received'));
        setMode('pick');
      }
    } catch (_e) { /* ignore */ }
    finally { setLoading(false); }
  }, [routeItemId, bulkIds, txnId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const pickItem = (it: Item) => { setKarigarEntry(null); setNote(''); setItem(it); setMode('form'); };

  const printIssueSlip = async (itemId: string) => {
    try { await api.post(`/repair-items/${itemId}/issue-slip/print`, {}); }
    catch (e: any) { notify('Print failed', e?.detail || 'Could not reach the printer. Check Printer Settings.'); }
  };

  const submit = async () => {
    if (submittingRef.current || !item) return;
    // Editing an existing issue transaction always needs a karigar (it's a real
    // record of who has the item). A fresh issue can skip the karigar entirely —
    // the backend then moves the tag straight to "Pending to Bill".
    if (isEdit && kEntry.kind === 'none') { notify('Missing', 'Enter the karigar’s mobile number'); return; }
    if (kEntry.kind !== 'none' && !dueBack) { notify('Missing', 'Choose when the karigar should bring it back'); return; }
    submittingRef.current = true; setBusy(true);
    try {
      const k = await getKarigar();
      if (k === undefined) return;
      if (isEdit) {
        await api.put(`/repair-items/${item.id}/transactions/${txnId}`, { karigar_id: k!.id, note, due_back: dueBack });
      } else {
        await api.post(`/repair-items/${item.id}/issue`, { karigar_id: k?.id ?? null, note, due_back: k ? dueBack || null : null });
      }
      setBusy(false); submittingRef.current = false;
      // Only a real karigar issue produces a challan to print — "Mark Pending
      // to Bill" (no karigar picked) has nothing to hand anyone.
      if (k) {
        promptChoice(
          'Issued', `Handed to ${k.name}.`, 'Print Slip',
          async () => { await printIssueSlip(item.id); router.replace(`/repairs/item/${item.id}` as any); },
          () => router.replace(`/repairs/item/${item.id}` as any),
        );
      } else {
        // Land on the tag's summary — print/PDF/edit/delete all live there.
        router.replace(`/repairs/item/${item.id}` as any);
      }
      return;
    } catch (e: any) { notify('Failed', e?.detail || 'Please try again'); }
    finally { setBusy(false); submittingRef.current = false; }
  };

  const submitBulk = async () => {
    if (submittingRef.current || bulkItems.length === 0) return;
    if (kEntry.kind === 'none') { notify('Missing', 'Enter the karigar’s mobile number'); return; }
    if (!dueBack) { notify('Missing', 'Choose when the karigar should bring it back'); return; }
    submittingRef.current = true; setBusy(true);
    let k: Karigar | null | undefined;
    try { k = await getKarigar(); } catch (e: any) { notify('Failed', e?.detail || 'Could not add karigar'); }
    if (!k) { setBusy(false); submittingRef.current = false; return; }
    let okCount = 0;
    const issuedIds: string[] = [];
    const failed: string[] = [];
    for (const it of bulkItems) {
      try { await api.post(`/repair-items/${it.id}/issue`, { karigar_id: k!.id, note, due_back: dueBack || null }); okCount += 1; issuedIds.push(it.id); }
      catch (_e) { failed.push(it.item_code); }
    }
    setBusy(false); submittingRef.current = false;
    if (failed.length === 0) {
      promptChoice(
        'Done', `Issued ${okCount} tag${okCount === 1 ? '' : 's'} to ${k.name}`, 'Print Slips',
        async () => { for (const iid of issuedIds) await printIssueSlip(iid); router.back(); },
        () => router.back(),
      );
    } else {
      notify('Partial success', `Issued ${okCount} tag(s). Failed: ${failed.join(', ')}`);
      await load();
    }
  };

  const onBack = () => {
    if (mode === 'form' && !routeItemId) { setItem(null); setKarigarEntry(null); setNote(''); setMode('pick'); return; }
    router.back();
  };

  const headerTitle = mode === 'bulk' ? `Issue ${bulkItems.length} Tags` : mode === 'pick' ? 'Select Tag to Issue' : isEdit ? 'Edit Issue' : 'Issue to Karigar';

  if (loading && ((mode === 'form' && !item) || mode === 'bulk')) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <GlassButton onPress={onBack} style={styles.iconBtn} testID="back-btn" hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </GlassButton>
          <View style={{ flex: 1 }} />
        </View>
        <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="issue-screen">
      <View style={styles.header}>
        <GlassButton onPress={onBack} style={styles.iconBtn} testID="back-btn" hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </GlassButton>
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
      ) : mode === 'bulk' ? (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Tags ({bulkItems.length})</Text>
            {bulkItems.map((it) => (
              <View key={it.id} style={styles.pickedCard}>
                <Text style={styles.cName}>{it.item_code} · {it.customer_name}</Text>
                <Text style={styles.cMeta}>{it.description} · {it.gross_weight.toFixed(3)}g</Text>
              </View>
            ))}

            <Text style={styles.label}>Karigar</Text>
            <KarigarChooser
              karigars={karigars} mobile={kMobile} onMobile={setKMobile} name={kName} onName={setKName}
              inHouse={kInHouse} onInHouse={(x) => setKInHouse(x as Karigar | null)}
              testID="issue-karigar"
            />
            <DueBackField label="Due back" value={dueBack} onChange={setDueBack} days={[1, 3, 5, 7]} testID="issue-due-back" />
            <Text style={styles.label}>Note (optional)</Text>
            <TextInput testID="issue-note" value={note} onChangeText={setNote} placeholder="Instructions for the karigar" placeholderTextColor={colors.mutedText} style={styles.input} />
            <Pressable onPress={submitBulk} disabled={busy} style={[styles.saveBtn, busy && { opacity: 0.6 }]} testID="issue-bulk-save-btn">
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>Issue {bulkItems.length} Tags</Text>}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
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

            <Text style={styles.label}>{isEdit ? 'Karigar' : 'Karigar (optional)'}</Text>
            <KarigarChooser
              karigars={karigars} mobile={kMobile} onMobile={setKMobile} name={kName} onName={setKName}
              inHouse={kInHouse} onInHouse={(x) => setKInHouse(x as Karigar | null)}
              testID="issue-karigar"
            />
            {!isEdit && kEntry.kind === 'none' && (
              <Text style={styles.hint}>No karigar needed on this job? Leave this blank and the tag will go straight to "Pending to Bill".</Text>
            )}
            {(isEdit || kEntry.kind !== 'none') && (
              <DueBackField label="Due back" value={dueBack} onChange={setDueBack} days={[1, 3, 5, 7]} testID="issue-due-back" />
            )}
            <Text style={styles.label}>Note (optional)</Text>
            <TextInput testID="issue-note" value={note} onChangeText={setNote} placeholder="Instructions for the karigar" placeholderTextColor={colors.mutedText} style={styles.input} />
            <Pressable onPress={submit} disabled={busy} style={[styles.saveBtn, busy && { opacity: 0.6 }]} testID="issue-save-btn">
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
                <Text style={styles.saveBtnText}>{isEdit ? 'Save Changes' : kEntry.kind !== 'none' ? 'Issue to Karigar' : 'Mark Pending to Bill'}</Text>
              )}
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
  // overflow: 'hidden' is what actually enforces maxHeight here — without it
  // a plain View lets its content spill past the box and visually overlap
  // whatever renders after it (the Note field, the save button) instead of
  // being clipped/scrollable.

  iconBox: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand,
  },

  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 13, alignItems: 'center', marginTop: spacing.lg },
  saveBtnText: { color: colors.onBrandPrimary, fontWeight: '700' },
});
