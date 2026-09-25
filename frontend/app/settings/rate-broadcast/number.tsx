import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, TextInput, RefreshControl, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';
import { Header, makeStyles, MetaStatus } from './_shared';

type Diag = {
  app_secret_set: boolean; verify_token_set: boolean;
  callback_url?: string;
  subscription: { subscribed: boolean | null; apps: string[]; overrides?: string[]; error: string | null };
  number?: { ok: boolean | null; error: string | null; status?: string; platform_type?: string; account_mode?: string; quality_rating?: string; messaging_limit_tier?: string;
    webhook_configuration?: { phone_number?: string; whatsapp_business_account?: string; application?: string } };
  hits: { at: string; kind: 'verify' | 'event'; ok: boolean; note: string }[];
};
const WEBHOOK_URL = 'https://api.rmj.co.in/api/webhooks/whatsapp-meta';
const ENV_KEYS = ['META_WA_PHONE_NUMBER_ID', 'META_WA_WABA_ID', 'META_WA_ACCESS_TOKEN', 'META_WA_APP_SECRET', 'META_WA_WEBHOOK_VERIFY_TOKEN', 'META_WA_APP_ID (only if WhatsApp is a different Meta app from Instagram)'];

// Step 1 — the official WhatsApp (Meta) number, used only for Rate Broadcast.
// Connection status, the customer subscribe link, and a test message.
export default function BroadcastNumberScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const [meta, setMeta] = useState<MetaStatus | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [mobile, setMobile] = useState('');
  const [text, setText] = useState('Test message from Ram Murti Jewellers');
  const [sending, setSending] = useState(false);
  const [diag, setDiag] = useState<Diag | null>(null);
  const [linking, setLinking] = useState(false);
  const [relinkMsg, setRelinkMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pin, setPin] = useState('');
  const [registering, setRegistering] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, l] = await Promise.all([
        api.get<MetaStatus>('/settings/whatsapp-meta'),
        api.get<{ url: string | null }>('/public/rate-broadcast/subscribe').catch(() => ({ url: null })),
      ]);
      setMeta(m); setLink(l.url);
      api.get<Diag>('/rate-broadcast/diagnostics').then(setDiag).catch(() => setDiag(null));
    } catch (e: any) { toast.error(e?.detail || 'Could not load'); }
    finally { setLoaded(true); setRefreshing(false); }
  }, [toast]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const sendTest = async () => {
    setSending(true);
    try {
      await api.post('/settings/whatsapp-meta/test-send', { mobile: mobile.trim(), text: text.trim() });
      toast.success('Test message sent');
    } catch (e: any) { toast.error(e?.detail || 'Send failed'); }
    finally { setSending(false); }
  };

  // Result stays on screen (not just a toast) so Meta's exact words can be read and screenshotted.
  const linkApp = async (pointHere = false) => {
    setLinking(true); setRelinkMsg(null);
    try {
      const d = await api.post<Diag & { relink_notes?: string[] }>('/rate-broadcast/diagnostics/subscribe-app', { point_here: pointHere });
      setDiag(d);
      const notes = d.relink_notes || [];
      setRelinkMsg({ ok: true, text: notes.length
        ? `Re-linked to RMJ-One, but Meta wouldn’t change the address: ${notes.join(' | ')}. Send START again to test.`
        : 'Done — this number’s messages now come to RMJ-One. Send START again to test.' });
    } catch (e: any) {
      setRelinkMsg({ ok: false, text: `Meta refused: ${e?.detail || e?.message || 'no details returned'}` });
    } finally { setLinking(false); }
  };

  const register = async () => {
    setRegistering(true);
    try { setDiag(await api.post<Diag>('/rate-broadcast/diagnostics/register-number', { pin })); setPin(''); toast.success('Number registered — send START again to test'); }
    catch (e: any) { toast.error(e?.detail || 'Could not register'); }
    finally { setRegistering(false); }
  };

  const copy = async (text: string) => {
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        toast.success('Copied');
      } else {
        Linking.openURL(text);
      }
    } catch { toast.error('Could not copy'); }
  };
  const copyLink = () => { if (link) copy(link); };

  const ok = !!meta?.connected;
  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="broadcast-number-screen">
      <Header title="Official number" colors={colors}
        right={<Pressable onPress={load} style={styles.iconBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Refresh status"><Ionicons name="refresh" size={18} color={colors.onSurface} /></Pressable>} />
      {!loaded ? <View style={styles.centered}><ActivityIndicator color={colors.brandPrimary} /></View> : (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}>
          <Text style={styles.hint}>
            A separate number on the official WhatsApp Business Platform (Meta). It sends only rate and offer broadcasts;
            everything else stays on the shop’s OpenWA number.
          </Text>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Connection</Text>
            <View style={[styles.status, ok ? styles.ok : styles.warn]} testID="broadcast-number-status">
              <Ionicons name={ok ? 'checkmark-circle-outline' : 'alert-circle-outline'} size={16} color={ok ? colors.onSuccess : colors.onWarning} />
              <Text style={[styles.statusText, { color: ok ? colors.onSuccess : colors.onWarning }]}>
                {!meta ? 'Couldn’t check the connection.'
                  : !meta.configured ? 'Not set up yet — the Meta details aren’t on the server.'
                  : ok ? `Connected — ${meta.display_name || ''}${meta.display_name && meta.phone ? ' · ' : ''}${meta.phone || ''}`
                  : 'Set up, but Meta refused the connection — check the access token and phone number id.'}
              </Text>
            </View>
            {!ok && (
              <>
                <Text style={styles.body}>These go in backend/.env on the server (then restart the backend):</Text>
                {ENV_KEYS.map((k) => <Text key={k} style={[styles.listMeta, { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }]}>{k}</Text>)}

              </>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Webhook (for START / STOP replies)</Text>
            <Text style={styles.body}>
              In Meta for Developers › WhatsApp › Configuration › Webhook, set the callback URL below and the same verify
              token as META_WA_WEBHOOK_VERIFY_TOKEN, then subscribe to the “messages” field. Without it, people who send
              START to this number are never added.
            </Text>
            <Pressable onPress={() => copy(WEBHOOK_URL)} style={styles.linkBox} accessibilityRole="button" accessibilityLabel="Copy webhook URL" testID="broadcast-webhook-url">
              <Text style={[styles.linkText, styles.flex1]} numberOfLines={1}>{WEBHOOK_URL}</Text>
              <Ionicons name="copy-outline" size={16} color={colors.brandSecondary} />
            </Pressable>
          </View>

          {diag && (
            <View style={styles.card} testID="broadcast-diagnostics">
              <Text style={styles.cardTitle}>Diagnostics — are START messages arriving?</Text>
              {[
                { ok: diag.number?.ok === true, label: 'Number registered for the WhatsApp API',
                  bad: diag.number?.ok === false
                    ? `Meta says: ${[diag.number.platform_type && `platform ${diag.number.platform_type}`, diag.number.status && `status ${diag.number.status}`].filter(Boolean).join(', ') || 'not registered'}. Messages sent to the number don’t reach the API until it’s registered.`
                    : `Couldn’t check${diag.number?.error ? `: ${diag.number.error}` : ''}` },
                { ok: diag.subscription.subscribed === true, label: 'Number linked to this Meta app',
                  bad: diag.subscription.subscribed === false ? 'Not linked — Meta sends no incoming messages until it is.' : `Couldn’t check${diag.subscription.error ? `: ${diag.subscription.error}` : ''}` },
                { ok: diag.app_secret_set, label: 'App secret on the server', bad: 'Missing — add META_WA_APP_SECRET (the App secret from App settings › Basic) and restart.' },
                { ok: diag.verify_token_set, label: 'Verify token on the server', bad: 'Missing — add META_WA_WEBHOOK_VERIFY_TOKEN and restart.' },
              ].map((c) => (
                <View key={c.label} style={[styles.row, { alignItems: 'flex-start' }]}>
                  <Ionicons name={c.ok ? 'checkmark-circle' : 'close-circle'} size={18} color={c.ok ? colors.onSuccess : colors.onError} />
                  <View style={styles.flex1}>
                    <Text style={styles.label}>{c.label}</Text>
                    {!c.ok && <Text style={styles.hint}>{c.bad}</Text>}
                  </View>
                </View>
              ))}
              {diag.number?.ok === false && (
                <View style={{ gap: 6 }}>
                  <Text style={styles.hint}>Enter the number’s 6-digit two-step verification PIN (WhatsApp Manager › Phone numbers › Two-step verification). If none was ever set, choose any 6 digits — it becomes the PIN.</Text>
                  <View style={styles.row}>
                    <TextInput value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" placeholder="6-digit PIN" placeholderTextColor={colors.mutedText} style={[styles.input, styles.flex1]} testID="broadcast-register-pin" />
                    <Pressable onPress={register} disabled={registering || pin.length !== 6} style={[styles.primary, { paddingHorizontal: 18 }, pin.length !== 6 && { opacity: 0.5 }]} accessibilityRole="button" testID="broadcast-register">
                      {registering ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Register</Text>}
                    </Pressable>
                  </View>
                </View>
              )}
              {(() => {
                const wc = diag.number?.webhook_configuration || {};
                const route = wc.phone_number || (diag.subscription.overrides || [])[0] || wc.whatsapp_business_account || wc.application;
                if (!route) return null;
                const here = !!diag.callback_url && route.replace(/\/$/, '') === diag.callback_url.replace(/\/$/, '');
                return (
                  <View style={[styles.row, { alignItems: 'flex-start' }]} testID="broadcast-route">
                    <Ionicons name={here ? 'checkmark-circle' : 'close-circle'} size={18} color={here ? colors.onSuccess : colors.onError} />
                    <View style={styles.flex1}>
                      <Text style={styles.label}>Where Meta sends this number’s messages</Text>
                      <Text style={styles.hint} numberOfLines={2}>{route}</Text>
                      {!here && <Text style={styles.hint}>That isn’t RMJ-One, so START never reaches the app. Tap below to send them here.</Text>}
                    </View>
                  </View>
                );
              })()}
              <Pressable onPress={() => linkApp(true)} disabled={linking} style={styles.btn} accessibilityRole="button" testID="broadcast-point-here">
                {linking ? <ActivityIndicator color={colors.brandSecondary} /> : <Text style={styles.btnText}>Re-link and send this number’s messages to RMJ-One</Text>}
              </Pressable>
              {relinkMsg && (
                <Text selectable style={[styles.hint, { color: relinkMsg.ok ? colors.onSuccess : colors.onError }]} testID="broadcast-relink-msg">{relinkMsg.text}</Text>
              )}
              {diag.subscription.apps.length > 0 && (
                <Text style={styles.hint}>Linked apps: {diag.subscription.apps.join(', ')}</Text>
              )}
              {diag.number && (diag.number.quality_rating || diag.number.messaging_limit_tier) ? (
                <Text style={styles.hint}>Quality: {diag.number.quality_rating || '—'} · Limit: {diag.number.messaging_limit_tier || '—'}{diag.number.account_mode ? ` · ${diag.number.account_mode}` : ''}</Text>
              ) : null}
              {diag.subscription.subscribed === false && (
                <Pressable onPress={() => linkApp(false)} disabled={linking} style={styles.primary} accessibilityRole="button" testID="broadcast-link-app">
                  {linking ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryText}>Link number to the app</Text>}
                </Pressable>
              )}
              <View style={styles.divider} />
              <Text style={styles.label}>Last messages from Meta</Text>
              {diag.hits.length === 0 ? (
                <Text style={styles.hint}>Nothing received from Meta yet. If you’ve sent START, Meta isn’t delivering — fix any red item above.</Text>
              ) : diag.hits.map((h, i) => (
                <View key={i} style={[styles.row, { alignItems: 'flex-start' }]}>
                  <Ionicons name={h.ok ? 'arrow-down-circle-outline' : 'alert-circle-outline'} size={16} color={h.ok ? colors.onSuccess : colors.onError} />
                  <Text style={[styles.listMeta, styles.flex1]}>
                    {new Date(h.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · {h.note}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Subscribe link</Text>
            <Text style={styles.body}>
              Opens WhatsApp to this number with START typed in — one tap and a customer is on the daily list. It’s the
              “Get the daily rate on WhatsApp” button on rmj.co.in; print it as a QR code for the counter.
            </Text>
            {link ? (
              <Pressable onPress={copyLink} style={styles.linkBox} accessibilityRole="button" accessibilityLabel="Copy subscribe link" testID="broadcast-subscribe-link">
                <Text style={[styles.linkText, styles.flex1]} numberOfLines={1}>{link}</Text>
                <Ionicons name="copy-outline" size={16} color={colors.brandSecondary} />
              </Pressable>
            ) : <Text style={styles.hint}>Appears once the number is connected.</Text>}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Send a test message</Text>
            <Text style={styles.hint}>Plain text only reaches a number that messaged the official number in the last 24 hours — send it “hi” from that phone first.</Text>
            <TextInput value={mobile} onChangeText={setMobile} keyboardType="phone-pad" placeholder="10-digit mobile" placeholderTextColor={colors.mutedText} style={styles.input} testID="broadcast-test-mobile" />
            <TextInput value={text} onChangeText={setText} multiline placeholder="Message" placeholderTextColor={colors.mutedText} style={[styles.input, { minHeight: 64 }]} testID="broadcast-test-text" />
            <Pressable onPress={sendTest} disabled={sending || !ok || !mobile.trim() || !text.trim()}
              style={[styles.btn, (!ok || !mobile.trim() || !text.trim()) && { opacity: 0.5 }]} testID="broadcast-test-send" accessibilityRole="button">
              {sending ? <ActivityIndicator color={colors.brandSecondary} /> : <Text style={styles.btnText}>Send test</Text>}
            </Pressable>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
