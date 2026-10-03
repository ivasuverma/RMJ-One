import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { confirmAction } from '@/src/utils/confirm';
import { istDisplayDate } from '@/src/utils/datetime';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';
import { ModuleHeader } from '@/src/components/ui/ModuleHeader';
import { HeaderSpacer, useScrolled } from '@/src/components/ui/StickyHeader';
import type { DocCategory } from '@/src/components/DocumentCaptureSheet';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || '';

type Mine = { exists: boolean; created_at?: string; last_used_at?: string | null; uses?: number };
type Link = { id: string; name: string; kind: string; created_at: string; last_used_at: string | null; uses: number };

// "Send to RMJ One" in the iPhone Share menu. A home-screen web app can't be in
// the Share menu, but a shortcut in Apple's Shortcuts app can: it posts the
// shared PDF/photo to the person's own link (/api/inbox/<key>), which can only
// upload documents, as them, into Pending. The key is shown once, when made.
export default function SendFromIphoneScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';
  const { scrolled, onScroll } = useScrolled();
  const [mine, setMine] = useState<Mine | null>(null);
  const [key, setKey] = useState<string | null>(null);     // only right after making it
  const [cats, setCats] = useState<DocCategory[]>([]);
  const [cat, setCat] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [links, setLinks] = useState<Link[]>([]);

  const load = useCallback(async () => {
    try { setMine(await api.get<Mine>('/upload-link/me')); } catch { setMine({ exists: false }); }
    if (isOwner) api.get<Link[]>('/upload-links').then(setLinks).catch(() => {});
  }, [isOwner]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => {
    api.get<DocCategory[]>('/document-categories').then((cs) => {
      const list = cs.filter((c) => c.can_view !== false);
      setCats(list);
      setCat((cur) => cur || (list.find((c) => c.key === 'bank_statements') || list[0])?.key || '');
    }).catch(() => {});
  }, []);

  const link = key ? `${BASE}/api/inbox/${key}${cat ? `?c=${encodeURIComponent(cat)}` : ''}` : '';

  const copy = async (text: string, what = 'Copied') => {
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        toast.success(what);
      }
    } catch { toast.error('Could not copy — press and hold the text to copy it'); }
  };

  const make = async () => {
    setBusy(true);
    try { const r = await api.post<{ key: string }>('/upload-link/me', {}); setKey(r.key); load(); }
    catch (e: any) { toast.error(e?.detail || 'Could not make the link'); }
    finally { setBusy(false); }
  };
  const remake = () => confirmAction('Make a new link?', 'The old link stops working, so any iPhone using it needs the new one pasted in.', 'Make new', make);
  const turnOff = () => confirmAction('Turn off Send to RMJ One?', 'Your link stops working. You can make a new one any time.', 'Turn off', async () => {
    try { await api.del('/upload-link/me'); setKey(null); load(); toast.success('Turned off'); }
    catch (e: any) { toast.error(e?.detail || 'Could not turn it off'); }
  });
  const revoke = (l: Link) => confirmAction(`Turn off ${l.name}'s link?`, 'Their shortcut stops working until they make a new link.', 'Turn off', async () => {
    try { await api.del(`/upload-links/${l.id}`); load(); } catch (e: any) { toast.error(e?.detail || 'Could not turn it off'); }
  });

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="send-from-iphone-screen">
      <ModuleHeader title="Send from iPhone" backLabel="Back" scrolled={scrolled} subtitle="Share › Send to RMJ One" />
      <ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 80 }}>
        <HeaderSpacer />
        <Text style={styles.intro}>
          Send a PDF or photo to RMJ One straight from WhatsApp, Mail or Files: tap <Text style={styles.b}>Share</Text>, then <Text style={styles.b}>Send to RMJ One</Text>. It lands in Documents › Pending, unlocked if its password is saved.
        </Text>

        <Text style={styles.groupTitle}>1 · Your link</Text>
        <View style={styles.card}>
          {!mine ? <ActivityIndicator color={colors.brandPrimary} /> : key ? (
            <>
              <Text style={styles.label}>Files go into</Text>
              <View style={styles.chips}>
                {cats.map((c) => (
                  <Pressable key={c.key} onPress={() => setCat(c.key)} style={[styles.chip, cat === c.key && styles.chipOn]} testID={`iphone-cat-${c.key}`}>
                    <Text style={[styles.chipText, cat === c.key && styles.chipTextOn]}>{c.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.hint}>You can change the category of any document later in the app.</Text>
              <Text style={styles.link} selectable testID="iphone-link">{link}</Text>
              <Pressable onPress={() => copy(link, 'Link copied — paste it in step 4 below')} style={styles.primary} testID="iphone-copy-link">
                <Ionicons name="copy-outline" size={18} color={colors.onBrandPrimary} /><Text style={styles.primaryText}>Copy link</Text>
              </Pressable>
              <Text style={styles.warn}>This link uploads documents as you — keep it to your own phone. It&apos;s shown only now.</Text>
            </>
          ) : mine.exists ? (
            <>
              <View style={styles.statusRow}>
                <Ionicons name="checkmark-circle" size={20} color={colors.onSuccess} />
                <Text style={styles.statusText}>
                  Set up {mine.created_at ? istDisplayDate(mine.created_at) : ''}{mine.uses ? ` · used ${mine.uses} time${mine.uses === 1 ? '' : 's'}` : ' · not used yet'}
                </Text>
              </View>
              <Text style={styles.hint}>For safety the link can&apos;t be shown again. To set up another iPhone, make a new link (the old one stops working).</Text>
              <View style={styles.row2}>
                <Pressable onPress={remake} disabled={busy} style={styles.secondary} testID="iphone-remake"><Text style={styles.secondaryText}>Make a new link</Text></Pressable>
                <Pressable onPress={turnOff} style={styles.secondary} testID="iphone-off"><Text style={[styles.secondaryText, { color: colors.onError }]}>Turn off</Text></Pressable>
              </View>
            </>
          ) : (
            <Pressable onPress={make} disabled={busy} style={[styles.primary, busy && { opacity: 0.6 }]} testID="iphone-make">
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><Ionicons name="link-outline" size={18} color={colors.onBrandPrimary} /><Text style={styles.primaryText}>Make my link</Text></>}
            </Pressable>
          )}
        </View>

        <Text style={styles.groupTitle}>2 · Add the shortcut (once, about 2 minutes)</Text>
        <View style={styles.card}>
          <Step n={1} styles={styles}>Open the <Text style={styles.b}>Shortcuts</Text> app (it&apos;s on every iPhone) and tap <Text style={styles.b}>+</Text> at the top right.</Step>
          <Step n={2} styles={styles}>Tap the name at the top and call it <Text style={styles.b}>Send to RMJ One</Text>.</Step>
          <Step n={3} styles={styles}>Tap the <Text style={styles.b}>ⓘ</Text> (or the name › <Text style={styles.b}>Details</Text>), turn on <Text style={styles.b}>Show in Share Sheet</Text>, then <Text style={styles.b}>Done</Text>.</Step>
          <Step n={4} styles={styles}>Tap <Text style={styles.b}>Search Actions</Text>, add <Text style={styles.b}>Get Contents of URL</Text>, tap the blue <Text style={styles.b}>URL</Text> and paste your link.</Step>
          <Step n={5} styles={styles}>Tap the <Text style={styles.b}>›</Text> on that action: <Text style={styles.b}>Method</Text> → POST, <Text style={styles.b}>Request Body</Text> → Form, <Text style={styles.b}>Add new field</Text> → File. Name it <Text style={styles.code}>file</Text> and for its value choose <Text style={styles.b}>Shortcut Input</Text>.</Step>
          <Step n={6} styles={styles}>Add the action <Text style={styles.b}>Show Notification</Text> and set its text to <Text style={styles.b}>Contents of URL</Text> — it tells you where the file was saved.</Step>
          <Step n={7} styles={styles} last>Tap <Text style={styles.b}>Done</Text>. In the Share menu, <Text style={styles.b}>Send to RMJ One</Text> is near the end — tap <Text style={styles.b}>Edit Actions</Text> there to move it up.</Step>
          <Pressable onPress={() => copy('file', 'Copied “file”')} style={styles.secondaryWide} testID="iphone-copy-file">
            <Text style={styles.secondaryText}>Copy the field name “file”</Text>
          </Pressable>
        </View>

        <Text style={styles.groupTitle}>3 · Use it</Text>
        <View style={styles.card}>
          <Text style={styles.body}>Open the PDF in WhatsApp, Mail or Files → <Text style={styles.b}>Share</Text> → <Text style={styles.b}>Send to RMJ One</Text>. A notification says it&apos;s saved; record it in Documents › Pending. Several files at once work too.</Text>
        </View>

        {isOwner && links.length > 0 && (
          <>
            <Text style={styles.groupTitle}>Links in use</Text>
            <View style={[styles.card, { paddingVertical: 4 }]}>
              {links.map((l, i) => (
                <View key={l.id} style={[styles.linkRow, i > 0 && styles.sep]} testID={`iphone-link-${l.id}`}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.name} numberOfLines={1}>{l.name}</Text>
                    <Text style={styles.sub} numberOfLines={1}>
                      Made {istDisplayDate(l.created_at)} · {l.uses ? `used ${l.uses} time${l.uses === 1 ? '' : 's'}${l.last_used_at ? `, last ${istDisplayDate(l.last_used_at)}` : ''}` : 'not used yet'}
                    </Text>
                  </View>
                  <Pressable onPress={() => revoke(l)} hitSlop={8} testID={`iphone-revoke-${l.id}`}><Text style={[styles.secondaryText, { color: colors.onError }]}>Turn off</Text></Pressable>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Step({ n, children, styles, last }: { n: number; children: React.ReactNode; styles: ReturnType<typeof makeStyles>; last?: boolean }) {
  return (
    <View style={[styles.step, !last && styles.stepGap]}>
      <View style={styles.stepNum}><Text style={styles.stepNumText}>{n}</Text></View>
      <Text style={styles.body}>{children}</Text>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  intro: { color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 20, marginTop: spacing.md, marginHorizontal: 4 },
  b: { fontWeight: '700', color: colors.onSurface },
  code: { fontWeight: '700', color: colors.brandSecondary, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  groupTitle: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginTop: spacing.lg, marginBottom: spacing.sm, marginHorizontal: 4 },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, padding: spacing.md, gap: 8 },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurface, fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: colors.onBrandPrimary },
  hint: { color: colors.mutedText, fontSize: 12.5, lineHeight: 18 },
  warn: { color: colors.onWarning, fontSize: 12.5, lineHeight: 18 },
  link: {
    color: colors.onSurface, fontSize: 12.5, padding: 10, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },
  primary: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 13 },
  primaryText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 15 },
  row2: { flexDirection: 'row', gap: 8 },
  secondary: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  secondaryWide: { alignItems: 'center', paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginTop: 4 },
  secondaryText: { color: colors.onSurface, fontWeight: '700', fontSize: 14 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusText: { color: colors.onSurface, fontSize: 14, fontWeight: '600', flex: 1 },
  body: { color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 20, flex: 1 },
  step: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  stepGap: { paddingBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  stepNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  stepNumText: { color: colors.brandSecondary, fontWeight: '800', fontSize: 12.5 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  sep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  name: { color: colors.onSurface, fontSize: 15, fontWeight: '600' },
  sub: { color: colors.mutedText, fontSize: 12, marginTop: 1 },
});
