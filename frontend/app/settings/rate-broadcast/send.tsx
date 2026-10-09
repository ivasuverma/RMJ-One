import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, TextInput, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { confirmAction } from '@/src/utils/confirm';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';
import { ToggleSwitch } from '@/src/components/ui/ToggleSwitch';
import { AUDIENCE_LABEL, Audience, VIA_LABEL, Via, BList, Header, Job, KIND_LABEL, MyTpl, Overview, Settings, SHORT_DAYS, jobAudience, makeStyles, num, when } from './_shared';
import { HeaderSpacer } from '@/src/components/ui/StickyHeader';

// Step 4 — send now, the daily/weekly schedule, and recent sends with their
// delivery results (from Meta's status webhooks).
export default function BroadcastSendScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const [ov, setOv] = useState<Overview | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [history, setHistory] = useState<Job[]>([]);
  const params = useLocalSearchParams<{ template?: string }>();
  const [audience, setAudience] = useState<Audience>(params.template ? 'list' : 'weekly');
  const [lists, setLists] = useState<BList[]>([]);
  const [listId, setListId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<MyTpl[]>([]);
  const [what, setWhat] = useState<string>(params.template || 'rate');   // 'rate' or one of your template ids
  const [viaPick, setViaPick] = useState<Via | null>(null);   // null = the list's own setting
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [o, h, l, t] = await Promise.all([
        api.get<Overview>('/rate-broadcast/overview'), api.get<Job[]>('/rate-broadcast/history'),
        api.get<BList[]>('/broadcasts/lists'), api.get<MyTpl[]>('/broadcasts/templates'),
      ]);
      setOv(o); setForm(o.settings); setHistory(h); setLists(l);
      setTemplates(t.filter((x) => x.status === 'APPROVED'));
      setListId((cur) => cur ?? l[0]?.id ?? null);
    } catch (e: any) { toast.error(e?.detail || 'Could not load'); }
    finally { setRefreshing(false); }
  }, [toast]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e: any) { toast.error(e?.detail || 'Something went wrong'); } finally { setBusy(null); }
  };

  const audienceCount = (a: Audience, lid: string | null = listId) => {
    if (!ov) return 0;
    if (a === 'list') return lists.find((l) => l.id === lid)?.count ?? 0;
    return a === 'all' ? ov.counts.daily + ov.counts.weekly : ov.counts[a];
  };
  const chosenTpl = templates.find((t) => t.id === what) || null;
  // Today's rate goes from the shop's own WhatsApp (OpenWA, plain text, no
  // charge) or the official Meta number (approved template) — by default as
  // set for that list in the schedule below. Your own templates are Meta only.
  const listVia: Via = (audience === 'daily' ? form?.daily_via || 'openwa' : form?.weekly_via || 'meta');
  const via: Via = chosenTpl ? 'meta' : viaPick || listVia;
  const viaShop = via === 'openwa';
  const audienceName = audience === 'list' ? `“${lists.find((l) => l.id === listId)?.name ?? ''}”` : AUDIENCE_LABEL[audience].toLowerCase();

  const sendNow = () => ov && confirmAction(
    chosenTpl ? `Send “${chosenTpl.label}” now?` : 'Send rates now?',
    viaShop
      ? `${num(audienceCount(audience))} people (${audienceName}) will get today’s rate from the shop’s WhatsApp, a few every minute. No charge.`
      : `${num(audienceCount(audience))} people (${audienceName}) will get this message on WhatsApp. Meta charges about ₹1 for each.`,
    'Send',
    () => run('send', async () => {
      const j = await api.post<Job>('/rate-broadcast/send', {
        audience, list_id: audience === 'list' ? listId : null, template_id: chosenTpl ? chosenTpl.id : null,
        via: chosenTpl ? null : via,
      });
      toast.success(viaShop ? `Sending to ${num(j.total)} from the shop’s WhatsApp` : `Sending to ${num(j.total)} — up to ${form?.daily_limit ?? 250} a day`);
      await load();
    }),
  );
  const stop = (j: Job) => confirmAction('Stop this send?', 'People not reached yet won’t get it.', 'Stop',
    () => run('stop', async () => { await api.post(`/rate-broadcast/${j.id}/stop`, {}); await load(); }));
  const saveSettings = () => form && run('settings', async () => {
    // On/off is saved from Settings › Notifications › General, not here.
    const { weekly_enabled: _w, daily_enabled: _d, ...rest } = form;
    const s = await api.put<Settings>('/rate-broadcast/settings', { ...rest, daily_limit: Number(form.daily_limit) || 250 });
    setForm(s);
    toast.success('Schedule saved');
  });

  if (!ov || !form) {
    return (
      <SafeAreaView style={styles.root} edges={['top']} testID="broadcast-send-screen">
        <Header title="Send & schedule" colors={colors} />
        <View style={styles.centered}><ActivityIndicator color={colors.brandPrimary} /></View>
      </SafeAreaView>
    );
  }
  const rateApproved = ov.template.status === 'APPROVED';
  const approved = chosenTpl || viaShop ? true : rateApproved;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="broadcast-send-screen">
      <Header title="Send & schedule" colors={colors} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}>
        <HeaderSpacer />

        {!rateApproved && !templates.length && !viaShop && (
          <View style={[styles.status, styles.warn]}>
            <Text style={[styles.statusText, { color: colors.onWarning }]}>Official (Meta) sending starts once the rate template is approved by Meta (Settings › WhatsApp › Meta templates) — or send from the Shop WhatsApp.</Text>
          </View>
        )}

        {/* ---- Send now ---- */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Send now</Text>
          {ov.sending.map((j) => (
            <View key={j.id} style={styles.row}>
              <Text style={[styles.body, styles.flex1]}>
                {j.template_label ? `“${j.template_label}”` : 'Rates'} to {jobAudience(j).toLowerCase()} — {num(j.total)} people, started {when(j.created_at)}.
              </Text>
              <Pressable onPress={() => stop(j)} hitSlop={8} accessibilityRole="button"><Text style={[styles.btnText, { color: colors.onError }]}>Stop</Text></Pressable>
            </View>
          ))}
          {ov.sending.length > 0 && (
            <Text style={styles.hint}>{num(ov.sent_today)} sent today (limit {num(form.daily_limit)} a day; the rest continue tomorrow).</Text>
          )}
          <Text style={styles.small}>What to send</Text>
          <View style={styles.chips}>
            {[{ id: 'rate', label: 'Today’s rate' }, ...templates.map((t) => ({ id: t.id, label: `${t.label} · ${KIND_LABEL[t.kind].toLowerCase()}` }))].map((o) => (
              <Pressable key={o.id} onPress={() => setWhat(o.id)} style={[styles.chip, what === o.id && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: what === o.id }} testID={`broadcast-what-${o.id}`}>
                <Text style={[styles.chipText, what === o.id && styles.chipTextOn]}>{o.label}</Text>
              </Pressable>
            ))}
          </View>
          {what === 'rate' && !rateApproved && !viaShop && <Text style={styles.hint}>The Meta rate template isn’t approved yet (Settings › WhatsApp › Meta templates).</Text>}
          {!templates.length && <Text style={styles.hint}>Your own templates show here once Meta approves them (Settings › WhatsApp › Meta templates → New template).</Text>}
          <Text style={styles.small}>To</Text>
          <View style={styles.chips}>
            {(['weekly', 'daily', 'all'] as Audience[]).map((a) => (
              <Pressable key={a} onPress={() => { setAudience(a); setViaPick(null); }} style={[styles.chip, audience === a && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: audience === a }}>
                <Text style={[styles.chipText, audience === a && styles.chipTextOn]}>{AUDIENCE_LABEL[a]} · {num(audienceCount(a))}</Text>
              </Pressable>
            ))}
            {lists.map((l) => {
              const on = audience === 'list' && listId === l.id;
              return (
                <Pressable key={l.id} onPress={() => { setAudience('list'); setListId(l.id); setViaPick(null); }} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }} testID={`broadcast-to-list-${l.id}`}>
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{l.name} · {num(l.count)}</Text>
                </Pressable>
              );
            })}
          </View>
          {!chosenTpl && (
            <>
              <Text style={styles.small}>Send from</Text>
              <View style={styles.chips}>
                {(['openwa', 'meta'] as Via[]).map((v) => (
                  <Pressable key={v} onPress={() => setViaPick(v)} style={[styles.chip, via === v && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: via === v }} testID={`broadcast-via-${v}`}>
                    <Text style={[styles.chipText, via === v && styles.chipTextOn]}>{VIA_LABEL[v]}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
          {viaShop && <Text style={styles.hint} testID="broadcast-via-shop">Goes from the shop’s WhatsApp ({ov.signup_number ? `+${ov.signup_number}` : 'OpenWA'}) as a plain message, a few every minute — no Meta approval or charge. Wording: Settings › WhatsApp › Message Templates.</Text>}
          {viaShop && audienceCount(audience) > 300 && <Text style={[styles.hint, { color: colors.onWarning }]} testID="broadcast-via-shop-warn">That’s a lot of people for the shop number — about {num(Math.ceil(audienceCount(audience) / 6 / 60))} hours of sending, and WhatsApp may block a number that messages many people who never wrote to it. Official (Meta) is safer for big lists.</Text>}
          <Pressable onPress={sendNow} disabled={!approved || !audienceCount(audience) || busy === 'send'}
            style={[styles.primary, (!approved || !audienceCount(audience)) && { opacity: 0.5 }]} testID="rate-broadcast-send-now" accessibilityRole="button">
            {busy === 'send' ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Send to {num(audienceCount(audience))} people</Text>}
          </Pressable>
        </View>

        {/* ---- Schedule ---- */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Schedule</Text>
          <Pressable onPress={() => router.push('/settings/notifications' as any)} style={styles.row} testID="rate-broadcast-weekly-status">
            <Text style={[styles.label, styles.flex1]}>Weekly — customer list ({num(ov.counts.weekly)}) · {form.weekly_enabled ? 'On' : 'Off'}</Text>
            <Text style={styles.small}>On/off in Notifications ›</Text>
          </Pressable>
          <View style={{ opacity: form.weekly_enabled ? 1 : 0.5, gap: 8 }}>
            <View style={styles.chips}>
              {SHORT_DAYS.map((d, i) => (
                <Pressable key={d} onPress={() => setForm((f) => f && { ...f, weekday: i })} style={[styles.chip, form.weekday === i && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: form.weekday === i }}>
                  <Text style={[styles.chipText, form.weekday === i && styles.chipTextOn]}>{d}</Text>
                </Pressable>
              ))}
            </View>
            <ViaChips value={form.weekly_via || 'meta'} onChange={(v) => setForm((f) => f && { ...f, weekly_via: v })} styles={styles} id="weekly" />
            <View>
              <Text style={styles.small}>Time (24h, IST)</Text>
              <TextInput value={form.time} onChangeText={(v) => setForm((f) => f && { ...f, time: v })} placeholder="11:00" placeholderTextColor={colors.mutedText} style={styles.input} testID="rate-broadcast-time" />
            </View>
          </View>

          <View style={styles.divider} />
          <Pressable onPress={() => router.push('/settings/notifications' as any)} style={styles.row} testID="rate-broadcast-daily-status">
            <Text style={[styles.label, styles.flex1]}>Daily — subscribers ({num(ov.counts.daily)}) · {form.daily_enabled ? 'On' : 'Off'}</Text>
            <Text style={styles.small}>On/off in Notifications ›</Text>
          </Pressable>
          <View style={{ opacity: form.daily_enabled ? 1 : 0.5 }}>
            <ViaChips value={form.daily_via || 'openwa'} onChange={(v) => setForm((f) => f && { ...f, daily_via: v })} styles={styles} id="daily" />
          </View>
          <View style={[styles.row, { opacity: form.daily_enabled ? 1 : 0.5 }]}>
            <View style={styles.flex1}>
              <Text style={styles.small}>Time (24h, IST)</Text>
              <TextInput value={form.daily_time} onChangeText={(v) => setForm((f) => f && { ...f, daily_time: v })} placeholder="11:30" placeholderTextColor={colors.mutedText} style={styles.input} testID="rate-broadcast-daily-time" />
            </View>
            <Pressable onPress={() => setForm((f) => f && { ...f, daily_skip_sunday: !f.daily_skip_sunday })} style={[styles.row, styles.flex1, { paddingTop: 18 }]} accessibilityRole="switch" accessibilityState={{ checked: form.daily_skip_sunday }}>
              <Text style={[styles.small, styles.flex1, { marginBottom: 0 }]}>Skip Sunday</Text>
              <ToggleSwitch value={form.daily_skip_sunday} />
            </Pressable>
          </View>

          <View style={styles.divider} />
          <View>
            <Text style={styles.small}>Most Official (Meta) messages a day (all Meta sends together)</Text>
            <TextInput value={String(form.daily_limit)} onChangeText={(v) => setForm((f) => f && { ...f, daily_limit: Number(v.replace(/\D/g, '')) || 0 })} keyboardType="numeric" style={styles.input} testID="rate-broadcast-limit" />
          </View>
          <Text style={styles.hint}>Meta lets a new number message about 250 different people a day; it rises to 1,000 and more once your business is verified and quality stays good. Over the limit, a send carries on the next day — and next week’s send replaces an unfinished one.</Text>
          <Pressable onPress={saveSettings} disabled={busy === 'settings'} style={styles.primary} testID="rate-broadcast-save-settings" accessibilityRole="button">
            {busy === 'settings' ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Save schedule</Text>}
          </Pressable>
        </View>

        {/* ---- History ---- */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Recent sends</Text>
          {history.length === 0 ? <Text style={styles.hint}>Nothing sent yet.</Text> : history.map((j) => (
            <View key={j.id} style={styles.listRow}>
              <View style={styles.flex1}>
                <Text style={styles.listName}>{when(j.created_at)} · {j.template_label ? `“${j.template_label}” → ` : ''}{jobAudience(j)}{j.trigger === 'schedule' ? ' (scheduled)' : ''}{j.status === 'sending' ? ' · sending' : j.status === 'stopped' ? ' · stopped' : j.status === 'replaced' ? ' · replaced' : ''}</Text>
                <Text style={styles.listMeta}>
                  {num(j.total)} people · {num(j.states?.sent ?? 0)} sent · {num((j.delivery?.delivered ?? 0) + (j.delivery?.read ?? 0))} delivered
                  {(j.delivery?.read ?? 0) ? ` (${num(j.delivery!.read)} read)` : ''}
                  {(j.states?.failed ?? 0) + (j.delivery?.failed ?? 0) ? ` · ${num((j.states?.failed ?? 0) + (j.delivery?.failed ?? 0))} failed` : ''}
                  {(j.states?.pending ?? 0) ? ` · ${num(j.states!.pending)} waiting` : ''}
                </Text>
                {j.taps && Object.keys(j.taps).length > 0 && (
                  <Text style={[styles.listMeta, { color: colors.onSurface }]} testID={`broadcast-taps-${j.id}`}>
                    Taps: {Object.entries(j.taps).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${num(v)}`).join(' · ')}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Shop WhatsApp / Official (Meta) choice for one scheduled list. */
function ViaChips({ value, onChange, styles, id }: { value: Via; onChange: (v: Via) => void; styles: any; id: string }) {
  return (
    <View>
      <Text style={styles.small}>Send from</Text>
      <View style={styles.chips}>
        {(['openwa', 'meta'] as Via[]).map((v) => (
          <Pressable key={v} onPress={() => onChange(v)} style={[styles.chip, value === v && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: value === v }} testID={`schedule-${id}-via-${v}`}>
            <Text style={[styles.chipText, value === v && styles.chipTextOn]}>{VIA_LABEL[v]}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
