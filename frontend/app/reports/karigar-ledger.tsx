import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Karigar = {
  id: string; name: string; mobile: string; is_employee: boolean; active: boolean;
  fine_weight_balance?: number; amount_due?: number;
};

// Read-only lookup into a karigar's gold/₹ ledger (karigars/[id].tsx).
// Adding/editing karigar accounts lives in Masters — this is reporting only.
export default function KarigarLedgerPickerScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [karigars, setKarigars] = useState<Karigar[]>([]);

  const load = useCallback(async () => {
    try { setKarigars(await api.get<Karigar[]>('/karigars')); }
    catch (_e) { setKarigars([]); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="karigar-ledger-picker-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Karigar Ledger</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        {karigars.length === 0 ? (
          <View style={styles.empty}><Ionicons name="hammer-outline" size={36} color={colors.mutedText} /><Text style={styles.emptyText}>No karigars yet</Text></View>
        ) : karigars.map((k) => {
          const fineBal = k.fine_weight_balance || 0;
          const amtDue = k.amount_due || 0;
          return (
            <Pressable key={k.id} onPress={() => router.push(`/karigars/${k.id}` as any)} style={[styles.card, !k.active && { opacity: 0.55 }]} testID={`karigar-ledger-${k.id}`}>
              <View style={styles.iconBox}><Ionicons name="hammer-outline" size={18} color={colors.brandSecondary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cName}>{k.name}</Text>
                <Text style={styles.cMeta}>{k.is_employee ? 'In-house' : 'Outside'}{k.mobile ? ` · ${k.mobile}` : ''}{!k.active ? ' · Inactive' : ''}</Text>
              </View>
              {(!!fineBal || !!amtDue) && (
                <View style={styles.balanceBadge}>
                  {!!fineBal && <Text style={[styles.balanceValue, { color: fineBal > 0 ? colors.onWarning : colors.onSuccess }]}>{fineBal > 0 ? '+' : ''}{fineBal.toFixed(3)}g</Text>}
                  {!!amtDue && <Text style={styles.balanceLabel}>₹{Math.abs(amtDue).toFixed(0)} {amtDue > 0 ? 'due' : 'credit'}</Text>}
                </View>
              )}
              <Ionicons name="chevron-forward" size={16} color={colors.mutedText} />
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

  empty: { alignItems: 'center', paddingVertical: 40, gap: spacing.sm },
  emptyText: { color: colors.onSurfaceTertiary },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  iconBox: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand,
  },
  cName: { color: colors.onSurface, fontWeight: '700', fontSize: 14 },
  cMeta: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  balanceBadge: { alignItems: 'flex-end', marginRight: spacing.xs },
  balanceValue: { fontWeight: '700', fontSize: 13 },
  balanceLabel: { color: colors.mutedText, fontSize: 10, marginTop: 1 },
});
