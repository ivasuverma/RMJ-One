import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, TextInput, Linking, Platform } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { confirmAction } from '@/src/utils/confirm';
import { istDisplayDate, todayIST } from '@/src/utils/datetime';
import { enqueueRecordPhoto } from '@/src/utils/uploadQueue';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Sheet, useToast } from '@/src/components/ui';
import { ModuleHeader } from '@/src/components/ui/ModuleHeader';
import { HeaderSpacer, useScrolled } from '@/src/components/ui/StickyHeader';
import { DateField } from '@/src/components/DateField';
import { RecordPhotos } from '@/src/components/RecordPhotos';
import { pickWebFile, makeThumb } from '@/src/components/DocumentCaptureSheet';
import { compressImage } from '@/src/components/QuickDocCapture';
import { inr, initials } from '@/src/utils/cashLedger';

type Account = { id: string; name: string; phone?: string; note?: string; balance: number; entries: number };
type Entry = { id: string; direction: 'gave' | 'got'; amount: number; date: string; note?: string; created_by_name?: string; balance_after: number; photos: number };
type Shot = { id: string; blob: Blob; thumb: string };

const newId = () => ((typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

// One person in the Cash Ledger: what they owe you (or you owe them), every
// entry newest first with the balance after it, and the two big buttons —
// "You gave" (cash went to them) and "You got" (cash came from them).
export default function CashLedgerAccountScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const { user, hasRight } = useAuth();
  const isOwner = user?.role === 'owner';
  const canEdit = isOwner || user?.role === 'admin' || hasRight('cash_ledger', 'edit');
  const canDelete = isOwner || user?.role === 'admin' || hasRight('cash_ledger', 'delete');
  const { scrolled, onScroll } = useScrolled();
  const [acc, setAcc] = useState<Account | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // entry sheet
  const [sheet, setSheet] = useState<null | { mode: 'new' | 'edit'; entry?: Entry }>(null);
  const [direction, setDirection] = useState<'gave' | 'got'>('gave');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIST());
  const [note, setNote] = useState('');
  const [shots, setShots] = useState<Shot[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [busy, setBusy] = useState(false);

  // account sheet
  const [editAcc, setEditAcc] = useState(false);
  const [accName, setAccName] = useState('');
  const [accPhone, setAccPhone] = useState('');
  const [accNote, setAccNote] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ account: Account; entries: Entry[] }>(`/khata/${id}`);
      setAcc(r.account); setEntries(r.entries);
    } catch (e: any) { toast.error(e?.detail || 'Could not load'); setEntries((x) => x || []); }
    finally { setRefreshing(false); }
  }, [id, toast]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openNew = (dir: 'gave' | 'got') => {
    setDirection(dir); setAmount(''); setDate(todayIST()); setNote(''); setShots([]); setSheet({ mode: 'new' });
  };
  const openEdit = (e: Entry) => {
    setDirection(e.direction); setAmount(String(e.amount)); setDate(e.date); setNote(e.note || ''); setShots([]); setSheet({ mode: 'edit', entry: e });
  };

  const shoot = async (gallery: boolean) => {
    if (capturing || Platform.OS !== 'web') return;
    setCapturing(true);
    try {
      const f = await pickWebFile('image/*', !gallery);
      if (!f) return;
      const blob = await compressImage(f, true);
      const sid = newId();
      setShots((p) => [...p, { id: sid, blob, thumb: '' }]);
      const thumb = await makeThumb(f);
      setShots((p) => p.map((s) => (s.id === sid ? { ...s, thumb } : s)));
    } catch { toast.error('Could not read that photo'); }
    finally { setCapturing(false); }
  };

  const save = async () => {
    const amt = Number(amount.replace(/,/g, ''));
    if (!amt || amt <= 0 || busy) { toast.error('Enter the amount'); return; }
    setBusy(true);
    try {
      const body = { direction, amount: amt, date, note: note.trim() };
      let entryId = sheet?.entry?.id || '';
      if (sheet?.mode === 'edit' && entryId) await api.put(`/khata/${id}/entries/${entryId}`, body);
      else entryId = (await api.post<{ id: string }>(`/khata/${id}/entries`, body)).id;
      // Same background upload as every other record photo: Drive keeps the full photo.
      for (const s of shots) {
        await enqueueRecordPhoto({ id: s.id, blob: s.blob, filename: `cash-ledger-${Date.now()}.jpg`, thumb: s.thumb, ref_type: 'cash_ledger_entry', ref_id: entryId });
      }
      setSheet(null); toast.success(sheet?.mode === 'edit' ? 'Entry updated' : 'Saved');
      await load();
    } catch (e: any) { toast.error(e?.detail || 'Could not save'); }
    finally { setBusy(false); }
  };

  const removeEntry = (e: Entry) => confirmAction('Delete this entry?', `${e.direction === 'gave' ? 'You gave' : 'You got'} ${inr(e.amount)} on ${istDisplayDate(e.date)}.`, 'Delete', async () => {
    try { await api.del(`/khata/${id}/entries/${e.id}`); setSheet(null); toast.success('Deleted'); load(); }
    catch (err: any) { toast.error(err?.detail || 'Could not delete'); }
  });

  const settle = () => acc && confirmAction('Settle up?', acc.balance > 0
    ? `Records that ${acc.name} paid you ${inr(acc.balance)}. The balance becomes zero.`
    : `Records that you paid ${acc.name} ${inr(acc.balance)}. The balance becomes zero.`, 'Settle', async () => {
    try { await api.post(`/khata/${id}/settle`, {}); toast.success('Settled up'); load(); }
    catch (e: any) { toast.error(e?.detail || 'Could not settle'); }
  });

  const phoneDigits = (acc?.phone || '').replace(/\D/g, '');
  const waNumber = phoneDigits.length === 10 ? `91${phoneDigits}` : phoneDigits;
  const remind = () => {
    if (!acc) return;
    const text = acc.balance > 0
      ? `Hi ${acc.name.split(' ')[0]}, a gentle reminder: ${inr(acc.balance)} is pending as per my records. — ${user?.name || 'RMJ'}`
      : `Hi ${acc.name.split(' ')[0]}, as per my records I owe you ${inr(acc.balance)}. — ${user?.name || 'RMJ'}`;
    Linking.openURL(`https://wa.me/${waNumber}?text=${encodeURIComponent(text)}`);
  };

  const openAccEdit = () => { if (!acc) return; setAccName(acc.name); setAccPhone(acc.phone || ''); setAccNote(acc.note || ''); setEditAcc(true); };
  const saveAcc = async () => {
    if (!accName.trim()) return;
    try { await api.put(`/khata/${id}`, { name: accName.trim(), phone: accPhone.trim(), note: accNote.trim() }); setEditAcc(false); load(); }
    catch (e: any) { toast.error(e?.detail || 'Could not save'); }
  };
  const deleteAcc = () => acc && confirmAction(`Remove ${acc.name}?`, 'They disappear from the Cash Ledger. Only possible when the balance is settled.', 'Remove', async () => {
    try { await api.del(`/khata/${id}`); setEditAcc(false); router.back(); }
    catch (e: any) { toast.error(e?.detail || 'Could not remove'); }
  });

  const owes = !!acc && acc.balance > 0.004, owe = !!acc && acc.balance < -0.004;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="cash-ledger-account">
      <ModuleHeader title={acc?.name || 'Cash Ledger'} backLabel="Cash Ledger" scrolled={scrolled}
        subtitle={acc?.phone || null}
        actions={canEdit ? (
          <Pressable onPress={openAccEdit} hitSlop={8} style={styles.headBtn} accessibilityLabel="Edit person" testID="cl-edit-account">
            <Ionicons name="create-outline" size={18} color={colors.brandSecondary} />
          </Pressable>
        ) : undefined} />
      <ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 130 + insets.bottom }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}>
        <HeaderSpacer />
        {!acc ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 40 }} /> : (
          <>
            <View style={styles.balance} testID="cl-balance">
              <View style={styles.av}><Text style={styles.avText}>{initials(acc.name)}</Text></View>
              <Text style={[styles.balAmt, { color: owes ? colors.onSuccess : owe ? colors.onError : colors.onSurface }]}>{owes || owe ? inr(acc.balance) : '₹0'}</Text>
              <Text style={styles.balLabel}>{owes ? `${acc.name.split(' ')[0]} owes you` : owe ? `You owe ${acc.name.split(' ')[0]}` : 'All settled'}</Text>
              <View style={styles.actions}>
                {!!phoneDigits && (
                  <Pressable onPress={() => Linking.openURL(`tel:${phoneDigits}`)} style={styles.action} testID="cl-call">
                    <Ionicons name="call-outline" size={17} color={colors.brandSecondary} /><Text style={styles.actionText}>Call</Text>
                  </Pressable>
                )}
                {!!phoneDigits && (owes || owe) && (
                  <Pressable onPress={remind} style={styles.action} testID="cl-remind">
                    <Ionicons name="logo-whatsapp" size={17} color={colors.brandSecondary} /><Text style={styles.actionText}>{owes ? 'Remind' : 'Message'}</Text>
                  </Pressable>
                )}
                {(owes || owe) && (
                  <Pressable onPress={settle} style={styles.action} testID="cl-settle">
                    <Ionicons name="checkmark-done-outline" size={17} color={colors.brandSecondary} /><Text style={styles.actionText}>Settle up</Text>
                  </Pressable>
                )}
              </View>
              {!!acc.note && <Text style={styles.accNote}>{acc.note}</Text>}
            </View>

            {entries && entries.length === 0 ? (
              <Text style={styles.emptyText}>No entries yet. Use the buttons below to record cash you gave or got.</Text>
            ) : (
              <>
                <View style={styles.colHead}>
                  <Text style={[styles.colHeadText, { flex: 1 }]}>Entries</Text>
                  <Text style={[styles.colHeadText, styles.colAmt]}>You gave</Text>
                  <Text style={[styles.colHeadText, styles.colAmt]}>You got</Text>
                </View>
                <View style={styles.card}>
                  {(entries || []).map((e, i) => (
                    <Pressable key={e.id} onPress={() => openEdit(e)} style={({ pressed }) => [styles.entry, i > 0 && styles.sep, pressed && { backgroundColor: colors.surfaceTertiary }]} testID={`cl-entry-${e.id}`}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.entryDate}>{istDisplayDate(e.date)}</Text>
                        {!!e.note && <Text style={styles.entryNote} numberOfLines={2}>{e.note}</Text>}
                        <View style={styles.entryMeta}>
                          {e.photos > 0 && <View style={styles.photoPill}><Ionicons name="image-outline" size={11} color={colors.brandSecondary} /><Text style={styles.photoPillText}>{e.photos}</Text></View>}
                          <Text style={styles.entryBal}>Bal {e.balance_after >= 0 ? '' : '−'}{inr(e.balance_after)}</Text>
                        </View>
                      </View>
                      <Text style={[styles.colAmt, styles.gave]}>{e.direction === 'gave' ? inr(e.amount) : ''}</Text>
                      <Text style={[styles.colAmt, styles.got]}>{e.direction === 'got' ? inr(e.amount) : ''}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: 12 + insets.bottom }]}>
        <Pressable onPress={() => openNew('gave')} style={[styles.barBtn, { backgroundColor: colors.error }]} testID="cl-you-gave">
          <Ionicons name="arrow-up" size={18} color={colors.onError} /><Text style={[styles.barText, { color: colors.onError }]}>You gave ₹</Text>
        </Pressable>
        <Pressable onPress={() => openNew('got')} style={[styles.barBtn, { backgroundColor: colors.success }]} testID="cl-you-got">
          <Ionicons name="arrow-down" size={18} color={colors.onSuccess} /><Text style={[styles.barText, { color: colors.onSuccess }]}>You got ₹</Text>
        </Pressable>
      </View>

      <Sheet visible={!!sheet} onClose={() => setSheet(null)} title={sheet?.mode === 'edit' ? 'Edit entry' : direction === 'gave' ? `You gave ${acc?.name.split(' ')[0] || ''}` : `You got from ${acc?.name.split(' ')[0] || ''}`} testID="cl-entry-sheet">
        <View style={styles.dirRow}>
          {(['gave', 'got'] as const).map((d) => (
            <Pressable key={d} onPress={() => setDirection(d)} style={[styles.dir, direction === d && (d === 'gave' ? styles.dirGave : styles.dirGot)]} testID={`cl-dir-${d}`}>
              <Text style={[styles.dirText, direction === d && { color: d === 'gave' ? colors.onError : colors.onSuccess }]}>{d === 'gave' ? 'You gave' : 'You got'}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.amountRow}>
          <Text style={[styles.rupee, { color: direction === 'gave' ? colors.onError : colors.onSuccess }]}>₹</Text>
          <TextInput value={amount} onChangeText={(t) => setAmount(t.replace(/[^\d.,]/g, ''))} placeholder="0" placeholderTextColor={colors.mutedText}
            keyboardType="decimal-pad" style={[styles.amountInput, { color: direction === 'gave' ? colors.onError : colors.onSuccess }]} autoFocus={sheet?.mode === 'new'} testID="cl-amount" />
        </View>
        <DateField label="Date" value={date} onChange={setDate} testID="cl-date" />
        <Text style={styles.label}>Note (optional)</Text>
        <TextInput value={note} onChangeText={setNote} placeholder="e.g. For the Diwali stock" placeholderTextColor={colors.mutedText} style={styles.input} testID="cl-note" />

        {sheet?.mode === 'edit' && sheet.entry ? (
          <RecordPhotos refType="cash_ledger_entry" refId={sheet.entry.id} label="Photos" />
        ) : null}
        {shots.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingVertical: 6 }}>
            {shots.map((s) => (
              <View key={s.id} style={styles.shot}>
                {s.thumb ? <Image source={{ uri: `data:image/jpeg;base64,${s.thumb}` }} style={styles.shotImg} /> : <View style={styles.shotImg}><ActivityIndicator size="small" color={colors.brandSecondary} /></View>}
                <Pressable onPress={() => setShots((p) => p.filter((x) => x.id !== s.id))} style={styles.shotX} hitSlop={6}><Ionicons name="close" size={12} color="#fff" /></Pressable>
              </View>
            ))}
          </ScrollView>
        )}
        {sheet?.mode === 'new' && (
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
            <Pressable onPress={() => shoot(false)} disabled={capturing} style={[styles.attach, { flex: 1 }]} testID="cl-photo">
              <Ionicons name="camera-outline" size={19} color={colors.brandSecondary} />
              <Text style={styles.attachText}>{shots.length ? 'Add another photo' : 'Add photo (chit / receipt)'}</Text>
            </Pressable>
            <Pressable onPress={() => shoot(true)} disabled={capturing} style={styles.attach} accessibilityLabel="Pick from gallery" testID="cl-photo-gallery">
              <Ionicons name="images-outline" size={19} color={colors.brandSecondary} />
            </Pressable>
          </View>
        )}

        {(sheet?.mode === 'new' || canEdit) && (
          <Pressable onPress={save} disabled={busy} style={[styles.save, { backgroundColor: direction === 'gave' ? colors.onError : colors.onSuccess }, busy && { opacity: 0.6 }]} testID="cl-save">
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>{sheet?.mode === 'edit' ? 'Save changes' : 'Save'}</Text>}
          </Pressable>
        )}
        {sheet?.mode === 'edit' && sheet.entry && canDelete && (
          <Pressable onPress={() => removeEntry(sheet.entry!)} style={styles.deleteBtn} testID="cl-delete-entry">
            <Text style={[styles.attachText, { color: colors.onError }]}>Delete entry</Text>
          </Pressable>
        )}
      </Sheet>

      <Sheet visible={editAcc} onClose={() => setEditAcc(false)} title="Edit person" testID="cl-account-sheet">
        <Text style={styles.label}>Name</Text>
        <TextInput value={accName} onChangeText={setAccName} style={styles.input} testID="cl-acc-name" />
        <Text style={styles.label}>Mobile</Text>
        <TextInput value={accPhone} onChangeText={setAccPhone} style={styles.input} keyboardType="phone-pad" testID="cl-acc-phone" />
        <Text style={styles.label}>Note</Text>
        <TextInput value={accNote} onChangeText={setAccNote} style={styles.input} placeholder="Anything to remember about them" placeholderTextColor={colors.mutedText} testID="cl-acc-note" />
        <Pressable onPress={saveAcc} style={[styles.save, { backgroundColor: colors.brandPrimary }]} testID="cl-acc-save"><Text style={[styles.saveText, { color: colors.onBrandPrimary }]}>Save</Text></Pressable>
        {canDelete && (
          <Pressable onPress={deleteAcc} style={styles.deleteBtn} testID="cl-acc-delete"><Text style={[styles.attachText, { color: colors.onError }]}>Remove person</Text></Pressable>
        )}
      </Sheet>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  headBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  balance: { alignItems: 'center', marginTop: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, padding: spacing.lg, gap: 4 },
  av: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  avText: { color: colors.brandSecondary, fontWeight: '800', fontSize: 18 },
  balAmt: { fontSize: 32, fontWeight: '800', letterSpacing: -0.5 },
  balLabel: { color: colors.onSurfaceSecondary, fontSize: 14, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 8, marginTop: spacing.md, flexWrap: 'wrap', justifyContent: 'center' },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  actionText: { color: colors.brandSecondary, fontWeight: '700', fontSize: 13.5 },
  accNote: { color: colors.mutedText, fontSize: 13, marginTop: spacing.sm, textAlign: 'center' },
  emptyText: { color: colors.mutedText, fontSize: 14, textAlign: 'center', marginTop: spacing.xl, lineHeight: 20, paddingHorizontal: spacing.lg },
  colHead: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg, marginBottom: 6, paddingHorizontal: 14 },
  colHeadText: { color: colors.mutedText, fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  colAmt: { width: 92, textAlign: 'right' },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: 18, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  entry: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11 },
  sep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  entryDate: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  entryNote: { color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 1 },
  entryMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  entryBal: { color: colors.mutedText, fontSize: 11.5 },
  photoPill: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: colors.brandTertiary },
  photoPillText: { color: colors.brandSecondary, fontSize: 11, fontWeight: '700' },
  gave: { color: colors.onError, fontSize: 15, fontWeight: '700' },
  got: { color: colors.onSuccess, fontSize: 15, fontWeight: '700' },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: 12, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  barBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 15, borderRadius: radius.md },
  barText: { fontWeight: '800', fontSize: 16 },
  dirRow: { flexDirection: 'row', gap: 8, marginBottom: spacing.md },
  dir: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  dirGave: { backgroundColor: colors.error, borderColor: colors.onError },
  dirGot: { backgroundColor: colors.success, borderColor: colors.onSuccess },
  dirText: { color: colors.onSurfaceSecondary, fontWeight: '700', fontSize: 14.5 },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.md, borderBottomWidth: 2, borderBottomColor: colors.border, paddingBottom: 4 },
  rupee: { fontSize: 30, fontWeight: '800' },
  amountInput: { flex: 1, fontSize: 32, fontWeight: '800', paddingVertical: 4 },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: spacing.sm },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 15 },
  attach: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  attachText: { color: colors.onSurface, fontWeight: '700', fontSize: 14 },
  shot: { width: 64, height: 64, borderRadius: radius.md, overflow: 'hidden' },
  shotImg: { width: 64, height: 64, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  shotX: { position: 'absolute', top: 3, right: 3, width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  save: { borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg },
  saveText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  deleteBtn: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
});
