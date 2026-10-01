import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { shiftedISTDate } from '@/src/utils/datetime';
import { notify } from '@/src/utils/notify';
import { friendlyDate } from '@/src/utils/friendlyDate';
import { spacing, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';
import { ModuleHeader } from '@/src/components/ui/ModuleHeader';
import { HeaderSpacer, useScrolled } from '@/src/components/ui/StickyHeader';

type Rep = { id: string; item_code: string; customer_name?: string; description?: string; karigar_name?: string };
type Sam = { id: string; sample_code: string; description?: string; karigar_name?: string };
const DAYS = [1, 3, 5, 7];

// One-time clean-up: repairs and samples that went to a karigar before "due back"
// was required. Tap how many days from today each should be back; the row then
// leaves the list, and from then on a late one shows on Home and its card.
export default function DueBackMissingScreen() {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const { scrolled, onScroll } = useScrolled();
  const [data, setData] = useState<{ repairs: Rep[]; samples: Sam[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.get('/due-back/missing')); } catch { setData((d) => d || { repairs: [], samples: [] }); }
    finally { setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const set = async (kind: 'repair' | 'sample', id: string, days: number) => {
    const due = shiftedISTDate(days);
    setBusy(`${id}:${days}`);
    try {
      if (kind === 'repair') await api.put(`/repair-items/${id}/due-back`, { due_back: due });
      else await api.put(`/samples/${id}`, { due_date: due });
      setData((d) => d && (kind === 'repair' ? { ...d, repairs: d.repairs.filter((x) => x.id !== id) } : { ...d, samples: d.samples.filter((x) => x.id !== id) }));
      toast.success(`Due back ${friendlyDate(due)}`);
    } catch (e: any) { notify('Could not save', e?.detail || 'Please try again'); }
    finally { setBusy(null); }
  };

  const total = (data?.repairs.length || 0) + (data?.samples.length || 0);
  const Row = ({ kind, id, title, sub }: { kind: 'repair' | 'sample'; id: string; title: string; sub: string }) => (
    <View style={s.row} testID={`due-missing-${id}`}>
      <Text style={s.title} numberOfLines={1}>{title}</Text>
      <Text style={s.sub} numberOfLines={1}>{sub}</Text>
      <View style={s.chips}>
        {DAYS.map((n) => (
          <Pressable key={n} onPress={() => set(kind, id, n)} disabled={!!busy} style={({ pressed }) => [s.chip, pressed && { opacity: 0.7 }]} testID={`due-missing-${id}-${n}d`}>
            {busy === `${id}:${n}` ? <ActivityIndicator size="small" color={colors.brandSecondary} /> : <Text style={s.chipText}>{n} day{n === 1 ? '' : 's'}</Text>}
          </Pressable>
        ))}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={s.root} edges={['top']} testID="due-back-missing-screen">
      <ModuleHeader title="Set due-back dates" backLabel="Home" scrolled={scrolled}
        subtitle={data ? (total ? `${total} with karigars have no date` : 'All set') : null} />
      <ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}>
        <HeaderSpacer />
        <Text style={s.note}>These went to a karigar before a due-back date was required. Pick when each should come back, counting from today.</Text>
        {!data ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 50 }} /> : total === 0 ? (
          <View style={s.empty}>
            <View style={s.emptyIcon}><Ionicons name="checkmark-done" size={28} color={colors.brandSecondary} /></View>
            <Text style={s.emptyTitle}>All set</Text>
            <Text style={s.emptyText}>Every repair and sample with a karigar has a due-back date.</Text>
          </View>
        ) : (
          <>
            {data.repairs.length > 0 && <Text style={s.group}>Repairs · {data.repairs.length}</Text>}
            {data.repairs.length > 0 && (
              <View style={s.card}>{data.repairs.map((r, i) => (
                <View key={r.id} style={i > 0 && s.sep}>
                  <Row kind="repair" id={r.id} title={`${r.item_code} · ${r.customer_name || ''}`} sub={`${r.description || ''} · with ${r.karigar_name || 'karigar'}`} />
                </View>
              ))}</View>
            )}
            {data.samples.length > 0 && <Text style={s.group}>Stock In/Out · {data.samples.length}</Text>}
            {data.samples.length > 0 && (
              <View style={s.card}>{data.samples.map((x, i) => (
                <View key={x.id} style={i > 0 && s.sep}>
                  <Row kind="sample" id={x.id} title={`${x.sample_code} · ${x.karigar_name || ''}`} sub={x.description || 'Sample'} />
                </View>
              ))}</View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  note: { color: colors.mutedText, fontSize: 13, lineHeight: 19, marginTop: spacing.sm, marginHorizontal: 4 },
  group: { color: colors.onSurface, fontSize: 18, fontWeight: '800', marginTop: 22, marginBottom: 8, marginHorizontal: 4 },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: 18, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  sep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  row: { paddingHorizontal: 14, paddingVertical: 12 },
  title: { color: colors.onSurface, fontSize: 15, fontWeight: '700' },
  sub: { color: colors.mutedText, fontSize: 12.5, marginTop: 1 },
  chips: { flexDirection: 'row', gap: 6, marginTop: 9 },
  chip: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipText: { color: colors.onSurface, fontSize: 13, fontWeight: '700' },
  empty: { alignItems: 'center', paddingTop: 70, paddingHorizontal: spacing.xl, gap: 6 },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  emptyTitle: { color: colors.onSurface, fontSize: 18, fontWeight: '700' },
  emptyText: { color: colors.mutedText, fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
