import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useAuth } from '@/src/auth/AuthContext';
import { useToast } from '@/src/components/ui';
import { ToggleSwitch } from '@/src/components/ui/ToggleSwitch';
import { GlassButton } from '@/src/components/ui/GlassButton';
import { useAccessEditor, AccessAccount } from '@/src/hooks/use-access-editor';
import { canReceiveAdminOnly } from '@/src/components/AccessEditorSections';
import { MODULE_ICON } from '@/src/components/home/sections';
import { isPushSupported, isSubscribed, subscribeToPush, unsubscribeFromPush } from '@/src/utils/push';
import { notify } from '@/src/utils/notify';

// Settings › Notifications — every on/off in one place, each with one switch:
//  • General: whole-shop messages (WhatsApp on/off, customer messages,
//    auto-replies, scheduled rate sends). Saved as soon as it's tapped.
//  • Owners & admins: each person's own alerts, by category.
// What an employee receives is set only on that employee's profile.
type Ch = 'push' | 'whatsapp';
type GeneralSwitch = { key: string; group: string; label: string; sub: string; needs: string | null; on: boolean };

const EXTRA_ICON: Record<string, string> = {
  cash_book: 'wallet-outline', gold_rate: 'trending-up-outline', system_health: 'pulse-outline', samples: 'diamond-outline',
};

export default function NotificationsSettings() {
  const { user: me } = useAuth();
  const params = useLocalSearchParams<{ account?: string }>();
  const [picked, setWho] = useState<string | undefined>(params.account);
  const [tab, setTab] = useState<'general' | 'people'>(params.account ? 'people' : 'general');
  const who = picked || me?.id;   // the signed-in person loads a moment after the page
  // Keyed by person so switching starts clean from that person's saved settings.
  return <PersonNotifications key={who || 'none'} who={who} setWho={setWho} tab={tab} setTab={setTab} />;
}

/** Push on the phone in your hand (each phone/browser signs up on its own). */
function ThisPhone() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (isPushSupported()) isSubscribed().then(setOn); }, []);
  const toggle = async () => {
    if (!isPushSupported()) { notify('Not supported', 'Notifications aren’t supported in this browser.'); return; }
    setBusy(true);
    try {
      if (on) { await unsubscribeFromPush(); setOn(false); }
      else {
        const res = await subscribeToPush();
        if (res.ok) setOn(true); else notify('Couldn’t enable notifications', res.reason || 'Please try again');
      }
    } finally { setBusy(false); }
  };
  return (
    <View style={[styles.card, { marginBottom: spacing.md }]}>
      <View style={styles.row}>
        <Ionicons name="phone-portrait-outline" size={18} color={colors.brandSecondary} style={{ marginRight: 10 }} />
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Push on this phone</Text>
          <Text style={styles.sub}>Each phone you sign in on is switched on separately</Text>
        </View>
        {busy ? <ActivityIndicator color={colors.brandSecondary} /> : (
          <Pressable onPress={toggle} accessibilityRole="switch" accessibilityState={{ checked: on }} testID="notif-this-phone">
            <ToggleSwitch value={on} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

function GeneralSection() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const [items, setItems] = useState<GeneralSwitch[] | null>(null);
  useEffect(() => {
    api.get<{ switches: GeneralSwitch[] }>('/settings/general-notifications').then((r) => setItems(r.switches)).catch(() => setItems([]));
  }, []);
  const flip = async (g: GeneralSwitch) => {
    const prev = items;
    setItems((l) => l && l.map((x) => (x.key === g.key ? { ...x, on: !g.on } : x)));
    try { setItems((await api.put<{ switches: GeneralSwitch[] }>('/settings/general-notifications', { key: g.key, on: !g.on })).switches); }
    catch (e: any) { setItems(prev); toast.error(e?.detail || 'Could not save'); }
  };
  if (!items) return <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 40 }} />;
  const isOn = (k: string | null): boolean => {
    if (!k) return true;
    const x = items.find((i) => i.key === k);
    return !!x && x.on && isOn(x.needs);
  };
  const groups = items.reduce<{ name: string; list: GeneralSwitch[] }[]>((g, x) => {
    const last = g[g.length - 1];
    if (last && last.name === x.group) last.list.push(x); else g.push({ name: x.group, list: [x] });
    return g;
  }, []);
  return (
    <>
      <Text style={styles.hint}>Messages for the whole shop, sent on WhatsApp. Changes save as soon as you tap. Wording is in WhatsApp Templates; times are in Rate Master and Message Broadcast.</Text>
      {groups.map((g) => (
        <View key={g.name} style={{ marginTop: spacing.lg }}>
          <View style={styles.catHead}><Text style={styles.catTitle}>{g.name}</Text></View>
          <View style={styles.card}>
            {g.list.map((x, i) => {
              const live = isOn(x.needs);
              return (
                <View key={x.key} style={[styles.row, i > 0 && styles.sep, !live && { opacity: 0.45 }]} testID={`gen-${x.key}`}>
                  <View style={{ flex: 1, minWidth: 0, paddingLeft: x.needs && x.needs !== 'wa_enabled' ? 14 : 0 }}>
                    <Text style={styles.evLabel}>{x.label}</Text>
                    {!!x.sub && <Text style={styles.sub}>{x.sub}</Text>}
                  </View>
                  <Pressable onPress={() => live && flip(x)} disabled={!live} hitSlop={6} accessibilityRole="switch" accessibilityState={{ checked: x.on }} testID={`gen-${x.key}-switch`}>
                    <ToggleSwitch value={x.on && live} />
                  </Pressable>
                </View>
              );
            })}
          </View>
        </View>
      ))}
    </>
  );
}

function PersonNotifications({ who, setWho, tab, setTab }: { who?: string; setWho: (id: string) => void; tab: 'general' | 'people'; setTab: (t: 'general' | 'people') => void }) {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const { user: me } = useAuth();
  const [people, setPeople] = useState<AccessAccount[]>([]);
  const editor = useAccessEditor(who);

  useEffect(() => {
    api.get<AccessAccount[]>('/access/accounts')
      .then((a) => setPeople(a.filter((x) => x.account_type === 'user' && x.role !== 'employee')))
      .catch(() => {});
  }, []);

  const { acc, notifOn, setNotifOn, notifModules, notifPrefs, setNotifPrefs, notifPrefsWhatsapp, setNotifPrefsWhatsapp } = editor;
  const adminish = canReceiveAdminOnly(acc?.role);

  // A category switch turns every alert in it on/off together, so nothing
  // underneath is left pointing the other way.
  const setCategory = (mod: string, eventKeys: string[], ch: Ch, v: boolean) => {
    const set = ch === 'push' ? setNotifPrefs : setNotifPrefsWhatsapp;
    set((p) => { const n = { ...p, [mod]: v }; for (const k of eventKeys) n[k] = v; return n; });
  };
  const setEvent = (key: string, ch: Ch, v: boolean) =>
    (ch === 'push' ? setNotifPrefs : setNotifPrefsWhatsapp)((p) => ({ ...p, [key]: v }));

  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const res = await editor.save();
      if (!res.ok) throw { detail: res.error };
      toast.success('Notifications saved');
    } catch (e: any) { toast.error(e?.detail || 'Could not save'); }
    finally { setSaving(false); }
  };

  const Sw = ({ value, onChange, id }: { value: boolean | null; onChange: (v: boolean) => void; id: string }) => (
    <View style={styles.col}>
      {value === null ? <Text style={styles.na}>—</Text> : (
        <Pressable onPress={() => onChange(!value)} hitSlop={6} accessibilityRole="switch" accessibilityState={{ checked: value }} testID={id}>
          <ToggleSwitch value={value} />
        </Pressable>
      )}
    </View>
  );

  const name = acc?.id === me?.id ? 'you' : acc?.name || '';

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="notifications-settings">
      <View style={styles.header}>
        <GlassButton onPress={() => router.back()} style={styles.iconBtn} hitSlop={12} testID="back-btn" accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </GlassButton>
        <Text style={styles.title}>Notifications</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 130 }}>
        <ThisPhone />
        <View style={styles.tabs}>
          {([['general', 'General'], ['people', 'Owners & admins']] as const).map(([k, label]) => (
            <Pressable key={k} onPress={() => setTab(k)} style={[styles.tab, tab === k && styles.tabOn]} testID={`notif-tab-${k}`}>
              <Text style={[styles.tabText, tab === k && styles.tabTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        {tab === 'general' ? <GeneralSection /> : (<>
        {people.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ marginBottom: spacing.md }}>
            {people.map((p) => (
              <Pressable key={p.id} onPress={() => { if (!saving) setWho(p.id); }}
                style={[styles.chip, who === p.id && styles.chipOn]} testID={`notif-person-${p.id}`}>
                <Text style={[styles.chipText, who === p.id && styles.chipTextOn]}>{p.id === me?.id ? 'Me' : p.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {editor.loading || !acc ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 40 }} /> : (
          <>
            <View style={styles.card}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Allow notifications for {name}</Text>
                  <Text style={styles.sub}>Off = {name === 'you' ? 'you get' : `${acc.name} gets`} no push or WhatsApp at all</Text>
                </View>
                <Pressable onPress={() => setNotifOn(!notifOn)} accessibilityRole="switch" accessibilityState={{ checked: notifOn }} testID="notif-master">
                  <ToggleSwitch value={notifOn} />
                </Pressable>
              </View>
            </View>
            {!acc.mobile && <Text style={styles.hint}>No mobile number saved for {acc.name} — WhatsApp alerts can&apos;t reach them until one is added (Users).</Text>}

            {notifModules.map((m) => {
              const events = (m.events || []).filter((e) => adminish || !e.admin_only);
              if (!events.length) return null;
              const modOn = notifPrefs[m.key] !== false;
              const modWa = notifPrefsWhatsapp[m.key] !== false;
              const evOn = (k: string, ch: Ch) => (ch === 'push' ? (k in notifPrefs ? notifPrefs[k] !== false : modOn) : (k in notifPrefsWhatsapp ? notifPrefsWhatsapp[k] !== false : modWa));
              const keys = events.map((e) => e.key);
              const allOn = (ch: Ch) => keys.length ? keys.some((k) => evOn(k, ch)) : (ch === 'push' ? modOn : modWa);
              return (
                <View key={m.key} style={{ marginTop: spacing.lg }} testID={`notif-cat-${m.key}`}>
                  <View style={styles.catHead}>
                    <Ionicons name={(MODULE_ICON[m.key] || EXTRA_ICON[m.key] || 'notifications-outline') as any} size={17} color={colors.brandSecondary} />
                    <Text style={styles.catTitle}>{m.label}</Text>
                    <Text style={styles.colHead}>Push</Text>
                    <Text style={styles.colHead}>WhatsApp</Text>
                  </View>
                  <View style={styles.card}>
                    {notifOn ? (
                      <>
                        <View style={[styles.row, styles.allRow]}>
                          <Text style={[styles.label, { flex: 1 }]}>Alerts to {name}</Text>
                          <Sw value={allOn('push')} onChange={(v) => setCategory(m.key, keys, 'push', v)} id={`notif-all-${m.key}-push`} />
                          <Sw value={allOn('whatsapp')} onChange={(v) => setCategory(m.key, keys, 'whatsapp', v)} id={`notif-all-${m.key}-wa`} />
                        </View>
                        {events.map((e) => (
                          <View key={e.key} style={[styles.row, styles.sep]}>
                            <Text style={[styles.evLabel, { flex: 1 }]}>{e.label.replace(/\s*\(.*\)\s*$/, '')}</Text>
                            <Sw value={evOn(e.key, 'push')} onChange={(v) => setEvent(e.key, 'push', v)} id={`notif-ev-${e.key}-push`} />
                            <Sw value={evOn(e.key, 'whatsapp')} onChange={(v) => setEvent(e.key, 'whatsapp', v)} id={`notif-ev-${e.key}-wa`} />
                          </View>
                        ))}
                      </>
                    ) : <Text style={[styles.sub, { paddingVertical: 12 }]}>Notifications are off for {name}.</Text>}
                  </View>
                </View>
              );
            })}

            <Text style={[styles.hint, { marginTop: spacing.lg }]}>
              Alerts to employees (their pay, tasks, attendance, work issued to them) are set on each employee&apos;s profile: Employees › person › Access &amp; Alerts. Messages to customers are under General.
            </Text>
            <Pressable onPress={() => router.push('/settings/staff-notifications' as any)} style={styles.link} testID="notif-staff-link">
              <Ionicons name="people-outline" size={17} color={colors.brandSecondary} />
              <Text style={styles.linkText}>Who has notifications turned on</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.mutedText} />
            </Pressable>
          </>
        )}
        </>)}
      </ScrollView>

      {tab === 'people' && <View style={styles.footer}>
        <Pressable onPress={save} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]} testID="notif-save">
          {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Save</Text>}
        </Pressable>
      </View>}
    </SafeAreaView>
  );
}

const COL = 70;
const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '700', fontFamily: fonts.display },
  tabs: { flexDirection: 'row', gap: 4, padding: 3, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, marginBottom: spacing.md },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radius.md - 2 },
  tabOn: { backgroundColor: colors.brandPrimary },
  tabText: { color: colors.onSurfaceSecondary, fontSize: 14, fontWeight: '700' },
  tabTextOn: { color: colors.onBrandPrimary },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurface, fontSize: 13.5, fontWeight: '700' },
  chipTextOn: { color: colors.onBrandPrimary },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11 },
  allRow: { paddingVertical: 9 },
  sep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  catHead: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, marginBottom: 6 },
  catTitle: { flex: 1, color: colors.onSurface, fontSize: 16, fontWeight: '800' },
  colHead: { width: COL, textAlign: 'center', color: colors.mutedText, fontSize: 11, fontWeight: '700' },
  label: { color: colors.onSurface, fontSize: 14, fontWeight: '700' },
  evLabel: { color: colors.onSurface, fontSize: 14 },
  sub: { color: colors.mutedText, fontSize: 12, marginTop: 1 },
  col: { width: COL, alignItems: 'center' },
  na: { color: colors.mutedText },
  hint: { color: colors.mutedText, fontSize: 12.5, lineHeight: 18, marginTop: 8 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.md, padding: 14, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary },
  linkText: { flex: 1, color: colors.onSurface, fontSize: 14.5, fontWeight: '600' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg, paddingTop: spacing.md, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 15, alignItems: 'center' },
  saveText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: '700' },
});
