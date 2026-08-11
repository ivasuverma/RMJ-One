import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, RefreshControl, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { colors, spacing, radius, fonts } from '@/src/theme';

type Log = {
  id: string; actor_name: string; actor_role: string; action: string;
  entity_type: string; entity_id: string; entity_label: string;
  details: any; created_at: string;
};

const ICON: Record<string, any> = {
  attendance: 'time-outline', correction: 'create-outline', payroll_entry: 'cash-outline',
  employee: 'person-outline', leave: 'calendar-outline', user: 'people-outline',
};

const fmtWhen = (iso: string) => {
  try { return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
};

export default function AuditLogsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await api.get<Log[]>('/audit/logs?limit=200')); }
    catch (_e) { setItems([]); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="audit-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Audit Logs</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.brandPrimary} size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
          showsVerticalScrollIndicator={false}
        >
          {items.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="shield-checkmark-outline" size={44} color={colors.mutedText} />
              <Text style={styles.emptyText}>No audit events yet</Text>
            </View>
          ) : items.map((l) => (
            <View key={l.id} style={styles.row} testID={`audit-${l.id}`}>
              <View style={styles.rowIcon}>
                <Ionicons name={ICON[l.entity_type] || 'ellipse-outline'} size={16} color={colors.brandSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.action}>{l.action}</Text>
                <Text style={styles.meta}>
                  <Text style={{ color: colors.onSurface }}>{l.actor_name}</Text>
                  <Text> · {l.actor_role.toUpperCase()} · {l.entity_type}</Text>
                </Text>
                {!!l.entity_label && <Text style={styles.entity}>{l.entity_label}</Text>}
              </View>
              <Text style={styles.when}>{fmtWhen(l.created_at)}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
  row: {
    flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start',
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  rowIcon: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand,
  },
  action: { color: colors.brandSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 0.4 },
  meta: { color: colors.onSurfaceTertiary, fontSize: 11, marginTop: 4 },
  entity: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  when: { color: colors.mutedText, fontSize: 10, marginLeft: spacing.sm },
  empty: { alignItems: 'center', paddingVertical: 60, gap: spacing.sm },
  emptyText: { color: colors.onSurfaceTertiary },
});
