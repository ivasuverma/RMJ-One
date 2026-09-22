import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, RefreshControl, Image, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { confirmAction } from '@/src/utils/confirm';
import { DateField } from '@/src/components/DateField';
import { RecordPhotos } from '@/src/components/RecordPhotos';
import { pickWebFile, makeThumb } from '@/src/components/DocumentCaptureSheet';
import { compressImage } from '@/src/components/QuickDocCapture';
import { enqueueRecordPhoto } from '@/src/utils/uploadQueue';
import { displayDateOnlyWithWeekday, localDateStr, todayIST } from '@/src/utils/datetime';
import { fmtCompactINR } from '@/src/utils/money';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { counterToneFor } from '@/src/theme/palettes';
import { useAuth } from '@/src/auth/AuthContext';
import { Card, ErrorState, SegmentedControl, Sheet, useToast } from '@/src/components/ui';

type EntryType = 'received' | 'paid';
type Kind = EntryType | 'transfer';
type Entry = {
  id: string; date: string; counter_id: string; type: EntryType; amount: number; name: string;
  category?: string | null; note?: string; created_at: string; created_by?: string;
  linked_entry_id?: string | null; transfer_counter_id?: string | null; photo_count?: number;
};
type DayData = {
  date: string; counter_id: string; counter_name: string; opening_balance: number; entries: Entry[];
  total_received: number; total_paid: number; closing_balance: number;
};
type Counter = { id: string; name: string; closing_balance: number; color?: string | null; active: boolean };
type CounterLite = { id: string; name: string };
type QuickName = { id: string; name: string; entry_type: EntryType | null };
type Shot = { id: string; blob: Blob; thumb: string };
type Filter = 'all' | 'received' | 'paid' | 'transfer';

const fmt = (n: number) => Math.round(Math.abs(n || 0)).toLocaleString('en-IN');
const inr = (n: number) => `${n < 0 ? '−' : ''}₹${fmt(n)}`;

// The newer Cash Book view: one running statement per location and day (Received / Paid / Transfer in a single ordered
// list, with the balance after every entry), a summary card on top, and Received/Paid buttons that open the compose sheet.
// Optional — reached from the default (classic) Cash Book tab via its ✨ button ("Classic view" here returns to it).
export default function CashBookScreen() {
  const router = useRouter();
  const { colors, scheme } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const { user, hasRight } = useAuth();
  const canEdit = hasRight('cash_book', 'edit');
  const canDelete = hasRight('cash_book', 'delete');
  const isOwner = user?.role === 'owner';
  // Employees see only today's book — no back-dating / browsing past days.
  const isEmployee = user?.role === 'employee';

  const [date, setDate] = useState(todayIST());
  const [counters, setCounters] = useState<Counter[]>([]);
  const [counterId, setCounterId] = useState('');
  const [countersLoading, setCountersLoading] = useState(true);
  const [transferOptions, setTransferOptions] = useState<CounterLite[]>([]);
  const [quickNames, setQuickNames] = useState<QuickName[]>([]);
  const [day, setDay] = useState<DayData | null>(null);
  const [dayError, setDayError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  // Compose / edit sheet
  const [sheet, setSheet] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [kind, setKind] = useState<EntryType>('received');
  // Only meaningful for a new entry (or one already linked as a transfer) —
  // there's no Received/Paid/Transfer selector in the sheet any more, so
  // this toggle is the only way in, matching the classic Cash Book view.
  const [isTransfer, setIsTransfer] = useState(false);
  const [amount, setAmount] = useState('');
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [note, setNote] = useState('');
  const [dest, setDest] = useState('');
  const [dir, setDir] = useState<'out' | 'in'>('out');   // transfer: cash leaving this location, or arriving into it
  const [shots, setShots] = useState<Shot[]>([]);   // receipt photos taken in this sheet, uploaded once the entry is saved
  const [capturing, setCapturing] = useState(false);
  const [addingTag, setAddingTag] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [busy, setBusy] = useState(false);

  const loadCounters = useCallback(async () => {
    try {
      const res = await api.get<Counter[]>('/cashbook/counters');
      setCounters(res);
      setCounterId((prev) => (prev && res.some((c) => c.id === prev) ? prev : res[0]?.id || ''));
    } catch { setCounters([]); }
    finally { setCountersLoading(false); }
  }, []);
  const loadRefs = useCallback(async () => {
    try { setQuickNames(await api.get<QuickName[]>('/cashbook/quick-names')); } catch { /* tags stay as they were */ }
    try { setTransferOptions(await api.get<CounterLite[]>('/cashbook/counters/transfer-options')); } catch { /* ignore */ }
  }, []);
  useFocusEffect(useCallback(() => { loadCounters(); loadRefs(); }, [loadCounters, loadRefs]));

  const load = useCallback(async (d: string, cid: string) => {
    setDayError('');
    if (!cid) { setDay(null); setLoading(false); setRefreshing(false); return; }
    try { setDay(await api.get<DayData>(`/cashbook/day?date=${d}&counter_id=${cid}`)); }
    catch (e: any) { setDay(null); setDayError(e?.detail || 'Failed to load this day'); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => {
    if (countersLoading) return;
    setLoading(true); load(date, counterId);
  }, [load, date, counterId, countersLoading]));

  const shiftDay = (delta: number) => {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    setDate(localDateStr(d));
  };
  const isToday = date === todayIST();

  // Running balance after every entry, from the day's opening balance in the order the API returns them.
  const rows = useMemo(() => {
    let bal = day?.opening_balance || 0;
    return (day?.entries || []).map((e) => {
      bal += e.type === 'received' ? e.amount : -e.amount;
      return { e, bal: Math.round(bal * 100) / 100, transfer: !!e.linked_entry_id };
    });
  }, [day]);
  const shown = rows.filter((r) => filter === 'all' || (filter === 'transfer' ? r.transfer : !r.transfer && filter === r.e.type));
  const net = day ? day.total_received - day.total_paid : 0;
  const otherCounters = transferOptions.filter((c) => c.id !== counterId);
  const tags = quickNames.filter((q) => !isTransfer && (q.entry_type == null || q.entry_type === kind));
  const counterName = (id?: string | null) => transferOptions.find((c) => c.id === id)?.name || counters.find((c) => c.id === id)?.name || '';

  // Tints the whole page to the selected counter's colour, so switching
  // counters is unmistakable even at a glance — matches its chip's colour.
  const selectedCounterIndex = counters.findIndex((c) => c.id === counterId);
  const pageTone = selectedCounterIndex >= 0 ? counterToneFor(colors, scheme, counters[selectedCounterIndex].color, selectedCounterIndex) : null;

  const openAdd = (k: EntryType = 'received') => {
    setEditing(null); setKind(k); setIsTransfer(false); setAmount(''); setName(''); setTag(''); setNote(''); setDest('');
    // Opened via the Received button defaults a Transfer's direction to
    // "Receive in"; via Paid, to "Send out" — matches the button they tapped.
    setDir(k === 'paid' ? 'out' : 'in');
    setShots([]);
    setAddingTag(false); setNewTag(''); setSheet(true);
  };
  const openEdit = (e: Entry) => {
    setEditing(e); setKind(e.type); setIsTransfer(!!e.linked_entry_id); setAmount(String(e.amount)); setName(e.name);
    setTag(e.category || ''); setNote(e.note || ''); setDest(e.transfer_counter_id || ''); setShots([]);
    setAddingTag(false); setNewTag(''); setSheet(true);
  };

  const saveTag = async () => {
    const n = newTag.trim();
    if (!n || isTransfer) return;
    try {
      const created = await api.post<QuickName>('/cashbook/quick-names', { name: n, entry_type: kind });
      setQuickNames((p) => (p.some((q) => q.id === created.id) ? p : [...p, created].sort((a, b) => a.name.localeCompare(b.name))));
      setTag(created.name); setNewTag(''); setAddingTag(false);
    } catch (e: any) { toast.error(e?.detail || 'Could not add the tag'); }
  };

  const submit = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error('Enter an amount greater than 0'); return; }
    if (!counterId) { toast.error('Add a Cash Book counter first'); return; }
    if (isTransfer && !editing && !dest) { toast.error('Pick where the cash is going'); return; }
    if (!isTransfer && !tag.trim()) { toast.error('Pick a tag for this entry'); return; }
    const label = isTransfer ? `Transfer ${dir === 'out' ? 'to' : 'from'} ${counterName(dest)}` : (name.trim() || tag.trim());
    if (!label) { toast.error('Enter a name or pick a tag'); return; }
    setBusy(true);
    const payload: any = { date, amount: amt, name: isTransfer && editing ? name.trim() || label : label, category: isTransfer ? '' : tag.trim(), note };
    if (!editing || !editing.linked_entry_id) { payload.counter_id = counterId; payload.type = isTransfer ? (dir === 'out' ? 'paid' : 'received') : kind; }
    if (isTransfer && !editing) payload.transfer_counter_id = dest;
    try {
      let savedId = editing?.id || '';
      if (editing) await api.put(`/cashbook/entries/${editing.id}`, payload);
      else savedId = (await api.post<{ id: string }>('/cashbook/entries', payload)).id;
      if (shots.length && savedId) await uploadReceipts(savedId, shots);
      setSheet(false); toast.success(editing ? 'Entry updated' : 'Entry saved');
      await load(date, counterId);
    } catch (e: any) { toast.error(e?.detail || 'Please try again'); }
    finally { setBusy(false); }
  };

  // Same background upload the other record photos use: Drive keeps the full photo, the app keeps a thumbnail.
  const uploadReceipts = async (entryId: string, list: Shot[]) => {
    try {
      for (const s of list) await enqueueRecordPhoto({ id: s.id, blob: s.blob, filename: `cashbook-${Date.now()}.jpg`, thumb: s.thumb, ref_type: 'cashbook_entry', ref_id: entryId });
    } catch { toast.error('Entry saved, but a receipt photo could not be queued'); }
  };

  // Quick-capture style: the camera opens straight away, and "Add another" keeps going — all photos belong to this entry.
  const shoot = async (gallery = false) => {
    if (capturing || Platform.OS !== 'web') return;
    setCapturing(true);
    try {
      const f = await pickWebFile('image/*', !gallery);
      if (!f) return;
      const blob = await compressImage(f, true);
      const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      setShots((p) => [...p, { id, blob, thumb: '' }]);
      const thumb = await makeThumb(f);
      setShots((p) => p.map((s) => (s.id === id ? { ...s, thumb } : s)));
    } catch { toast.error('Could not read that photo'); }
    finally { setCapturing(false); }
  };

  const confirmDelete = (e: Entry) => {
    const other = e.linked_entry_id ? counterName(e.transfer_counter_id) : '';
    confirmAction(
      'Delete entry?',
      other ? `Remove "${e.name}" (${inr(e.amount)}) — this also removes the matching transfer entry in ${other}. This cannot be undone.`
        : `Remove "${e.name}" (${inr(e.amount)}) from this day's cash book. This cannot be undone.`,
      'Delete',
      async () => {
        try { await api.del(`/cashbook/entries/${e.id}`); setSheet(false); toast.success('Entry deleted'); await load(date, counterId); }
        catch (err: any) { toast.error(err?.detail || 'Please try again'); }
      },
    );
  };

  const kindColor = (k: Kind) => (k === 'received' ? colors.onSuccess : k === 'paid' ? colors.onError : colors.onInfo);
  const kindBg = (k: Kind) => (k === 'received' ? colors.success : k === 'paid' ? colors.error : colors.info);
  const editingTransfer = !!editing?.linked_entry_id;

  return (
    <SafeAreaView style={[styles.root, pageTone && { backgroundColor: pageTone.pageBg }]} edges={['top']} testID="cashbook-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Cash Book</Text>
        <Pressable onPress={() => router.back()} style={styles.classicBtn} testID="cashbook-classic-btn" hitSlop={8}>
          <Ionicons name="reader-outline" size={15} color={colors.onSurfaceSecondary} />
          <Text style={styles.classicText}>Classic view</Text>
        </Pressable>
        {isOwner ? (
          <Pressable onPress={() => router.push('/cashbook?manage=1' as any)} style={styles.iconBtn} testID="cashbook-settings-btn" hitSlop={12}>
            <Ionicons name="settings-outline" size={19} color={colors.onSurface} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.stickyBar}>
        {!isEmployee && (
          <View style={styles.dayNav}>
            <Pressable onPress={() => shiftDay(-1)} style={styles.navBtn} testID="cashbook-prev-day" hitSlop={10}>
              <Ionicons name="chevron-back" size={18} color={colors.onSurface} />
            </Pressable>
            <View style={{ flex: 1 }}><DateField value={date} onChange={setDate} testID="cashbook-date-field" /></View>
            <Pressable onPress={() => shiftDay(1)} style={styles.navBtn} testID="cashbook-next-day" hitSlop={10}>
              <Ionicons name="chevron-forward" size={18} color={colors.onSurface} />
            </Pressable>
            {!isToday && (
              <Pressable onPress={() => setDate(todayIST())} style={styles.todayPill} testID="cashbook-today-btn">
                <Text style={styles.todayText}>Today</Text>
              </Pressable>
            )}
          </View>
        )}

        {counters.length > 1 && (
          <View style={styles.counterRow}>
            {counters.map((c, i) => {
              const tone = counterToneFor(colors, scheme, c.color, i);
              const active = counterId === c.id;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => setCounterId(c.id)}
                  style={[
                    styles.counterChip,
                    { backgroundColor: tone.bg },
                    active && { borderColor: tone.text, borderWidth: 2 },
                  ]}
                  testID={`cashbook-counter-${c.id}`}
                >
                  <Text style={[styles.counterChipText, { color: tone.text }, active && styles.counterChipTextActive]}>{c.name}</Text>
                  <Text style={[styles.counterChipBalance, { color: tone.text }]}>{fmtCompactINR(c.closing_balance)}</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        <Text style={styles.dayLabel}>{isToday ? 'Today · ' : ''}{displayDateOnlyWithWeekday(date)}</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: 100, gap: spacing.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(date, counterId); }} tintColor={colors.brandPrimary} />}
      >
        {loading ? <View style={{ paddingVertical: 60 }}><ActivityIndicator color={colors.brandPrimary} /></View>
          : dayError ? <ErrorState message={dayError} onRetry={() => load(date, counterId)} testID="cashbook-day-error" />
          : !day ? <Text style={styles.empty}>No Cash Book location is set up yet.</Text> : (
          <>
            <Card style={styles.heroCard}>
              <View style={styles.heroTotals}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.heroLabel}>Received</Text>
                  <Text style={[styles.heroSmall, { color: colors.onSuccess }]} testID="cashbook-total-received">{inr(day.total_received)}</Text>
                </View>
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                  <Text style={styles.heroLabel}>Paid</Text>
                  <Text style={[styles.heroSmall, { color: colors.onError }]} testID="cashbook-total-paid">{inr(day.total_paid)}</Text>
                </View>
              </View>
              <View style={styles.heroRule} />
              <View style={styles.heroCloseRow}>
                <View>
                  <Text style={styles.heroLabel}>Closing · {day.counter_name}</Text>
                  <Text style={styles.heroBig} testID="cashbook-closing">{inr(day.closing_balance)}</Text>
                </View>
                <Text style={[styles.net, { color: net >= 0 ? colors.onSuccess : colors.onError }]}>
                  {net >= 0 ? '▲' : '▼'} {inr(Math.abs(net))} net {isToday ? 'today' : 'this day'}
                </Text>
              </View>
            </Card>

            <SegmentedControl
              testID="cashbook-filter"
              options={[{ key: 'all', label: 'All' }, { key: 'received', label: 'Received' }, { key: 'paid', label: 'Paid' }, { key: 'transfer', label: 'Transfers' }]}
              value={filter} onChange={(k) => setFilter(k as Filter)}
              tones={{ received: { bg: colors.success, fg: colors.onSuccess }, paid: { bg: colors.error, fg: colors.onError }, transfer: { bg: colors.info, fg: colors.onInfo } }}
            />

            <View style={styles.opening} testID="cashbook-opening">
              <Text style={styles.openingVal}>{inr(day.opening_balance)}</Text>
              <Text style={styles.openingLabel}>Opening balance</Text>
            </View>

            {shown.length === 0 ? (
              <Text style={styles.empty}>{day.entries.length === 0 ? 'No entries yet for this day.' : 'Nothing matches this filter.'}</Text>
            ) : (
              <View style={styles.list}>
                {shown.map(({ e, bal, transfer }, i) => {
                  const k: Kind = transfer ? 'transfer' : e.type;
                  const title = transfer ? `${e.type === 'paid' ? 'To' : 'From'} ${counterName(e.transfer_counter_id) || e.name.replace(/^Transfer\s+(to|from)\s+/i, '')}` : e.name;
                  const sub = transfer ? (e.type === 'paid' ? 'Transfer out ↑' : 'Transfer in ↓') : e.category || '';
                  return (
                    <Pressable key={e.id} disabled={!canEdit} onPress={() => openEdit(e)}
                      style={[styles.row, i > 0 && styles.rowBorder]} testID={`cashbook-entry-${e.id}`}>
                      <View style={[styles.rowIcon, { backgroundColor: kindBg(k) }]}>
                        <Ionicons name={k === 'received' ? 'arrow-down' : k === 'paid' ? 'arrow-up' : 'swap-horizontal'} size={17} color={kindColor(k)} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.rowName} numberOfLines={1}>{title}</Text>
                        <View style={styles.rowMeta}>
                          {sub ? <Text style={styles.tag} numberOfLines={1}>{sub}</Text> : null}
                          {e.note ? <Text style={styles.rowNote} numberOfLines={1}>{e.note}</Text> : null}
                          {(e.photo_count || 0) > 0 ? <Ionicons name="camera-outline" size={13} color={colors.mutedText} /> : null}
                        </View>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[styles.rowAmt, { color: e.type === 'received' ? colors.onSuccess : colors.onError }]}>
                          {e.type === 'received' ? '+' : '−'}₹{fmt(e.amount)}
                        </Text>
                        <Text style={styles.rowBal}>bal {inr(bal)}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {counterId ? (
        <View style={styles.fabRow}>
          <Pressable onPress={() => openAdd('received')} style={[styles.fab, { backgroundColor: colors.brandPrimary }]} testID="cashbook-add-received">
            <Ionicons name="add" size={18} color={colors.onBrandPrimary} />
            <Text style={styles.fabText}>Received</Text>
          </Pressable>
          <Pressable onPress={() => openAdd('paid')} style={[styles.fab, styles.fabSecondary]} testID="cashbook-add-paid">
            <Ionicons name="add" size={18} color={colors.onSurface} />
            <Text style={[styles.fabText, { color: colors.onSurface }]}>Paid</Text>
          </Pressable>
        </View>
      ) : null}

      <Sheet visible={sheet} onClose={() => setSheet(false)} title={editing ? 'Edit entry' : (kind === 'received' ? 'Cash Received' : 'Cash Paid')} testID="cashbook-sheet">
        <View style={{ gap: spacing.md }}>
          {editing ? (
            editingTransfer ? <Text style={styles.hint}>A transfer's direction and location can't change — delete it and add it again to change them.</Text> : null
          ) : null}
          <View style={styles.amountBox}>
            <Text style={styles.rupee}>₹</Text>
            <TextInput testID="cashbook-amount" value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad"
              placeholder="0" placeholderTextColor={colors.mutedText} style={styles.amountInput} autoFocus={!editing} />
          </View>

          {!editing && otherCounters.length > 0 && (
            <Pressable
              onPress={() => { setIsTransfer((v) => !v); setDest(''); setTag(''); }}
              style={[styles.transferToggleBtn, isTransfer && styles.transferToggleBtnActive]}
              testID="cashbook-transfer-toggle"
            >
              <Ionicons name="swap-horizontal-outline" size={16} color={isTransfer ? colors.onBrandPrimary : colors.brandSecondary} />
              <Text style={[styles.transferToggleText, isTransfer && styles.transferToggleTextActive]}>
                This is a transfer to/from another counter
              </Text>
            </Pressable>
          )}

          {isTransfer ? (
            !editing ? (
              <View>
                <Text style={styles.label}>
                  {dir === 'out' ? `Move cash from ${counters.find((c) => c.id === counterId)?.name || 'here'} to` : `Bring cash into ${counters.find((c) => c.id === counterId)?.name || 'here'} from`}
                </Text>
                <View style={styles.chips}>
                  {otherCounters.map((c) => (
                    <Pressable key={c.id} onPress={() => setDest(c.id)} style={[styles.chip, dest === c.id && styles.chipOn]} testID={`cashbook-dest-${c.id}`}>
                      <Text style={[styles.chipText, dest === c.id && styles.chipTextOn]}>{c.name}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null
          ) : (
            <>
              <View>
                <Text style={styles.label}>Name</Text>
                <TextInput testID="cashbook-name" value={name} onChangeText={setName} placeholder="e.g. Ajay Sood advance, Milk"
                  placeholderTextColor={colors.mutedText} style={styles.input} />
              </View>
              <View>
                <Text style={styles.label}>Tag</Text>
                <View style={styles.chips}>
                  {tags.map((q) => (
                    <Pressable key={q.id} onPress={() => setTag(tag === q.name ? '' : q.name)} style={[styles.chip, tag === q.name && styles.chipOn]}>
                      <Text style={[styles.chipText, tag === q.name && styles.chipTextOn]}>{q.name}</Text>
                    </Pressable>
                  ))}
                  {tag && !tags.some((q) => q.name === tag) ? (
                    <Pressable onPress={() => setTag('')} style={[styles.chip, styles.chipOn]}><Text style={[styles.chipText, styles.chipTextOn]}>{tag}</Text></Pressable>
                  ) : null}
                  {!addingTag ? (
                    <Pressable onPress={() => setAddingTag(true)} style={[styles.chip, styles.chipAdd]} testID="cashbook-add-tag">
                      <Ionicons name="add" size={14} color={colors.brandSecondary} /><Text style={[styles.chipText, { color: colors.brandSecondary }]}>New</Text>
                    </Pressable>
                  ) : null}
                </View>
                {addingTag ? (
                  <View style={styles.newTagRow}>
                    <TextInput value={newTag} onChangeText={setNewTag} placeholder="New tag" placeholderTextColor={colors.mutedText} style={[styles.input, { flex: 1 }]} autoFocus onSubmitEditing={saveTag} />
                    <Pressable onPress={saveTag} style={styles.smallBtn} testID="cashbook-save-tag"><Text style={styles.smallBtnText}>Add</Text></Pressable>
                    <Pressable onPress={() => { setAddingTag(false); setNewTag(''); }} hitSlop={8}><Ionicons name="close" size={20} color={colors.mutedText} /></Pressable>
                  </View>
                ) : null}
              </View>
            </>
          )}

          <View>
            <Text style={styles.label}>Note (optional)</Text>
            <TextInput testID="cashbook-note" value={note} onChangeText={setNote} placeholder="Note" placeholderTextColor={colors.mutedText} style={styles.input} />
          </View>

          {editing ? (
            <RecordPhotos refType="cashbook_entry" refId={editing.id} label="Receipt photos" />
          ) : (
            <View style={{ gap: spacing.sm }}>
              {shots.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingVertical: 4 }}>
                  {shots.map((s) => (
                    <View key={s.id} style={styles.shot}>
                      {s.thumb ? <Image source={{ uri: `data:image/jpeg;base64,${s.thumb}` }} style={styles.shotImg} /> : <View style={styles.shotImg}><ActivityIndicator size="small" color={colors.brandSecondary} /></View>}
                      <Pressable onPress={() => setShots((p) => p.filter((x) => x.id !== s.id))} style={styles.shotX} hitSlop={6}>
                        <Ionicons name="close" size={12} color={colors.onBrandPrimary} />
                      </Pressable>
                    </View>
                  ))}
                </ScrollView>
              ) : null}
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Pressable onPress={() => shoot(false)} disabled={capturing} style={[styles.attach, { flex: 1 }]} testID="cashbook-attach">
                  <Ionicons name="camera-outline" size={20} color={colors.brandSecondary} />
                  <Text style={styles.attachText}>{shots.length ? 'Add another photo' : 'Attach receipt photo'}</Text>
                </Pressable>
                <Pressable onPress={() => shoot(true)} disabled={capturing} style={styles.attach} testID="cashbook-attach-gallery" accessibilityLabel="Pick from gallery">
                  <Ionicons name="images-outline" size={20} color={colors.brandSecondary} />
                </Pressable>
              </View>
            </View>
          )}

          <Pressable onPress={submit} disabled={busy} style={[styles.saveBtn, busy && { opacity: 0.6 }]} testID="cashbook-save-entry">
            {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>{editing ? 'Save changes' : 'Save entry'}</Text>}
          </Pressable>
          {editing && canDelete ? (
            <Pressable onPress={() => confirmDelete(editing)} style={styles.deleteBtn} testID="cashbook-delete-entry">
              <Text style={styles.deleteText}>Delete entry</Text>
            </Pressable>
          ) : null}
        </View>
      </Sheet>

    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '600', fontFamily: fonts.display },
  classicBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: 34, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  classicText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  stickyBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xs, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  dayNav: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  navBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  todayPill: { paddingHorizontal: 14, height: 34, borderRadius: radius.pill, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  todayText: { color: colors.onBrandPrimary, fontSize: 12, fontWeight: '700' },
  dayLabel: { color: colors.mutedText, fontSize: 12, textAlign: 'center' },
  counterRow: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.sm },
  counterChip: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: 'transparent' },
  counterChipText: { fontSize: 12.5, fontWeight: '700', textAlign: 'center' },
  counterChipBalance: { fontSize: 10, fontWeight: '600', textAlign: 'center', opacity: 0.75, marginTop: 1 },
  counterChipTextActive: { fontWeight: '800' },
  heroCard: { padding: spacing.md },
  heroTotals: { flexDirection: 'row' },
  heroLabel: { color: colors.mutedText, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase' },
  heroSmall: { fontSize: 17, fontWeight: '700', marginTop: 2 },
  heroRule: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.sm },
  heroCloseRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  heroBig: { color: colors.brandPrimary, fontSize: 26, fontWeight: '700', fontFamily: fonts.display, marginTop: 2 },
  net: { fontSize: 12, fontWeight: '600' },
  opening: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10 },
  openingLabel: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: '600' },
  openingVal: { color: colors.onSurface, fontSize: 14, fontWeight: '700' },
  list: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.divider },
  rowIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  rowName: { color: colors.onSurface, fontSize: 14.5, fontWeight: '600' },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  tag: { color: colors.brandSecondary, fontSize: 11, fontWeight: '700', backgroundColor: colors.surfaceTertiary, paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill, overflow: 'hidden' },
  rowNote: { color: colors.mutedText, fontSize: 12, flexShrink: 1 },
  rowAmt: { fontSize: 15, fontWeight: '700' },
  rowBal: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  empty: { color: colors.mutedText, textAlign: 'center', paddingVertical: 40 },
  fabRow: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.lg, flexDirection: 'row', gap: spacing.sm },
  fab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: radius.pill, paddingVertical: 13, elevation: 6, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  fabSecondary: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  fabText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 13 },
  hint: { color: colors.mutedText, fontSize: 12, lineHeight: 17 },
  amountBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: spacing.sm },
  rupee: { color: colors.mutedText, fontSize: 30, fontWeight: '600' },
  amountInput: { color: colors.onSurface, fontSize: 40, fontWeight: '700', fontFamily: fonts.display, minWidth: 90, textAlign: 'center' },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  input: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: 11, color: colors.onSurface, fontSize: 15 },
  transferToggleBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: 10, paddingHorizontal: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceTertiary,
  },
  transferToggleBtnActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  transferToggleText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: '600' },
  transferToggleTextActive: { color: colors.onBrandPrimary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 13, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipAdd: { borderStyle: 'dashed' },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: colors.onBrandPrimary },
  newTagRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  smallBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 11 },
  smallBtnText: { color: colors.onBrandPrimary, fontWeight: '700' },
  attach: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.borderStrong },
  attachText: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  shot: { width: 60, height: 60 },
  shotImg: { width: 60, height: 60, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  shotX: { position: 'absolute', top: -5, right: -5, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingVertical: 15, alignItems: 'center' },
  saveText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: '700' },
  deleteBtn: { alignItems: 'center', paddingVertical: 10 },
  deleteText: { color: colors.onError, fontWeight: '700' },
});
