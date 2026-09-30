import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { istDate, todayIST } from '@/src/utils/datetime';
import { spacing, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { SegmentedControl } from '@/src/components/ui';
import { ModuleHeader, HeaderButton } from '@/src/components/ui/ModuleHeader';
import { HeaderSpacer, useScrolled } from '@/src/components/ui/StickyHeader';
import { Notif, NotifRow, notifTarget } from '@/src/components/notifications/NotifRow';

const DAY = 86400000;

/** Group label for a notification, iOS Notification Centre style. */
function groupOf(iso: string, today: string): string {
  const d = istDate(iso);
  if (d === today) return 'Today';
  const diff = Math.round((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${d}T00:00:00Z`).getTime()) / DAY);
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return 'This week';
  return 'Earlier';
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { scrolled, onScroll } = useScrolled();
  const [items, setItems] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const load = useCallback(async () => {
    try { setItems(await api.get<Notif[]>('/notifications')); }
    catch (_e) { setItems([]); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const unreadCount = items.filter((n) => !n.read).length;
  const today = todayIST();
  const groups = useMemo(() => {
    const out: { label: string; items: Notif[] }[] = [];
    for (const n of items) {
      if (filter === 'unread' && n.read) continue;
      const label = groupOf(n.created_at, today);
      const g = out[out.length - 1];
      if (g && g.label === label) g.items.push(n); else out.push({ label, items: [n] });
    }
    return out;
  }, [items, filter, today]);

  const openNotif = (n: Notif) => {
    if (!n.read) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      api.post(`/notifications/${n.id}/read`, {}).catch(() => {});
    }
    const to = notifTarget(n.url);
    if (to) router.push(to as any);
  };

  const markAllRead = async () => {
    if (unreadCount === 0) return;
    setMarkingAll(true);
    try {
      await api.post('/notifications/read-all', {});
      setItems((prev) => prev.map((x) => ({ ...x, read: true })));
    } catch (_e) { /* ignore */ }
    finally { setMarkingAll(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="notifications-screen">
      <ModuleHeader
        title="Notifications" backLabel="Home" scrolled={scrolled}
        subtitle={loading ? null : unreadCount ? `${unreadCount} unread` : 'All caught up'}
        actions={unreadCount > 0 ? (
          markingAll ? <ActivityIndicator color={colors.brandSecondary} />
            : <HeaderButton icon="checkmark-done" label="Mark all read" onPress={markAllRead} testID="mark-all-read-btn" tint={colors.brandSecondary} />
        ) : undefined}
      />
      <ScrollView onScroll={onScroll} scrollEventThrottle={16}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
      >
        <HeaderSpacer />
        <View style={{ marginTop: spacing.sm }}>
          <SegmentedControl
            options={[{ key: 'all', label: 'All' }, { key: 'unread', label: unreadCount ? `Unread (${unreadCount})` : 'Unread' }]}
            value={filter} onChange={(k) => setFilter(k as 'all' | 'unread')} testID="notif-filter"
          />
        </View>

        {loading ? (
          <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 60 }} />
        ) : groups.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}><Ionicons name={filter === 'unread' ? 'checkmark-done' : 'notifications-outline'} size={30} color={colors.brandSecondary} /></View>
            <Text style={styles.emptyTitle}>{filter === 'unread' ? 'All caught up' : 'No notifications yet'}</Text>
            <Text style={styles.emptyText}>{filter === 'unread' ? 'You’ve read everything.' : 'Alerts about repairs, stock, cash and your team will show up here.'}</Text>
            {filter === 'unread' && items.length > 0 && (
              <Pressable onPress={() => setFilter('all')} hitSlop={8}><Text style={styles.emptyLink}>Show all</Text></Pressable>
            )}
          </View>
        ) : groups.map((g) => (
          <View key={g.label}>
            <Text style={styles.groupTitle}>{g.label}</Text>
            <View style={styles.card}>
              {g.items.map((n, i) => <NotifRow key={n.id} n={n} first={i === 0} onPress={() => openNotif(n)} testID={`notif-${n.id}`} />)}
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  groupTitle: { color: colors.onSurface, fontSize: 20, fontWeight: '800', letterSpacing: -0.3, marginTop: 22, marginBottom: 8, marginHorizontal: 4 },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: 18, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: spacing.xl, gap: 6 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  emptyTitle: { color: colors.onSurface, fontSize: 18, fontWeight: '700' },
  emptyText: { color: colors.mutedText, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  emptyLink: { color: colors.brandSecondary, fontSize: 15, fontWeight: '600', marginTop: 10 },
});
