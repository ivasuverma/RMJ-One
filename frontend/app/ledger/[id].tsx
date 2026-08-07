import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Platform, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { colors, spacing, radius } from '@/src/theme';

const fmtINR = (n: number) => `₹${(Math.abs(n) || 0).toLocaleString('en-IN')}`;
const fmtDate = (s?: string) => {
  if (!s) return '';
  try { return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return s; }
};

const ICON: Record<string, any> = {
  advance: 'cash-outline', bonus: 'gift-outline', fine: 'warning-outline',
  deduction: 'remove-circle-outline', salary: 'wallet-outline',
  joined: 'briefcase-outline', salary_revised: 'trending-up-outline',
  leave: 'calendar-outline', correction: 'create-outline', other: 'ellipse-outline',
};

export default function EmployeeLedger() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<{ entries: any[]; closing_balance: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.get<any>(`/ledger/${id}`)); }
    catch (_e) { setData({ entries: [], closing_balance: 0 }); }
    finally { setLoading(false); setRefreshing(false); }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="ledger-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Employee Ledger</Text>
        <Pressable
          onPress={() => router.push({ pathname: '/ledger/new', params: { emp: id } })}
          style={styles.addBtn}
          testID="add-ledger-entry-btn"
        >
          <Ionicons name="add" size={18} color={colors.onBrandPrimary} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.brandPrimary} size="large" /></View>
      ) : (
        <>
          <View style={styles.balanceCard}>
            <Text style={styles.balanceLabel}>CLOSING BALANCE</Text>
            <Text style={[styles.balanceValue, { color: (data?.closing_balance || 0) >= 0 ? colors.brandPrimary : '#F1A9A9' }]}>
              {(data?.closing_balance || 0) >= 0 ? '' : '- '}{fmtINR(data?.closing_balance || 0)}
            </Text>
            <Text style={styles.balanceHint}>Positive = employee is owed. Negative = employee owes.</Text>
          </View>

          <ScrollView
            contentContainerStyle={{ padding: spacing.lg, paddingBottom: 80 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
            showsVerticalScrollIndicator={false}
          >
            {(data?.entries || []).length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="book-outline" size={44} color={colors.mutedText} />
                <Text style={styles.emptyText}>No ledger entries yet</Text>
              </View>
            ) : (data?.entries || []).map((e: any) => (
              <View key={e.id} style={styles.row} testID={`ledger-${e.id}`}>
                <View style={styles.rowIcon}>
                  <Ionicons name={ICON[e.type] || 'ellipse-outline'} size={16} color={colors.brandSecondary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{e.title}</Text>
                  {!!e.description && <Text style={styles.rowDesc}>{e.description}</Text>}
                  <Text style={styles.rowDate}>{fmtDate(e.created_at)}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  {e.delta !== 0 ? (
                    <Text style={[styles.delta, { color: e.delta > 0 ? '#B7EFC5' : '#F1A9A9' }]}>
                      {e.delta > 0 ? '+' : '−'} {fmtINR(e.delta)}
                    </Text>
                  ) : <Text style={styles.deltaZero}>—</Text>}
                  <Text style={styles.balance}>{fmtINR(e.balance)}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
    fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }),
  },
  addBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
  },

  balanceCard: {
    margin: spacing.lg, marginBottom: 0, padding: spacing.lg,
    backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary, borderWidth: 1,
    borderRadius: radius.lg, alignItems: 'center',
  },
  balanceLabel: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1 },
  balanceValue: {
    fontSize: 34, fontWeight: '800', marginTop: 4,
    fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }),
  },
  balanceHint: { color: colors.onSurfaceTertiary, fontSize: 11, marginTop: spacing.sm, textAlign: 'center' },

  row: {
    flexDirection: 'row', gap: spacing.md, alignItems: 'center',
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  rowIcon: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand,
  },
  rowTitle: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  rowDesc: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  rowDate: { color: colors.mutedText, fontSize: 11, marginTop: 4 },
  delta: { fontSize: 13, fontWeight: '800' },
  deltaZero: { color: colors.mutedText, fontSize: 13 },
  balance: { color: colors.mutedText, fontSize: 11, marginTop: 2 },

  empty: { alignItems: 'center', paddingVertical: 60, gap: spacing.sm },
  emptyText: { color: colors.onSurfaceTertiary },
});
