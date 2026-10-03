import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { confirmAction } from '@/src/utils/confirm';
import { istDisplayDate } from '@/src/utils/datetime';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';
import { ModuleHeader } from '@/src/components/ui/ModuleHeader';
import { HeaderSpacer, useScrolled } from '@/src/components/ui/StickyHeader';

type Saved = { id: string; password: string | null; label: string; created_at: string; created_by?: string; last_used_at: string | null; uses: number };

// Passwords of PDFs (bank statements) the app remembers: a locked PDF that one of
// these opens is unlocked as it's uploaded, with no question. Owner only; staff
// never see them. Kept encrypted on the server (see routers/documents.py).
export default function PdfPasswordsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const { scrolled, onScroll } = useScrolled();
  const [rows, setRows] = useState<Saved[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [labelText, setLabelText] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try { setRows(await api.get<Saved[]>('/pdf-passwords')); }
    catch { setRows((r) => r || []); }
    finally { setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = (id: string) => setShown((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const add = async () => {
    if (!newPw.trim() || adding) return;
    setAdding(true);
    try {
      await api.post('/pdf-passwords', { password: newPw.trim(), label: newLabel.trim() });
      setNewPw(''); setNewLabel(''); toast.success('Saved'); load();
    } catch (e: any) { toast.error(e?.detail || 'Could not save'); }
    finally { setAdding(false); }
  };

  const saveLabel = async (id: string) => {
    try { await api.patch(`/pdf-passwords/${id}`, { label: labelText.trim() }); setEditing(null); load(); }
    catch (e: any) { toast.error(e?.detail || 'Could not save'); }
  };

  const remove = (r: Saved) => confirmAction('Forget this password?', 'PDFs that use it will ask for it again. Statements already saved stay unlocked.', 'Forget', async () => {
    try { await api.del(`/pdf-passwords/${r.id}`); toast.success('Forgotten'); load(); }
    catch (e: any) { toast.error(e?.detail || 'Could not delete'); }
  });

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="pdf-passwords-screen">
      <ModuleHeader title="PDF passwords" backLabel="Settings" scrolled={scrolled}
        subtitle={rows ? (rows.length ? `${rows.length} saved` : 'None saved yet') : null} />
      <ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}>
        <HeaderSpacer />
        <Text style={styles.note}>
          Bank statements with a password are unlocked as they&apos;re uploaded, using these. A password typed in once is added here automatically. Only you can see this list; staff never see the passwords.
        </Text>

        {!rows ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 40 }} /> : rows.length > 0 && (
          <View style={styles.card}>
            {rows.map((r, i) => (
              <View key={r.id} style={[styles.row, i > 0 && styles.sep]} testID={`pdf-pw-${r.id}`}>
                <View style={styles.icon}><Ionicons name="key-outline" size={17} color={colors.brandSecondary} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  {editing === r.id ? (
                    <View style={styles.labelEdit}>
                      <TextInput value={labelText} onChangeText={setLabelText} placeholder="e.g. HDFC current account" placeholderTextColor={colors.mutedText}
                        style={[styles.input, { flex: 1, paddingVertical: 8 }]} autoFocus onSubmitEditing={() => saveLabel(r.id)} testID={`pdf-pw-label-input-${r.id}`} />
                      <Pressable onPress={() => saveLabel(r.id)} hitSlop={8} testID={`pdf-pw-label-save-${r.id}`}><Ionicons name="checkmark" size={22} color={colors.brandPrimary} /></Pressable>
                    </View>
                  ) : (
                    <Pressable onPress={() => { setEditing(r.id); setLabelText(r.label); }} hitSlop={4}>
                      <Text style={[styles.label, !r.label && { color: colors.mutedText }]} numberOfLines={1}>{r.label || 'Add a name (which bank?)'}</Text>
                    </Pressable>
                  )}
                  <Text style={styles.pw} selectable>{r.password === null ? "Can't be read any more" : shown.has(r.id) ? r.password : '•'.repeat(Math.min(Math.max(r.password.length, 6), 14))}</Text>
                  <Text style={styles.sub} numberOfLines={1}>
                    {r.uses ? `Used ${r.uses} time${r.uses === 1 ? '' : 's'}${r.last_used_at ? ` · last ${istDisplayDate(r.last_used_at)}` : ''}` : 'Not used yet'}
                    {r.created_by ? ` · added by ${r.created_by.split(' ')[0]}` : ''}
                  </Text>
                </View>
                {r.password !== null && (
                  <Pressable onPress={() => toggle(r.id)} hitSlop={8} style={styles.btn} accessibilityLabel={shown.has(r.id) ? 'Hide password' : 'Show password'} testID={`pdf-pw-show-${r.id}`}>
                    <Ionicons name={shown.has(r.id) ? 'eye-off-outline' : 'eye-outline'} size={19} color={colors.onSurfaceSecondary} />
                  </Pressable>
                )}
                <Pressable onPress={() => remove(r)} hitSlop={8} style={styles.btn} accessibilityLabel="Forget password" testID={`pdf-pw-del-${r.id}`}>
                  <Ionicons name="trash-outline" size={19} color={colors.onError} />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.groupTitle}>Add a password</Text>
        <View style={[styles.card, { padding: spacing.md, gap: spacing.sm }]}>
          <TextInput value={newLabel} onChangeText={setNewLabel} placeholder="Name (optional) — e.g. ICICI savings" placeholderTextColor={colors.mutedText}
            style={styles.input} testID="pdf-pw-new-label" />
          <TextInput value={newPw} onChangeText={setNewPw} placeholder="Password" placeholderTextColor={colors.mutedText}
            style={styles.input} autoCapitalize="none" autoCorrect={false} onSubmitEditing={add} testID="pdf-pw-new" />
          <Pressable onPress={add} disabled={!newPw.trim() || adding} style={[styles.addBtn, (!newPw.trim() || adding) && { opacity: 0.5 }]} testID="pdf-pw-add">
            {adding ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.addText}>Save password</Text>}
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  note: { color: colors.mutedText, fontSize: 13, lineHeight: 19, marginTop: spacing.md, marginHorizontal: 4 },
  groupTitle: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginTop: spacing.lg, marginBottom: spacing.sm, marginHorizontal: 4 },
  card: { marginTop: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: 18, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  sep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  icon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  label: { color: colors.onSurface, fontSize: 15, fontWeight: '600' },
  labelEdit: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pw: { color: colors.onSurface, fontSize: 15, marginTop: 2, letterSpacing: 0.5 },
  sub: { color: colors.mutedText, fontSize: 12, marginTop: 2 },
  btn: { padding: 6 },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 11, fontSize: 15,
  },
  addBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 13, alignItems: 'center' },
  addText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 15 },
});
