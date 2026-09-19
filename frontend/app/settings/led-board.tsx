import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Switch, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { istDisplayDateTime } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';
import { confirmAction } from '@/src/utils/confirm';

type Cfg = { enabled: boolean; driver: string; host: string; port: number; template: string; auto_push: boolean };
type Status = {
  last_push_at: string | null; last_ok: boolean | null; last_error: string | null; last_text: string | null; last_reason: string | null;
  last_test_at: string | null; last_test_ok: boolean | null; last_test_detail: string | null;
};
type Tpl = { id: string; name: string; text: string };
type State = { templates?: Tpl[]; config: Cfg; status: Status; drivers: string[]; today: { gold: number; silver: number; date: string; confirmed: boolean } | null; preview: string | null; default_template: string };

const DRIVER_LABEL: Record<string, string> = { simulator: 'Simulator (no board)', huidu_w2: 'Huidu HD-W2' };

export default function LedBoardScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';

  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<'save' | 'test' | 'push' | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [driver, setDriver] = useState('simulator');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [template, setTemplate] = useState('');
  const [autoPush, setAutoPush] = useState(true);
  const [dirty, setDirty] = useState(false);
  // One-off / saved custom messages
  const [customText, setCustomText] = useState('');
  const [customPreview, setCustomPreview] = useState<{ text: string | null; error: string | null } | null>(null);
  const [saveName, setSaveName] = useState<string | null>(null);
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const previewSeq = useRef(0);

  const apply = (s: State) => {
    setState(s); setTpls(s.templates || []);
    setEnabled(s.config.enabled); setDriver(s.config.driver); setHost(s.config.host);
    setPort(s.config.port ? String(s.config.port) : ''); setTemplate(s.config.template); setAutoPush(s.config.auto_push);
    setDirty(false);
  };
  const load = useCallback(async () => {
    try { apply(await api.get<State>('/led-board')); }
    catch (e: any) { toast.error(e?.detail || 'Could not load the board settings'); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const edit = <T,>(set: (v: T) => void) => (v: T) => { set(v); setDirty(true); };

  const save = async () => {
    setBusy('save');
    try {
      await api.put('/led-board/config', { enabled, driver, host: host.trim(), port: parseInt(port || '0', 10) || 0, template: template.trim() || null, auto_push: autoPush });
      toast.success('Board settings saved');
      await load();
    } catch (e: any) { toast.error(e?.detail || 'Could not save'); }
    finally { setBusy(null); }
  };
  const test = async () => {
    setBusy('test');
    try {
      const r = await api.post<{ ok: boolean; detail: string }>('/led-board/test', {});
      r.ok ? toast.success(r.detail) : toast.error(r.detail);
      await load();
    } catch (e: any) { toast.error(e?.detail || 'Test failed'); }
    finally { setBusy(null); }
  };
  const push = async () => {
    setBusy('push');
    try {
      const r = await api.post<{ ok: boolean; text: string }>('/led-board/push', {});
      toast.success(`Sent to the board: ${r.text}`);
    } catch (e: any) { toast.error(e?.detail || 'Could not update the board'); }
    finally { setBusy(null); await load(); }
  };

  useEffect(() => {
    if (!customText.trim()) { setCustomPreview(null); return; }
    const my = ++previewSeq.current;
    const t = setTimeout(async () => {
      try {
        const r = await api.post<{ text: string | null; error: string | null }>('/led-board/preview', { template: customText });
        if (my === previewSeq.current) setCustomPreview(r);
      } catch { /* keep last */ }
    }, 300);
    return () => clearTimeout(t);
  }, [customText]);
  const addChip = (c: string) => setCustomText((t) => (t && !t.endsWith(' ') ? `${t} ${c}` : `${t}${c}`));
  const pushCustom = async () => {
    setBusy('push');
    try {
      const r = await api.post<{ text: string }>('/led-board/push', { template: customText });
      toast.success(`Board shows: ${r.text}`);
    } catch (e: any) { toast.error(e?.detail || 'Could not update the board'); }
    finally { setBusy(null); await load(); }
  };
  const saveTemplate = async () => {
    try {
      const r = await api.post<{ items: Tpl[] }>('/led-board/templates', { name: saveName || '', text: customText });
      setTpls(r.items); toast.success(`Saved template “${(saveName || '').trim()}”`); setSaveName(null);
    } catch (e: any) { toast.error(e?.detail || 'Could not save the template'); }
  };
  const deleteTemplate = (t: Tpl) => confirmAction('Delete template?', `“${t.name}” will be removed.`, 'Delete', async () => {
    try { const r = await api.del<{ items: Tpl[] }>(`/led-board/templates/${t.id}`); setTpls(r?.items ?? []); }
    catch (e: any) { toast.error(e?.detail || 'Could not delete'); }
  });

  if (loading) return <SafeAreaView style={styles.centered}><ActivityIndicator color={colors.brandPrimary} /></SafeAreaView>;
  const st = state?.status;
  const canPush = enabled && !dirty && !!state?.today;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="led-board-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} hitSlop={12} testID="back-btn"><Ionicons name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.title}>LED Rate Board</Text>
        <Pressable onPress={load} style={styles.iconBtn} hitSlop={12}><Ionicons name="refresh" size={18} color={colors.onSurface} /></Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}>

        <View style={styles.infoBox}>
          <Ionicons name="tv-outline" size={16} color={colors.brandSecondary} />
          <Text style={styles.infoText}>Shows today's gold and silver rate on the shop's LED board. It updates when you confirm the rate on the Rate Updater screen, or when you tap "Update board now".</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Board now</Text>
          <Text style={styles.big}>{state?.preview || 'No rate for today yet'}</Text>
          <Text style={styles.hint}>
            {state?.today ? `Rate for ${state.today.date}${state.today.confirmed ? ' · sent' : ' · not sent yet'}` : 'Fetch or enter today\'s rate on the Rate Updater screen.'}
          </Text>
          <Pressable onPress={push} disabled={!canPush || busy === 'push'} style={[styles.primaryBtn, (!canPush || busy === 'push') && { opacity: 0.5 }]} testID="led-push">
            {busy === 'push' ? <ActivityIndicator color={colors.onBrandPrimary} size="small" /> : <><Ionicons name="cloud-upload-outline" size={17} color={colors.onBrandPrimary} /><Text style={styles.primaryBtnText}>Update board now</Text></>}
          </Pressable>
          {!enabled ? <Text style={styles.hint}>Switch the board on below first.</Text> : dirty ? <Text style={styles.hint}>Save your changes first.</Text> : null}
          {st?.last_push_at ? (
            <View style={[styles.statusRow, st.last_ok ? styles.ok : styles.bad]}>
              <Ionicons name={st.last_ok ? 'checkmark-circle' : 'alert-circle'} size={16} color={st.last_ok ? colors.onSuccess : colors.onError} />
              <Text style={[styles.statusText, { color: st.last_ok ? colors.onSuccess : colors.onError }]}>
                {st.last_ok ? `Last update ${istDisplayDateTime(st.last_push_at)}` : `Last attempt failed ${istDisplayDateTime(st.last_push_at)}: ${st.last_error}`}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Settings{isOwner ? '' : ' (owner only)'}</Text>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}><Text style={styles.label}>Board switched on</Text><Text style={styles.hint}>Nothing is sent to the board while this is off.</Text></View>
            <Switch value={enabled} onValueChange={edit(setEnabled)} disabled={!isOwner} trackColor={{ true: colors.brandPrimary, false: colors.border }} thumbColor={colors.surface} testID="led-enabled" />
          </View>
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}><Text style={styles.label}>Update automatically</Text><Text style={styles.hint}>Push to the board whenever the daily rate is confirmed.</Text></View>
            <Switch value={autoPush} onValueChange={edit(setAutoPush)} disabled={!isOwner} trackColor={{ true: colors.brandPrimary, false: colors.border }} thumbColor={colors.surface} testID="led-auto" />
          </View>

          <Text style={styles.label}>Board type</Text>
          <View style={styles.seg}>
            {(state?.drivers || []).map((d) => (
              <Pressable key={d} disabled={!isOwner} onPress={() => edit(setDriver)(d)} style={[styles.segItem, driver === d && styles.segOn]} testID={`led-driver-${d}`}>
                <Text style={[styles.segText, driver === d && styles.segTextOn]}>{DRIVER_LABEL[d] || d}</Text>
              </Pressable>
            ))}
          </View>
          {driver === 'huidu_w2' ? <Text style={styles.hint}>The HD-W2 connection is still being set up. Until it is tested with the real board, use the Simulator.</Text> : null}

          {driver !== 'simulator' ? (
            <View style={styles.row2}>
              <View style={{ flex: 2 }}>
                <Text style={styles.label}>Board address</Text>
                <TextInput value={host} onChangeText={edit(setHost)} editable={isOwner} autoCapitalize="none" autoCorrect={false} placeholder="e.g. 192.168.31.60" placeholderTextColor={colors.mutedText} style={styles.input} testID="led-host" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Port</Text>
                <TextInput value={port} onChangeText={edit(setPort)} editable={isOwner} keyboardType="numeric" placeholder="port" placeholderTextColor={colors.mutedText} style={styles.input} testID="led-port" />
              </View>
            </View>
          ) : null}

          <Text style={styles.label}>Text on the board</Text>
          <TextInput value={template} onChangeText={edit(setTemplate)} editable={isOwner} autoCapitalize="characters" placeholder={state?.default_template} placeholderTextColor={colors.mutedText} style={styles.input} testID="led-template" />
          <Text style={styles.hint}>Numbers: {'{gold_24k}'} {'{gold_22k}'} {'{gold_18k}'} {'{gold_14k}'} {'{silver_9999}'} — worked out by the Rate Master percentages. Add _comma for 1,51,050 style (e.g. {'{gold_22k_comma}'}). {'{gold_rate}'} and {'{silver_rate}'} are the raw confirmed rates; {'{date}'} and {'{time}'} also work.</Text>
          <Pressable onPress={() => router.push('/settings/rate-master' as any)}><Text style={styles.link}>Edit the percentages in Rate Master</Text></Pressable>

          {isOwner ? (
            <View style={styles.row2}>
              <Pressable onPress={test} disabled={!!busy || dirty} style={[styles.altBtn, { flex: 1 }, (!!busy || dirty) && { opacity: 0.5 }]} testID="led-test">
                {busy === 'test' ? <ActivityIndicator color={colors.brandSecondary} size="small" /> : <><Ionicons name="pulse-outline" size={15} color={colors.brandSecondary} /><Text style={styles.altBtnText}>Test connection</Text></>}
              </Pressable>
              <Pressable onPress={save} disabled={!!busy || !dirty} style={[styles.primaryBtn, { flex: 1, marginTop: 0 }, (!!busy || !dirty) && { opacity: 0.5 }]} testID="led-save">
                {busy === 'save' ? <ActivityIndicator color={colors.onBrandPrimary} size="small" /> : <Text style={styles.primaryBtnText}>Save</Text>}
              </Pressable>
            </View>
          ) : null}
          {st?.last_test_at ? <Text style={[styles.hint, { marginTop: spacing.sm }]}>Last test: {st.last_test_ok ? '✔' : '✖'} {st.last_test_detail}</Text> : null}
        </View>

        <View style={styles.card} testID="led-custom-card">
          <Text style={styles.cardTitle}>Custom message & templates</Text>
          <Text style={styles.hint}>Show any text on the board — an offer, a notice — using the same placeholders. It stays until the next rate update. Save messages you use often as templates.</Text>
          {tpls.length ? (
            <View style={{ marginTop: 6 }}>
              <Text style={styles.hint}>Saved templates — tap to use, ✕ to delete</Text>
              <View style={styles.chipRow}>
                {tpls.map((t) => (
                  <View key={t.id} style={styles.tplChip} testID={`led-template-${t.id}`}>
                    <Pressable onPress={() => setCustomText(t.text)} hitSlop={4}><Text style={styles.chipText}>{t.name}</Text></Pressable>
                    <Pressable onPress={() => deleteTemplate(t)} hitSlop={8}><Ionicons name="close" size={13} color={colors.mutedText} /></Pressable>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
          <TextInput value={customText} onChangeText={setCustomText} autoCapitalize="characters" placeholder="e.g. 22K {gold_22k}  18K {gold_18k}" placeholderTextColor={colors.mutedText}
            style={[styles.input, { marginTop: spacing.sm }]} testID="led-custom-text" />
          <View style={styles.chipRow}>
            {['{gold_24k}', '{gold_22k}', '{gold_18k}', '{gold_14k}', '{silver_9999}', '{date}', '{time}'].map((c) => (
              <Pressable key={c} onPress={() => addChip(c)} style={styles.chip}><Text style={styles.chipText}>{c}</Text></Pressable>
            ))}
          </View>
          {customPreview ? (customPreview.error
            ? <Text style={styles.err}>{customPreview.error}</Text>
            : <Text style={styles.hint}>Board will show: <Text style={{ fontWeight: '800', color: colors.onSurface }}>{customPreview.text}</Text></Text>) : null}
          {saveName === null ? (
            <Pressable onPress={() => setSaveName('')} disabled={!customText.trim()} style={{ opacity: customText.trim() ? 1 : 0.4 }} testID="led-template-save-open"><Text style={styles.link}>Save this text as a template</Text></Pressable>
          ) : (
            <View style={styles.row2}>
              <TextInput value={saveName} onChangeText={setSaveName} placeholder="Template name" placeholderTextColor={colors.mutedText} style={[styles.input, { flex: 1 }]} testID="led-template-name" />
              <Pressable onPress={saveTemplate} disabled={!saveName.trim()} style={[styles.altBtn, { paddingHorizontal: 16 }, !saveName.trim() && { opacity: 0.5 }]} testID="led-template-save"><Text style={styles.altBtnText}>Save</Text></Pressable>
              <Pressable onPress={() => setSaveName(null)} hitSlop={8} style={{ justifyContent: 'center' }}><Ionicons name="close" size={18} color={colors.mutedText} /></Pressable>
            </View>
          )}
          <Pressable onPress={pushCustom} disabled={busy === 'push' || !enabled || dirty || !customPreview?.text} style={[styles.primaryBtn, (busy === 'push' || !enabled || dirty || !customPreview?.text) && { opacity: 0.5 }]} testID="led-custom-push">
            {busy === 'push' ? <ActivityIndicator color={colors.onBrandPrimary} size="small" /> : <><Ionicons name="cloud-upload-outline" size={17} color={colors.onBrandPrimary} /><Text style={styles.primaryBtnText}>Push to board</Text></>}
          </Pressable>
          {!enabled ? <Text style={styles.hint}>Switch the board on above first.</Text> : dirty ? <Text style={styles.hint}>Save your changes first.</Text> : null}
        </View>
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
  infoBox: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  infoText: { color: colors.onSurfaceTertiary, fontSize: 12, flex: 1 },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md, gap: 6 },
  cardTitle: { color: colors.onSurface, fontSize: 15, fontWeight: '800', marginBottom: 4 },
  big: { color: colors.onSurface, fontSize: 22, fontWeight: '800', letterSpacing: 0.5, paddingVertical: spacing.sm },
  hint: { color: colors.mutedText, fontSize: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  tplChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary },
  chipText: { color: colors.brandSecondary, fontSize: 12, fontWeight: '700' },
  err: { color: colors.onError, fontSize: 12 },
  link: { color: colors.brandPrimary, fontSize: 12.5, fontWeight: '600', marginTop: 4 },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600', marginTop: spacing.sm, marginBottom: 4 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 4 },
  row2: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end', marginTop: spacing.sm },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 11, fontSize: 14 },
  seg: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  segItem: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  segOn: { backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary },
  segText: { color: colors.mutedText, fontSize: 12.5, fontWeight: '600' },
  segTextOn: { color: colors.brandPrimary },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 13, marginTop: spacing.sm },
  primaryBtnText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 14 },
  altBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: 13 },
  altBtnText: { color: colors.brandSecondary, fontWeight: '700', fontSize: 13 },
  statusRow: { flexDirection: 'row', gap: 8, alignItems: 'center', borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.sm },
  ok: { backgroundColor: colors.success }, bad: { backgroundColor: colors.error },
  statusText: { flex: 1, fontSize: 12 },
});
