import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { ModuleHeader } from '@/src/components/ui/ModuleHeader';
import { HeaderSpacer, useScrolled } from '@/src/components/ui/StickyHeader';

type Row = { id: string; name: string; designation: string; missing: string[] };

// Employees whose profile is still missing details — opened from the Home
// "Needs you today" row. What counts as complete is decided on the server
// (PROFILE_CHECKS in routers/employees.py). Tapping someone opens their profile,
// where Edit fills the details and ID proofs are added.
export default function IncompleteProfilesScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { scrolled, onScroll } = useScrolled();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setRows((await api.get<{ employees: Row[] }>('/employees/incomplete')).employees); setError(false); }
    catch { setError(true); setRows((r) => r || []); }
    finally { setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="incomplete-profiles-screen">
      <ModuleHeader title="Complete profiles" backLabel="Home" scrolled={scrolled}
        subtitle={rows ? (rows.length ? `${rows.length} employee${rows.length === 1 ? '' : 's'} missing details` : 'Every profile is complete') : null} />
      <ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}>
        <HeaderSpacer />
        {!rows ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 60 }} /> : error && !rows.length ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Couldn&apos;t load this — pull down to try again.</Text>
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}><Ionicons name="checkmark-done" size={28} color={colors.brandSecondary} /></View>
            <Text style={styles.emptyTitle}>All complete</Text>
            <Text style={styles.emptyText}>Every current employee has a photo, contact, Aadhaar, PAN, bank details and an ID proof.</Text>
          </View>
        ) : (
          <>
            <Text style={styles.note}>Tap a name, then Edit to fill the details. Add ID proofs on the profile.</Text>
            <View style={styles.card}>
              {rows.map((r, i) => (
                <Pressable key={r.id} onPress={() => router.push(`/employee/${r.id}` as any)}
                  style={({ pressed }) => [styles.row, i > 0 && styles.sep, pressed && { backgroundColor: colors.surfaceTertiary }]} testID={`incomplete-${r.id}`}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.name} numberOfLines={1}>{r.name}{r.designation ? <Text style={styles.sub}>  ·  {r.designation}</Text> : null}</Text>
                    <View style={styles.chips}>
                      {r.missing.map((m) => <Text key={m} style={styles.chip}>{m}</Text>)}
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.mutedText} />
                </Pressable>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  note: { color: colors.mutedText, fontSize: 13, lineHeight: 19, marginTop: spacing.md, marginHorizontal: 4 },
  card: { marginTop: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: 18, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  sep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  name: { color: colors.onSurface, fontSize: 15, fontWeight: '600' },
  sub: { color: colors.mutedText, fontSize: 12.5, fontWeight: '400' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 7 },
  chip: {
    color: colors.onWarning, backgroundColor: colors.warning, fontSize: 12, fontWeight: '600',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, overflow: 'hidden',
  },
  empty: { alignItems: 'center', paddingTop: 70, paddingHorizontal: spacing.xl, gap: 6 },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  emptyTitle: { color: colors.onSurface, fontSize: 18, fontWeight: '700' },
  emptyText: { color: colors.mutedText, fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
