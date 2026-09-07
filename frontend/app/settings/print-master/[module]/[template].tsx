import { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Switch, Platform } from 'react-native';
import { notify } from '@/src/utils/notify';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Templates, TemplateCfg, SAMPLE_VALUES, PREVIEW_HEADINGS, clampSize } from '../_shared';

// One field row in the editor — `size: null` means "use the template's
// overall Text Size above"; an explicit number is a per-field override.
type Row = { key: string; label: string; enabled: boolean; size: number | null };

export default function PrintMasterTemplateScreen() {
  const router = useRouter();
  const { template } = useLocalSearchParams<{ module: string; template: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<TemplateCfg | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [fontSize, setFontSize] = useState(10);
  const [showShopName, setShowShopName] = useState(true);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const all = await api.get<Templates>('/settings/print-templates');
      const t = all[template as string];
      if (!t) { notify('Not found', 'This print format no longer exists'); router.back(); return; }
      setMeta(t);
      const orderedKeys = t.field_order.length
        ? [...t.field_order, ...t.fields.map((f) => f.key).filter((k) => !t.field_order.includes(k))]
        : t.fields.map((f) => f.key);
      const labelOf: Record<string, string> = {};
      t.fields.forEach((f) => { labelOf[f.key] = f.label; });
      setRows(orderedKeys.map((k) => ({
        key: k, label: labelOf[k] ?? k, enabled: !t.disabled_fields.includes(k), size: t.field_sizes[k] ?? null,
      })));
      setFontSize(t.font_size);
      setShowShopName(t.show_shop_name);
    } catch (_e) { notify('Failed', 'Could not load print settings'); }
    finally { setLoading(false); }
  }, [template, router]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Debounced auto-save — reorder/resize taps can fire in quick bursts, so
  // this collapses a burst into one PUT instead of one per tap.
  const scheduleSave = useCallback((next: { rows: Row[]; fontSize: number; showShopName: boolean }) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaving(true);
    saveTimer.current = setTimeout(async () => {
      try {
        const field_sizes: Record<string, number> = {};
        next.rows.forEach((r) => { if (r.size != null) field_sizes[r.key] = r.size; });
        await api.put(`/settings/print-templates/${template}`, {
          disabled_fields: next.rows.filter((r) => !r.enabled).map((r) => r.key),
          font_size: next.fontSize,
          field_sizes,
          field_order: next.rows.map((r) => r.key),
          show_shop_name: next.showShopName,
        });
      } catch (e: any) { notify('Failed to save', e?.detail || 'Please try again'); await load(); }
      finally { setSaving(false); }
    }, 400);
  }, [template, load]);

  const updateRows = (mutator: (r: Row[]) => Row[]) => {
    setRows((prev) => {
      const next = mutator(prev);
      scheduleSave({ rows: next, fontSize, showShopName });
      return next;
    });
  };

  const toggleField = (key: string) => updateRows((prev) => prev.map((r) => (r.key === key ? { ...r, enabled: !r.enabled } : r)));

  const moveField = (index: number, dir: -1 | 1) => updateRows((prev) => {
    const target = index + dir;
    if (target < 0 || target >= prev.length) return prev;
    const next = [...prev];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });

  const resizeField = (key: string, delta: number) => updateRows((prev) => prev.map((r) => {
    if (r.key !== key) return r;
    return { ...r, size: clampSize((r.size ?? fontSize) + delta) };
  }));

  const resetFieldSize = (key: string) => updateRows((prev) => prev.map((r) => (r.key === key ? { ...r, size: null } : r)));

  const changeFontSize = (delta: number) => {
    const next = clampSize(fontSize + delta);
    setFontSize(next);
    scheduleSave({ rows, fontSize: next, showShopName });
  };

  const toggleShopName = () => {
    const next = !showShopName;
    setShowShopName(next);
    scheduleSave({ rows, fontSize, showShopName: next });
  };

  if (loading || !meta) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="print-master-template-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{meta.label}</Text>
        {saving ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : <View style={{ width: 22 }} />}
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionLabel}>Live Preview</Text>
        <View style={styles.previewPaper}>
          {showShopName && <Text style={[styles.previewShop, { fontSize: fontSize + 3 }]}>Ram Murti Jewellers</Text>}
          <Text style={[styles.previewMuted, { fontSize: Math.max(7, fontSize - 1) }]}>Mobile: 98765 43210</Text>
          <Text style={[styles.previewMuted, { fontSize }]}>{PREVIEW_HEADINGS[template as string] || meta.label}</Text>
          <View style={styles.previewDivider} />
          {rows.filter((r) => r.enabled).map((r) => (
            <Text key={r.key} style={[styles.previewLine, { fontSize: r.size ?? fontSize }]}>
              <Text style={styles.previewLabel}>{r.label.toUpperCase()}: </Text>
              {SAMPLE_VALUES[r.key] || '—'}
            </Text>
          ))}
          {rows.every((r) => !r.enabled) && <Text style={styles.previewMuted}>All fields hidden</Text>}
        </View>

        <View style={[styles.rowBetween, { marginTop: spacing.lg }]}>
          <Text style={styles.sectionLabel}>Shop Name on Print</Text>
          <Switch
            value={showShopName} onValueChange={toggleShopName}
            trackColor={{ true: colors.brandPrimary, false: colors.border }} thumbColor={colors.surface}
            testID="print-shopname"
          />
        </View>

        <Text style={[styles.sectionLabel, { marginTop: spacing.md }]}>Overall Text Size</Text>
        <View style={styles.stepper}>
          <Pressable onPress={() => changeFontSize(-1)} style={styles.stepBtn} testID="print-fontsize-minus" hitSlop={8}>
            <Ionicons name="remove" size={18} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.stepValue}>{fontSize}pt</Text>
          <Pressable onPress={() => changeFontSize(1)} style={styles.stepBtn} testID="print-fontsize-plus" hitSlop={8}>
            <Ionicons name="add" size={18} color={colors.onSurface} />
          </Pressable>
        </View>

        <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>Fields — order, visibility & size</Text>
        <Text style={styles.fieldsHint}>
          Tap a field to show/hide it. Use the arrows to reorder. Each field's size follows the overall Text Size above
          until you nudge it individually.
        </Text>
        {rows.map((r, i) => (
          <View key={r.key} style={[styles.fieldRow, !r.enabled && styles.fieldRowDisabled]} testID={`print-field-${r.key}`}>
            <Pressable onPress={() => toggleField(r.key)} style={styles.fieldCheck} hitSlop={8} testID={`print-field-toggle-${r.key}`}>
              <Ionicons name={r.enabled ? 'checkbox' : 'square-outline'} size={20} color={r.enabled ? colors.brandPrimary : colors.mutedText} />
            </Pressable>
            <Text style={[styles.fieldLabel, !r.enabled && { color: colors.mutedText }]} numberOfLines={1}>{r.label}</Text>
            <View style={styles.fieldSize}>
              <Pressable onPress={() => resizeField(r.key, -1)} style={styles.miniBtn} hitSlop={6} testID={`print-field-size-minus-${r.key}`}>
                <Ionicons name="remove" size={13} color={colors.onSurface} />
              </Pressable>
              <Text style={styles.miniValue}>{r.size ?? fontSize}</Text>
              <Pressable onPress={() => resizeField(r.key, 1)} style={styles.miniBtn} hitSlop={6} testID={`print-field-size-plus-${r.key}`}>
                <Ionicons name="add" size={13} color={colors.onSurface} />
              </Pressable>
              {r.size != null && (
                <Pressable onPress={() => resetFieldSize(r.key)} hitSlop={8} testID={`print-field-size-reset-${r.key}`}>
                  <Ionicons name="close-circle" size={15} color={colors.mutedText} style={{ marginLeft: 2 }} />
                </Pressable>
              )}
            </View>
            <View style={styles.reorderBtns}>
              <Pressable onPress={() => moveField(i, -1)} disabled={i === 0} style={[styles.miniBtn, i === 0 && styles.miniBtnDisabled]} hitSlop={6} testID={`print-field-up-${r.key}`}>
                <Ionicons name="chevron-up" size={14} color={colors.onSurface} />
              </Pressable>
              <Pressable onPress={() => moveField(i, 1)} disabled={i === rows.length - 1} style={[styles.miniBtn, i === rows.length - 1 && styles.miniBtnDisabled]} hitSlop={6} testID={`print-field-down-${r.key}`}>
                <Ionicons name="chevron-down" size={14} color={colors.onSurface} />
              </Pressable>
            </View>
          </View>
        ))}

        {template === 'repair_bill' && (
          <Text style={styles.footnote}>
            Field toggles/order/size apply to the downloadable PDF. The WiFi-printer version uses a fixed table layout, so
            only Shop Name and Overall Text Size apply there.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

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
  title: { flex: 1, color: colors.onSurface, fontSize: 17, fontWeight: '600', fontFamily: fonts.display, textAlign: 'center' },
  sectionLabel: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  fieldsHint: { color: colors.mutedText, fontSize: 11.5, lineHeight: 16, marginTop: 4, marginBottom: spacing.sm },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  previewPaper: {
    backgroundColor: '#101010', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginTop: spacing.xs, alignItems: 'stretch',
  },
  previewShop: { color: '#F5F5F5', fontWeight: '700', textAlign: 'center', fontFamily: MONO },
  previewMuted: { color: '#9A9A9A', textAlign: 'center', fontFamily: MONO },
  previewDivider: { height: 1, backgroundColor: '#3A3A3A', marginVertical: spacing.sm },
  previewLine: { color: '#F5F5F5', fontFamily: MONO, marginBottom: 3 },
  previewLabel: { fontWeight: '700' },

  stepper: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.sm, paddingVertical: 6, marginTop: spacing.xs,
  },
  stepBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  stepValue: { color: colors.onSurface, fontSize: 14, fontWeight: '700', minWidth: 34, textAlign: 'center' },

  fieldRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.sm, paddingVertical: 8, marginBottom: 6,
  },
  fieldRowDisabled: { opacity: 0.6 },
  fieldCheck: { padding: 2 },
  fieldLabel: { flex: 1, color: colors.onSurface, fontSize: 13 },
  fieldSize: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  miniBtn: {
    width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  miniBtnDisabled: { opacity: 0.3 },
  miniValue: { color: colors.onSurface, fontSize: 12, fontWeight: '700', minWidth: 16, textAlign: 'center' },
  reorderBtns: { gap: 3 },
  footnote: { color: colors.mutedText, fontSize: 11, lineHeight: 15, marginTop: spacing.md, fontStyle: 'italic' },
});
