import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { notify } from '@/src/utils/notify';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { MODULE_ORDER, MODULE_ICONS, type Templates } from './_shared';

// Print Master home — one card per module (Repairs, Stock In/Out, Gold
// Loan), each drilling into its own list of print templates. See
// backend/print_templates.py for the registry this mirrors.
export default function PrintMasterHomeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [templates, setTemplates] = useState<Templates>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setTemplates(await api.get<Templates>('/settings/print-templates')); }
    catch (_e) { notify('Failed', 'Could not load print settings'); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const byModule = useMemo(() => {
    const grouped: Record<string, { key: string; label: string; customized: boolean }[]> = {};
    for (const [key, t] of Object.entries(templates)) {
      const customized = t.disabled_fields.length > 0 || Object.keys(t.field_sizes).length > 0
        || t.field_order.length > 0 || t.font_size !== 10 || !t.show_shop_name;
      (grouped[t.module] ||= []).push({ key, label: t.label, customized });
    }
    return grouped;
  }, [templates]);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="print-master-home-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Print Master</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          <Text style={styles.hint}>
            Choose a module to customize its printed receipts/challans — which fields show, their order, text size, and
            whether the shop name appears.
          </Text>

          {MODULE_ORDER.map((m) => {
            const items = byModule[m.key] || [];
            const customizedCount = items.filter((i) => i.customized).length;
            return (
              <Pressable
                key={m.key} onPress={() => router.push({ pathname: '/settings/print-master/[module]' as any, params: { module: m.key } })}
                style={styles.card} testID={`print-module-${m.key}`}
              >
                <View style={styles.cardIcon}>
                  <Ionicons name={MODULE_ICONS[m.key]} size={20} color={colors.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{m.label}</Text>
                  <Text style={styles.cardMeta}>
                    {items.length} format{items.length === 1 ? '' : 's'}
                    {customizedCount > 0 ? ` · ${customizedCount} customized` : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
              </Pressable>
            );
          })}
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
  title: { flex: 1, color: colors.onSurface, fontSize: 18, fontWeight: '600', fontFamily: fonts.display, textAlign: 'center' },
  hint: { color: colors.mutedText, fontSize: 12, marginBottom: spacing.lg, lineHeight: 17 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 14, marginBottom: spacing.sm,
  },
  cardIcon: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  cardTitle: { color: colors.onSurface, fontSize: 15, fontWeight: '700' },
  cardMeta: { color: colors.mutedText, fontSize: 12, marginTop: 2 },
});
