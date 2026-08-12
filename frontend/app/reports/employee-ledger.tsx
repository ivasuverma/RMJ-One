import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Employee = {
  id: string; name: string; employee_code: string; designation?: string;
  department?: string; status?: string; closing_balance?: number;
};

const fmtINR = (n: number) => `₹${Math.abs(n || 0).toLocaleString('en-IN')}`;

// Read-only lookup into an employee's payroll ledger (ledger/[id].tsx handles
// add/edit/delete). Adding/editing employee records lives in Team management —
// this is reporting only, mirroring the customer/karigar ledger pickers.
export default function EmployeeLedgerPickerScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [onlyBalance, setOnlyBalance] = useState(false);

  const load = useCallback(async () => {
    try { setEmployees(await api.get<Employee[]>('/employees')); }
    catch (_e) { setEmployees([]); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const hasBalance = (e: Employee) => !!e.closing_balance;
  const withBalanceCount = employees.filter(hasBalance).length;
  const visible = (onlyBalance ? employees.filter(hasBalance) : employees)
    .slice()
    .sort((a, b) => Math.abs(b.closing_balance || 0) - Math.abs(a.closing_balance || 0));

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="employee-ledger-picker-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Employee Ledger</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.filterRow}>
        <Pressable onPress={() => setOnlyBalance(false)} style={[styles.filterChip, !onlyBalance && styles.filterChipActive]} testID="filter-all">
          <Text style={[styles.filterText, !onlyBalance && styles.filterTextActive]}>All · {employees.length}</Text>
        </Pressable>
        <Pressable onPress={() => setOnlyBalance(true)} style={[styles.filterChip, onlyBalance && styles.filterChipActive]} testID="filter-with-balance">
          <Text style={[styles.filterText, onlyBalance && styles.filterTextActive]}>With Balance · {withBalanceCount}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        {visible.length === 0 ? (
          <View style={styles.empty}><Ionicons name="people-outline" size={36} color={colors.mutedText} /><Text style={styles.emptyText}>{onlyBalance ? 'No one has an open balance right now' : 'No employees yet'}</Text></View>
        ) : visible.map((e) => {
          const bal = e.closing_balance || 0;
          return (
            <Pressable key={e.id} onPress={() => router.push(`/ledger/${e.id}` as any)} style={[styles.card, e.status && e.status !== 'active' && { opacity: 0.55 }]} testID={`employee-ledger-${e.id}`}>
              <View style={styles.iconBox}><Ionicons name="person-outline" size={18} color={colors.brandSecondary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cName}>{e.name}</Text>
                <Text style={styles.cMeta}>{e.employee_code}{e.designation ? ` · ${e.designation}` : ''}{e.status && e.status !== 'active' ? ` · ${e.status}` : ''}</Text>
              </View>
              {!!bal && (
                <View style={styles.balanceBadge}>
                  <Text style={[styles.balanceValue, { color: bal >= 0 ? colors.onSuccess : colors.onError }]}>{bal >= 0 ? '' : '- '}{fmtINR(bal)}</Text>
                  <Text style={styles.balanceLabel}>{bal >= 0 ? 'owed' : 'owes'}</Text>
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

  filterRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  filterChip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  filterChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  filterText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  filterTextActive: { color: colors.onBrandPrimary },

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
