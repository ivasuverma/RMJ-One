import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, TextInput, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { confirmAction } from '@/src/utils/confirm';
import { pickWebFile } from '@/src/components/DocumentCaptureSheet';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';
import { BList, Header, makeStyles, Overview, Plan, Sub, num } from './_shared';

// Built-in rate lists, or `list:<id>` for one of the owner's own lists.
type Filter = 'weekly' | 'daily' | 'stopped' | 'all' | `list:${string}`;
const FILTER_QUERY: Record<string, string> = {
  weekly: 'status=active&plan=weekly', daily: 'status=active&plan=daily', stopped: 'status=opted_out', all: '',
};
const filterQuery = (f: Filter) => (f.startsWith('list:') ? `status=active&list_id=${f.slice(5)}` : FILTER_QUERY[f]);

// Step 3 — who gets the broadcasts. The customer list (imported, sent weekly),
// daily subscribers (joined by sending START), and people who replied STOP,
// kept on file so an import can never add them back.
export default function BroadcastPeopleScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const [counts, setCounts] = useState<Overview['counts'] | null>(null);
  const [subs, setSubs] = useState<Sub[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [newSub, setNewSub] = useState<{ name: string; mobile: string; plan: Plan }>({ name: '', mobile: '', plan: 'weekly' });
  const [lists, setLists] = useState<BList[]>([]);
  const [newList, setNewList] = useState<string | null>(null);   // null = not creating
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const seq = useRef(0);

  const loadCounts = useCallback(async () => {
    try {
      const [o, l] = await Promise.all([api.get<Overview>('/rate-broadcast/overview'), api.get<BList[]>('/broadcasts/lists')]);
      setCounts(o.counts); setLists(l);
    } catch { /* list still works */ }
  }, []);
  const loadList = useCallback(async (f: Filter, query: string) => {
    const my = ++seq.current;
    try {
      const params = [filterQuery(f), query.trim() ? `q=${encodeURIComponent(query.trim())}` : ''].filter(Boolean).join('&');
      const rows = await api.get<Sub[]>(`/rate-broadcast/subscribers${params ? `?${params}` : ''}`);
      if (my === seq.current) setSubs(rows);
    } catch (e: any) { toast.error(e?.detail || 'Could not load'); }
    finally { setRefreshing(false); }
  }, [toast]);

  useFocusEffect(useCallback(() => { loadCounts(); }, [loadCounts]));
  // Search runs on the server, so all of a 4,000-name list is searchable, not just what's shown.
  useEffect(() => {
    const t = setTimeout(() => loadList(filter, q), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [filter, q, loadList]);
  const reload = () => { loadCounts(); loadList(filter, q); };

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e: any) { toast.error(e?.detail || 'Something went wrong'); } finally { setBusy(null); }
  };

  const listId = filter.startsWith('list:') ? filter.slice(5) : null;
  const curList = lists.find((l) => l.id === listId) || null;

  const importList = async () => {
    const file = await pickWebFile('.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    if (!file) return;
    run('import', async () => {
      const form = new FormData();
      form.append('file', file, file.name);
      if (listId) {
        const r = await api.upload<any>(`/broadcasts/lists/${listId}/import`, form);
        const bits = [`${num(r.added)} added`];
        if (r.already) bits.push(`${num(r.already)} already on the list`);
        if (r.invalid) bits.push(`${num(r.invalid)} invalid numbers skipped`);
        if (r.opted_out) bits.push(`${num(r.opted_out)} had replied STOP — left out`);
        toast.success(bits.join(' · '));
      } else {
        const r = await api.upload<any>('/rate-broadcast/subscribers/import', form);
        const bits = [`${num(r.added)} added`];
        if (r.already_there) bits.push(`${num(r.already_there)} already on the list`);
        if (r.invalid) bits.push(`${num(r.invalid)} invalid numbers skipped`);
        if (r.opted_out_kept) bits.push(`${num(r.opted_out_kept)} had replied STOP — left out`);
        toast.success(bits.join(' · '));
      }
      reload();
    });
  };

  const addOne = () => run('add', async () => {
    if (listId) await api.post(`/broadcasts/lists/${listId}/members`, { name: newSub.name, mobile: newSub.mobile });
    else await api.post('/rate-broadcast/subscribers', newSub);
    setNewSub((s) => ({ ...s, name: '', mobile: '' }));
    toast.success('Added');
    reload();
  });

  const remove = (s: Sub) => (listId
    ? confirmAction('Remove from this list?', `${s.name || s.mobile} is taken off “${curList?.name}”.`, 'Remove',
      () => run(`del-${s.id}`, async () => { await api.del(`/broadcasts/lists/${listId}/members/${s.id}`); reload(); }))
    : confirmAction('Remove from the list?', `${s.name || s.mobile} won’t get broadcasts.`, 'Remove',
      () => run(`del-${s.id}`, async () => { await api.del(`/rate-broadcast/subscribers/${s.id}`); reload(); })));

  const createList = () => newList?.trim() && run('list', async () => {
    const l = await api.post<BList>('/broadcasts/lists', { name: newList.trim() });
    setLists((ls) => [...ls, l]);
    setNewList(null);
    setFilter(`list:${l.id}`);
  });
  const deleteList = () => curList && confirmAction('Delete this list?', `“${curList.name}” is removed. People on other lists or the rate lists stay.`, 'Delete',
    () => run('list', async () => {
      await api.del(`/broadcasts/lists/${curList.id}`);
      setLists((ls) => ls.filter((l) => l.id !== curList.id));
      setFilter('all');
    }));

  const FILTERS: { key: Filter; label: string; n?: number }[] = [
    { key: 'all', label: 'All' },
    { key: 'daily', label: 'Daily', n: counts?.daily },
    { key: 'weekly', label: 'Customer list', n: counts?.weekly },
    { key: 'stopped', label: 'Replied STOP', n: counts?.opted_out },
  ];

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="broadcast-people-screen">
      <Header title="People" colors={colors} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); reload(); }} tintColor={colors.brandPrimary} />}>
        <Text style={styles.hint}>
          The customer list gets the weekly send; daily subscribers joined themselves by sending START to the shop’s number
          or the official one. Make your own lists (Bridal, VIP…) for offers and new designs. Anyone who replies STOP or taps
          “Stop updates” is taken off everything automatically.
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{curList ? `Add people to “${curList.name}”` : 'Add people'}</Text>
          <Pressable onPress={importList} disabled={busy === 'import'} style={styles.btn} testID="rate-broadcast-import" accessibilityRole="button">
            {busy === 'import' ? <ActivityIndicator color={colors.brandSecondary} /> : (
              <><Ionicons name="cloud-upload-outline" size={16} color={colors.brandSecondary} /><Text style={styles.btnText}>{curList ? 'Import into this list (Excel / CSV)' : 'Import customer list (Excel / CSV)'}</Text></>
            )}
          </Pressable>
          <Text style={styles.hint}>{curList ? 'They get only what you send to this list — not the rate, unless they join it. ' : 'Imported customers join the customer list. '}Needs a mobile column; a name column is optional. Numbers already there are skipped.</Text>
          <View style={styles.divider} />
          <View style={styles.row}>
            <TextInput value={newSub.name} onChangeText={(v) => setNewSub((s) => ({ ...s, name: v }))} placeholder="Name" placeholderTextColor={colors.mutedText} style={[styles.input, styles.flex1]} testID="broadcast-add-name" />
            <TextInput value={newSub.mobile} onChangeText={(v) => setNewSub((s) => ({ ...s, mobile: v }))} placeholder="Mobile" keyboardType="phone-pad" placeholderTextColor={colors.mutedText} style={[styles.input, styles.flex1]} testID="broadcast-add-mobile" />
          </View>
          <View style={styles.row}>
            <View style={[styles.chips, styles.flex1]}>
              {!curList && (['weekly', 'daily'] as Plan[]).map((p) => (
                <Pressable key={p} onPress={() => setNewSub((s) => ({ ...s, plan: p }))} style={[styles.chip, newSub.plan === p && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: newSub.plan === p }}>
                  <Text style={[styles.chipText, newSub.plan === p && styles.chipTextOn]}>{p === 'daily' ? 'Daily' : 'Customer list'}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable onPress={addOne} disabled={!newSub.mobile.trim() || busy === 'add'} style={[styles.primary, { paddingHorizontal: 18, paddingVertical: 10 }, !newSub.mobile.trim() && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel="Add person" testID="broadcast-add-btn">
              <Text style={styles.primaryText}>Add</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.chips}>
            {FILTERS.map((f) => (
              <Pressable key={f.key} onPress={() => setFilter(f.key)} style={[styles.chip, filter === f.key && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: filter === f.key }} testID={`broadcast-filter-${f.key}`}>
                <Text style={[styles.chipText, filter === f.key && styles.chipTextOn]}>{f.label}{f.n != null ? ` · ${num(f.n)}` : ''}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.small, { marginTop: 4, marginBottom: 0 }]}>Your lists</Text>
          <View style={styles.chips}>
            {lists.map((l) => {
              const on = filter === `list:${l.id}`;
              return (
                <Pressable key={l.id} onPress={() => setFilter(`list:${l.id}`)} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }} testID={`broadcast-list-${l.id}`}>
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{l.name} · {num(l.count)}</Text>
                </Pressable>
              );
            })}
            {newList === null && (
              <Pressable onPress={() => setNewList('')} style={[styles.chip, { borderStyle: 'dashed' }]} accessibilityRole="button" testID="broadcast-new-list">
                <Text style={[styles.chipText, { color: colors.brandSecondary }]}>+ New list</Text>
              </Pressable>
            )}
          </View>
          {newList !== null && (
            <View style={styles.row}>
              <TextInput value={newList} onChangeText={setNewList} autoFocus maxLength={40} placeholder="List name, e.g. Bridal enquiries" placeholderTextColor={colors.mutedText}
                onSubmitEditing={createList} style={[styles.input, styles.flex1]} testID="broadcast-new-list-name" />
              <Pressable onPress={createList} disabled={!newList.trim() || busy === 'list'} style={[styles.primary, { paddingHorizontal: 16, paddingVertical: 10 }, !newList.trim() && { opacity: 0.5 }]} accessibilityRole="button" testID="broadcast-new-list-save">
                <Text style={styles.primaryText}>Create</Text>
              </Pressable>
              <Pressable onPress={() => setNewList(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel">
                <Ionicons name="close" size={20} color={colors.mutedText} />
              </Pressable>
            </View>
          )}
          {curList && (
            <Pressable onPress={deleteList} style={{ alignSelf: 'flex-start' }} accessibilityRole="button" testID="broadcast-delete-list">
              <Text style={[styles.btnText, { color: colors.onError, fontSize: 12.5 }]}>Delete “{curList.name}”</Text>
            </Pressable>
          )}
          <TextInput value={q} onChangeText={setQ} placeholder="Search name or mobile" placeholderTextColor={colors.mutedText} style={styles.input} testID="broadcast-search" />
          {subs === null ? <ActivityIndicator color={colors.brandPrimary} style={{ marginVertical: 12 }} /> : subs.length === 0 ? (
            <Text style={styles.hint}>{q ? 'Nobody matches.' : 'Nobody here yet.'}</Text>
          ) : subs.map((s) => (
            <View key={s.id} style={styles.listRow}>
              <View style={styles.flex1}>
                <Text style={styles.listName} numberOfLines={1}>{s.name || '—'}</Text>
                <Text style={styles.listMeta}>{s.mobile} · {s.status === 'opted_out' ? 'replied STOP' : s.plan === 'daily' ? 'daily rate' : s.plan === 'none' ? 'no rate updates' : 'customer list'}{s.source === 'whatsapp' || s.source === 'shop_whatsapp' ? ' · joined on WhatsApp' : ''}</Text>
              </View>
              {s.status === 'active' && (
                <Pressable onPress={() => remove(s)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${s.name || s.mobile}`}>
                  <Ionicons name="close-circle-outline" size={20} color={colors.mutedText} />
                </Pressable>
              )}
            </View>
          ))}
          {subs && subs.length >= 300 && <Text style={styles.hint}>Showing the newest 300 — search to find someone.</Text>}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
