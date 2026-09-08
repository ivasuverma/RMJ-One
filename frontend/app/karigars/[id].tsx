import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Image, Modal, TextInput,
} from 'react-native';
import { notify } from '@/src/utils/notify';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { confirmAction } from '@/src/utils/confirm';
import { istDate } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useAuth } from '@/src/auth/AuthContext';
import { ErrorState, Sheet } from '@/src/components/ui';

type Karigar = { id: string; name: string; mobile: string; is_employee: boolean };
type Entry = {
  id: string; type: 'gold_out' | 'gold_in' | 'wastage' | 'adjustment' | 'labour_payable' | 'payment' | 'receipt' | 'loss';
  weight: number | null; fine_weight?: number | null; amount: number | null; item_id?: string | null; item_code: string | null;
  note: string; created_at: string; created_by: string; slip_photo?: string | null; txn_id?: string | null;
};
type Job = {
  itemId: string; itemCode: string; entries: Entry[];
  fineBal: number; amtDue: number; slipPhoto: string | null; lastAt: string;
};

const ENTRY_LABEL: Record<Entry['type'], string> = {
  gold_out: 'Gold issued', gold_in: 'Gold received', wastage: 'Wastage adjustment', adjustment: 'Adjustment', labour_payable: 'Labour payable', payment: 'Payment made', receipt: 'Cash received', loss: 'Process loss (declared)',
};
const ENTRY_ICON: Record<Entry['type'], any> = {
  gold_out: 'arrow-redo-outline', gold_in: 'arrow-undo-outline', wastage: 'trending-down-outline', adjustment: 'swap-vertical-outline', labour_payable: 'cash-outline', payment: 'checkmark-circle-outline', receipt: 'download-outline', loss: 'flame-outline',
};

export default function KarigarLedgerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const { hasRight } = useAuth();
  const canDeleteEntry = hasRight('karigar_ledger', 'delete');
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [karigar, setKarigar] = useState<Karigar | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [weightBalance, setWeightBalance] = useState(0);
  const [fineWeightBalance, setFineWeightBalance] = useState(0);
  const [amountDue, setAmountDue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);

  // Settle Balance — records a metal or cash transaction against one or
  // more selected jobs at once, clearing each job's own outstanding balance
  // in that dimension rather than a single freeform adjustment.
  const [settleOpen, setSettleOpen] = useState(false);
  const [settleKind, setSettleKind] = useState<'metal' | 'cash'>('metal');
  const [settleDir, setSettleDir] = useState<'pay' | 'receive'>('receive');
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  const [settleNote, setSettleNote] = useState('');
  const [settleBusy, setSettleBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setError('');
      const res = await api.get<{ karigar: Karigar; entries: Entry[]; weight_balance: number; fine_weight_balance?: number; amount_due: number }>(`/karigars/${id}/ledger`);
      setKarigar(res.karigar); setEntries(res.entries); setWeightBalance(res.weight_balance); setFineWeightBalance(res.fine_weight_balance ?? 0); setAmountDue(res.amount_due);
    } catch (e: any) { setError(e?.detail || 'Failed to load karigar'); }
    finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Group ledger entries by repair job (item_code) so a karigar's activity on
  // a given tag — issued, received, wastage, settlement, slip photo — reads
  // together instead of being interleaved with every other job chronologically.
  // Entries with no item_code (general cash/metal adjustments not tied to a
  // specific tag) fall through to a flat "Other Entries" list.
  const { jobs, general } = useMemo(() => {
    const map = new Map<string, Job>();
    const gen: Entry[] = [];
    for (const e of entries) {
      if (!e.item_code) { gen.push(e); continue; }
      const key = e.item_id || e.item_code;
      let j = map.get(key);
      if (!j) {
        j = { itemId: key, itemCode: e.item_code, entries: [], fineBal: 0, amtDue: 0, slipPhoto: null, lastAt: e.created_at };
        map.set(key, j);
      }
      j.entries.push(e);
      if (e.type === 'gold_out') j.fineBal += (e.fine_weight ?? e.weight) || 0;
      else if (e.type === 'gold_in') j.fineBal -= (e.fine_weight ?? e.weight) || 0;
      else if (e.type === 'labour_payable' || e.type === 'receipt') j.amtDue += e.amount || 0;
      else if (e.type === 'payment') j.amtDue -= e.amount || 0;
      else if (e.type === 'wastage' || e.type === 'adjustment') j.amtDue += e.amount || 0;
      if (e.slip_photo) j.slipPhoto = e.slip_photo;
      if (e.created_at > j.lastAt) j.lastAt = e.created_at;
    }
    const list = Array.from(map.values());
    list.sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
    for (const j of list) j.entries.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return { jobs: list, general: gen };
  }, [entries]);

  // Most recent job open by default; everything else collapsed so the screen
  // stays scannable even with a long history. Only sets this once per load —
  // once the user has toggled anything, leave their choices alone.
  useEffect(() => {
    if (jobs.length && expanded.size === 0) setExpanded(new Set([jobs[0].itemId]));
  }, [jobs]);

  // Which jobs a given Settle Balance direction can actually apply to — a
  // job's own balance has to be outstanding in the matching direction:
  // fineBal > 0 (gold still with the karigar) is what Receive Metal clears;
  // fineBal < 0 (excess returned) is what Pay Metal clears; same idea for
  // amtDue and cash. Mixed-direction jobs just don't show up for the wrong
  // action rather than needing a per-job override.
  const settleEligibleJobs = useMemo(() => {
    if (settleKind === 'metal') {
      return jobs.filter((j) => (settleDir === 'receive' ? j.fineBal > 0.001 : j.fineBal < -0.001));
    }
    return jobs.filter((j) => (settleDir === 'pay' ? j.amtDue > 0.5 : j.amtDue < -0.5));
  }, [jobs, settleKind, settleDir]);
  const settleTotal = useMemo(
    () => settleEligibleJobs.filter((j) => selectedJobs.has(j.itemId))
      .reduce((s, j) => s + Math.abs(settleKind === 'metal' ? j.fineBal : j.amtDue), 0),
    [settleEligibleJobs, selectedJobs, settleKind],
  );

  const openSettle = () => { setSelectedJobs(new Set()); setSettleNote(''); setSettleOpen(true); };
  const toggleSettleJob = (itemId: string) => {
    setSelectedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  };
  const submitSettle = async () => {
    if (selectedJobs.size === 0) { notify('Nothing selected', 'Pick at least one job to settle.'); return; }
    setSettleBusy(true);
    try {
      const type = settleKind === 'metal'
        ? (settleDir === 'pay' ? 'gold_out' : 'gold_in')
        : (settleDir === 'pay' ? 'payment' : 'receipt');
      for (const job of settleEligibleJobs) {
        if (!selectedJobs.has(job.itemId)) continue;
        const magnitude = Math.abs(settleKind === 'metal' ? job.fineBal : job.amtDue);
        const payload: any = { type, note: settleNote.trim(), item_id: job.itemId, item_code: job.itemCode };
        if (settleKind === 'metal') payload.weight = magnitude; else payload.amount = magnitude;
        await api.post(`/karigars/${id}/ledger`, payload);
      }
      setSettleOpen(false);
      await load();
    } catch (err: any) {
      notify('Failed', err?.detail || 'Could not record this settlement.');
    } finally {
      setSettleBusy(false);
    }
  };

  const toggleJob = (itemId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  };

  const removeEntry = (e: Entry) => {
    confirmAction(
      'Delete entry?',
      `Remove this ${ENTRY_LABEL[e.type].toLowerCase()} entry? This cannot be undone.`,
      'Delete',
      async () => {
        setDeletingId(e.id);
        try { await api.del(`/karigars/${id}/ledger/${e.id}`); await load(); }
        catch (err: any) { notify('Failed', err?.detail || 'Could not delete this entry.'); }
        finally { setDeletingId(''); }
      },
    );
  };

  const renderEntry = (e: Entry, showItemCode: boolean) => (
    <View key={e.id} style={styles.entryRow} testID={`entry-${e.id}`}>
      <View style={styles.entryIcon}><Ionicons name={ENTRY_ICON[e.type]} size={16} color={colors.brandSecondary} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.entryTitle}>{ENTRY_LABEL[e.type]}{showItemCode && e.item_code ? ` · ${e.item_code}` : ''}</Text>
        <Text style={styles.entryMeta}>{e.note || '—'} · {istDate(e.created_at)} · {e.created_by}</Text>
      </View>
      <Text style={styles.entryValue}>
        {e.weight != null ? `${e.weight.toFixed(3)}g` : e.amount != null ? `₹${Math.abs(e.amount).toFixed(0)}` : ''}
      </Text>
      {e.slip_photo ? (
        <Pressable onPress={() => setPreviewPhoto(e.slip_photo!)} hitSlop={8} testID={`entry-photo-${e.id}`}>
          <Image source={{ uri: e.slip_photo }} style={styles.entryThumb} />
        </Pressable>
      ) : null}
      {!e.txn_id && canDeleteEntry && (
        <Pressable onPress={() => removeEntry(e)} disabled={deletingId === e.id} style={styles.entryDelBtn} hitSlop={8} testID={`del-entry-${e.id}`}>
          {deletingId === e.id ? <ActivityIndicator size="small" color={colors.onError} /> : <Ionicons name="trash-outline" size={14} color={colors.onError} />}
        </Pressable>
      )}
    </View>
  );

  if (loading || !karigar) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }} />
          <View style={{ width: 40 }} />
        </View>
        {loading ? (
          <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
        ) : (
          <View style={{ padding: spacing.lg }}><ErrorState message={error || 'Karigar not found'} onRetry={load} testID="karigar-detail-error" /></View>
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="karigar-ledger-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{karigar.name}</Text>
        <Pressable onPress={openSettle} style={styles.iconBtn} testID="open-settle-btn" hitSlop={12}>
          <Ionicons name="swap-horizontal-outline" size={20} color={colors.onSurface} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
        <View style={styles.summaryRow}>
            <View style={styles.summaryTile}>
              <Text style={styles.summaryValue}>{weightBalance.toFixed(3)}g</Text>
              <Text style={styles.summaryLabel}>Gross wt with karigar</Text>
            </View>
            <View style={styles.summaryTile}>
              <Text style={styles.summaryValue}>{fineWeightBalance.toFixed(3)}g</Text>
              <Text style={styles.summaryLabel}>Fine wt with karigar</Text>
            </View>
            <View style={styles.summaryTile}>
              <Text style={[styles.summaryValue, amountDue > 0 && { color: colors.onWarning }]}>₹{amountDue.toFixed(0)}</Text>
              <Text style={styles.summaryLabel}>Amount due</Text>
            </View>
          </View>

          <Text style={styles.section}>Jobs · {jobs.length}</Text>
          {jobs.length === 0 && general.length === 0 ? (
            <View style={styles.empty}><Text style={styles.emptyText}>No ledger entries yet</Text></View>
          ) : null}

          {jobs.map((job) => {
            const isOpen = expanded.has(job.itemId);
            const fineLabel = Math.abs(job.fineBal) < 0.001
              ? 'Fine settled'
              : `${Math.abs(job.fineBal).toFixed(3)}g fine ${job.fineBal > 0 ? 'with karigar' : 'excess returned'}`;
            const amtLabel = Math.abs(job.amtDue) < 0.5
              ? ''
              : ` · ₹${Math.abs(job.amtDue).toFixed(0)} ${job.amtDue > 0 ? 'due to karigar' : 'owed by karigar'}`;
            return (
              <View key={job.itemId} style={styles.jobCard} testID={`job-${job.itemId}`}>
                <Pressable style={styles.jobHeader} onPress={() => toggleJob(job.itemId)} testID={`job-toggle-${job.itemId}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.jobCode}>{job.itemCode}</Text>
                    <Text style={styles.jobMeta}>{fineLabel}{amtLabel}</Text>
                  </View>
                  {job.slipPhoto ? (
                    <Pressable onPress={() => setPreviewPhoto(job.slipPhoto!)} hitSlop={8} testID={`job-photo-${job.itemId}`}>
                      <Image source={{ uri: job.slipPhoto }} style={styles.jobThumb} />
                    </Pressable>
                  ) : null}
                  <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.mutedText} style={{ marginLeft: spacing.xs }} />
                </Pressable>
                {isOpen && (
                  <View style={styles.jobEntries}>
                    {job.entries.map((e) => renderEntry(e, false))}
                  </View>
                )}
              </View>
            );
          })}

          {general.length > 0 && (
            <>
              <Text style={[styles.section, { marginTop: spacing.md }]}>Other Entries · {general.length}</Text>
              {general.map((e) => renderEntry(e, true))}
            </>
          )}
      </ScrollView>

      <Modal visible={!!previewPhoto} transparent animationType="fade" onRequestClose={() => setPreviewPhoto(null)}>
        <Pressable style={styles.previewOverlay} onPress={() => setPreviewPhoto(null)} testID="photo-preview-overlay">
          {previewPhoto ? <Image source={{ uri: previewPhoto }} style={styles.previewImage} resizeMode="contain" /> : null}
        </Pressable>
      </Modal>

      <Sheet visible={settleOpen} onClose={() => setSettleOpen(false)} title="Settle Balance" testID="settle-sheet">
        <Text style={styles.settleLabel}>Kind</Text>
        <View style={styles.settleChoiceRow}>
          <Pressable
            onPress={() => { setSettleKind('metal'); setSelectedJobs(new Set()); }}
            style={[styles.settleChip, settleKind === 'metal' && styles.settleChipActive]} testID="settle-kind-metal"
          >
            <Text style={[styles.settleChipText, settleKind === 'metal' && styles.settleChipTextActive]}>Metal</Text>
          </Pressable>
          <Pressable
            onPress={() => { setSettleKind('cash'); setSelectedJobs(new Set()); }}
            style={[styles.settleChip, settleKind === 'cash' && styles.settleChipActive]} testID="settle-kind-cash"
          >
            <Text style={[styles.settleChipText, settleKind === 'cash' && styles.settleChipTextActive]}>Cash</Text>
          </Pressable>
        </View>

        <Text style={styles.settleLabel}>Direction</Text>
        <View style={styles.settleChoiceRow}>
          <Pressable
            onPress={() => { setSettleDir('receive'); setSelectedJobs(new Set()); }}
            style={[styles.settleChip, settleDir === 'receive' && styles.settleChipActive]} testID="settle-dir-receive"
          >
            <Text style={[styles.settleChipText, settleDir === 'receive' && styles.settleChipTextActive]}>
              {settleKind === 'metal' ? 'Receive Metal' : 'Receive Cash'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => { setSettleDir('pay'); setSelectedJobs(new Set()); }}
            style={[styles.settleChip, settleDir === 'pay' && styles.settleChipActive]} testID="settle-dir-pay"
          >
            <Text style={[styles.settleChipText, settleDir === 'pay' && styles.settleChipTextActive]}>
              {settleKind === 'metal' ? 'Pay Metal' : 'Pay Cash'}
            </Text>
          </Pressable>
        </View>

        <Text style={styles.settleLabel}>Jobs — pick one or more to settle</Text>
        {settleEligibleJobs.length === 0 ? (
          <Text style={styles.settleEmpty}>No jobs have an outstanding balance for this direction.</Text>
        ) : (
          <ScrollView style={styles.settleJobList} contentContainerStyle={{ gap: spacing.xs }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {settleEligibleJobs.map((j) => {
              const checked = selectedJobs.has(j.itemId);
              const magnitude = Math.abs(settleKind === 'metal' ? j.fineBal : j.amtDue);
              return (
                <Pressable
                  key={j.itemId} onPress={() => toggleSettleJob(j.itemId)}
                  style={[styles.settleJobRow, checked && styles.settleJobRowActive]}
                  testID={`settle-job-${j.itemId}`}
                >
                  <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={19} color={checked ? colors.brandPrimary : colors.mutedText} />
                  <Text style={styles.settleJobCode}>{j.itemCode}</Text>
                  <Text style={styles.settleJobAmt}>{settleKind === 'metal' ? `${magnitude.toFixed(3)}g` : `₹${magnitude.toFixed(0)}`}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {selectedJobs.size > 0 && (
          <View style={styles.settleTotalRow}>
            <Text style={styles.settleTotalLabel}>Total ({selectedJobs.size} job{selectedJobs.size === 1 ? '' : 's'})</Text>
            <Text style={styles.settleTotalValue}>{settleKind === 'metal' ? `${settleTotal.toFixed(3)}g` : `₹${settleTotal.toFixed(0)}`}</Text>
          </View>
        )}

        <Text style={styles.settleLabel}>Note (optional)</Text>
        <TextInput
          testID="settle-note" value={settleNote} onChangeText={setSettleNote}
          placeholder="Anything worth noting" placeholderTextColor={colors.mutedText}
          style={styles.settleInput}
        />

        <Pressable
          onPress={submitSettle} disabled={settleBusy || selectedJobs.size === 0}
          style={[styles.settleSaveBtn, (settleBusy || selectedJobs.size === 0) && { opacity: 0.5 }]}
          testID="settle-submit-btn"
        >
          {settleBusy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.settleSaveBtnText}>Record Settlement</Text>}
        </Pressable>
      </Sheet>
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

  summaryRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  summaryTile: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center' },
  summaryValue: { color: colors.onSurface, fontSize: 20, fontWeight: '700' },
  summaryLabel: { color: colors.mutedText, fontSize: 11, marginTop: 4, textAlign: 'center' },

  section: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm },
  empty: { paddingVertical: 30, alignItems: 'center' },
  emptyText: { color: colors.mutedText },

  jobCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    marginBottom: spacing.sm, overflow: 'hidden',
  },
  jobHeader: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.sm },
  jobCode: { color: colors.onSurface, fontSize: 14, fontWeight: '700' },
  jobMeta: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  jobThumb: { width: 34, height: 34, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  jobEntries: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },

  entryRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  entryIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  entryTitle: { color: colors.onSurface, fontSize: 13, fontWeight: '700' },
  entryMeta: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  entryValue: { color: colors.onSurface, fontSize: 13, fontWeight: '700' },
  entryThumb: { width: 30, height: 30, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  entryDelBtn: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: colors.error,
    alignItems: 'center', justifyContent: 'center', marginLeft: spacing.xs,
  },

  previewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center' },
  previewImage: { width: '92%', height: '80%' },

  settleLabel: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6, marginTop: spacing.md },
  settleChoiceRow: { flexDirection: 'row', gap: spacing.sm },
  settleChip: {
    flex: 1, paddingVertical: 10, borderRadius: radius.md, alignItems: 'center',
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  settleChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  settleChipText: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: '700' },
  settleChipTextActive: { color: colors.onBrandPrimary },

  settleEmpty: { color: colors.mutedText, fontSize: 13, paddingVertical: spacing.md },
  settleJobList: { maxHeight: 220 },
  settleJobRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingVertical: 10, paddingHorizontal: spacing.md,
  },
  settleJobRowActive: { borderColor: colors.brandPrimary },
  settleJobCode: { flex: 1, color: colors.onSurface, fontSize: 13, fontWeight: '700' },
  settleJobAmt: { color: colors.onSurface, fontSize: 13, fontWeight: '700' },

  settleTotalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider,
  },
  settleTotalLabel: { color: colors.mutedText, fontSize: 12, fontWeight: '600' },
  settleTotalValue: { color: colors.onSurface, fontSize: 16, fontWeight: '800' },

  settleInput: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },
  settleSaveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg },
  settleSaveBtnText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 14 },
});
