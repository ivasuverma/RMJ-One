import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
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

// Settings › Notifications: the one place for owners and admins.
// Each category shows (1) the alerts the chosen owner/admin gets, and (2) the
// alerts the shop sends to employees, karigars and customers. Employees keep
// their simple module on/off on their own profile (Users › employee).
type General = { key: string; module: string; label: string; to: string; push: boolean | null; whatsapp: boolean | null };
type Ch = 'push' | 'whatsapp';

const EXTRA_ICON: Record<string, string> = {
  cash_book: 'wallet-outline', gold_rate: 'trending-up-outline', system_health: 'pulse-outline', samples: 'diamond-outline',
};

export default function NotificationsSettings() {
  const { user: me } = useAuth();
  const params = useLocalSearchParams<{ account?: string }>();
  const [picked, setWho] = useState<string | undefined>(params.account);
  const who = picked || me?.id;   // the signed-in person loads a moment after the page
  // Keyed by person so switching starts clean from that person's saved settings.
  return <PersonNotifications key={who || 'none'} who={who} setWho={setWho} />;
}

function PersonNotifications({ who, setWho }: { who?: string; setWho: (id: string) => void }) {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const { user: me } = useAuth();
  const [people, setPeople] = useState<AccessAccount[]>([]);
  const editor = useAccessEditor(who);
  const [general, setGeneral] = useState<General[] | null>(null);
  const [draft, setDraft] = useState<Record<string, Partial<Record<Ch, boolean>>>>({});

  useEffect(() => {
    api.get<AccessAccount[]>('/access/accounts')
      .then((a) => setPeople(a.filter((x) => x.account_type === 'user' && x.role !== 'employee')))
      .catch(() => {});
  }, []);
  const loadGeneral = useCallback(async () => {
    try { setGeneral((await api.get<{ alerts: General[] }>('/settings/general-alerts')).alerts); } catch { setGeneral([]); }
  }, []);
  useFocusEffect(useCallback(() => { loadGeneral(); }, [loadGeneral]));

  const { acc, notifOn, setNotifOn, notifModules, notifPrefs, setNotifPrefs, notifPrefsWhatsapp, setNotifPrefsWhatsapp } = editor;
  const adminish = canReceiveAdminOnly(acc?.role);
  const dirty = Object.keys(draft).length > 0;

  // A category switch turns every alert in it on/off together, so nothing
  // underneath is left pointing the other way.
  const setCategory = (mod: string, eventKeys: string[], ch: Ch, v: boolean) => {
    const set = ch === 'push' ? setNotifPrefs : setNotifPrefsWhatsapp;
    set((p) => { const n = { ...p, [mod]: v }; for (const k of eventKeys) n[k] = v; return n; });
  };
  const setEvent = (key: string, ch: Ch, v: boolean) =>
    (ch === 'push' ? setNotifPrefs : setNotifPrefsWhatsapp)((p) => ({ ...p, [key]: v }));
  const genValue = (g: General, ch: Ch) => (draft[g.key]?.[ch] ?? g[ch]);
  const setGen = (g: General, ch: Ch, v: boolean) => setDraft((d) => ({ ...d, [g.key]: { ...d[g.key], [ch]: v } }));

  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const res = await editor.save();
      if (!res.ok) throw { detail: res.error };
      for (const [key, chs] of Object.entries(draft)) {
        for (const [ch, on] of Object.entries(chs)) await api.put('/settings/general-alerts', { key, channel: ch, on });
      }
      setDraft({}); await loadGeneral();
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
        {people.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ marginBottom: spacing.md }}>
            {people.map((p) => (
              <Pressable key={p.id} onPress={() => { if (!dirty && !saving) setWho(p.id); else toast.error('Save first'); }}
                style={[styles.chip, who === p.id && styles.chipOn]} testID={`notif-person-${p.id}`}>
                <Text style={[styles.chipText, who === p.id && styles.chipTextOn]}>{p.id === me?.id ? 'Me' : p.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {editor.loading || !acc || !general ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 40 }} /> : (
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
              const gen = general.filter((g) => g.module === m.key);
              if (!events.length && !gen.length) return null;
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
                    {notifOn && events.length > 0 && (
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
                    )}
                    {gen.length > 0 && (
                      <>
                        <View style={[styles.row, (notifOn && events.length > 0) && styles.sep, styles.allRow]}>
                          <Text style={[styles.label, { flex: 1 }]}>Sent to employees &amp; customers</Text>
                          <Text style={styles.shop}>Whole shop</Text>
                        </View>
                        {gen.map((g) => (
                          <View key={g.key} style={[styles.row, styles.sep]} testID={`notif-gen-${g.key}`}>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={styles.evLabel}>{g.label}</Text>
                              <Text style={styles.sub}>To: {g.to}</Text>
                            </View>
                            <Sw value={genValue(g, 'push')} onChange={(v) => setGen(g, 'push', v)} id={`notif-gen-${g.key}-push`} />
                            <Sw value={genValue(g, 'whatsapp')} onChange={(v) => setGen(g, 'whatsapp', v)} id={`notif-gen-${g.key}-wa`} />
                          </View>
                        ))}
                      </>
                    )}
                  </View>
                </View>
              );
            })}

            <Text style={[styles.hint, { marginTop: spacing.lg }]}>
              Employees choose by module on their own profile (Users › employee › Notifications): a module on means they get its alerts.
            </Text>
            <Pressable onPress={() => router.push('/settings/staff-notifications' as any)} style={styles.link} testID="notif-staff-link">
              <Ionicons name="people-outline" size={17} color={colors.brandSecondary} />
              <Text style={styles.linkText}>Who has notifications turned on</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.mutedText} />
            </Pressable>
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable onPress={save} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]} testID="notif-save">
          {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Save</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const COL = 70;
const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '700', fontFamily: fonts.display },
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
  shop: { color: colors.mutedText, fontSize: 11.5, fontWeight: '600' },
  col: { width: COL, alignItems: 'center' },
  na: { color: colors.mutedText },
  hint: { color: colors.mutedText, fontSize: 12.5, lineHeight: 18, marginTop: 8 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.md, padding: 14, borderRadius: radius.lg, backgroundColor: colors.surfaceSecondary },
  linkText: { flex: 1, color: colors.onSurface, fontSize: 14.5, fontWeight: '600' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg, paddingTop: spacing.md, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 15, alignItems: 'center' },
  saveText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: '700' },
});
