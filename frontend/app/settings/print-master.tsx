import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, Switch } from 'react-native';
import { notify } from '@/src/utils/notify';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

// Per-template print config, stored on the `print_templates` settings doc
// (see backend/print_templates.py + routers/print_settings.py). Every
// receipt/challan the app prints (Repairs, Stock In/Out, Gold Loans) reads
// this at print time to decide which fields to show, how big the body text
// is, and whether the shop name heading appears.
type Field = { key: string; label: string };
type TemplateCfg = {
  label: string; fields: Field[];
  disabled_fields: string[]; font_size: 'normal' | 'large'; show_shop_name: boolean;
};
type Templates = Record<string, TemplateCfg>;

export default function PrintMasterScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [templates, setTemplates] = useState<Templates>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setTemplates(await api.get<Templates>('/settings/print-templates')); }
    catch (_e) { notify('Failed', 'Could not load print settings'); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const save = async (key: string, next: TemplateCfg) => {
    setTemplates((prev) => ({ ...prev, [key]: next })); // optimistic — reverted by load() below if the save fails
    setSavingKey(key);
    try {
      const saved = await api.put<TemplateCfg>(`/settings/print-templates/${key}`, {
        disabled_fields: next.disabled_fields, font_size: next.font_size, show_shop_name: next.show_shop_name,
      });
      setTemplates((prev) => ({ ...prev, [key]: saved }));
    } catch (e: any) { notify('Failed', e?.detail || 'Please try again'); await load(); }
    finally { setSavingKey(null); }
  };

  const toggleField = (key: string, fieldKey: string) => {
    const t = templates[key];
    if (!t) return;
    const has = t.disabled_fields.includes(fieldKey);
    save(key, { ...t, disabled_fields: has ? t.disabled_fields.filter((k) => k !== fieldKey) : [...t.disabled_fields, fieldKey] });
  };

  const setFontSize = (key: string, font_size: 'normal' | 'large') => {
    const t = templates[key];
    if (!t || t.font_size === font_size) return;
    save(key, { ...t, font_size });
  };

  const toggleShopName = (key: string) => {
    const t = templates[key];
    if (!t) return;
    save(key, { ...t, show_shop_name: !t.show_shop_name });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="print-master-screen">
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
            Control what shows on each printed receipt/challan — hide fields you don't need, make the text bigger, or drop the
            shop name. Changes save immediately and take effect on the next print.
          </Text>

          {Object.entries(templates).map(([key, t]) => {
            const isOpen = expanded === key;
            return (
              <View key={key} style={styles.card} testID={`print-template-${key}`}>
                <Pressable onPress={() => setExpanded(isOpen ? null : key)} style={styles.cardHeader} testID={`print-template-toggle-${key}`}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{t.label}</Text>
                    <Text style={styles.cardMeta}>
                      {t.disabled_fields.length > 0 ? `${t.disabled_fields.length} field(s) hidden` : 'All fields shown'}
                      {t.font_size === 'large' ? ' · Large text' : ''}
                      {!t.show_shop_name ? ' · Shop name hidden' : ''}
                    </Text>
                  </View>
                  {savingKey === key && <ActivityIndicator size="small" color={colors.brandPrimary} style={{ marginRight: spacing.sm }} />}
                  <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.mutedText} />
                </Pressable>

                {isOpen && (
                  <View style={styles.cardBody}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.sectionLabel}>Shop Name on Print</Text>
                      <Switch
                        value={t.show_shop_name} onValueChange={() => toggleShopName(key)}
                        trackColor={{ true: colors.brandPrimary, false: colors.border }} thumbColor={colors.surface}
                        testID={`print-shopname-${key}`}
                      />
                    </View>

                    <Text style={[styles.sectionLabel, { marginTop: spacing.md }]}>Text Size</Text>
                    <View style={styles.segment}>
                      {(['normal', 'large'] as const).map((sz) => (
                        <Pressable
                          key={sz} onPress={() => setFontSize(key, sz)}
                          style={[styles.segmentBtn, t.font_size === sz && styles.segmentBtnActive]}
                          testID={`print-fontsize-${key}-${sz}`}
                        >
                          <Text style={[styles.segmentText, t.font_size === sz && styles.segmentTextActive]}>
                            {sz === 'normal' ? 'Normal' : 'Large'}
                          </Text>
                        </Pressable>
                      ))}
                    </View>

                    <Text style={[styles.sectionLabel, { marginTop: spacing.md }]}>Fields</Text>
                    {t.fields.map((f) => {
                      const visible = !t.disabled_fields.includes(f.key);
                      return (
                        <Pressable key={f.key} onPress={() => toggleField(key, f.key)} style={styles.fieldRow} testID={`print-field-${key}-${f.key}`}>
                          <Ionicons name={visible ? 'checkbox' : 'square-outline'} size={20} color={visible ? colors.brandPrimary : colors.mutedText} />
                          <Text style={styles.fieldLabel}>{f.label}</Text>
                        </Pressable>
                      );
                    })}

                    {key === 'repair_bill' && (
                      <Text style={styles.footnote}>
                        Field toggles apply to the downloadable PDF. The WiFi-printer version uses a fixed table layout, so
                        only Shop Name and Text Size apply there.
                      </Text>
                    )}
                  </View>
                )}
              </View>
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
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    marginBottom: spacing.sm, overflow: 'hidden',
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 14 },
  cardTitle: { color: colors.onSurface, fontSize: 14, fontWeight: '700' },
  cardMeta: { color: colors.mutedText, fontSize: 12, marginTop: 2 },
  cardBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  segment: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginTop: spacing.xs, padding: 3 },
  segmentBtn: { flex: 1, paddingVertical: 8, borderRadius: radius.sm, alignItems: 'center' },
  segmentBtnActive: { backgroundColor: colors.brandPrimary },
  segmentText: { color: colors.mutedText, fontSize: 13, fontWeight: '600' },
  segmentTextActive: { color: colors.onBrandPrimary },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8 },
  fieldLabel: { color: colors.onSurface, fontSize: 13.5 },
  footnote: { color: colors.mutedText, fontSize: 11, lineHeight: 15, marginTop: spacing.sm, fontStyle: 'italic' },
});
