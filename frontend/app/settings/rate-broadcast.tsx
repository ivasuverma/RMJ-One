import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, RefreshControl, Linking, Platform } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { confirmAction } from '@/src/utils/confirm';
import { pickWebFile } from '@/src/components/DocumentCaptureSheet';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';
import { ToggleSwitch } from '@/src/components/ui/ToggleSwitch';

type Plan = 'daily' | 'weekly';
type Audience = Plan | 'all';
type Tpl = { exists: boolean; status: string | null; reason: string | null; error: string | null };
type Settings = {
  weekly_enabled: boolean; weekday: number; time: string;
  daily_enabled: boolean; daily_time: string; daily_skip_sunday: boolean; daily_limit: number;
};
type Job = { id: string; created_at: string; trigger: string; audience?: Audience; status: string; total: number;
  states?: Record<string, number>; delivery?: Record<string, number> };
type Overview = {
  settings: Settings; weekdays: string[]; counts: { daily: number; weekly: number; opted_out: number };
  rates: { gold: number; silver: number } | null; preview: string; buttons: string[];
  photo_url: string; photo_custom: boolean; subscribe_link: string | null;
  template: Tpl; meta_configured: boolean; sending: Job[]; sent_today: number;
};
type Sub = { id: string; name: string; mobile: string; status: 'active' | 'opted_out'; plan?: Plan };

const SHORT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const BUTTON_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  'See live rates': 'open-outline', 'Call the shop': 'call-outline', 'Stop updates': 'arrow-undo-outline',
};
const AUDIENCE_LABEL: Record<Audience, string> = { daily: 'Daily subscribers', weekly: 'Customer list', all: 'Everyone' };
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// Rate updates on the official Meta line (backend/routers/rate_broadcast.py):
// a daily list (people who sent START) and a weekly list (imported customers).
export default function RateBroadcastScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const [ov, setOv] = useState<Overview | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [history, setHistory] = useState<Job[]>([]);
  const [q, setQ] = useState('');
  const [newSub, setNewSub] = useState<{ name: string; mobile: string; plan: Plan }>({ name: '', mobile: '', plan: 'weekly' });
  const [audience, setAudience] = useState<Audience>('weekly');
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [o, s, h] = await Promise.all([
        api.get<Overview>('/rate-broadcast/overview'),
        api.get<Sub[]>('/rate-broadcast/subscribers'),
        api.get<Job[]>('/rate-broadcast/history'),
      ]);
      setOv(o); setForm(o.settings); setSubs(s); setHistory(h);
    } catch (e: any) { toast.error(e?.detail || 'Could not load'); }
    finally { setRefreshing(false); }
  }, [toast]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e: any) { toast.error(e?.detail || 'Something went wrong'); } finally { setBusy(null); }
  };

  const createTemplate = () => run('tpl', async () => {
    const t = await api.post<Tpl>('/rate-broadcast/template', {});
    setOv((o) => (o ? { ...o, template: t } : o));
    toast.success('Template sent to Meta for approval');
  });

  const changePhoto = async () => {
    const file = await pickWebFile('image/*');
    if (!file) return;
    run('photo', async () => {
      const form = new FormData();
      form.append('file', file, file.name || 'photo.jpg');
      const r = await api.upload<{ photo_url: string; photo_custom: boolean }>('/rate-broadcast/photo', form);
      setOv((o) => (o ? { ...o, ...r } : o));
      toast.success('Photo updated — used from the next send');
    });
  };
  const resetPhoto = () => run('photo', async () => {
    const r = await api.del<{ photo_url: string; photo_custom: boolean }>('/rate-broadcast/photo');
    setOv((o) => (o ? { ...o, ...r } : o));
  });

  const importList = async () => {
    const file = await pickWebFile('.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    if (!file) return;
    run('import', async () => {
      const form = new FormData();
      form.append('file', file, file.name);
      const r = await api.upload<any>('/rate-broadcast/subscribers/import', form);
      const bits = [`${r.added} added`];
      if (r.already_there) bits.push(`${r.already_there} already on the list`);
      if (r.invalid) bits.push(`${r.invalid} invalid numbers skipped`);
      if (r.opted_out_kept) bits.push(`${r.opted_out_kept} had replied STOP — left out`);
      toast.success(bits.join(' · '));
      await load();
    });
  };

  const addOne = () => run('add', async () => {
    await api.post('/rate-broadcast/subscribers', newSub);
    setNewSub((s) => ({ ...s, name: '', mobile: '' }));
    toast.success('Added');
    await load();
  });

  const remove = (s: Sub) => confirmAction('Remove from the list?', `${s.name || s.mobile} won’t get rate updates.`, 'Remove',
    () => run(`del-${s.id}`, async () => { await api.del(`/rate-broadcast/subscribers/${s.id}`); await load(); }));

  const saveSettings = () => form && run('settings', async () => {
    const s = await api.put<Settings>('/rate-broadcast/settings', { ...form, daily_limit: Number(form.daily_limit) || 250 });
    setForm(s);
    toast.success('Schedule saved');
  });

  const audienceCount = (a: Audience) => (ov ? (a === 'all' ? ov.counts.daily + ov.counts.weekly : ov.counts[a]) : 0);

  const sendNow = () => ov && confirmAction(
    'Send rates now?',
    `${audienceCount(audience)} people (${AUDIENCE_LABEL[audience].toLowerCase()}) will get this message on WhatsApp. Meta charges for each marketing message.`,
    'Send',
    () => run('send', async () => {
      const j = await api.post<Job>('/rate-broadcast/send', { audience });
      toast.success(`Sending to ${j.total} — up to ${form?.daily_limit ?? 250} a day`);
      await load();
    }),
  );

  const stop = (j: Job) => confirmAction('Stop this send?', 'People not reached yet won’t get it.', 'Stop',
    () => run('stop', async () => { await api.post(`/rate-broadcast/${j.id}/stop`, {}); await load(); }));

  const copyLink = async () => {
    if (!ov?.subscribe_link) return;
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(ov.subscribe_link);
        toast.success('Link copied');
      } else {
        Linking.openURL(ov.subscribe_link);
      }
    } catch { toast.error('Could not copy'); }
  };

  if (!ov || !form) {
    // Same root container as the loaded screen (not a separate centered one):
    // swapping containers left the dark-theme background behind on web.
    return (
      <SafeAreaView style={styles.root} edges={['top']} testID="rate-broadcast-screen">
        <View style={styles.centered}><ActivityIndicator color={colors.brandPrimary} /></View>
      </SafeAreaView>
    );
  }
  const tpl = ov.template;
  const approved = tpl.status === 'APPROVED';
  const shown = subs.filter((s) => !q || s.name.toLowerCase().includes(q.toLowerCase()) || s.mobile.includes(q));

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="rate-broadcast-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} hitSlop={12} testID="back-btn" accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>Rate Broadcast</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}>

        <Text style={styles.hint}>
          Sends today’s rate on WhatsApp from the official (Meta) number, never the shop’s OpenWA number, so a big send
          can’t get it banned. Replying STOP or tapping “Stop updates” removes a person automatically.
        </Text>

        {/* ---- Message preview ---- */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Message</Text>
          <View style={styles.bubble} testID="rate-broadcast-preview">
            <Image source={{ uri: ov.photo_url }} style={styles.photo} contentFit="cover" />
            <Text style={styles.bubbleText}>{ov.preview}</Text>
            {ov.buttons.map((b) => (
              <View key={b} style={styles.waButton}>
                <Ionicons name={BUTTON_ICONS[b] || 'ellipse-outline'} size={15} color="#1B8AD8" />
                <Text style={styles.waButtonText}>{b}</Text>
              </View>
            ))}
          </View>
          <View style={styles.row}>
            <Pressable onPress={changePhoto} disabled={busy === 'photo'} style={[styles.btn, styles.flex1]} testID="rate-broadcast-change-photo" accessibilityRole="button">
              {busy === 'photo' ? <ActivityIndicator color={colors.brandSecondary} /> : (
                <><Ionicons name="image-outline" size={16} color={colors.brandSecondary} /><Text style={styles.btnText}>Change photo</Text></>
              )}
            </Pressable>
            {ov.photo_custom && (
              <Pressable onPress={resetPhoto} style={[styles.btn, styles.flex1]} accessibilityRole="button"><Text style={styles.btnText}>Use shop photo</Text></Pressable>
            )}
          </View>
          <View style={[styles.status, approved ? styles.ok : styles.warn]} testID="rate-broadcast-template-status">
            <Ionicons name={approved ? 'checkmark-circle-outline' : 'time-outline'} size={16} color={approved ? colors.onSuccess : colors.onWarning} />
            <Text style={[styles.statusText, { color: approved ? colors.onSuccess : colors.onWarning }]}>
              {!ov.meta_configured ? 'The official WhatsApp (Meta) line is not configured yet.'
                : tpl.error ? tpl.error
                : !tpl.exists ? 'Template not created yet — Meta must approve it before the first send.'
                : approved ? 'Approved by Meta. The photo can change any time; the text and buttons are fixed by the template.'
                : tpl.status === 'REJECTED' ? `Rejected by Meta${tpl.reason ? `: ${tpl.reason}` : ''}.`
                : `Waiting for Meta’s review (${(tpl.status || 'pending').toLowerCase()}).`}
            </Text>
          </View>
          {!tpl.exists && ov.meta_configured ? (
            <Pressable onPress={createTemplate} disabled={busy === 'tpl'} style={styles.btn} testID="rate-broadcast-create-template" accessibilityRole="button">
              {busy === 'tpl' ? <ActivityIndicator color={colors.brandSecondary} /> : <Text style={styles.btnText}>Create template</Text>}
            </Pressable>
          ) : !approved ? (
            <Pressable onPress={load} style={styles.btn} accessibilityRole="button"><Text style={styles.btnText}>Check status</Text></Pressable>
          ) : null}
        </View>

        {/* ---- Send now ---- */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Send now</Text>
          {ov.sending.map((j) => (
            <View key={j.id} style={styles.sendingRow}>
              <Text style={[styles.body, styles.flex1]}>
                Sending to {AUDIENCE_LABEL[j.audience || 'weekly'].toLowerCase()} — {j.total} people, started {when(j.created_at)}.
              </Text>
              <Pressable onPress={() => stop(j)} hitSlop={8} accessibilityRole="button"><Text style={[styles.btnText, { color: colors.onError }]}>Stop</Text></Pressable>
            </View>
          ))}
          {ov.sending.length > 0 && (
            <Text style={styles.hint}>{ov.sent_today} sent today (limit {form.daily_limit} a day; the rest continue tomorrow).</Text>
          )}
          <View style={styles.chips}>
            {(['weekly', 'daily', 'all'] as Audience[]).map((a) => (
              <Pressable key={a} onPress={() => setAudience(a)} style={[styles.chip, audience === a && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: audience === a }}>
                <Text style={[styles.chipText, audience === a && styles.chipTextOn]}>{AUDIENCE_LABEL[a]} · {audienceCount(a)}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={sendNow} disabled={!approved || !audienceCount(audience) || busy === 'send'}
            style={[styles.primary, (!approved || !audienceCount(audience)) && { opacity: 0.5 }]} testID="rate-broadcast-send-now" accessibilityRole="button">
            {busy === 'send' ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Send to {audienceCount(audience)} people</Text>}
          </Pressable>
        </View>

        {/* ---- Schedule ---- */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Schedule</Text>
          <Pressable onPress={() => setForm((f) => f && { ...f, daily_enabled: !f.daily_enabled })} style={styles.row} accessibilityRole="switch" accessibilityState={{ checked: form.daily_enabled }} testID="rate-broadcast-daily-toggle">
            <View style={styles.flex1}>
              <Text style={styles.label}>Daily — to people who subscribed ({ov.counts.daily})</Text>
            </View>
            <ToggleSwitch value={form.daily_enabled} />
          </Pressable>
          <View style={[styles.row, { opacity: form.daily_enabled ? 1 : 0.5 }]}>
            <View style={styles.flex1}>
              <Text style={styles.small}>Time (24h, IST)</Text>
              <TextInput value={form.daily_time} onChangeText={(v) => setForm((f) => f && { ...f, daily_time: v })} placeholder="11:30" placeholderTextColor={colors.mutedText} style={styles.input} testID="rate-broadcast-daily-time" />
            </View>
            <Pressable onPress={() => setForm((f) => f && { ...f, daily_skip_sunday: !f.daily_skip_sunday })} style={[styles.row, styles.flex1, { paddingTop: 18 }]} accessibilityRole="switch" accessibilityState={{ checked: form.daily_skip_sunday }}>
              <Text style={[styles.small, styles.flex1]}>Skip Sunday</Text>
              <ToggleSwitch value={form.daily_skip_sunday} />
            </Pressable>
          </View>

          <View style={styles.divider} />
          <Pressable onPress={() => setForm((f) => f && { ...f, weekly_enabled: !f.weekly_enabled })} style={styles.row} accessibilityRole="switch" accessibilityState={{ checked: form.weekly_enabled }} testID="rate-broadcast-weekly-toggle">
            <View style={styles.flex1}>
              <Text style={styles.label}>Weekly — to your customer list ({ov.counts.weekly})</Text>
            </View>
            <ToggleSwitch value={form.weekly_enabled} />
          </Pressable>
          <View style={{ opacity: form.weekly_enabled ? 1 : 0.5 }}>
            <View style={styles.chips}>
              {SHORT_DAYS.map((d, i) => (
                <Pressable key={d} onPress={() => setForm((f) => f && { ...f, weekday: i })} style={[styles.chip, form.weekday === i && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: form.weekday === i }}>
                  <Text style={[styles.chipText, form.weekday === i && styles.chipTextOn]}>{d}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.row}>
              <View style={styles.flex1}>
                <Text style={styles.small}>Time (24h, IST)</Text>
                <TextInput value={form.time} onChangeText={(v) => setForm((f) => f && { ...f, time: v })} placeholder="11:00" placeholderTextColor={colors.mutedText} style={styles.input} testID="rate-broadcast-time" />
              </View>
              <View style={styles.flex1}>
                <Text style={styles.small}>Daily limit (all sends)</Text>
                <TextInput value={String(form.daily_limit)} onChangeText={(v) => setForm((f) => f && { ...f, daily_limit: Number(v.replace(/\D/g, '')) || 0 })} keyboardType="numeric" style={styles.input} testID="rate-broadcast-limit" />
              </View>
            </View>
          </View>
          <Text style={styles.hint}>Meta lets a new number message about 250 different people a day; it rises to 1,000 and more once your business is verified and quality stays good. Over the limit, a send carries on the next day — and next week’s send replaces an unfinished one.</Text>
          <Pressable onPress={saveSettings} disabled={busy === 'settings'} style={styles.primary} testID="rate-broadcast-save-settings" accessibilityRole="button">
            {busy === 'settings' ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Save schedule</Text>}
          </Pressable>
        </View>

        {/* ---- Subscribe link ---- */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Let customers subscribe</Text>
          <Text style={styles.body}>
            This link opens WhatsApp to your official number with START typed in — one tap and they’re on the daily list.
            It’s also the “Get the daily rate on WhatsApp” button on rmj.co.in. Print it as a QR code for the counter.
          </Text>
          {ov.subscribe_link ? (
            <Pressable onPress={copyLink} style={styles.linkBox} accessibilityRole="button" accessibilityLabel="Copy subscribe link">
              <Text style={[styles.linkText, styles.flex1]} numberOfLines={1}>{ov.subscribe_link}</Text>
              <Ionicons name="copy-outline" size={16} color={colors.brandSecondary} />
            </Pressable>
          ) : <Text style={styles.hint}>Appears once the official WhatsApp (Meta) line is connected.</Text>}
        </View>

        {/* ---- People ---- */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>People</Text>
          <Text style={styles.body}>{ov.counts.daily} daily · {ov.counts.weekly} weekly · {ov.counts.opted_out} replied STOP</Text>
          <Pressable onPress={importList} disabled={busy === 'import'} style={styles.btn} testID="rate-broadcast-import" accessibilityRole="button">
            {busy === 'import' ? <ActivityIndicator color={colors.brandSecondary} /> : (
              <><Ionicons name="cloud-upload-outline" size={16} color={colors.brandSecondary} /><Text style={styles.btnText}>Import customer list (Excel / CSV)</Text></>
            )}
          </Pressable>
          <Text style={styles.hint}>Imported customers go on the weekly list. Needs a mobile column; a name column is optional. Numbers already on the list are skipped.</Text>
          <View style={styles.row}>
            <TextInput value={newSub.name} onChangeText={(v) => setNewSub((s) => ({ ...s, name: v }))} placeholder="Name" placeholderTextColor={colors.mutedText} style={[styles.input, styles.flex1]} />
            <TextInput value={newSub.mobile} onChangeText={(v) => setNewSub((s) => ({ ...s, mobile: v }))} placeholder="Mobile" keyboardType="phone-pad" placeholderTextColor={colors.mutedText} style={[styles.input, styles.flex1]} />
          </View>
          <View style={styles.row}>
            <View style={[styles.chips, styles.flex1]}>
              {(['weekly', 'daily'] as Plan[]).map((p) => (
                <Pressable key={p} onPress={() => setNewSub((s) => ({ ...s, plan: p }))} style={[styles.chip, newSub.plan === p && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: newSub.plan === p }}>
                  <Text style={[styles.chipText, newSub.plan === p && styles.chipTextOn]}>{p === 'daily' ? 'Daily' : 'Weekly'}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable onPress={addOne} disabled={!newSub.mobile.trim() || busy === 'add'} style={[styles.addBtn, !newSub.mobile.trim() && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel="Add person">
              <Ionicons name="add" size={18} color={colors.onBrandPrimary} />
              <Text style={styles.addText}>Add</Text>
            </Pressable>
          </View>
          <TextInput value={q} onChangeText={setQ} placeholder="Search name or mobile" placeholderTextColor={colors.mutedText} style={[styles.input, { marginTop: spacing.sm }]} />
          {shown.slice(0, 100).map((s) => (
            <View key={s.id} style={styles.subRow}>
              <View style={styles.flex1}>
                <Text style={styles.subName} numberOfLines={1}>{s.name || '—'}</Text>
                <Text style={styles.subMeta}>{s.mobile} · {s.status === 'opted_out' ? 'replied STOP' : s.plan === 'daily' ? 'daily' : 'weekly'}</Text>
              </View>
              {s.status === 'active' && (
                <Pressable onPress={() => remove(s)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${s.name || s.mobile}`}>
                  <Ionicons name="close-circle-outline" size={20} color={colors.mutedText} />
                </Pressable>
              )}
            </View>
          ))}
          {shown.length > 100 && <Text style={styles.hint}>Showing the latest 100 — search to find someone.</Text>}
        </View>

        {/* ---- History ---- */}
        {history.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Recent sends</Text>
            {history.map((j) => (
              <View key={j.id} style={styles.subRow}>
                <View style={styles.flex1}>
                  <Text style={styles.subName}>{when(j.created_at)} · {AUDIENCE_LABEL[j.audience || 'weekly']}{j.trigger === 'schedule' ? ' (scheduled)' : ''}{j.status === 'sending' ? ' · sending' : j.status === 'stopped' ? ' · stopped' : j.status === 'replaced' ? ' · replaced' : ''}</Text>
                  <Text style={styles.subMeta}>
                    {j.total} people · {(j.states?.sent ?? 0)} sent · {(j.delivery?.delivered ?? 0) + (j.delivery?.read ?? 0)} delivered
                    {(j.delivery?.read ?? 0) ? ` (${j.delivery!.read} read)` : ''}
                    {(j.states?.failed ?? 0) + (j.delivery?.failed ?? 0) ? ` · ${(j.states?.failed ?? 0) + (j.delivery?.failed ?? 0)} failed` : ''}
                    {(j.states?.pending ?? 0) ? ` · ${j.states!.pending} waiting` : ''}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  centered: { flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '600', fontFamily: fonts.display, textAlign: 'center' },
  flex1: { flex: 1, minWidth: 0 },
  hint: { color: colors.mutedText, fontSize: 12.5, lineHeight: 18, marginVertical: 4 },
  body: { color: colors.onSurfaceSecondary, fontSize: 13.5, lineHeight: 19, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginTop: spacing.md, gap: 8 },
  cardTitle: { color: colors.onSurface, fontSize: 15, fontWeight: '800' },
  bubble: { backgroundColor: '#FFFFFF', borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, maxWidth: 340, width: '100%', alignSelf: 'center' },
  photo: { width: '100%', aspectRatio: 1.6, backgroundColor: colors.surfaceTertiary },
  bubbleText: { color: '#111B21', fontSize: 13.5, lineHeight: 19, padding: 10 },
  waButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#D1D7DB' },
  waButtonText: { color: '#1B8AD8', fontSize: 14, fontWeight: '600' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radius.md, padding: spacing.md },
  ok: { backgroundColor: colors.success }, warn: { backgroundColor: colors.warning },
  statusText: { flex: 1, fontSize: 12.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { color: colors.onSurface, fontSize: 13.5, fontWeight: '700' },
  small: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.sm },
  // minWidth 0 + width 100%: a web <input> otherwise keeps a ~20-character
  // minimum width, which pushed two side-by-side fields off a phone screen.
  input: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 11, fontSize: 14, minWidth: 0, width: '100%' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 12.5, fontWeight: '600' }, chipTextOn: { color: colors.brandPrimary },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 10, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  btnText: { color: colors.brandSecondary, fontSize: 13.5, fontWeight: '700' },
  primary: { alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: radius.md, backgroundColor: colors.brandPrimary },
  primaryText: { color: colors.onBrandPrimary, fontSize: 14.5, fontWeight: '800' },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, height: 40, borderRadius: radius.md, backgroundColor: colors.brandPrimary },
  addText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 13.5 },
  sendingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  linkBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  linkText: { color: colors.onSurface, fontSize: 13 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  subName: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  subMeta: { color: colors.mutedText, fontSize: 12 },
});
