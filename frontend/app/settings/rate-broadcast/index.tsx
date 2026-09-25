import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';
import { Header, makeStyles, MetaStatus, Overview, SHORT_DAYS, num, templateLine } from './_shared';

type Step = { key: string; n: number; title: string; sub: string; ok: boolean; route: string; icon: keyof typeof Ionicons.glyphMap };

// Rate Broadcast hub — the four parts in the order they're set up: the
// official number, the message template, the people, then sending. Each
// opens its own screen; every other WhatsApp message stays on OpenWA
// (Settings › WhatsApp).
export default function RateBroadcastHub() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const hub = useMemo(() => hubStyles(colors), [colors]);
  const toast = useToast();
  const [ov, setOv] = useState<Overview | null>(null);
  const [meta, setMeta] = useState<MetaStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [o, m] = await Promise.all([
        api.get<Overview>('/rate-broadcast/overview'),
        api.get<MetaStatus>('/settings/whatsapp-meta').catch(() => null),
      ]);
      setOv(o); setMeta(m);
    } catch (e: any) { toast.error(e?.detail || 'Could not load'); }
    finally { setRefreshing(false); }
  }, [toast]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!ov) {
    return (
      <SafeAreaView style={styles.root} edges={['top']} testID="rate-broadcast-screen">
        <Header title="Rate Broadcast" colors={colors} />
        <View style={styles.centered}><ActivityIndicator color={colors.brandPrimary} /></View>
      </SafeAreaView>
    );
  }

  const s = ov.settings;
  const schedule = [
    s.weekly_enabled ? `Weekly: ${SHORT_DAYS[s.weekday]} ${s.time}` : 'Weekly: off',
    s.daily_enabled ? `Daily: ${s.daily_time}` : 'Daily: off',
  ].join(' · ');
  const steps: Step[] = [
    {
      key: 'number', n: 1, title: 'Official number', icon: 'shield-checkmark-outline', route: '/settings/rate-broadcast/number',
      ok: !!meta?.connected,
      sub: !meta ? 'Checking…' : !meta.configured ? 'Not set up yet' : meta.connected ? `Connected · ${meta.display_name || meta.phone}` : 'Set up, but not connecting — open to check',
    },
    {
      key: 'templates', n: 2, title: 'Templates', icon: 'document-text-outline', route: '/settings/rate-broadcast/templates',
      ok: ov.template.status === 'APPROVED', sub: `Rate update · ${templateLine(ov)}${ov.my_templates ? ` · ${num(ov.my_templates)} of your own` : ''}`,
    },
    {
      key: 'people', n: 3, title: 'People', icon: 'people-outline', route: '/settings/rate-broadcast/people',
      ok: ov.counts.weekly + ov.counts.daily > 0,
      sub: `${num(ov.counts.weekly)} customers · ${num(ov.counts.daily)} daily · ${num(ov.counts.opted_out)} stopped${ov.my_lists ? ` · ${num(ov.my_lists)} lists` : ''}`,
    },
    {
      key: 'send', n: 4, title: 'Send & schedule', icon: 'paper-plane-outline', route: '/settings/rate-broadcast/send',
      ok: s.weekly_enabled || s.daily_enabled,
      sub: ov.sending.length ? `Sending now · ${num(ov.sent_today)} sent today` : schedule,
    },
  ];

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="rate-broadcast-screen">
      <Header title="Rate Broadcast" colors={colors} />
      <ScrollView contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}>
        <Text style={styles.hint}>
          Rates and offers to customers on WhatsApp, from the official (Meta) number only — the shop’s OpenWA number is
          never used for these, so a big send can’t get it banned. Set up each part in order.
        </Text>

        {steps.map((st) => (
          <Pressable key={st.key} onPress={() => router.push(st.route as any)} style={hub.step} testID={`rate-broadcast-step-${st.key}`} accessibilityRole="button" accessibilityLabel={`${st.n}. ${st.title}. ${st.sub}`}>
            <View style={[hub.num, st.ok && hub.numOk]}>
              {st.ok ? <Ionicons name="checkmark" size={16} color={colors.onSuccess} /> : <Text style={hub.numText}>{st.n}</Text>}
            </View>
            <View style={styles.flex1}>
              <View style={styles.row}>
                <Ionicons name={st.icon} size={15} color={colors.brandSecondary} />
                <Text style={styles.label}>{st.title}</Text>
              </View>
              <Text style={[styles.listMeta, { marginTop: 3 }]} numberOfLines={2}>{st.sub}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
          </Pressable>
        ))}

        <Pressable onPress={() => router.push('/settings/whatsapp' as any)} hitSlop={6} style={{ marginTop: spacing.lg }} accessibilityRole="link">
          <Text style={styles.hint}>Repair notices, staff alerts, the chatbot and the rate channel use the shop’s number — Settings › WhatsApp.</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const hubStyles = (colors: ThemeColors) => StyleSheet.create({
  step: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md,
  },
  num: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  numOk: { backgroundColor: colors.success, borderColor: colors.success },
  numText: { color: colors.onSurfaceSecondary, fontWeight: '800', fontSize: 13 },
});
