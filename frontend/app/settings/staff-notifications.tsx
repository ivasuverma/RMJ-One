import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { istDisplayDate } from '@/src/utils/datetime';
import { spacing, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { SegmentedControl, useToast } from '@/src/components/ui';
import { ModuleHeader } from '@/src/components/ui/ModuleHeader';
import { HeaderSpacer, useScrolled } from '@/src/components/ui/StickyHeader';

type Row = { id: string; name: string; designation: string; photo: string; devices: number; since: string | null; nudged_at: string | null };

// Who on the team can get push notifications. "Off" means none of their phones is
// subscribed (a phone that stops accepting pushes is dropped automatically). Remind
// brings the "Turn on notifications" banner back on their Home, even if they closed it.
export default function StaffNotificationsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const { scrolled, onScroll } = useScrolled();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [filter, setFilter] = useState<'off' | 'on'>('off');
  const [busy, setBusy] = useState<string | null>(null);   // employee id, or 'all'
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setRows((await api.get<{ staff: Row[] }>('/notifications/staff-status')).staff); }
    catch { setRows((r) => r || []); }
    finally { setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const off = (rows || []).filter((r) => !r.devices);
  const on = (rows || []).filter((r) => r.devices);
  const shown = filter === 'off' ? off : on;

  const remind = async (ids: string[] | null) => {
    setBusy(ids && ids.length === 1 ? ids[0] : 'all');
    try {
      const r = await api.post<{ reminded: number; at: string }>('/notifications/staff-nudge', { employee_ids: ids });
      setRows((prev) => (prev || []).map((x) => (ids === null ? !x.devices : ids.includes(x.id)) ? { ...x, nudged_at: r.at } : x));
      toast.success(r.reminded === 1 ? 'Reminder shown on their Home' : `Reminder shown on ${r.reminded} people's Home`);
    } catch (e: any) { toast.error(e?.detail || 'Could not send the reminder'); }
    finally { setBusy(null); }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="staff-notifications-screen">
      <ModuleHeader title="Staff notifications" backLabel="Settings" scrolled={scrolled}
        subtitle={rows ? (off.length ? `${off.length} of ${rows.length} haven't turned them on` : `All ${rows.length} have them on`) : null} />
      <ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}>
        <HeaderSpacer />
        <View style={{ marginTop: spacing.sm }}>
          <SegmentedControl options={[{ key: 'off', label: `Off (${off.length})` }, { key: 'on', label: `On (${on.length})` }]}
            value={filter} onChange={(k) => setFilter(k as 'off' | 'on')} testID="staff-notif-filter" />
        </View>

        {!rows ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 60 }} /> : shown.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}><Ionicons name={filter === 'off' ? 'checkmark-done' : 'notifications-off-outline'} size={28} color={colors.brandSecondary} /></View>
            <Text style={styles.emptyTitle}>{filter === 'off' ? 'Everyone is set up' : 'No one yet'}</Text>
            <Text style={styles.emptyText}>{filter === 'off' ? 'Every active employee can get notifications on at least one phone.' : 'No one has turned on notifications yet.'}</Text>
          </View>
        ) : (
          <>
            {filter === 'off' && (
              <Text style={styles.note}>They won&apos;t get alerts for tasks, repairs, leave or attendance until they turn notifications on. Remind shows the setup steps on their Home again.</Text>
            )}
            <View style={styles.card}>
              {shown.map((r, i) => (
                <View key={r.id} style={[styles.row, i > 0 && styles.sep]} testID={`staff-notif-${r.id}`}>
                  {r.photo ? <Image source={{ uri: r.photo }} style={styles.av} /> : (
                    <View style={[styles.av, styles.avEmpty]}><Text style={styles.avText}>{initials(r.name)}</Text></View>
                  )}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.name} numberOfLines={1}>{r.name}</Text>
                    <Text style={styles.sub} numberOfLines={1}>
                      {r.devices
                        ? `${r.devices} device${r.devices === 1 ? '' : 's'}${r.since ? ` · since ${istDisplayDate(r.since)}` : ''}`
                        : r.nudged_at ? `Reminded ${istDisplayDate(r.nudged_at)}` : (r.designation || 'Not set up')}
                    </Text>
                  </View>
                  {r.devices ? (
                    <View style={styles.onPill}><Ionicons name="notifications" size={12} color={colors.onSuccess} /><Text style={styles.onText}>On</Text></View>
                  ) : (
                    <Pressable onPress={() => remind([r.id])} disabled={!!busy} style={[styles.remind, !!busy && { opacity: 0.6 }]} testID={`staff-notif-remind-${r.id}`}>
                      {busy === r.id ? <ActivityIndicator size="small" color={colors.brandSecondary} /> : <Text style={styles.remindText}>Remind</Text>}
                    </Pressable>
                  )}
                </View>
              ))}
            </View>
            {filter === 'off' && off.length > 1 && (
              <Pressable onPress={() => remind(null)} disabled={!!busy} style={[styles.all, !!busy && { opacity: 0.6 }]} testID="staff-notif-remind-all">
                {busy === 'all' ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.allText}>Remind all {off.length}</Text>}
              </Pressable>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function initials(name: string) { return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase(); }

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  note: { color: colors.mutedText, fontSize: 13, lineHeight: 19, marginTop: spacing.md, marginHorizontal: 4 },
  card: { marginTop: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: 18, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  sep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  av: { width: 38, height: 38, borderRadius: 19 },
  avEmpty: { backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  avText: { color: colors.onSurfaceSecondary, fontWeight: '700', fontSize: 13 },
  name: { color: colors.onSurface, fontSize: 15, fontWeight: '600' },
  sub: { color: colors.mutedText, fontSize: 12.5, marginTop: 1 },
  onPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.success, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  onText: { color: colors.onSuccess, fontSize: 12.5, fontWeight: '700' },
  remind: { backgroundColor: colors.brandTertiary, paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999, minWidth: 76, alignItems: 'center' },
  remindText: { color: colors.brandSecondary, fontSize: 13, fontWeight: '700' },
  all: { marginTop: spacing.md, backgroundColor: colors.brandPrimary, borderRadius: 14, paddingVertical: 13, alignItems: 'center' },
  allText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: '700' },
  empty: { alignItems: 'center', paddingTop: 70, paddingHorizontal: spacing.xl, gap: 6 },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  emptyTitle: { color: colors.onSurface, fontSize: 18, fontWeight: '700' },
  emptyText: { color: colors.mutedText, fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
