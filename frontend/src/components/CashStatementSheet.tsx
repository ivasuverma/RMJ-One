import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, ScrollView, ActivityIndicator, Platform, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { api, getToken } from '@/src/api/client';
import { spacing, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';
import { DateField } from '@/src/components/DateField';
import { shareFile, useShareableFile } from '@/src/utils/shareFile';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

type Preset = 'month' | 'last' | 'fy' | 'all';
function range(p: Preset): [string, string] {
  const now = new Date();
  if (p === 'month') return [ymd(new Date(now.getFullYear(), now.getMonth(), 1)), ymd(now)];
  if (p === 'last') return [ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), ymd(new Date(now.getFullYear(), now.getMonth(), 0))];
  if (p === 'fy') { const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; return [`${y}-04-01`, ymd(now)]; }   // Indian financial year
  return ['', ''];
}

/** A person's (or one group's) Cash Ledger statement, From–To, in accounts
 *  style (Date · Description · Remarks · Dr · Cr · Closing). Previewed as the
 *  PDF's own pages, then Share (WhatsApp, Mail, Files…) or Download. */
export function CashStatementSheet({ visible, onClose, accountId, name, group, scopeLabel }: {
  visible: boolean; onClose: () => void; accountId: string; name: string; group?: string; scopeLabel: string;
}) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const { width } = useWindowDimensions();
  const [preset, setPreset] = useState<Preset | null>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [token, setToken] = useState('');
  const [pages, setPages] = useState<number | null | undefined>(undefined);

  useEffect(() => { if (visible) getToken().then((t) => setToken(t || '')); }, [visible]);
  useEffect(() => { if (visible) { setPreset('all'); setFrom(''); setTo(''); } }, [visible]);

  const bad = !!(from && to && from > to);
  const query = [from && `from=${from}`, to && `to=${to}`, group && `group=${group}`].filter(Boolean).join('&');
  const path = `/khata/${accountId}/statement`;

  useEffect(() => {
    if (!visible || bad) return;
    let dead = false;
    setPages(undefined);
    api.get<{ pages: number | null }>(`${path}?format=info${query ? `&${query}` : ''}`)
      .then((r) => { if (!dead) setPages(r.pages || null); })
      .catch(() => { if (!dead) setPages(null); });
    return () => { dead = true; };
  }, [visible, path, query, bad]);

  const slug = `${name}${group ? ` ${scopeLabel}` : ''}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const fileName = `statement-${slug}${from || to ? `-${from || 'start'}-to-${to || 'today'}` : ''}.pdf`;
  // Fetched as soon as it's shown, so iPhone can open the share sheet straight from the tap.
  const file = useShareableFile(visible && token && !bad ? `${BASE}/api${path}${query ? `?${query}` : ''}` : null, token || null, fileName);

  const pick = (p: Preset) => { const [f, t] = range(p); setPreset(p); setFrom(f); setTo(t); };
  const send = async (download: boolean) => {
    if (!file || Platform.OS !== 'web') return;
    if (download) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file); a.download = file.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      return;
    }
    const r = await shareFile(file, `Statement - ${name}`);
    if (r === 'failed') toast.error('Could not share the statement');
  };

  const pageW = Math.min(width, 820) - spacing.lg * 2;
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.root} edges={['top', 'bottom']} testID="cl-statement">
        <View style={s.nav}>
          <Pressable onPress={onClose} hitSlop={10} style={({ pressed }) => [s.navSide, pressed && { opacity: 0.5 }]} testID="cl-statement-done">
            <Text style={s.navText}>Done</Text>
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={s.navTitle} numberOfLines={1}>Statement</Text>
            <Text style={s.navSub} numberOfLines={1}>{group ? `${name} · ${scopeLabel}` : name}</Text>
          </View>
          <Pressable onPress={() => send(false)} disabled={!file} hitSlop={10} style={({ pressed }) => [s.navSide, { alignItems: 'flex-end' }, (!file || pressed) && { opacity: 0.4 }]} testID="cl-statement-share-top">
            <Ionicons name="share-outline" size={24} color={colors.brandPrimary} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={s.content}>
          <View style={s.presets}>
            {([['month', 'This Month'], ['last', 'Last Month'], ['fy', 'This FY'], ['all', 'All']] as const).map(([k, l]) => (
              <Pressable key={k} onPress={() => pick(k)} style={[s.preset, preset === k && s.presetOn]} testID={`cl-st-preset-${k}`}>
                <Text style={[s.presetText, preset === k && s.presetTextOn]}>{l}</Text>
              </Pressable>
            ))}
          </View>
          <View style={s.group}>
            <View style={s.dateRow}>
              <Text style={s.dateLabel}>From</Text>
              <View style={{ flex: 1 }}><DateField value={from} onChange={(v) => { setFrom(v); setPreset(null); }} placeholder="Beginning" testID="cl-st-from" /></View>
            </View>
            <View style={s.sep} />
            <View style={s.dateRow}>
              <Text style={s.dateLabel}>To</Text>
              <View style={{ flex: 1 }}><DateField value={to} onChange={(v) => { setTo(v); setPreset(null); }} placeholder="Today" testID="cl-st-to" /></View>
            </View>
          </View>
          {bad && <Text style={s.err}>From is after To.</Text>}

          <Text style={s.caption}>PREVIEW</Text>
          {bad ? null : pages === undefined || !token ? (
            <View style={[s.page, { width: pageW, height: pageW * 1.414, alignItems: 'center', justifyContent: 'center' }]}><ActivityIndicator color={colors.mutedText} /></View>
          ) : pages === null ? (
            <Text style={s.err}>The preview isn&apos;t available here — Share or Download still work.</Text>
          ) : Array.from({ length: pages }, (_, i) => (
            <Image key={`${query}-${i}`} source={{ uri: `${BASE}/api${path}?format=page&page=${i}${query ? `&${query}` : ''}`, headers: { Authorization: `Bearer ${token}` } }}
              style={[s.page, { width: pageW, height: pageW * 1.414 }]} contentFit="contain" transition={150} testID={`cl-st-page-${i}`} />
          ))}
        </ScrollView>

        <View style={s.toolbar}>
          <Pressable onPress={() => send(true)} disabled={!file} style={({ pressed }) => [s.btn, s.btnAlt, (!file || pressed) && { opacity: 0.5 }]} testID="cl-statement-download">
            <Ionicons name="download-outline" size={18} color={colors.brandPrimary} /><Text style={[s.btnText, { color: colors.brandPrimary }]}>Download</Text>
          </Pressable>
          <Pressable onPress={() => send(false)} disabled={!file} style={({ pressed }) => [s.btn, (!file || pressed) && { opacity: 0.5 }]} testID="cl-statement-share">
            {file ? <Ionicons name="paper-plane-outline" size={18} color={colors.onBrandPrimary} /> : <ActivityIndicator size="small" color={colors.onBrandPrimary} />}
            <Text style={[s.btnText, { color: colors.onBrandPrimary }]}>Send</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  nav: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  navSide: { width: 64 },
  navText: { color: colors.brandPrimary, fontSize: 17, fontWeight: '600' },
  navTitle: { color: colors.onSurface, fontSize: 17, fontWeight: '600' },
  navSub: { color: colors.mutedText, fontSize: 12 },
  content: { padding: spacing.lg, paddingBottom: 40, alignItems: 'center' },
  presets: { flexDirection: 'row', gap: 6, alignSelf: 'stretch', marginBottom: spacing.md },
  preset: { flex: 1, paddingVertical: 8, borderRadius: 9, backgroundColor: colors.surfaceSecondary, alignItems: 'center' },
  presetOn: { backgroundColor: colors.brandPrimary },
  presetText: { color: colors.onSurface, fontSize: 13, fontWeight: '500' },
  presetTextOn: { color: colors.onBrandPrimary, fontWeight: '600' },
  group: { alignSelf: 'stretch', backgroundColor: colors.surfaceSecondary, borderRadius: 12, overflow: 'hidden' },
  dateRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.md, paddingRight: 6, minHeight: 48 },
  dateLabel: { width: 56, color: colors.onSurface, fontSize: 17 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.divider, marginLeft: spacing.md },
  err: { color: colors.onError, fontSize: 13, marginTop: 8, alignSelf: 'stretch', marginHorizontal: spacing.md },
  caption: { alignSelf: 'stretch', color: colors.mutedText, fontSize: 13, marginTop: spacing.xl, marginBottom: 6, marginLeft: spacing.md },
  page: { backgroundColor: '#fff', borderRadius: 6, marginBottom: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.divider,
    ...({ boxShadow: '0 2px 12px rgba(0,0,0,0.12)' } as any) },
  toolbar: { flexDirection: 'row', gap: 10, paddingHorizontal: spacing.lg, paddingTop: 10, paddingBottom: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  btn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 14, backgroundColor: colors.brandPrimary },
  btnAlt: { backgroundColor: colors.surfaceSecondary },
  btnText: { fontSize: 17, fontWeight: '600' },
});
