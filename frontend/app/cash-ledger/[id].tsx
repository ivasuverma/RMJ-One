import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, TextInput, Linking, Platform, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { confirmAction } from '@/src/utils/confirm';
import { istDisplayDate, todayIST } from '@/src/utils/datetime';
import { enqueueRecordPhoto } from '@/src/utils/uploadQueue';
import { haptics } from '@/src/utils/haptics';
import { spacing, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Sheet, useToast } from '@/src/components/ui';
import { SegmentedControl } from '@/src/components/ui/SegmentedControl';
import { ModuleHeader } from '@/src/components/ui/ModuleHeader';
import { HeaderSpacer, useScrolled } from '@/src/components/ui/StickyHeader';
import { DateField } from '@/src/components/DateField';
import { RecordPhotos } from '@/src/components/RecordPhotos';
import { CurrencyPicker } from '@/src/components/CurrencyPicker';
import { CashStatementSheet } from '@/src/components/CashStatementSheet';
import { pickWebFile, makeThumb } from '@/src/components/DocumentCaptureSheet';
import { compressImage } from '@/src/components/QuickDocCapture';
import { Balances, BASE_CURRENCY, METALS, currencyName, money, num, initials, orderedCodes, symbol } from '@/src/utils/cashLedger';

type Group = { id: string; name: string; balances: Balances; entries: number };
type Account = { id: string; name: string; phone?: string; note?: string; currency: string; balances: Balances; entries: number; general_balances: Balances; groups: Group[] };
type Entry = { id: string; direction: 'gave' | 'got'; amount: number; currency: string; date: string; note?: string; remark?: string; group_id?: string | null; conversion_id?: string; split?: { mode: 'equal' | 'custom'; total: number } | null; created_by_name?: string; balance_after: number; photos: number };
type Shot = { id: string; blob: Blob; thumb: string };

const newId = () => ((typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const monthLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const signed = (n: number, code: string) => `${n < 0 ? '−' : ''}${money(n, code)}`;

// Three ways to read the same entries; the choice is remembered on this device.
type ViewKey = 'list' | 'statement' | 'daily';
const VIEW_KEY = 'rmj.cash_ledger_view';
const savedView = (): ViewKey => {
  try { const v = localStorage.getItem(VIEW_KEY); if (v === 'statement' || v === 'daily') return v; } catch { /* no storage */ }
  return 'list';
};

// One person in the Cash Ledger, laid out like an iOS detail screen: the
// balance up top (one line per currency — never converted), round actions
// like Contacts, entries grouped by month like Wallet, and a translucent
// toolbar with "You Gave" / "You Got".
// Groups: `?group=<id>` shows one group of this person — its own entries,
// running balance and total. Without it, the screen shows the person's general
// entries (those in no group) with the groups listed above them; the balance
// at the top is always everything, groups included.
export default function CashLedgerAccountScreen() {
  const { id, group } = useLocalSearchParams<{ id: string; group?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const narrow = useWindowDimensions().width < 370;   // small iPhones: tighter number columns
  const s = useMemo(() => makeStyles(colors, narrow), [colors, narrow]);
  const toast = useToast();
  const { user, hasRight } = useAuth();
  const isOwner = user?.role === 'owner';
  const canEdit = isOwner || hasRight('cash_ledger', 'edit') || user?.role === 'admin';
  const canDelete = isOwner || hasRight('cash_ledger', 'delete') || user?.role === 'admin';
  const { scrolled, onScroll } = useScrolled();
  const [acc, setAcc] = useState<Account | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setViewState] = useState<ViewKey>(savedView);
  const setView = (v: ViewKey) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* no storage */ } };

  // entry sheet
  const [sheet, setSheet] = useState<null | { mode: 'new' | 'edit'; entry?: Entry }>(null);
  const [direction, setDirection] = useState<'gave' | 'got'>('gave');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(BASE_CURRENCY);
  const [date, setDate] = useState(todayIST());
  const [note, setNote] = useState('');
  const [remark, setRemark] = useState('');
  // a shared bill (like Splitwise): the amount typed is the whole bill
  const [splitMode, setSplitMode] = useState<'full' | 'equal' | 'custom'>('full');
  const [share, setShare] = useState('');
  const [pickingSplit, setPickingSplit] = useState(false);
  const [entryGroup, setEntryGroup] = useState<string | null>(null);
  const [pickingGroup, setPickingGroup] = useState(false);
  const [stmtOpen, setStmtOpen] = useState(false);
  const [groupSheet, setGroupSheet] = useState<null | { mode: 'new' | 'edit' }>(null);
  const [groupName, setGroupName] = useState('');
  // convert sheet: move a balance from one currency/metal into another at a rate
  const [conv, setConv] = useState<null | { from: string }>(null);
  const [convTo, setConvTo] = useState(BASE_CURRENCY);
  const [convAmt, setConvAmt] = useState('');
  const [convRate, setConvRate] = useState('');
  const [convDate, setConvDate] = useState(todayIST());
  const [convNote, setConvNote] = useState('');
  const [convPicking, setConvPicking] = useState(false);
  const [convBusy, setConvBusy] = useState(false);
  const [metalRates, setMetalRates] = useState<Record<string, number | null>>({});
  const [shots, setShots] = useState<Shot[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);

  // person sheet
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

  const first = acc?.name.split(' ')[0] || '';
  const groups = useMemo(() => acc?.groups || [], [acc]);
  const grp = group ? groups.find((g) => g.id === group) : undefined;
  // What this screen is about: one group, or the whole person.
  const heroBal: Balances = grp ? grp.balances : acc?.balances || {};
  const codes = orderedCodes(heroBal);
  const totalCodes = acc ? orderedCodes(acc.balances) : [];
  const scoped = useMemo(() => (entries || []).filter((e) => (group ? e.group_id === group : !e.group_id)), [entries, group]);
  const groupLabel = (gid: string | null | undefined) => groups.find((g) => g.id === gid)?.name || 'General';

  const openNew = (dir: 'gave' | 'got') => {
    setDirection(dir); setAmount(''); setCurrency(acc?.currency || BASE_CURRENCY); setDate(todayIST()); setNote(''); setRemark(''); setSplitMode('full'); setShare(''); setEntryGroup(group || null); setShots([]); setSheet({ mode: 'new' });
  };
  const openEdit = (e: Entry) => {
    if (e.conversion_id) {   // the two sides of a conversion go together: delete and convert again
      if (canDelete) {
        confirmAction('Delete Conversion?', `${e.remark || ''}\nBoth entries of this conversion will be removed.`, 'Delete', async () => {
          try { await api.del(`/khata/${id}/entries/${e.id}`); load(); }
          catch (err: any) { toast.error(err?.detail || 'Could not delete'); }
        });
      } else toast.error("A conversion can't be edited");
      return;
    }
    setSplitMode(e.split?.mode || 'full'); setShare(e.split ? String(e.amount) : '');
    setDirection(e.direction); setAmount(String(e.split ? e.split.total : e.amount)); setCurrency(e.currency); setDate(e.date); setNote(e.note || ''); setRemark(e.remark || ''); setEntryGroup(e.group_id || null); setShots([]); setSheet({ mode: 'edit', entry: e });
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
      setShots((p) => p.map((x) => (x.id === sid ? { ...x, thumb } : x)));
    } catch { toast.error('Could not read that photo'); }
    finally { setCapturing(false); }
  };

  // What actually goes into the balance for this bill.
  const billN = Number(amount.replace(/,/g, '')) || 0;
  const owedNow = splitMode === 'full' ? billN : splitMode === 'equal' ? billN / 2 : Number(share.replace(/,/g, '')) || 0;
  const splitLabel = (dir: 'gave' | 'got', mode: 'full' | 'equal' | 'custom') => {
    const them = (acc?.name.split(' ')[0]) || 'They';
    if (mode === 'equal') return dir === 'gave' ? 'You paid, split equally' : `${them} paid, split equally`;
    if (mode === 'custom') return dir === 'gave' ? `You paid, ${them}'s share` : `${them} paid, your share`;
    return dir === 'gave' ? 'You are owed the full amount' : `${them} is owed the full amount`;
  };

  const save = async () => {
    const amt = Number(amount.replace(/,/g, ''));
    if (!amt || amt <= 0 || busy) { toast.error('Enter the amount'); return; }
    if (splitMode === 'custom' && !(owedNow > 0 && owedNow <= amt)) { toast.error('Enter a share between zero and the bill'); return; }
    setBusy(true);
    try {
      const body = {
        direction, amount: splitMode === 'full' ? amt : owedNow, currency, date, note: note.trim(), remark: remark.trim(), group_id: entryGroup,
        split: splitMode === 'full' ? null : { mode: splitMode, total: amt },
      };
      let entryId = sheet?.entry?.id || '';
      if (sheet?.mode === 'edit' && entryId) await api.put(`/khata/${id}/entries/${entryId}`, body);
      else entryId = (await api.post<{ id: string }>(`/khata/${id}/entries`, body)).id;
      // Same background upload as every other record photo: Drive keeps the full photo.
      for (const sh of shots) {
        await enqueueRecordPhoto({ id: sh.id, blob: sh.blob, filename: `cash-ledger-${Date.now()}.jpg`, thumb: sh.thumb, ref_type: 'cash_ledger_entry', ref_id: entryId });
      }
      haptics.success();
      setSheet(null);
      await load();
    } catch (e: any) { haptics.error(); toast.error(e?.detail || 'Could not save'); }
    finally { setBusy(false); }
  };

  const removeEntry = (e: Entry) => confirmAction('Delete Entry?', `${e.direction === 'gave' ? 'You gave' : 'You got'} ${money(e.amount, e.currency)} on ${istDisplayDate(e.date)}.`, 'Delete', async () => {
    try { await api.del(`/khata/${id}/entries/${e.id}`); setSheet(null); load(); }
    catch (err: any) { toast.error(err?.detail || 'Could not delete'); }
  });

  const settle = () => acc && confirmAction(grp ? `Settle ${grp.name}?` : 'Settle Up?',
    codes.map((c) => (heroBal[c] > 0 ? `${first} pays you ${money(heroBal[c], c)}` : `You pay ${first} ${money(heroBal[c], c)}`)).join('\n'),
    'Settle Up', async () => {
      try { await api.post(`/khata/${id}/settle${group ? `?group=${group}` : ''}`, {}); haptics.success(); load(); }
      catch (e: any) { toast.error(e?.detail || 'Could not settle'); }
    });

  const phoneDigits = (acc?.phone || '').replace(/\D/g, '');
  const waNumber = phoneDigits.length === 10 ? `91${phoneDigits}` : phoneDigits;
  const remind = () => {
    if (!acc) return;
    const owed = codes.filter((c) => heroBal[c] > 0).map((c) => money(heroBal[c], c));
    const owe = codes.filter((c) => heroBal[c] < 0).map((c) => money(heroBal[c], c));
    const what = grp ? ` for ${grp.name}` : '';
    const text = owed.length
      ? `Hi ${first}, a gentle reminder: ${owed.join(' and ')} is pending${what} as per my records. — ${user?.name || 'RMJ'}`
      : `Hi ${first}, as per my records I owe you ${owe.join(' and ')}${what}. — ${user?.name || 'RMJ'}`;
    Linking.openURL(`https://wa.me/${waNumber}?text=${encodeURIComponent(text)}`);
  };

  const openAccEdit = () => { if (!acc) return; setAccName(acc.name); setAccPhone(acc.phone || ''); setAccNote(acc.note || ''); setEditAcc(true); };
  const saveAcc = async () => {
    if (!accName.trim()) return;
    try { await api.put(`/khata/${id}`, { name: accName.trim(), phone: accPhone.trim(), note: accNote.trim(), currency: acc?.currency }); setEditAcc(false); load(); }
    catch (e: any) { toast.error(e?.detail || 'Could not save'); }
  };
  const openGroupSheet = (mode: 'new' | 'edit') => { setGroupName(mode === 'edit' ? grp?.name || '' : ''); setGroupSheet({ mode }); };
  const saveGroup = async () => {
    const n = groupName.trim();
    if (!n) return;
    try {
      if (groupSheet?.mode === 'edit' && grp) await api.put(`/khata/${id}/groups/${grp.id}`, { name: n });
      else {
        const g = await api.post<Group>(`/khata/${id}/groups`, { name: n });
        if (sheet) setEntryGroup(g.id);   // made from the entry sheet: put this entry in it
      }
      haptics.success(); setGroupSheet(null); load();
    } catch (e: any) { toast.error(e?.detail || 'Could not save'); }
  };
  const deleteGroup = () => grp && confirmAction(`Delete ${grp.name}?`, 'Only possible once the group has no entries.', 'Delete', async () => {
    try { await api.del(`/khata/${id}/groups/${grp.id}`); setGroupSheet(null); router.back(); }
    catch (e: any) { toast.error(e?.detail || 'Could not delete'); }
  });

  // Suggest a rate where the app knows one: gold/silver <-> rupees from today's live rate.
  const suggestRate = (from: string, to: string, rates = metalRates) => {
    if (METALS[from] && to === BASE_CURRENCY && rates[from]) return String(rates[from]);
    if (from === BASE_CURRENCY && METALS[to] && rates[to]) return String(Number((1 / (rates[to] as number)).toFixed(6)));
    return '';
  };
  // From the person's page this converts the general balance; a group's balance is converted on the group's page.
  const convertible = (c: string) => (grp ? heroBal[c] || 0 : acc?.general_balances?.[c] || 0);
  const openConvert = async (from: string) => {
    if (!convertible(from)) { toast.error('This balance is all in groups — open the group to convert it.'); return; }
    const to = from === BASE_CURRENCY ? (codes.find((c) => c !== from) || 'USD') : BASE_CURRENCY;
    setConv({ from }); setConvTo(to); setConvAmt(String(Math.abs(convertible(from)))); setConvDate(todayIST()); setConvNote('');
    setConvRate(suggestRate(from, to));
    if (!Object.keys(metalRates).length) {
      try {
        const r = await api.get<Record<string, number | null>>('/khata-metal-rates');
        setMetalRates(r);
        setConvRate((cur) => cur || suggestRate(from, to, r));
      } catch { /* no live rate: type it */ }
    }
  };
  const convFromBal = conv ? convertible(conv.from) : 0;
  const convAmtN = Number(convAmt.replace(/,/g, '')) || 0;
  const convRateN = Number(convRate.replace(/,/g, '')) || 0;
  const convOut = convAmtN * convRateN;
  const unitOf = (c: string) => (METALS[c] ? `g ${METALS[c].name.toLowerCase()}` : c);
  const doConvert = async () => {
    if (!conv || convBusy) return;
    if (!convAmtN || !convRateN) { toast.error('Enter the amount and the rate'); return; }
    setConvBusy(true);
    try {
      await api.post(`/khata/${id}/convert`, { from_currency: conv.from, to_currency: convTo, amount: convAmtN, rate: convRateN, date: convDate, note: convNote.trim(), group_id: group || null });
      haptics.success(); setConv(null); load();
    } catch (e: any) { haptics.error(); toast.error(e?.detail || 'Could not convert'); }
    finally { setConvBusy(false); }
  };

  const deleteAcc = () => acc && confirmAction(`Delete ${acc.name}?`, 'Only possible once everything is settled.', 'Delete', async () => {
    try { await api.del(`/khata/${id}`); setEditAcc(false); router.back(); }
    catch (e: any) { toast.error(e?.detail || 'Could not delete'); }
  });

  // Entries grouped by month, newest first (Wallet-style sections).
  const sections: { title: string; items: Entry[] }[] = [];
  for (const e of scoped) {
    const t = monthLabel(e.date);
    if (!sections.length || sections[sections.length - 1].title !== t) sections.push({ title: t, items: [] });
    sections[sections.length - 1].items.push(e);
  }
  const tint = direction === 'gave' ? colors.onError : colors.onSuccess;
  const balColor = (n: number) => (n > 0 ? colors.onSuccess : n < 0 ? colors.onError : colors.onSurface);

  // Statement: a passbook per currency, oldest first, closing balance on every
  // line. On the person's page each group is one total line after the general
  // entries, so the closing balance is the person's whole balance.
  const chron = useMemo(() => [...scoped].reverse(), [scoped]);
  type StRow = { kind: 'entry'; e: Entry; amt: number; bal: number } | { kind: 'group'; g: Group; amt: number; bal: number };
  const statements = useMemo(() => {
    const byCur: Record<string, Entry[]> = {};
    for (const e of chron) (byCur[e.currency] ||= []).push(e);
    const withGroups = grp ? [] : groups.filter((g) => Object.keys(g.balances).length);
    const all: Balances = Object.fromEntries(Object.keys(byCur).map((c) => [c, 1]));
    for (const g of withGroups) for (const c of Object.keys(g.balances)) all[c] = 1;
    return orderedCodes(all).map((c) => {
      const rows: StRow[] = (byCur[c] || []).map((e) => ({ kind: 'entry', e, amt: e.direction === 'gave' ? e.amount : -e.amount, bal: e.balance_after }));
      let bal = rows.length ? rows[rows.length - 1].bal : 0;
      for (const g of withGroups) {
        if (!g.balances[c]) continue;
        bal += g.balances[c];
        rows.push({ kind: 'group', g, amt: g.balances[c], bal });
      }
      const gave = rows.reduce((t, r) => t + (r.amt > 0 ? r.amt : 0), 0);
      const got = rows.reduce((t, r) => t + (r.amt < 0 ? -r.amt : 0), 0);
      return { code: c, rows, gave, got, closing: bal };
    });
  }, [chron, groups, grp]);

  // Day-wise: newest day first, each day ends with its closing balance per currency.
  const days = useMemo(() => {
    const out: { date: string; items: Entry[]; closing: { code: string; bal: number }[] }[] = [];
    for (const e of scoped) {
      if (!out.length || out[out.length - 1].date !== e.date) out.push({ date: e.date, items: [], closing: [] });
      out[out.length - 1].items.push(e);
    }
    for (const d of out) {
      d.items.reverse();   // oldest first within the day, so the running balance reads downwards
      const last: Record<string, number> = {};
      for (const e of d.items) last[e.currency] = e.balance_after;
      d.closing = orderedCodes(last).map((code) => ({ code, bal: last[code] }));
    }
    return out;
  }, [scoped]);

  return (
    <SafeAreaView style={s.root} edges={['top']} testID="cash-ledger-account">
      <ModuleHeader title={grp ? grp.name : acc?.name || ''} backLabel={grp ? first : 'Cash Ledger'} scrolled={scrolled}
        actions={canEdit ? (
          <Pressable onPress={grp ? () => openGroupSheet('edit') : openAccEdit} hitSlop={10} style={({ pressed }) => [pressed && { opacity: 0.5 }]} testID="cl-edit-account">
            <Text style={s.navText}>Edit</Text>
          </Pressable>
        ) : undefined} />
      <ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={[s.content, { paddingBottom: 110 + insets.bottom }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.mutedText} />}>
        <HeaderSpacer />
        {!acc ? <ActivityIndicator color={colors.mutedText} style={{ marginTop: 40 }} /> : (
          <>
            {/* Who, then one card per currency (or metal) — compact however many there are */}
            <View style={s.hero} testID="cl-balance">
              <View style={s.heroAv}>
                {grp ? <Ionicons name="folder" size={24} color={colors.brandPrimary} /> : <Text style={s.heroAvText}>{initials(acc.name)}</Text>}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.heroLabel} numberOfLines={1}>
                  {!codes.length ? (grp ? 'Group settled' : 'All settled')
                    : codes.every((c) => heroBal[c] > 0) ? `${first} owes you${grp ? ' in this group' : ''}`
                      : codes.every((c) => heroBal[c] < 0) ? `You owe ${first}${grp ? ' in this group' : ''}`
                        : `${first} · balances`}
                </Text>
                {grp ? (
                  <Text style={s.heroSub} numberOfLines={2} testID="cl-total-with">
                    Total with {first}: {totalCodes.length ? totalCodes.map((c) => signed(acc.balances[c], c)).join(' · ') : 'settled'}
                  </Text>
                ) : !!acc.phone && <Text style={s.heroSub}>{acc.phone}</Text>}
              </View>
            </View>
            <View style={s.tiles}>
              {(codes.length ? codes : [acc.currency]).map((c, _i, all) => {
                const mixed = all.some((x) => heroBal[x] > 0) && all.some((x) => heroBal[x] < 0);   // the heading can't say it for all
                const v = heroBal[c] || 0;
                return (
                  <Pressable key={c} onPress={() => v && openConvert(c)} disabled={!v} style={({ pressed }) => [s.tile, codes.length <= 1 && s.tileWide, pressed && { opacity: 0.7 }]} testID={`cl-tile-${c}`}>
                    <Text style={s.tileLabel} numberOfLines={1}>{currencyName(c).replace(' (grams)', '')}</Text>
                    <Text style={[s.tileAmt, codes.length <= 1 && s.tileAmtBig, { color: balColor(v) }]} numberOfLines={1} adjustsFontSizeToFit>
                      {METALS[c] ? `${num(v, c)} g` : money(v, c)}
                    </Text>
                    {mixed && <Text style={s.tileSub}>{v > 0 ? `${first} owes you` : `You owe ${first}`}</Text>}
                  </Pressable>
                );
              })}
            </View>

            {codes.length > 0 && <Text style={s.tilesHint}>Tap a balance to convert it into another currency or metal.</Text>}

            <View style={s.actions}>
              <RoundAction s={s} icon="call" label="Call" disabled={!phoneDigits} onPress={() => Linking.openURL(`tel:${phoneDigits}`)} testID="cl-call" />
              <RoundAction s={s} icon="logo-whatsapp" label="Remind" disabled={!phoneDigits || !codes.length} onPress={remind} testID="cl-remind" />
              <RoundAction s={s} icon="checkmark-done" label="Settle Up" disabled={!codes.length} onPress={settle} testID="cl-settle" />
              <RoundAction s={s} icon="document-text" label="Statement" disabled={!scoped.length && !(!grp && acc.entries)} onPress={() => setStmtOpen(true)} testID="cl-statement-open" />
            </View>

            {!grp && (groups.length > 0 || canEdit) && (
              <View testID="cl-groups">
                <Text style={s.sectionHeader}>GROUPS</Text>
                <View style={s.group}>
                  {groups.map((g, i) => {
                    const gc = orderedCodes(g.balances);
                    return (
                      <Pressable key={g.id} onPress={() => router.push(`/cash-ledger/${id}?group=${g.id}` as any)} style={({ pressed }) => [s.entry, pressed && s.pressed]} testID={`cl-group-${g.id}`}>
                        <View style={[s.entryIcon, { backgroundColor: colors.surfaceTertiary }]}><Ionicons name="folder" size={15} color={colors.brandPrimary} /></View>
                        <View style={[s.entryBody, i > 0 && s.sepTop]}>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={s.title} numberOfLines={1}>{g.name}</Text>
                            <Text style={s.subtitle}>{g.entries} {g.entries === 1 ? 'entry' : 'entries'}</Text>
                          </View>
                          <View style={s.trailing}>
                            {gc.length ? gc.map((c) => (
                              <Text key={c} style={[s.amount, { color: balColor(g.balances[c]) }]}>{signed(g.balances[c], c)}</Text>
                            )) : <Text style={s.subtitle}>Settled</Text>}
                          </View>
                          <Ionicons name="chevron-forward" size={16} color={colors.mutedText} style={{ marginLeft: 6 }} />
                        </View>
                      </Pressable>
                    );
                  })}
                  {canEdit && (
                    <Pressable onPress={() => openGroupSheet('new')} style={({ pressed }) => [s.entry, pressed && s.pressed]} testID="cl-new-group">
                      <View style={[s.entryIcon, { backgroundColor: 'transparent' }]}><Ionicons name="add-circle" size={22} color={colors.brandPrimary} /></View>
                      <View style={[s.entryBody, groups.length > 0 && s.sepTop, { minHeight: 46 }]}><Text style={[s.title, { color: colors.brandPrimary }]}>New Group</Text></View>
                    </Pressable>
                  )}
                </View>
                {groups.length > 0 && (
                  <Text style={s.footer}>Each group keeps its own entries and total. The balance at the top includes them.</Text>
                )}
              </View>
            )}

            {!!acc.note && <Text style={s.note}>{acc.note}</Text>}

            {!grp && groups.length > 0 && <Text style={s.sectionHeader}>GENERAL ENTRIES</Text>}
            {!!scoped.length && (
              <View style={{ marginTop: !grp && groups.length > 0 ? 0 : spacing.xl }}>
                <SegmentedControl options={[{ key: 'list', label: 'Entries' }, { key: 'statement', label: 'Statement' }, { key: 'daily', label: 'Day-wise' }]}
                  value={view} onChange={(k) => setView(k as ViewKey)} testID="cl-view" />
              </View>
            )}

            {entries && scoped.length === 0 ? (
              <Text style={s.emptyText}>{grp ? 'No entries in this group yet.' : groups.length ? 'No general entries.' : 'No entries yet.'}</Text>
            ) : view === 'statement' ? statements.map((st) => (
              <View key={st.code} testID={`cl-statement-${st.code}`}>
                <Text style={s.sectionHeader}>{currencyName(st.code).toUpperCase()} · {symbol(st.code)}</Text>
                <View style={s.group}>
                  <View style={[s.tRow, s.tHead]}>
                    <Text style={[s.tDetails, s.tHeadText]} numberOfLines={1}>DETAILS</Text>
                    <Text style={[s.tNum, s.tHeadText]}>AMOUNT</Text>
                    <Text style={[s.tBal, s.tHeadText]}>BALANCE</Text>
                  </View>
                  {st.rows.map((r) => (
                    <Pressable key={r.kind === 'entry' ? r.e.id : `g-${r.g.id}`} testID={r.kind === 'entry' ? `cl-st-${r.e.id}` : `cl-st-group-${r.g.id}`}
                      onPress={() => (r.kind === 'entry' ? openEdit(r.e) : router.push(`/cash-ledger/${id}?group=${r.g.id}` as any))}
                      style={({ pressed }) => [s.tRow, s.sepTop, r.kind === 'group' && s.tGroup, pressed && s.pressed]}>
                      <View style={s.tDetails}>
                        {r.kind === 'entry' ? (
                          <>
                            <Text style={s.tYear}>{istDisplayDate(r.e.date)}</Text>
                            <Text style={s.tCell} numberOfLines={2}>{r.e.note || (r.e.direction === 'gave' ? 'You gave' : 'You got')}{r.e.photos > 0 ? ' 📷' : ''}</Text>
                            {!!r.e.remark && <Text style={s.tYear} numberOfLines={1}>{r.e.remark}</Text>}
                          </>
                        ) : (
                          <>
                            <Text style={s.tYear}>Group total · {r.g.entries} {r.g.entries === 1 ? 'entry' : 'entries'}</Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                              <Ionicons name="folder" size={13} color={colors.brandPrimary} />
                              <Text style={[s.tCell, { fontWeight: '600', flexShrink: 1 }]} numberOfLines={1}>{r.g.name}</Text>
                              <Ionicons name="chevron-forward" size={12} color={colors.mutedText} />
                            </View>
                          </>
                        )}
                      </View>
                      <Text style={[s.tNum, s.tCell, { color: r.amt > 0 ? colors.onError : colors.onSuccess }, r.kind === 'group' && { fontWeight: '600' }]} numberOfLines={1}>
                        {r.amt > 0 ? '−' : '+'}{num(r.amt, st.code)}
                      </Text>
                      <Text style={[s.tBal, s.tCell, { color: balColor(r.bal) }]} numberOfLines={1}>{r.bal < 0 ? '−' : ''}{num(r.bal, st.code)}</Text>
                    </Pressable>
                  ))}
                  <View style={[s.tRow, s.tFoot]}>
                    <View style={s.tDetails}>
                      <Text style={s.tFootText}>Closing Balance</Text>
                      <Text style={s.tYear} numberOfLines={2}>Gave {num(st.gave, st.code)} · Got {num(st.got, st.code)}</Text>
                    </View>
                    <Text style={[s.tBal, s.tFootText, { width: narrow ? 130 : 150, color: balColor(st.closing) }]} numberOfLines={1}>{st.closing < 0 ? '−' : ''}{money(st.closing, st.code)}</Text>
                  </View>
                </View>
              </View>
            )) : view === 'daily' ? days.map((d) => (
              <View key={d.date} testID={`cl-day-${d.date}`}>
                <Text style={s.sectionHeader}>{dayLabel(d.date).toUpperCase()}</Text>
                <View style={s.group}>
                  {d.items.map((e, i) => (
                    <Pressable key={e.id} onPress={() => openEdit(e)} style={({ pressed }) => [s.dRow, i > 0 && s.sepTop, pressed && s.pressed]} testID={`cl-d-${e.id}`}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.dNote} numberOfLines={1}>{e.note || (e.direction === 'gave' ? 'You gave' : 'You got')}{e.photos > 0 ? ' 📷' : ''}</Text>
                        {!!e.remark && <Text style={s.subtitle} numberOfLines={1}>{e.remark}</Text>}
                      </View>
                      <View style={s.trailing}>
                        <Text style={[s.dAmt, { color: e.direction === 'gave' ? colors.onError : colors.onSuccess }]}>{e.direction === 'gave' ? '−' : '+'}{money(e.amount, e.currency)}</Text>
                        <Text style={s.subtitle}>Bal {signed(e.balance_after, e.currency)}</Text>
                      </View>
                    </Pressable>
                  ))}
                  <View style={[s.dRow, s.dClose]}>
                    <Text style={s.dCloseLabel}>Closing Balance</Text>
                    <View style={s.trailing}>
                      {d.closing.map((c) => (
                        <Text key={c.code} style={[s.dCloseAmt, { color: balColor(c.bal) }]}>{c.bal === 0 ? 'Settled' : signed(c.bal, c.code)}</Text>
                      ))}
                    </View>
                  </View>
                </View>
              </View>
            )) : sections.map((sec) => (
              <View key={sec.title}>
                <Text style={s.sectionHeader}>{sec.title.toUpperCase()}</Text>
                <View style={s.group}>
                  {sec.items.map((e, i) => (
                    <Pressable key={e.id} onPress={() => openEdit(e)} style={({ pressed }) => [s.entry, pressed && s.pressed]} testID={`cl-entry-${e.id}`}>
                      <View style={[s.entryIcon, { backgroundColor: e.conversion_id ? colors.surfaceTertiary : e.direction === 'gave' ? colors.error : colors.success }]}>
                        <Ionicons name={e.conversion_id ? 'swap-horizontal' : e.direction === 'gave' ? 'arrow-up' : 'arrow-down'} size={15}
                          color={e.conversion_id ? colors.brandPrimary : e.direction === 'gave' ? colors.onError : colors.onSuccess} />
                      </View>
                      <View style={[s.entryBody, i > 0 && s.sepTop]}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={s.title} numberOfLines={1}>{e.note || (e.direction === 'gave' ? 'You gave' : 'You got')}</Text>
                          <View style={s.metaRow}>
                            <Text style={s.subtitle} numberOfLines={1}>{istDisplayDate(e.date)}{e.split ? ` · ${money(e.split.total, e.currency)} bill, ${e.split.mode === 'equal' ? 'split equally' : 'shared'}` : ''}{e.remark ? ` · ${e.remark}` : ''}</Text>
                            {e.photos > 0 && <><Ionicons name="image-outline" size={12} color={colors.mutedText} /><Text style={s.subtitle}>{e.photos}</Text></>}
                          </View>
                        </View>
                        <View style={s.trailing}>
                          <Text style={[s.amount, { color: e.direction === 'gave' ? colors.onError : colors.onSuccess }]}>
                            {e.direction === 'gave' ? '−' : '+'}{money(e.amount, e.currency)}
                          </Text>
                          <Text style={s.subtitle}>Bal {e.balance_after < 0 ? '−' : ''}{money(e.balance_after, e.currency)}</Text>
                        </View>
                      </View>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
            {scoped.length > 0 && (
              <Text style={s.footer}>
                {view === 'statement' ? `Balance is the closing balance after each line${!grp && groups.some((g) => Object.keys(g.balances).length) ? '; each group is added as one total line, so the closing balance is the full amount' : ''}. Green: ${first} owes you · Red: you owe ${first}.`
                  : view === 'daily' ? `Closing balance at the end of each day. Green: ${first} owes you · Red: you owe ${first}.`
                    : `− You gave · + You got. Bal is what ${first} owes you after each entry.`}
              </Text>
            )}
          </>
        )}
      </ScrollView>

      {/* Translucent toolbar, content scrolls under it */}
      <View style={[s.toolbar, { paddingBottom: 10 + insets.bottom }]}>
        <Pressable onPress={() => openNew('gave')} style={({ pressed }) => [s.toolBtn, { backgroundColor: colors.error }, pressed && { transform: [{ scale: 0.97 }] }]} testID="cl-you-gave">
          <Ionicons name="arrow-up" size={17} color={colors.onError} /><Text style={[s.toolText, { color: colors.onError }]}>You Gave</Text>
        </Pressable>
        <Pressable onPress={() => openNew('got')} style={({ pressed }) => [s.toolBtn, { backgroundColor: colors.success }, pressed && { transform: [{ scale: 0.97 }] }]} testID="cl-you-got">
          <Ionicons name="arrow-down" size={17} color={colors.onSuccess} /><Text style={[s.toolText, { color: colors.onSuccess }]}>You Got</Text>
        </Pressable>
      </View>

      <Sheet visible={!!sheet} onClose={() => setSheet(null)} title={sheet?.mode === 'edit' ? 'Entry' : first} testID="cl-entry-sheet">
        <SegmentedControl options={[{ key: 'gave', label: 'You Gave' }, { key: 'got', label: 'You Got' }]}
          value={direction} onChange={(k) => setDirection(k as 'gave' | 'got')} testID="cl-dir" />

        {/* Big centred amount, Apple Cash style; the symbol opens the currency list */}
        <View style={s.amountWrap}>
          <Pressable onPress={() => setPicking(true)} hitSlop={8} style={({ pressed }) => [s.curBtn, pressed && { opacity: 0.6 }]} testID="cl-currency">
            <Text style={[s.curSym, { color: tint }]}>{symbol(currency)}</Text>
            <Ionicons name="chevron-down" size={14} color={colors.mutedText} />
          </Pressable>
          <TextInput value={amount} onChangeText={(t) => setAmount(t.replace(/[^\d.,]/g, ''))} placeholder="0" placeholderTextColor={colors.mutedText}
            keyboardType="decimal-pad" style={[s.amountInput, { color: tint }]} autoFocus={sheet?.mode === 'new'} testID="cl-amount" />
        </View>
        <Text style={s.curCode}>{splitMode !== 'full' ? 'Total bill · ' : ''}{METALS[currency] ? `${METALS[currency].name} · grams` : currency}</Text>

        {/* How was it split? Like Splitwise; the balance only takes the share that's owed */}
        <Pressable onPress={() => setPickingSplit(true)} style={({ pressed }) => [s.splitBtn, pressed && { opacity: 0.6 }]} testID="cl-split">
          <Ionicons name="people-outline" size={16} color={colors.brandPrimary} />
          <Text style={s.splitBtnText} numberOfLines={1}>{splitLabel(direction, splitMode)}</Text>
          <Ionicons name="chevron-down" size={14} color={colors.mutedText} />
        </Pressable>
        {splitMode === 'custom' && (
          <View style={[s.formGroup, { marginTop: 10 }]}>
            <View style={s.formRow}>
              <Text style={[s.formLabel, { flexShrink: 0 }]}>{direction === 'gave' ? `${first}'s share` : 'Your share'}</Text>
              <TextInput value={share} onChangeText={(t) => setShare(t.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText}
                style={[s.formInput, { flex: 1, minWidth: 0, textAlign: 'right', paddingHorizontal: 0 }]} testID="cl-split-share" />
            </View>
            <View style={s.formSep} />
            <View style={[s.formRow, { gap: 8 }]}>
              {[25, 50, 75].map((pc) => (
                <Pressable key={pc} onPress={() => billN && setShare(String(Math.round(billN * pc) / 100))} style={({ pressed }) => [s.pcChip, pressed && { opacity: 0.6 }]} testID={`cl-split-${pc}`}>
                  <Text style={s.pcChipText}>{pc}%</Text>
                </Pressable>
              ))}
              <Text style={[s.subtitle, { flex: 1, textAlign: 'right' }]}>{billN && owedNow ? `${Math.round((owedNow / billN) * 1000) / 10}% of the bill` : ''}</Text>
            </View>
          </View>
        )}
        {splitMode !== 'full' && billN > 0 && (
          <Text style={[s.splitResult, { color: direction === 'gave' ? colors.onSuccess : colors.onError }]} testID="cl-split-result">
            {direction === 'gave' ? `${first} owes you` : `You owe ${first}`} {money(owedNow, currency)}
          </Text>
        )}

        <View style={s.formGroup}>
          <View style={s.formPad}><DateField value={date} onChange={setDate} testID="cl-date" /></View>
          <View style={s.formSep} />
          <TextInput value={note} onChangeText={setNote} placeholder="Description" placeholderTextColor={colors.mutedText} style={s.formInput} testID="cl-note" />
          <View style={s.formSep} />
          <TextInput value={remark} onChangeText={setRemark} placeholder="Remark" placeholderTextColor={colors.mutedText} style={s.formInput} testID="cl-remark" />
          {(groups.length > 0 || canEdit) && (
            <>
              <View style={s.formSep} />
              <Pressable onPress={() => setPickingGroup(true)} style={({ pressed }) => [s.formRow, pressed && s.pressed]} testID="cl-entry-group">
                <Text style={[s.formLabel]}>Group</Text>
                <Text style={s.formValue} numberOfLines={1}>{groupLabel(entryGroup)}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.mutedText} />
              </Pressable>
            </>
          )}
        </View>

        {sheet?.mode === 'edit' && sheet.entry ? (
          <RecordPhotos refType="cash_ledger_entry" refId={sheet.entry.id} label="Photos" />
        ) : (
          <View style={[s.formGroup, { marginTop: spacing.md }]}>
            {shots.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, padding: 10 }}>
                {shots.map((sh) => (
                  <View key={sh.id} style={s.shot}>
                    {sh.thumb ? <Image source={{ uri: `data:image/jpeg;base64,${sh.thumb}` }} style={s.shotImg} /> : <View style={s.shotImg}><ActivityIndicator size="small" color={colors.mutedText} /></View>}
                    <Pressable onPress={() => setShots((p) => p.filter((x) => x.id !== sh.id))} style={s.shotX} hitSlop={6}><Ionicons name="close" size={12} color="#fff" /></Pressable>
                  </View>
                ))}
              </ScrollView>
            )}
            {shots.length > 0 && <View style={s.formSep} />}
            <Pressable onPress={() => shoot(false)} disabled={capturing} style={({ pressed }) => [s.formRow, pressed && s.pressed]} testID="cl-photo">
              <Ionicons name="camera-outline" size={20} color={colors.brandPrimary} /><Text style={s.formAction}>Take Photo</Text>
            </Pressable>
            <View style={s.formSep} />
            <Pressable onPress={() => shoot(true)} disabled={capturing} style={({ pressed }) => [s.formRow, pressed && s.pressed]} testID="cl-photo-gallery">
              <Ionicons name="images-outline" size={20} color={colors.brandPrimary} /><Text style={s.formAction}>Choose Photo</Text>
            </Pressable>
          </View>
        )}

        {(sheet?.mode === 'new' || canEdit) && (
          <Pressable onPress={save} disabled={busy} style={({ pressed }) => [s.primary, busy && { opacity: 0.5 }, pressed && { opacity: 0.85 }]} testID="cl-save">
            {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={s.primaryText}>{sheet?.mode === 'edit' ? 'Save' : 'Done'}</Text>}
          </Pressable>
        )}
        {sheet?.mode === 'edit' && sheet.entry && canDelete && (
          <Pressable onPress={() => removeEntry(sheet.entry!)} style={({ pressed }) => [s.destructive, pressed && s.pressed]} testID="cl-delete-entry">
            <Text style={s.destructiveText}>Delete Entry</Text>
          </Pressable>
        )}
      </Sheet>
      <CurrencyPicker visible={picking} value={currency} onPick={(c) => { setCurrency(c); setPicking(false); }} onClose={() => setPicking(false)} />

      <Sheet visible={pickingSplit} onClose={() => setPickingSplit(false)} title="How was this split?" testID="cl-split-picker">
        <View style={s.formGroup}>
          {([['gave', 'equal'], ['gave', 'full'], ['got', 'equal'], ['got', 'full']] as const).map(([d, m], i) => {
            const half = billN ? money(m === 'equal' ? billN / 2 : billN, currency) : '';
            return (
              <Pressable key={`${d}-${m}`} onPress={() => { setDirection(d); setSplitMode(m); setPickingSplit(false); }}
                style={({ pressed }) => [s.splitRow, i > 0 && s.sepTop, pressed && s.pressed]} testID={`cl-split-${d}-${m}`}>
                <View style={[s.entryIcon, { backgroundColor: d === 'gave' ? colors.success : colors.error }]}>
                  <Ionicons name={m === 'equal' ? 'git-compare-outline' : 'person'} size={14} color={d === 'gave' ? colors.onSuccess : colors.onError} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.formLabel}>{splitLabel(d, m)}</Text>
                  {!!half && <Text style={[s.subtitle, { color: d === 'gave' ? colors.onSuccess : colors.onError }]}>{d === 'gave' ? `${first} owes you ${half}` : `You owe ${first} ${half}`}</Text>}
                </View>
                {direction === d && splitMode === m && <Ionicons name="checkmark" size={20} color={colors.brandPrimary} />}
              </Pressable>
            );
          })}
        </View>
        <Text style={[s.sectionHeader, { marginTop: spacing.lg }]}>MORE OPTIONS</Text>
        <View style={s.formGroup}>
          {(['gave', 'got'] as const).map((d, i) => (
            <Pressable key={d} onPress={() => { setDirection(d); setSplitMode('custom'); if (!share && billN) setShare(String(billN / 2)); setPickingSplit(false); }}
              style={({ pressed }) => [s.splitRow, i > 0 && s.sepTop, pressed && s.pressed]} testID={`cl-split-${d}-custom`}>
              <Ionicons name="options-outline" size={20} color={colors.mutedText} />
              <Text style={[s.formLabel, { flex: 1 }]}>{splitLabel(d, 'custom')} (enter amount)</Text>
              {direction === d && splitMode === 'custom' && <Ionicons name="checkmark" size={20} color={colors.brandPrimary} />}
            </Pressable>
          ))}
        </View>
      </Sheet>

      <Sheet visible={pickingGroup} onClose={() => setPickingGroup(false)} title="Group" testID="cl-group-picker">
        <View style={s.formGroup}>
          {[{ id: null as string | null, name: 'General' }, ...groups].map((g, i) => (
            <Pressable key={g.id || 'general'} onPress={() => { setEntryGroup(g.id); setPickingGroup(false); }} style={({ pressed }) => [s.formRow, i > 0 && s.sepTop, pressed && s.pressed]} testID={`cl-pick-group-${g.id || 'general'}`}>
              <Ionicons name={g.id ? 'folder-outline' : 'person-outline'} size={18} color={colors.mutedText} />
              <Text style={[s.formLabel, { flex: 1 }]} numberOfLines={1}>{g.name}</Text>
              {entryGroup === g.id && <Ionicons name="checkmark" size={20} color={colors.brandPrimary} />}
            </Pressable>
          ))}
          {canEdit && (
            <Pressable onPress={() => { setPickingGroup(false); openGroupSheet('new'); }} style={({ pressed }) => [s.formRow, s.sepTop, pressed && s.pressed]} testID="cl-pick-group-new">
              <Ionicons name="add-circle" size={18} color={colors.brandPrimary} /><Text style={s.formAction}>New Group</Text>
            </Pressable>
          )}
        </View>
        <Text style={s.footer}>General entries and each group keep separate totals; all of them add up to {first}&apos;s balance.</Text>
      </Sheet>

      <Sheet visible={!!groupSheet} onClose={() => setGroupSheet(null)} title={groupSheet?.mode === 'edit' ? 'Edit Group' : 'New Group'} testID="cl-group-sheet">
        <View style={s.formGroup}>
          <TextInput value={groupName} onChangeText={setGroupName} placeholder="Group name, e.g. Dubai trip" placeholderTextColor={colors.mutedText}
            style={s.formInput} autoFocus onSubmitEditing={saveGroup} testID="cl-group-name" />
        </View>
        <Pressable onPress={saveGroup} disabled={!groupName.trim()} style={({ pressed }) => [s.primary, !groupName.trim() && { opacity: 0.5 }, pressed && { opacity: 0.85 }]} testID="cl-group-save">
          <Text style={s.primaryText}>{groupSheet?.mode === 'edit' ? 'Save' : 'Create Group'}</Text>
        </Pressable>
        {groupSheet?.mode === 'edit' && canDelete && (
          <Pressable onPress={deleteGroup} style={({ pressed }) => [s.destructive, pressed && s.pressed]} testID="cl-group-delete"><Text style={s.destructiveText}>Delete Group</Text></Pressable>
        )}
      </Sheet>

      <Sheet visible={!!conv} onClose={() => setConv(null)} title="Convert" testID="cl-convert-sheet">
        {conv && (
          <>
            <View style={s.formGroup}>
              <View style={s.formRow}>
                <Text style={[s.formLabel, { flex: 1 }]}>From</Text>
                <Text style={s.formValue} numberOfLines={1}>{money(convFromBal, conv.from)}</Text>
              </View>
              <View style={s.formSep} />
              <View style={s.formRow}>
                <Text style={[s.curSymSmall]}>{symbol(conv.from)}</Text>
                <TextInput value={convAmt} onChangeText={(t) => setConvAmt(t.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad" placeholder="0"
                  placeholderTextColor={colors.mutedText} style={[s.formInput, { flex: 1, paddingHorizontal: 0, fontWeight: '600' }]} testID="cl-conv-amount" />
                <Pressable onPress={() => setConvAmt(String(Math.abs(convFromBal)))} hitSlop={8}><Text style={s.formAction}>All</Text></Pressable>
              </View>
            </View>

            {(grp || groups.length > 0) && (
              <Text style={s.footer}>{grp ? `From the ${grp.name} group's balance.` : "From the general balance — a group's balance is converted on the group's page."}</Text>
            )}
            <View style={{ alignItems: 'center', marginVertical: 8 }}><Ionicons name="arrow-down-circle" size={28} color={colors.brandPrimary} /></View>

            <View style={s.formGroup}>
              <Pressable onPress={() => setConvPicking(true)} style={({ pressed }) => [s.formRow, pressed && s.pressed]} testID="cl-conv-to">
                <Text style={[s.formLabel, { flex: 1 }]}>To</Text>
                <Text style={s.formValue} numberOfLines={1}>{currencyName(convTo).replace(' (grams)', '')} {symbol(convTo)}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.mutedText} />
              </Pressable>
              <View style={s.formSep} />
              <View style={s.formRow}>
                <Text style={[s.formLabel, { flexShrink: 0 }]} numberOfLines={1}>1 {unitOf(conv.from)} =</Text>
                <TextInput value={convRate} onChangeText={(t) => setConvRate(t.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad" placeholder="Rate"
                  placeholderTextColor={colors.mutedText} style={[s.formInput, { flex: 1, minWidth: 0, textAlign: 'right', paddingHorizontal: 0 }]} testID="cl-conv-rate" />
                <Text style={[s.formValue2, { flexShrink: 0 }]} numberOfLines={1}>{unitOf(convTo)}</Text>
              </View>
            </View>
            {(METALS[conv.from] || METALS[convTo]) && !!suggestRate(conv.from, convTo) && (
              <Pressable onPress={() => setConvRate(suggestRate(conv.from, convTo))} hitSlop={6}>
                <Text style={s.footer}>Today&apos;s live rate: {money(metalRates[METALS[conv.from] ? conv.from : convTo] || 0, BASE_CURRENCY)} per gram ({METALS[conv.from] ? METALS[conv.from].name : METALS[convTo].name}, sell). Tap to use it.</Text>
              </Pressable>
            )}

            <View style={s.convResult} testID="cl-conv-result">
              <Text style={s.convResultLabel}>{convFromBal > 0 ? `${first} will owe you` : `You will owe ${first}`}</Text>
              <Text style={[s.convResultAmt, { color: balColor(convFromBal) }]} numberOfLines={1} adjustsFontSizeToFit>{convOut ? money(convOut, convTo) : '—'}</Text>
              <Text style={s.convResultSub}>instead of {money(convAmtN, conv.from)}</Text>
            </View>

            <View style={s.formGroup}>
              <View style={s.formPad}><DateField value={convDate} onChange={setConvDate} testID="cl-conv-date" /></View>
              <View style={s.formSep} />
              <TextInput value={convNote} onChangeText={setConvNote} placeholder="Note (optional)" placeholderTextColor={colors.mutedText} style={s.formInput} testID="cl-conv-note" />
            </View>
            <Pressable onPress={doConvert} disabled={convBusy || !convOut} style={({ pressed }) => [s.primary, (convBusy || !convOut) && { opacity: 0.5 }, pressed && { opacity: 0.85 }]} testID="cl-conv-save">
              {convBusy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={s.primaryText}>Convert</Text>}
            </Pressable>
            <Text style={s.footer}>Saved as two entries with the rate, so the statement still adds up. Delete either one to undo the conversion.</Text>
          </>
        )}
      </Sheet>
      <CurrencyPicker visible={convPicking} value={convTo}
        onPick={(c) => { setConvPicking(false); if (conv && c !== conv.from) { setConvTo(c); setConvRate(suggestRate(conv.from, c)); } }}
        onClose={() => setConvPicking(false)} />

      {acc && (
        <CashStatementSheet visible={stmtOpen} onClose={() => setStmtOpen(false)} accountId={id} name={acc.name}
          group={grp ? grp.id : undefined} scopeLabel={grp ? grp.name : 'All'} />
      )}

      <Sheet visible={editAcc} onClose={() => setEditAcc(false)} title="Edit" testID="cl-account-sheet">
        <View style={s.formGroup}>
          <TextInput value={accName} onChangeText={setAccName} placeholder="Name" placeholderTextColor={colors.mutedText} style={s.formInput} testID="cl-acc-name" />
          <View style={s.formSep} />
          <TextInput value={accPhone} onChangeText={setAccPhone} placeholder="Mobile" placeholderTextColor={colors.mutedText} style={s.formInput} keyboardType="phone-pad" testID="cl-acc-phone" />
          <View style={s.formSep} />
          <TextInput value={accNote} onChangeText={setAccNote} placeholder="Note" placeholderTextColor={colors.mutedText} style={s.formInput} testID="cl-acc-note" />
        </View>
        <Pressable onPress={saveAcc} style={({ pressed }) => [s.primary, pressed && { opacity: 0.85 }]} testID="cl-acc-save"><Text style={s.primaryText}>Save</Text></Pressable>
        {canDelete && (
          <Pressable onPress={deleteAcc} style={({ pressed }) => [s.destructive, pressed && s.pressed]} testID="cl-acc-delete"><Text style={s.destructiveText}>Delete Person</Text></Pressable>
        )}
      </Sheet>
    </SafeAreaView>
  );
}

function RoundAction({ s, icon, label, onPress, disabled, testID }: {
  s: ReturnType<typeof makeStyles>; icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; disabled?: boolean; testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [s.roundAction, disabled && { opacity: 0.35 }, pressed && { opacity: 0.6 }]} testID={testID}>
      <View style={s.roundIcon}><Ionicons name={icon} size={20} color={colors.brandPrimary} /></View>
      <Text style={s.roundLabel}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors, narrow = false) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: spacing.lg },
  navText: { color: colors.brandPrimary, fontSize: 17 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: spacing.sm },
  heroAv: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  heroAvText: { color: colors.onSurfaceSecondary, fontSize: 20, fontWeight: '500' },
  heroLabel: { color: colors.onSurface, fontSize: 17, fontWeight: '600' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: spacing.md },
  tile: { flexGrow: 1, flexBasis: '45%', backgroundColor: colors.surfaceSecondary, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  tileWide: { flexBasis: '100%' },
  tileLabel: { color: colors.mutedText, fontSize: 13, fontWeight: '500' },
  tileAmt: { fontSize: 22, fontWeight: '700', letterSpacing: -0.4, marginTop: 2, fontVariant: ['tabular-nums'] },
  tileAmtBig: { fontSize: 30, letterSpacing: -0.6 },
  tileSub: { color: colors.mutedText, fontSize: 12, marginTop: 2 },
  heroSub: { color: colors.mutedText, fontSize: 13, marginTop: 1 },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: spacing.lg },
  roundAction: { flex: 1, maxWidth: 110, alignItems: 'center', gap: 5, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.surfaceSecondary },
  roundIcon: { height: 26, alignItems: 'center', justifyContent: 'center' },
  roundLabel: { color: colors.brandPrimary, fontSize: 12, fontWeight: '500' },
  note: { color: colors.mutedText, fontSize: 13, textAlign: 'center', marginTop: spacing.md },
  emptyText: { color: colors.mutedText, fontSize: 15, textAlign: 'center', marginTop: spacing.xl },
  sectionHeader: { color: colors.mutedText, fontSize: 13, letterSpacing: 0.2, marginTop: spacing.xl, marginBottom: 6, marginLeft: spacing.md },
  group: { backgroundColor: colors.surfaceSecondary, borderRadius: 12, overflow: 'hidden' },
  pressed: { backgroundColor: colors.surfaceTertiary },
  entry: { flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.md },
  entryIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  entryBody: { flex: 1, flexDirection: 'row', alignItems: 'center', marginLeft: 12, paddingVertical: 10, paddingRight: spacing.md, minHeight: 56 },
  sepTop: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  title: { color: colors.onSurface, fontSize: 17, letterSpacing: -0.2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  subtitle: { color: colors.mutedText, fontSize: 13 },
  trailing: { alignItems: 'flex-end', marginLeft: 8 },
  amount: { fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
  footer: { color: colors.mutedText, fontSize: 13, marginTop: 8, marginHorizontal: spacing.md },
  // Statement table
  tRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: narrow ? 10 : 12, paddingVertical: 9, gap: narrow ? 6 : 8 },
  tHead: { paddingVertical: 7 },
  tHeadText: { color: colors.mutedText, fontSize: narrow ? 10 : 11, fontWeight: '600', letterSpacing: 0.3 },
  tCell: { color: colors.onSurface, fontSize: narrow ? 12 : 13, fontVariant: ['tabular-nums'] },
  tYear: { color: colors.mutedText, fontSize: 11, fontVariant: ['tabular-nums'] },
  tDetails: { flex: 1, minWidth: 0 },
  tNum: { width: narrow ? 84 : 100, textAlign: 'right' },
  tBal: { width: narrow ? 88 : 104, textAlign: 'right', fontWeight: '600' },
  tGroup: { backgroundColor: colors.surfaceTertiary + '80' },
  tFoot: { backgroundColor: colors.surfaceTertiary },
  tFootText: { color: colors.onSurface, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  // Day-wise
  dRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 10, minHeight: 50 },
  dNote: { flex: 1, minWidth: 0, color: colors.onSurface, fontSize: 16 },
  dAmt: { fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  dClose: { backgroundColor: colors.surfaceTertiary },
  dCloseLabel: { flex: 1, color: colors.onSurface, fontSize: 15, fontWeight: '600' },
  dCloseAmt: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  toolbar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 10, paddingHorizontal: spacing.lg, paddingTop: 10,
    backgroundColor: Platform.OS === 'web' ? 'rgba(127,127,127,0.10)' : colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider,
    // Frosted, content scrolls under it (web)
    ...(Platform.OS === 'web' ? ({ backdropFilter: 'blur(20px) saturate(180%)', WebkitBackdropFilter: 'blur(20px) saturate(180%)' } as any) : {}),
  },
  toolBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 14 },
  toolText: { fontWeight: '600', fontSize: 17 },
  amountWrap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg, gap: 4 },
  curBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingRight: 2 },
  curSym: { fontSize: 40, fontWeight: '600' },
  amountInput: { ...({ outlineStyle: 'none' } as any), fontSize: 52, fontWeight: '700', letterSpacing: -1, textAlign: 'center', minWidth: 80, maxWidth: 260, paddingVertical: 0, fontVariant: ['tabular-nums'] },
  curCode: { color: colors.mutedText, fontSize: 13, textAlign: 'center', marginBottom: spacing.lg },
  formGroup: { backgroundColor: colors.surfaceSecondary, borderRadius: 12, overflow: 'hidden' },
  formPad: { paddingHorizontal: 6, paddingVertical: 4 },
  formInput: { color: colors.onSurface, fontSize: 17, paddingHorizontal: spacing.md, paddingVertical: 13, ...({ outlineStyle: 'none' } as any) },
  formSep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.divider, marginLeft: spacing.md },
  formRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: spacing.md, minHeight: 48 },
  formAction: { color: colors.brandPrimary, fontSize: 17 },
  formLabel: { color: colors.onSurface, fontSize: 17 },
  splitBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.surfaceSecondary, marginBottom: 4, maxWidth: '100%' },
  splitBtnText: { color: colors.onSurface, fontSize: 15, fontWeight: '500', flexShrink: 1 },
  splitResult: { textAlign: 'center', fontSize: 15, fontWeight: '600', marginTop: 8, marginBottom: 4 },
  splitRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: spacing.md, paddingVertical: 10, minHeight: 56 },
  pcChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.surfaceTertiary },
  pcChipText: { color: colors.brandPrimary, fontSize: 14, fontWeight: '600' },
  formValue: { flex: 1, textAlign: 'right', color: colors.mutedText, fontSize: 17 },
  formValue2: { color: colors.mutedText, fontSize: 17, marginLeft: 6 },
  curSymSmall: { color: colors.onSurface, fontSize: 20, fontWeight: '600', minWidth: 24 },
  tilesHint: { color: colors.mutedText, fontSize: 12, textAlign: 'center', marginTop: 8 },
  convResult: { alignItems: 'center', paddingVertical: spacing.lg },
  convResultLabel: { color: colors.mutedText, fontSize: 13 },
  convResultAmt: { fontSize: 34, fontWeight: '700', letterSpacing: -0.8, fontVariant: ['tabular-nums'], marginTop: 2 },
  convResultSub: { color: colors.mutedText, fontSize: 13, marginTop: 2 },
  shot: { width: 60, height: 60, borderRadius: 8, overflow: 'hidden' },
  shotImg: { width: 60, height: 60, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  shotX: { position: 'absolute', top: 3, right: 3, width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: colors.brandPrimary, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: spacing.lg },
  primaryText: { color: colors.onBrandPrimary, fontWeight: '600', fontSize: 17 },
  destructive: { backgroundColor: colors.surfaceSecondary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: spacing.md },
  destructiveText: { color: colors.onError, fontSize: 17 },
});
