import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, TextInput, RefreshControl, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';
import { Header, makeStyles, MetaStatus } from './_shared';

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

  const load = useCallback(async () => {
    try {
      const [m, l] = await Promise.all([
        api.get<MetaStatus>('/settings/whatsapp-meta'),
        api.get<{ url: string | null }>('/public/rate-broadcast/subscribe').catch(() => ({ url: null })),
      ]);
      setMeta(m); setLink(l.url);
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
