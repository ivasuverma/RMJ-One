import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';
import { ToggleSwitch } from '@/src/components/ui/ToggleSwitch';
import { GlassButton } from '@/src/components/ui/GlassButton';

// Settings › General Notifications: alerts that go straight to one person about
// their own work or money (an employee, an in-house karigar, a customer).
// Each has its own Push and WhatsApp switch, for the whole shop.
type Alert = { key: string; group: string; label: string; to: string; push: boolean | null; whatsapp: boolean | null };
type Channel = 'push' | 'whatsapp';

export default function GeneralNotificationsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const [alerts, setAlerts] = useState<Alert[] | null>(null);

  const load = useCallback(async () => {
    try { setAlerts((await api.get<{ alerts: Alert[] }>('/settings/general-alerts')).alerts); }
    catch (e: any) { setAlerts([]); toast.error(e?.detail || 'Could not load'); }
  }, [toast]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Saves straight away; rolls back if the save fails.
  const flip = async (a: Alert, ch: Channel) => {
    const on = !a[ch];
    const prev = alerts;
    setAlerts((list) => list && list.map((x) => (x.key === a.key ? { ...x, [ch]: on } : x)));
    try { setAlerts((await api.put<{ alerts: Alert[] }>('/settings/general-alerts', { key: a.key, channel: ch, on })).alerts); }
    catch (e: any) { setAlerts(prev); toast.error(e?.detail || 'Could not save'); }
  };

  const groups = useMemo(() => {
    const g: { name: string; items: Alert[] }[] = [];
    for (const a of alerts || []) {
      const last = g[g.length - 1];
      if (last && last.name === a.group) last.items.push(a); else g.push({ name: a.group, items: [a] });
    }
    return g;
  }, [alerts]);

  const Switch = ({ a, ch }: { a: Alert; ch: Channel }) => (
    <View style={styles.col}>
      {a[ch] === null ? <Text style={styles.na}>—</Text> : (
        <Pressable onPress={() => flip(a, ch)} hitSlop={6} accessibilityRole="switch" accessibilityState={{ checked: !!a[ch] }}
          accessibilityLabel={`${a.label} by ${ch === 'push' ? 'push' : 'WhatsApp'}`} testID={`ga-${a.key}-${ch}`}>
          <ToggleSwitch value={!!a[ch]} />
        </Pressable>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="general-notifications-screen">
      <View style={styles.header}>
        <GlassButton onPress={() => router.back()} style={styles.iconBtn} hitSlop={12} testID="back-btn" accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </GlassButton>
        <Text style={styles.title}>General Notifications</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
        <Text style={styles.note}>
          Alerts sent straight to the person concerned. Off here stops it for everyone. Someone who has turned their own notifications off in Users won&apos;t get these either. Either way the alert still shows in their in-app list.{'\n\n'}Staff alerts (check-ins, new repairs, cash) and each employee&apos;s attendance alerts are set per person in Users — they are different alerts, so nothing is sent twice.
        </Text>
        {!alerts ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 40 }} /> : groups.map((g) => (
          <View key={g.name} style={{ marginTop: spacing.lg }}>
            <View style={styles.groupHead}>
              <Text style={styles.groupTitle}>{g.name}</Text>
              <Text style={styles.colHead}>Push</Text>
              <Text style={styles.colHead}>WhatsApp</Text>
            </View>
            <View style={styles.card}>
              {g.items.map((a, i) => (
                <View key={a.key} style={[styles.row, i > 0 && styles.sep]} testID={`ga-row-${a.key}`}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.label}>{a.label}</Text>
                    <Text style={styles.to}>To: {a.to}</Text>
                  </View>
                  <Switch a={a} ch="push" />
                  <Switch a={a} ch="whatsapp" />
                </View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const COL = 76;
const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '700', fontFamily: fonts.display },
  note: { color: colors.mutedText, fontSize: 13, lineHeight: 19 },
  groupHead: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 14, marginBottom: 6 },
  groupTitle: { flex: 1, color: colors.mutedText, fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  colHead: { width: COL, textAlign: 'center', color: colors.mutedText, fontSize: 11.5, fontWeight: '700' },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  sep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  label: { color: colors.onSurface, fontSize: 14.5, fontWeight: '600' },
  to: { color: colors.mutedText, fontSize: 12, marginTop: 2 },
  col: { width: COL, alignItems: 'center' },
  na: { color: colors.mutedText, fontSize: 15 },
});
