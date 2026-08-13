import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api, TOKEN_KEY } from '@/src/api/client';
import { storage } from '@/src/utils/storage';
import { REPAIR_STATUS_LABEL, repairStatusColors } from '@/src/utils/repairStatus';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Order = { id: string; order_no: string; customer_name: string; customer_mobile: string; created_at: string; created_by: string; status: string };
type Item = {
  id: string; item_code: string; description: string; repair_type: string;
  gross_weight: number; pc_count: number; labour_charge: number; needs_karigar: boolean;
  due_date: string | null; status: 'received' | 'with_karigar' | 'ready' | 'delivered'; karigar_name: string | null;
  created_by?: string; updated_by?: string;
};

export default function RepairOrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [order, setOrder] = useState<Order | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ order: Order; items: Item[] }>(`/repair-orders/${id}`);
      setOrder(res.order); setItems(res.items);
    } catch (_e) { /* ignore */ }
    finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const printSlip = async () => {
    setPrinting(true);
    try {
      const base = process.env.EXPO_PUBLIC_BACKEND_URL || '';
      const url = `${base}/api/repair-orders/${id}/slip/pdf`;
      const token = (await storage.secureGet<string>(TOKEN_KEY, '')) || '';
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Slip failed (${res.status})`);
      if (Platform.OS === 'web') {
        const blob = await res.blob();
        window.open(URL.createObjectURL(blob), '_blank');
      } else {
        Alert.alert('Slip generated', 'PDF preview is available on the web app.');
      }
    } catch (e: any) { Alert.alert('Failed', e?.message || 'Please try again'); }
    finally { setPrinting(false); }
  };

  const [thermalPrinting, setThermalPrinting] = useState(false);
  // Sends the customer intake receipt straight to the WiFi thermal printer
  // configured in Store Settings (raw ESC/POS over TCP).
  const printThermal = async () => {
    setThermalPrinting(true);
    try {
      await api.post(`/repair-orders/${id}/slip/print`, {});
    } catch (e: any) { Alert.alert('Print failed', e?.detail || 'Could not reach the printer. Check Store Settings.'); }
    finally { setThermalPrinting(false); }
  };

  if (loading || !order) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }} />
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="repair-order-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{order.order_no}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <View style={styles.card}>
          <MetaRow icon="person-outline" label="Customer" value={order.customer_name} colors={colors} />
          <MetaRow icon="call-outline" label="Mobile" value={order.customer_mobile || '—'} colors={colors} />
          <MetaRow icon="calendar-outline" label="Received" value={order.created_at?.slice(0, 10)} colors={colors} />
          <MetaRow icon="person-circle-outline" label="Taken by" value={order.created_by} colors={colors} />
        </View>

        <View style={styles.printRow}>
          <Pressable onPress={printThermal} disabled={thermalPrinting} style={[styles.printBtn, { flex: 1 }, thermalPrinting && { opacity: 0.6 }]} testID="print-slip-btn">
            {thermalPrinting ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><Ionicons name="print-outline" size={16} color={colors.onBrandPrimary} /><Text style={styles.printBtnText}>Print Receipt</Text></>}
          </Pressable>
          <Pressable onPress={printSlip} disabled={printing} style={[styles.pdfBtn, printing && { opacity: 0.6 }]} testID="print-slip-pdf-btn">
            {printing ? <ActivityIndicator color={colors.onSurfaceSecondary} /> : <><Ionicons name="document-text-outline" size={16} color={colors.onSurfaceSecondary} /><Text style={styles.pdfBtnText}>PDF</Text></>}
          </Pressable>
        </View>

        <Text style={styles.section}>Items · {items.length}</Text>
        {items.map((i) => {
          const sc = repairStatusColors(i.status, colors);
          return (
            <Pressable key={i.id} onPress={() => router.push(`/repairs/item/${i.id}` as any)} style={styles.itemRow} testID={`item-${i.id}`}>
              <View style={styles.iconBox}><Ionicons name="pricetag-outline" size={18} color={colors.brandSecondary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cName}>{i.item_code} · {i.description}</Text>
                <Text style={styles.cMeta}>{i.gross_weight.toFixed(3)}g · {i.pc_count} pc{i.pc_count === 1 ? '' : 's'}{i.karigar_name ? ` · ${i.karigar_name}` : ''}</Text>
                {i.created_by && <Text style={styles.cMeta}>By {i.created_by}</Text>}
              </View>
              <View style={[styles.statusBadge, { backgroundColor: sc.bg, borderColor: sc.border }]}>
                <Text style={[styles.statusText, { color: sc.fg }]}>{REPAIR_STATUS_LABEL[i.status]}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.mutedText} />
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

function MetaRow({ icon, label, value, colors }: { icon: any; label: string; value: string; colors: ThemeColors }) {
  const styles = makeStyles(colors);
  return (
    <View style={styles.metaRow}>
      <Ionicons name={icon} size={16} color={colors.brandSecondary} />
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  title: { flex: 1, color: colors.onSurface, fontSize: 18, fontWeight: '600', fontFamily: fonts.display },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.lg, overflow: 'hidden' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider },
  metaLabel: { color: colors.mutedText, fontSize: 12, width: 80 },
  metaValue: { flex: 1, color: colors.onSurface, fontSize: 13, fontWeight: '600' },

  printRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },
  printBtn: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 13,
  },
  printBtnText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 13 },
  pdfBtn: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingVertical: 13, paddingHorizontal: spacing.md,
  },
  pdfBtnText: { color: colors.onSurfaceSecondary, fontWeight: '700', fontSize: 13 },

  section: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm },
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
  statusText: { fontSize: 9, fontWeight: '700', color: colors.onSurface, textTransform: 'uppercase' },
});
