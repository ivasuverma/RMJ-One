import { useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TOKEN_KEY } from '@/src/api/client';
import { storage } from '@/src/utils/storage';
import { Sheet } from '@/src/components/ui';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

// A printable statement (PDF) for one party, over an optional date range: open it, or share it (WhatsApp,
// email…) where the device supports sharing a file. `path` is the API path without the query, e.g.
// `/karigars/<id>/statement/pdf`.
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function StatementSheet({ visible, onClose, path, title, filename }: { visible: boolean; onClose: () => void; path: string; title: string; filename: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState<'open' | 'share' | null>(null);
  const [err, setErr] = useState('');

  const preset = (k: 'month' | 'lastmonth' | 'year' | 'all') => {
    const now = new Date();
    if (k === 'all') { setFrom(''); setTo(''); return; }
    if (k === 'month') { setFrom(ymd(new Date(now.getFullYear(), now.getMonth(), 1))); setTo(ymd(now)); return; }
    if (k === 'lastmonth') { setFrom(ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1))); setTo(ymd(new Date(now.getFullYear(), now.getMonth(), 0))); return; }
    setFrom(ymd(new Date(now.getFullYear(), 0, 1))); setTo(ymd(now));
  };

  const go = async (mode: 'open' | 'share') => {
    if (Platform.OS !== 'web') { setErr('Open the RMJ One web app to print or share statements.'); return; }
    const bad = (v: string) => v && !/^\d{4}-\d{2}-\d{2}$/.test(v);
    if (bad(from) || bad(to)) { setErr('Dates look like 2026-09-30'); return; }
    setBusy(mode); setErr('');
    try {
      const token = (await storage.secureGet<string>(TOKEN_KEY, '')) || '';
      const base = process.env.EXPO_PUBLIC_BACKEND_URL || '';
      const q = [from && `from=${from}`, to && `to=${to}`].filter(Boolean).join('&');
      const res = await fetch(`${base}/api${path}${q ? `?${q}` : ''}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.detail || 'Could not create the statement');
      const blob = await res.blob();
      const file = new File([blob], `${filename}.pdf`, { type: 'application/pdf' });
      const nav: any = navigator;
      if (mode === 'share' && nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title });
      } else {
        window.open(URL.createObjectURL(blob), '_blank');
      }
      onClose();
    } catch (e: any) { if (e?.name !== 'AbortError') setErr(e?.message || 'Could not create the statement'); }
    finally { setBusy(null); }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={title} testID="statement-sheet">
      <Text style={styles.hint}>Choose a period, or leave both dates empty for everything.</Text>
      <View style={styles.chips}>
        {([['month', 'This month'], ['lastmonth', 'Last month'], ['year', 'This year'], ['all', 'All']] as const).map(([k, l]) => (
          <Pressable key={k} onPress={() => preset(k)} style={styles.chip}><Text style={styles.chipText}>{l}</Text></Pressable>
        ))}
      </View>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>From</Text>
          <TextInput value={from} onChangeText={setFrom} placeholder="2026-09-01" placeholderTextColor={colors.mutedText} style={styles.input} testID="statement-from" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>To</Text>
          <TextInput value={to} onChangeText={setTo} placeholder="2026-09-30" placeholderTextColor={colors.mutedText} style={styles.input} testID="statement-to" />
        </View>
      </View>
      {err ? <Text style={styles.err}>{err}</Text> : null}
      <View style={styles.row}>
        <Pressable onPress={() => go('open')} disabled={!!busy} style={[styles.btn, styles.btnAlt, busy && { opacity: 0.6 }]} testID="statement-open">
          {busy === 'open' ? <ActivityIndicator size="small" color={colors.brandSecondary} /> : <><Ionicons name="document-text-outline" size={16} color={colors.brandSecondary} /><Text style={styles.btnAltText}>Open / print</Text></>}
        </Pressable>
        <Pressable onPress={() => go('share')} disabled={!!busy} style={[styles.btn, busy && { opacity: 0.6 }]} testID="statement-share">
          {busy === 'share' ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <><Ionicons name="share-social-outline" size={16} color={colors.onBrandPrimary} /><Text style={styles.btnText}>Share</Text></>}
        </Pressable>
      </View>
    </Sheet>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  hint: { color: colors.mutedText, fontSize: 12.5, marginBottom: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.sm },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  chipText: { color: colors.brandSecondary, fontSize: 12.5, fontWeight: '700' },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600', marginBottom: 4 },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 11, fontSize: 14 },
  err: { color: colors.onError, fontSize: 12.5, marginTop: spacing.sm },
  btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 13 },
  btnText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 14 },
  btnAlt: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.brandSecondary },
  btnAltText: { color: colors.brandSecondary, fontWeight: '700', fontSize: 14 },
});
