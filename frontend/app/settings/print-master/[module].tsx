import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { notify } from '@/src/utils/notify';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { MODULE_ORDER, type Templates, summarize } from './_shared';

// Template list within one module (e.g. Repairs: Intake Receipt, Item Tag,
// Bill/Quotation, Karigar Issue Challan) — tap a row to edit its fields,
// order, and text size.
export default function PrintMasterModuleScreen() {
  const router = useRouter();
  const { module } = useLocalSearchParams<{ module: string }>();
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

  const moduleLabel = MODULE_ORDER.find((m) => m.key === module)?.label || module;
  const rows = useMemo(
    () => Object.entries(templates).filter(([, t]) => t.module === module),
    [templates, module],
  );

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="print-master-module-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{moduleLabel}</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          {rows.length === 0 ? (
            <Text style={styles.empty}>No print formats registered for this module.</Text>
          ) : rows.map(([key, t]) => (
            <Pressable
              key={key} onPress={() => router.push({ pathname: '/settings/print-master/[module]/[template]' as any, params: { module: module as string, template: key } })}
              style={styles.card} testID={`print-template-${key}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{t.label}</Text>
                <Text style={styles.cardMeta}>{summarize(t)}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
            </Pressable>
          ))}
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
  empty: { color: colors.mutedText, fontSize: 13, textAlign: 'center', marginTop: spacing.xl },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 14, marginBottom: spacing.sm,
  },
  cardTitle: { color: colors.onSurface, fontSize: 14, fontWeight: '700' },
  cardMeta: { color: colors.mutedText, fontSize: 12, marginTop: 2 },
});
