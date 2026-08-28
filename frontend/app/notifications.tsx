import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { istDisplayDate } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Notif = { id: string; title: string; body: string; url: string; read: boolean; created_at: string };

function timeAgo(iso: string) {
  // Relative buckets diff two absolute instants, so they're timezone-agnostic
  // — only the >=7-day fallback needs an IST-correct absolute date.
  const then = new Date(iso).getTime();
  const diffMin = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return istDisplayDate(iso);
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await api.get<Notif[]>('/notifications')); }
    catch (_e) { setItems([]); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const unreadCount = items.filter((n) => !n.read).length;

  const openNotif = async (n: Notif) => {
    if (!n.read) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      api.post(`/notifications/${n.id}/read`, {}).catch(() => {});
    }
    // Older notifications were saved pointing at the deprecated Transactions
    // tab; send those to the live Repairs list instead.
    let url = n.url;
    if (url === '/(tabs)/transactions' || url === '/(emp)/transactions') url = '/repairs';
    if (url && url !== '/') router.push(url as any);
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
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Notifications</Text>
        <Pressable onPress={markAllRead} disabled={markingAll || unreadCount === 0} style={styles.markAllBtn} testID="mark-all-read-btn">
          {markingAll ? <ActivityIndicator size="small" color={colors.onSurfaceSecondary} /> : <Text style={[styles.markAllText, unreadCount === 0 && { opacity: 0.4 }]}>Mark all read</Text>}
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
      >
        {loading ? (
          <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 40 }} />
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="notifications-off-outline" size={36} color={colors.mutedText} />
            <Text style={styles.emptyText}>Nothing here yet</Text>
          </View>
        ) : items.map((n) => (
          <Pressable key={n.id} onPress={() => openNotif(n)} style={[styles.row, !n.read && styles.rowUnread]} testID={`notif-${n.id}`}>
            {!n.read && <View style={styles.unreadDot} />}
            <View style={styles.iconBox}>
              <Ionicons name="notifications-outline" size={16} color={colors.brandSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.notifTitle}>{n.title}</Text>
              <Text style={styles.notifBody} numberOfLines={2}>{n.body}</Text>
              <Text style={styles.notifTime}>{timeAgo(n.created_at)}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '600', fontFamily: fonts.display },
  markAllBtn: { paddingHorizontal: 4, paddingVertical: 8 },
  markAllText: { color: colors.brandSecondary, fontSize: 12, fontWeight: '700' },

  empty: { alignItems: 'center', paddingVertical: 60, gap: spacing.sm },
  emptyText: { color: colors.onSurfaceTertiary },
  row: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  rowUnread: { borderColor: colors.brand, backgroundColor: colors.brandTertiary },
  unreadDot: {
    width: 12, height: 12, borderRadius: 6, backgroundColor: colors.error, marginTop: 4,
    borderWidth: 2, borderColor: colors.surface,
    shadowColor: colors.error, shadowOpacity: 0.6, shadowRadius: 4, shadowOffset: { width: 0, height: 0 }, elevation: 3,
  },
  iconBox: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  notifTitle: { color: colors.onSurface, fontWeight: '700', fontSize: 13 },
  notifBody: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  notifTime: { color: colors.mutedText, fontSize: 10, marginTop: 4 },
});
