import { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  SectionList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { ErrorState, SegmentedControl } from '@/src/components/ui';

type Emp = {
  id: string; name: string; employee_code: string; department: string;
  designation: string; status: 'active' | 'inactive' | 'on_leave'; photo?: string | null;
  salary: number;
};

const SEGMENTS = [
  { key: 'active', label: 'Active' },
  { key: 'on_leave', label: 'On Leave' },
  { key: 'inactive', label: 'Inactive' },
  { key: 'all', label: 'All' },
];

const DOT_COLOR: Record<Emp['status'], keyof ThemeColors> = {
  active: 'onSuccess', on_leave: 'brandPrimary', inactive: 'mutedText',
};

export default function EmployeesScreen() {
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const goBack = () => { if (from === 'work' || from === 'transactions') router.replace('/(tabs)/work' as any); else router.back(); };
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<Emp[]>([]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<string>('active');   // open on active staff by default
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      const query = new URLSearchParams();
      if (q.trim()) query.set('q', q.trim());
      if (filter !== 'all') query.set('status', filter);
      const path = `/employees${query.toString() ? `?${query.toString()}` : ''}`;
      const res = await api.get<Emp[]>(path);
      setItems(res || []);
    } catch (e: any) {
      setItems([]);
      setError(e?.detail || 'Failed to load employees');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [q, filter]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => { setRefreshing(true); load(); };

  const empty = !loading && items.length === 0;

  const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('');

  // Grouped by department — an inset "Shop · 7" section per department,
  // department-less employees collected into one group at the end.
  const sections = useMemo(() => {
    const byDept = new Map<string, Emp[]>();
    for (const e of items) {
      const key = e.department?.trim() || 'No Department';
      if (!byDept.has(key)) byDept.set(key, []);
      byDept.get(key)!.push(e);
    }
    const keys = [...byDept.keys()].sort((a, b) => {
      if (a === 'No Department') return 1;
      if (b === 'No Department') return -1;
      return a.localeCompare(b);
    });
    return keys.map((k) => ({ title: k, data: byDept.get(k)! }));
  }, [items]);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="employees-screen">
      {/* Sticky Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          {(router.canGoBack() || from === 'transactions') && (
            <Pressable onPress={goBack} style={styles.backBtn} testID="back-btn" hitSlop={12}>
              <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
            </Pressable>
          )}
          <Text style={styles.title}>Employees</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{items.length}</Text>
          </View>
        </View>
        {from === 'transactions' && <Text style={styles.ledgerHint}>Tap an employee to open their ledger</Text>}

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={colors.mutedText} />
          <TextInput
            testID="employee-search-input"
            style={styles.searchInput}
            placeholder="Search name, code, department"
            placeholderTextColor={colors.mutedText}
            value={q}
            onChangeText={setQ}
            returnKeyType="search"
            onSubmitEditing={load}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {q.length > 0 && (
            <Pressable onPress={() => { setQ(''); setTimeout(load, 0); }} hitSlop={12} testID="clear-search">
              <Ionicons name="close-circle" size={18} color={colors.mutedText} />
            </Pressable>
          )}
        </View>

        <SegmentedControl options={SEGMENTS} value={filter} onChange={setFilter} testID="employees-status-seg" />
      </View>

      {loading && items.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brandPrimary} size="large" />
        </View>
      ) : error && items.length === 0 ? (
        <View style={{ padding: spacing.lg }}><ErrorState message={error} onRetry={load} testID="employees-error" /></View>
      ) : empty ? (
        <View style={styles.center} testID="employees-empty">
          <Ionicons name="people-outline" size={48} color={colors.mutedText} />
          <Text style={styles.emptyTitle}>No employees found</Text>
          <Text style={styles.emptySub}>Add your first employee to get started</Text>
          <Pressable style={styles.emptyCta} onPress={() => router.push('/employee/new')} testID="empty-add-btn">
            <Ionicons name="add" size={18} color={colors.onBrandPrimary} />
            <Text style={styles.emptyCtaText}>Add Employee</Text>
          </Pressable>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionHeader}>{section.title} · {section.data.length}</Text>
          )}
          renderItem={({ item, index, section }) => (
            <Pressable
              testID={`emp-row-${item.id}`}
              style={({ pressed }) => [
                styles.row,
                index === 0 && styles.rowFirst,
                index === section.data.length - 1 && styles.rowLast,
                index > 0 && styles.rowDivider,
                pressed && { opacity: 0.85 },
              ]}
              onPress={() => router.push(from === 'transactions' ? `/ledger/${item.id}` : `/employee/${item.id}`)}
            >
              <View style={styles.avatarWrap}>
                {item.photo ? (
                  <Image source={{ uri: item.photo }} style={styles.avatarPhoto} />
                ) : (
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials(item.name)}</Text>
                  </View>
                )}
                <View style={[styles.statusDot, { backgroundColor: colors[DOT_COLOR[item.status]] as string, borderColor: colors.surfaceSecondary }]} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {item.designation || '—'} · {item.employee_code}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
            </Pressable>
          )}
          ListFooterComponent={
            <Text style={styles.legend}>
              <Text style={{ color: colors.onSuccess }}>● </Text>active ·{' '}
              <Text style={{ color: colors.brandPrimary }}>● </Text>on leave ·{' '}
              <Text style={{ color: colors.mutedText }}>● </Text>inactive
            </Text>
          }
        />
      )}

      <Pressable style={styles.fab} onPress={() => router.push('/employee/new')} testID="fab-add-employee">
        <Ionicons name="add" size={26} color={colors.onBrandPrimary} />
      </Pressable>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  title: {
    color: colors.onSurface, fontSize: 30, fontWeight: '600', flex: 1,
    fontFamily: fonts.display,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  countBadge: {
    minWidth: 34, height: 26, paddingHorizontal: 10, borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center',
  },
  countBadgeText: { color: colors.brandSecondary, fontWeight: '700' },
  ledgerHint: { color: colors.mutedText, fontSize: 12, marginTop: -6, marginBottom: spacing.md },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, height: 44, marginBottom: spacing.md,
  },
  searchInput: { flex: 1, color: colors.onSurface, fontSize: 14, paddingVertical: 0 },

  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 100 },
  sectionHeader: {
    color: colors.mutedText, fontSize: 12, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase',
    marginTop: spacing.md, marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border, borderTopWidth: 0,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md, minHeight: 68,
  },
  rowFirst: { borderTopWidth: 1, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  rowLast: { borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  avatarWrap: { width: 44, height: 44 },
  avatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.brand,
  },
  avatarText: { color: colors.brandSecondary, fontWeight: '700', fontSize: 15 },
  avatarPhoto: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceTertiary },
  statusDot: {
    position: 'absolute', right: -1, bottom: -1, width: 13, height: 13, borderRadius: 7, borderWidth: 2,
  },
  rowName: { color: colors.onSurface, fontSize: 15.5, fontWeight: '600' },
  rowSub: { color: colors.onSurfaceTertiary, fontSize: 12.5, marginTop: 2 },
  legend: { color: colors.mutedText, fontSize: 12, textAlign: 'center', marginTop: spacing.lg },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  emptyTitle: { color: colors.onSurface, fontSize: 18, fontWeight: '600', marginTop: spacing.md },
  emptySub: { color: colors.onSurfaceTertiary, fontSize: 13, textAlign: 'center' },
  emptyCta: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.brandPrimary, borderRadius: radius.md,
    paddingHorizontal: spacing.xl, paddingVertical: 12, marginTop: spacing.md,
  },
  emptyCtaText: { color: colors.onBrandPrimary, fontWeight: '700' },

  fab: {
    position: 'absolute', right: 20, bottom: 20,
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
    boxShadow: '0px 6px 12px rgba(0,0,0,0.4)', elevation: 8,
  },
});
