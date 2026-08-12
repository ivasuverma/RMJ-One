import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Platform, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api, TOKEN_KEY } from '@/src/api/client';
import { storage } from '@/src/utils/storage';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Item = {
  id: string; item_code: string; customer_name: string; description: string;
  status: 'received' | 'with_karigar' | 'ready'; karigar_name: string | null;
  gross_weight: number; due_date: string | null; created_at: string;
};

const STATUS_LABEL: Record<string, string> = { received: 'Received', with_karigar: 'With Karigar', ready: 'Ready' };

function daysPending(createdAt: string) {
  const start = new Date(createdAt?.slice(0, 10));
  const now = new Date();
  return Math.max(0, Math.round((now.getTime() - start.getTime()) / 86400000));
}

export default function OutstandingRepairsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<Item[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [printing, setPrinting] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await api.get<Item[]>('/repair-items')); }
    catch (_e) { setItems([]); }
    finally { setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const printReport = async () => {
    setPrinting(true);
    try {
      const base = process.env.EXPO_PUBLIC_BACKEND_URL || '';
      const url = `${base}/api/reports/repairs_outstanding/pdf`;
      const token = (await storage.secureGet<string>(TOKEN_KEY, '')) || '';
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Report failed (${res.status})`);
      if (Platform.OS === 'web') {
        const blob = await res.blob();
        window.open(URL.createObjectURL(blob), '_blank');
      } else {
        Alert.alert('Report generated', 'PDF preview is available on the web app.');
      }
    } catch (e: any) { Alert.alert('Failed', e?.message || 'Please try again'); }
    finally { setPrinting(false); }
  };

  const overdue = items.filter((i) => i.due_date && i.due_date < new Date().toISOString().slice(0, 10));

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="outstanding-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Outstanding Repairs</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
      >
        <View style={styles.summaryRow}>
          <View style={styles.summaryTile}>
            <Text style={styles.summaryValue}>{items.length}</Text>
            <Text style={styles.summaryLabel}>Not delivered</Text>
          </View>
          <View style={styles.summaryTile}>
            <Text style={[styles.summaryValue, overdue.length > 0 && { color: colors.onWarning }]}>{overdue.length}</Text>
            <Text style={styles.summaryLabel}>Past due date</Text>
          </View>
        </View>

        <Pressable onPress={printReport} disabled={printing} style={[styles.printBtn, printing && { opacity: 0.6 }]} testID="print-outstanding-btn">
          {printing ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><Ionicons name="print-outline" size={16} color={colors.onBrandPrimary} /><Text style={styles.printBtnText}>Print Report</Text></>}
        </Pressable>

        {items.length === 0 ? (
          <View style={styles.empty}><Ionicons name="checkmark-done-outline" size={36} color={colors.mutedText} /><Text style={styles.emptyText}>Nothing outstanding — all caught up</Text></View>
        ) : items.map((i) => {
          const dp = daysPending(i.created_at);
          const isOverdue = !!i.due_date && i.due_date < new Date().toISOString().slice(0, 10);
          return (
            <Pressable key={i.id} onPress={() => router.push(`/repairs/item/${i.id}` as any)} style={styles.itemRow} testID={`outstanding-${i.id}`}>
              <View style={styles.iconBox}><Ionicons name="pricetag-outline" size={18} color={colors.brandSecondary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cName}>{i.item_code} · {i.customer_name}</Text>
                <Text style={styles.cMeta}>{i.description} · {i.gross_weight.toFixed(3)}g{i.karigar_name ? ` · ${i.karigar_name}` : ''} · {dp}d pending</Text>
              </View>
              <View style={[styles.statusBadge, isOverdue ? styles.statusOverdue : styles.statusOpen]}>
                <Text style={styles.statusText}>{isOverdue ? 'Overdue' : STATUS_LABEL[i.status] || i.status}</Text>
              </View>
            </Pressable>
          );
        })}
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
  title: { flex: 1, color: colors.onSurface, fontSize: 18, fontWeight: '600', fontFamily: fonts.display },

  summaryRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  summaryTile: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center' },
  summaryValue: { color: colors.onSurface, fontSize: 22, fontWeight: '700' },
  summaryLabel: { color: colors.mutedText, fontSize: 11, marginTop: 4, textAlign: 'center' },

  printBtn: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 13, marginBottom: spacing.lg,
  },
  printBtnText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 13 },

  empty: { alignItems: 'center', paddingVertical: 40, gap: spacing.sm },
  emptyText: { color: colors.onSurfaceTertiary, textAlign: 'center' },
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  iconBox: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand,
  },
  cName: { color: colors.onSurface, fontWeight: '700', fontSize: 13 },
  cMeta: { color: colors.onSurfaceTertiary, fontSize: 11, marginTop: 2 },
  statusBadge: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1 },
  statusOpen: { backgroundColor: colors.surfaceTertiary, borderColor: colors.border },
  statusOverdue: { backgroundColor: colors.error, borderColor: colors.onError },
  statusText: { fontSize: 9, fontWeight: '700', color: colors.onSurface, textTransform: 'uppercase' },
});
