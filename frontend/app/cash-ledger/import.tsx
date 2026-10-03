import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { istDisplayDate } from '@/src/utils/datetime';
import { haptics } from '@/src/utils/haptics';
import { spacing, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Sheet, useToast } from '@/src/components/ui';
import { SegmentedControl } from '@/src/components/ui/SegmentedControl';
import { ModuleHeader } from '@/src/components/ui/ModuleHeader';
import { HeaderSpacer, useScrolled } from '@/src/components/ui/StickyHeader';
import { CLAccount, money, orderedCodes } from '@/src/utils/cashLedger';

type Preview = {
  people: string[]; me: string; other: string; lines: number; from: string; to: string;
  balances: Record<string, number>; file_totals: Record<string, number>; matches_file: boolean;
  account: { id: string; name: string; groups: { id: string; name: string }[]; exact: boolean } | null;
  already_imported: number; too_many_people: boolean;
};
type Target = { kind: 'existing'; id: string; name: string; groups: { id: string; name: string }[] } | { kind: 'new' };

// Import a Splitwise "Export as spreadsheet" CSV (one friend) into a person
// in the Cash Ledger: preview first — names, dates, and the balance it comes
// to, checked against Splitwise's own Total balance lines — then import.
// Importing the same file again skips the lines already brought in.
export default function SplitwiseImportScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const { scrolled, onScroll } = useScrolled();
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [me, setMe] = useState<string | undefined>();
  const [target, setTarget] = useState<Target | null>(null);
  const [newName, setNewName] = useState('');
  const [groupMode, setGroupMode] = useState<string>('general');   // 'general' | group id | 'new'
  const [newGroup, setNewGroup] = useState('');
  const [pv, setPv] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState<CLAccount[]>([]);
  const [choosing, setChoosing] = useState(false);

  const preview = useCallback(async (text: string, who?: string, accountId?: string) => {
    setLoading(true);
    try {
      const r = await api.post<Preview>('/khata-import/splitwise/preview', { csv: text, me: who, account_id: accountId });
      setPv(r); setMe(r.me);
      return r;
    } catch (e: any) { toast.error(e?.detail || 'Could not read this file'); setPv(null); return null; }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { api.get<{ accounts: CLAccount[] }>('/khata').then((r) => setAccounts(r.accounts)).catch(() => {}); }, []);

  // Its own file input that stays on the page and just waits for 'change': on
  // iPhone a CSV in iCloud/Files is downloaded first, which can take a while,
  // and a picker that gives up early made the tap look like it did nothing.
  const inputRef = useRef<HTMLInputElement | null>(null);
  const onFileRef = useRef<(f: File) => void>(() => {});
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv,text/comma-separated-values,text/plain,application/vnd.ms-excel';
    Object.assign(input.style, { position: 'fixed', left: '-9999px', top: '0', opacity: '0' });
    input.onchange = () => { const f = input.files?.[0]; if (f) onFileRef.current(f); };
    document.body.appendChild(input);
    inputRef.current = input;
    return () => { input.remove(); inputRef.current = null; };
  }, []);
  const choose = () => {
    if (!inputRef.current) { toast.error('Open the RMJ One web app to import a file'); return; }
    inputRef.current.value = '';   // so picking the same file again still fires
    inputRef.current.click();
  };
  onFileRef.current = async (f: File) => {
    setFileName(f.name); setLoading(true); setPv(null);
    let text = '';
    try { text = await f.text(); } catch { setLoading(false); toast.error("Couldn't read that file — try saving it to On My iPhone first"); return; }
    setCsv(text);
    const r = await preview(text);
    if (r) {
      // Only an exact name match is chosen for you; a same-first-name match is just offered.
      setTarget(r.account?.exact ? { kind: 'existing', ...r.account } : { kind: 'new' });
      setNewName(r.other.replace(/\b\w/g, (c) => c.toUpperCase()));
      setGroupMode('general'); setNewGroup('');
    }
  };
  const pickMe = async (who: string) => { if (who !== me) await preview(csv, who, target?.kind === 'existing' ? target.id : undefined); };
  const pickTarget = async (t: Target) => {
    setTarget(t); setGroupMode('general'); setChoosing(false);
    await preview(csv, me, t.kind === 'existing' ? t.id : undefined);
  };

  const otherName = target?.kind === 'existing' ? target.name.split(' ')[0] : (newName.trim() || pv?.other || '').split(' ')[0];
  const canImport = !!pv && !pv.too_many_people && !!target && (target.kind === 'existing' || !!newName.trim()) && (groupMode !== 'new' || !!newGroup.trim());

  const run = async () => {
    if (!pv || !target || busy) return;
    setBusy(true);
    try {
      const r = await api.post<{ account_id: string; added: number; skipped: number; group_id: string | null }>('/khata-import/splitwise', {
        csv, me,
        account_id: target.kind === 'existing' ? target.id : undefined,
        new_name: target.kind === 'new' ? newName.trim() : undefined,
        group_id: groupMode !== 'general' && groupMode !== 'new' ? groupMode : undefined,
        new_group: groupMode === 'new' ? newGroup.trim() : undefined,
      });
      haptics.success();
      toast.success(r.added ? `Imported ${r.added} ${r.added === 1 ? 'entry' : 'entries'}${r.skipped ? ` · ${r.skipped} already there` : ''}` : 'Nothing new — everything was already imported');
      router.replace(`/cash-ledger/${r.account_id}${r.group_id ? `?group=${r.group_id}` : ''}` as any);
    } catch (e: any) { haptics.error(); toast.error(e?.detail || 'Could not import'); }
    finally { setBusy(false); }
  };

  const codes = pv ? orderedCodes(pv.balances) : [];
  const groups = target?.kind === 'existing' ? target.groups : [];

  return (
    <SafeAreaView style={s.root} edges={['top']} testID="cl-import-screen">
      <ModuleHeader title="Import" backLabel="Cash Ledger" scrolled={scrolled} />
      <ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <HeaderSpacer />
        <View style={s.hero}>
          <View style={s.heroIcon}><Ionicons name="swap-vertical" size={28} color={colors.brandPrimary} /></View>
          <Text style={s.heroTitle}>Import from Splitwise</Text>
          <Text style={s.heroText}>In Splitwise, open the friend, tap the settings icon, then Export as spreadsheet. Choose that CSV file here.</Text>
        </View>

        <Pressable onPress={choose} style={({ pressed }) => [s.group, s.fileRow, pressed && s.pressed]} testID="cl-import-choose">
          <Ionicons name="document-text-outline" size={22} color={colors.brandPrimary} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.title} numberOfLines={1}>{fileName || 'Choose CSV File'}</Text>
            {pv && <Text style={s.subtitle}>{pv.lines} entries · {istDisplayDate(pv.from)} – {istDisplayDate(pv.to)}</Text>}
          </View>
          {loading ? <ActivityIndicator color={colors.mutedText} /> : <Text style={s.link}>{fileName ? 'Change' : 'Choose'}</Text>}
        </Pressable>

        {pv && pv.too_many_people && (
          <Text style={s.warn}>This file has {pv.people.length} people. Export the balance with one friend (not a group) and try again.</Text>
        )}

        {pv && !pv.too_many_people && (
          <>
            <Text style={s.sectionHeader}>WHICH ONE IS YOU?</Text>
            <SegmentedControl options={pv.people.map((p) => ({ key: p, label: p }))} value={me || pv.me} onChange={pickMe} testID="cl-import-me" />

            <Text style={s.sectionHeader}>IMPORT INTO</Text>
            <View style={s.group}>
              {pv.account && (
                <Pressable onPress={() => pickTarget({ kind: 'existing', ...pv.account! })} style={({ pressed }) => [s.row, pressed && s.pressed]} testID="cl-import-existing">
                  <Ionicons name="person-circle-outline" size={22} color={colors.mutedText} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.title}>{pv.account.name}</Text>
                    <Text style={s.subtitle}>{pv.account.exact ? 'Already in the Cash Ledger' : 'Same first name — tap if this is them'}</Text>
                  </View>
                  {target?.kind === 'existing' && target.id === pv.account.id && <Ionicons name="checkmark" size={20} color={colors.brandPrimary} />}
                </Pressable>
              )}
              <Pressable onPress={() => pickTarget({ kind: 'new' })} style={({ pressed }) => [s.row, pv.account && s.sepTop, pressed && s.pressed]} testID="cl-import-new">
                <Ionicons name="person-add-outline" size={22} color={colors.mutedText} />
                <View style={{ flex: 1 }}>
                  {target?.kind === 'new' ? (
                    <TextInput value={newName} onChangeText={setNewName} placeholder="New person's name" placeholderTextColor={colors.mutedText} style={s.inlineInput} testID="cl-import-new-name" />
                  ) : <Text style={s.title}>New person</Text>}
                </View>
                {target?.kind === 'new' && <Ionicons name="checkmark" size={20} color={colors.brandPrimary} />}
              </Pressable>
              <Pressable onPress={() => setChoosing(true)} style={({ pressed }) => [s.row, s.sepTop, pressed && s.pressed]} testID="cl-import-other">
                <Ionicons name="people-outline" size={22} color={colors.mutedText} />
                <Text style={[s.title, { flex: 1 }]} numberOfLines={1}>
                  {target?.kind === 'existing' && target.id !== pv.account?.id ? target.name : 'Someone else…'}
                </Text>
                {target?.kind === 'existing' && target.id !== pv.account?.id ? <Ionicons name="checkmark" size={20} color={colors.brandPrimary} /> : <Ionicons name="chevron-forward" size={16} color={colors.mutedText} />}
              </Pressable>
            </View>

            <Text style={s.sectionHeader}>GROUP</Text>
            <View style={s.group}>
              {[{ id: 'general', name: 'General' }, ...groups, { id: 'new', name: 'New group' }].map((g, i) => (
                <Pressable key={g.id} onPress={() => setGroupMode(g.id)} style={({ pressed }) => [s.row, i > 0 && s.sepTop, pressed && s.pressed]} testID={`cl-import-group-${g.id}`}>
                  <Ionicons name={g.id === 'general' ? 'list-outline' : g.id === 'new' ? 'add-circle-outline' : 'folder-outline'} size={20} color={colors.mutedText} />
                  <View style={{ flex: 1 }}>
                    {g.id === 'new' && groupMode === 'new' ? (
                      <TextInput value={newGroup} onChangeText={setNewGroup} placeholder="Group name, e.g. Splitwise" placeholderTextColor={colors.mutedText} style={s.inlineInput} autoFocus testID="cl-import-new-group" />
                    ) : <Text style={s.title}>{g.name}</Text>}
                  </View>
                  {groupMode === g.id && <Ionicons name="checkmark" size={20} color={colors.brandPrimary} />}
                </Pressable>
              ))}
            </View>
            <Text style={s.footer}>A group keeps these entries and their total apart, and still adds them to the person&apos;s balance.</Text>

            <Text style={s.sectionHeader}>BALANCE FROM THIS FILE</Text>
            <View style={[s.group, { padding: spacing.md, gap: 6 }]} testID="cl-import-balance">
              {codes.length ? codes.map((c) => (
                <View key={c} style={s.balRow}>
                  <Text style={s.subtitle}>{pv.balances[c] > 0 ? `${otherName} owes you` : `You owe ${otherName}`}</Text>
                  <Text style={[s.balAmt, { color: pv.balances[c] > 0 ? colors.onSuccess : colors.onError }]}>{money(pv.balances[c], c)}</Text>
                </View>
              )) : <Text style={s.subtitle}>Settled — nothing owed either way.</Text>}
              {Object.keys(pv.file_totals).length > 0 && (
                <View style={s.check}>
                  <Ionicons name={pv.matches_file ? 'checkmark-circle' : 'alert-circle'} size={16} color={pv.matches_file ? colors.onSuccess : colors.onError} />
                  <Text style={[s.subtitle, { flex: 1 }]}>{pv.matches_file ? "Matches Splitwise's total balance" : "Doesn't match Splitwise's total balance — check which one is you"}</Text>
                </View>
              )}
            </View>
            {target?.kind === 'existing' && pv.already_imported > 0 && (
              <Text style={s.footer}>{pv.already_imported} of these are already imported and will be skipped.</Text>
            )}
            {target?.kind === 'existing' && (
              <Text style={s.footer}>They&apos;re added to {target.name}&apos;s existing entries.</Text>
            )}

            <Pressable onPress={run} disabled={!canImport || busy} style={({ pressed }) => [s.primary, (!canImport || busy) && { opacity: 0.4 }, pressed && { opacity: 0.85 }]} testID="cl-import-run">
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={s.primaryText}>Import {pv.lines - (target?.kind === 'existing' ? pv.already_imported : 0)} Entries</Text>}
            </Pressable>
          </>
        )}
      </ScrollView>

      <Sheet visible={choosing} onClose={() => setChoosing(false)} title="Import Into" testID="cl-import-accounts">
        <ScrollView style={{ maxHeight: 460 }}>
          <View style={s.group}>
            {accounts.map((a, i) => (
              <Pressable key={a.id} onPress={async () => {
                const full = await api.get<{ account: { id: string; name: string; groups?: { id: string; name: string }[] } }>(`/khata/${a.id}`).catch(() => null);
                pickTarget({ kind: 'existing', id: a.id, name: a.name, groups: (full?.account.groups || []).map((g) => ({ id: g.id, name: g.name })) });
              }} style={({ pressed }) => [s.row, i > 0 && s.sepTop, pressed && s.pressed]} testID={`cl-import-account-${a.id}`}>
                <Text style={[s.title, { flex: 1 }]} numberOfLines={1}>{a.name}</Text>
                {target?.kind === 'existing' && target.id === a.id && <Ionicons name="checkmark" size={20} color={colors.brandPrimary} />}
              </Pressable>
            ))}
            {!accounts.length && <Text style={[s.subtitle, { padding: spacing.md }]}>No one in the Cash Ledger yet.</Text>}
          </View>
        </ScrollView>
      </Sheet>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 60 },
  hero: { alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.lg, gap: 6 },
  heroIcon: { width: 60, height: 60, borderRadius: 16, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { color: colors.onSurface, fontSize: 22, fontWeight: '700', marginTop: 6 },
  heroText: { color: colors.mutedText, fontSize: 15, textAlign: 'center', lineHeight: 20, paddingHorizontal: spacing.md },
  group: { backgroundColor: colors.surfaceSecondary, borderRadius: 12, overflow: 'hidden' },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: spacing.md, paddingVertical: 12 },
  pressed: { backgroundColor: colors.surfaceTertiary },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: spacing.md, minHeight: 50, paddingVertical: 8 },
  sepTop: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  title: { color: colors.onSurface, fontSize: 17 },
  subtitle: { color: colors.mutedText, fontSize: 13 },
  link: { color: colors.brandPrimary, fontSize: 17 },
  sectionHeader: { color: colors.mutedText, fontSize: 13, letterSpacing: 0.2, marginTop: spacing.xl, marginBottom: 6, marginLeft: spacing.md },
  footer: { color: colors.mutedText, fontSize: 13, marginTop: 8, marginHorizontal: spacing.md },
  warn: { color: colors.onError, fontSize: 14, marginTop: spacing.md, marginHorizontal: spacing.md },
  inlineInput: { color: colors.onSurface, fontSize: 17, paddingVertical: 6, ...({ outlineStyle: 'none' } as any) },
  balRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  balAmt: { fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  check: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  primary: { backgroundColor: colors.brandPrimary, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: spacing.lg },
  primaryText: { color: colors.onBrandPrimary, fontWeight: '600', fontSize: 17 },
});
