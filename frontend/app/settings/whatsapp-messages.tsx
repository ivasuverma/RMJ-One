import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { istDisplayDateTime } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

// Separate from the generic Audit Log (settings/audit.tsx): that one records
// who changed what in the app; this one records every WhatsApp send attempt
// from either provider — OpenWA (the shop's live number) and the official
// Meta Cloud API (test line) — and its real delivery outcome, since a 200
// from either API doesn't guarantee the customer actually got it (see
// backend/whatsapp_meta.py's 24-hour-window note).
type Msg = {
  id: string; provider: 'openwa' | 'meta'; to: string; message_type: string;
  body: string; flow: string; success: boolean; error: string;
  wa_message_id: string | null; status: string | null; status_error?: string | null;
  created_at: string;
};

const FLOW_LABEL: Record<string, string> = {
  repair_ready_notice: 'Repair ready notice', repair_received_notice: 'Repair received notice',
  gold_rate_auto_send: 'Gold rate (auto)', gold_rate_manual_send: 'Gold rate (manual)',
  chatbot_reply_rate: 'Chatbot: RATE', chatbot_reply_status: 'Chatbot: STATUS',
  meta_test_send: 'Meta test send',
};

const fmtWhen = (iso: string) => istDisplayDateTime(iso);

function outcomeOf(m: Msg): { label: string; tone: 'ok' | 'warn' | 'bad' } {
  if (!m.success) return { label: 'Send failed', tone: 'bad' };
  if (m.status === 'failed') return { label: 'Not delivered', tone: 'bad' };
  if (m.status === 'read') return { label: 'Read', tone: 'ok' };
  if (m.status === 'delivered') return { label: 'Delivered', tone: 'ok' };
  if (m.status === 'sent') return { label: 'Sent', tone: 'ok' };
  return { label: 'Sent (no status yet)', tone: 'warn' };
}

export default function WhatsAppMessagesScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<Msg[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [providerFilter, setProviderFilter] = useState<'' | 'openwa' | 'meta'>('');

  const load = useCallback(async (provider: '' | 'openwa' | 'meta') => {
    try {
      const q = provider ? `&provider=${provider}` : '';
      const res = await api.get<{ items: Msg[]; next_cursor: string | null }>(`/settings/whatsapp-messages?limit=200${q}`);
      setItems(res.items); setNextCursor(res.next_cursor);
    } catch (_e) { setItems([]); setNextCursor(null); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(providerFilter); }, [load, providerFilter]));

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const q = providerFilter ? `&provider=${providerFilter}` : '';
      const res = await api.get<{ items: Msg[]; next_cursor: string | null }>(`/settings/whatsapp-messages?limit=200&cursor=${encodeURIComponent(nextCursor)}${q}`);
      setItems((prev) => [...prev, ...res.items]);
      setNextCursor(res.next_cursor);
    } catch (_e) { /* keep what's already loaded */ }
    finally { setLoadingMore(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="whatsapp-messages-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>WhatsApp Messages</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.filterRow}>
        {(['', 'openwa', 'meta'] as const).map((p) => (
          <Pressable
            key={p || 'all'}
            onPress={() => setProviderFilter(p)}
            style={[styles.filterChip, providerFilter === p && styles.filterChipOn]}
            testID={`whatsapp-messages-filter-${p || 'all'}`}
          >
            <Text style={[styles.filterChipText, providerFilter === p && styles.filterChipTextOn]}>
              {p === '' ? 'All' : p === 'openwa' ? 'OpenWA' : 'Meta'}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.brandPrimary} size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(providerFilter); }} tintColor={colors.brandPrimary} />}
          showsVerticalScrollIndicator={false}
        >
          {items.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="logo-whatsapp" size={44} color={colors.mutedText} />
              <Text style={styles.emptyText}>No WhatsApp messages logged yet</Text>
            </View>
          ) : items.map((m) => {
            const outcome = outcomeOf(m);
            return (
              <View key={m.id} style={styles.row} testID={`whatsapp-message-${m.id}`}>
                <View style={[styles.rowIcon, m.provider === 'meta' && styles.rowIconMeta]}>
                  <Ionicons name="logo-whatsapp" size={16} color={colors.brandSecondary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.flow}>{FLOW_LABEL[m.flow] || m.flow || m.message_type}</Text>
                  <Text style={styles.meta}>
                    <Text style={{ color: colors.onSurface }}>{m.to}</Text>
                    <Text> · {m.provider === 'meta' ? 'Meta' : 'OpenWA'}</Text>
                  </Text>
                  {!!m.body && <Text style={styles.body} numberOfLines={2}>{m.body}</Text>}
                  {!m.success && !!m.error && <Text style={styles.errorText} numberOfLines={2}>{m.error}</Text>}
                  {m.success && m.status === 'failed' && !!m.status_error && <Text style={styles.errorText} numberOfLines={2}>{m.status_error}</Text>}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <View style={[styles.badge, outcome.tone === 'ok' && styles.badgeOk, outcome.tone === 'bad' && styles.badgeBad, outcome.tone === 'warn' && styles.badgeWarn]}>
                    <Text style={[styles.badgeText, outcome.tone === 'ok' && styles.badgeTextOk, outcome.tone === 'bad' && styles.badgeTextBad, outcome.tone === 'warn' && styles.badgeTextWarn]}>{outcome.label}</Text>
                  </View>
                  <Text style={styles.when}>{fmtWhen(m.created_at)}</Text>
                </View>
              </View>
            );
          })}
          {!!nextCursor && (
            <Pressable onPress={loadMore} disabled={loadingMore} style={styles.loadMoreBtn} testID="whatsapp-messages-load-more">
              {loadingMore ? <ActivityIndicator color={colors.brandPrimary} /> : <Text style={styles.loadMoreText}>Load older</Text>}
            </Pressable>
          )}
        </ScrollView>
      )}
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
  title: {
    flex: 1, color: colors.onSurface, fontSize: 22, fontWeight: '600',
    fontFamily: fonts.display,
  },
  filterRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  filterChip: {
    paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  filterChipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  filterChipText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600' },
  filterChipTextOn: { color: colors.onBrandPrimary },
  row: {
    flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start',
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  rowIcon: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand,
  },
  rowIconMeta: { backgroundColor: colors.surfaceTertiary },
  flow: { color: colors.brandSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 0.2 },
  meta: { color: colors.onSurfaceTertiary, fontSize: 11, marginTop: 4 },
  body: { color: colors.mutedText, fontSize: 11, marginTop: 4 },
  errorText: { color: colors.onError, fontSize: 11, marginTop: 4 },
  when: { color: colors.mutedText, fontSize: 10, marginTop: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
  badgeOk: { backgroundColor: colors.success },
  badgeBad: { backgroundColor: colors.error },
  badgeWarn: { backgroundColor: colors.warning },
  badgeText: { fontSize: 10, fontWeight: '700', color: colors.onSurfaceTertiary },
  badgeTextOk: { color: colors.onSuccess },
  badgeTextBad: { color: colors.onError },
  badgeTextWarn: { color: colors.onWarning },
  empty: { alignItems: 'center', paddingVertical: 60, gap: spacing.sm },
  emptyText: { color: colors.onSurfaceTertiary },
  loadMoreBtn: {
    alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.md,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary, marginTop: spacing.xs,
  },
  loadMoreText: { color: colors.brandSecondary, fontSize: 13, fontWeight: '700' },
});
