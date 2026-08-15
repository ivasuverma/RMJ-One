import { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  Pressable,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  Platform,
} from 'react-native';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Emp = {
  id: string; name: string; employee_code: string; department: string;
  designation: string; status: 'active' | 'inactive' | 'on_leave'; photo?: string | null;
  salary: number;
};

const CHIPS: { key: string; label: string; status?: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active', status: 'active' },
  { key: 'on_leave', label: 'On Leave', status: 'on_leave' },
  { key: 'inactive', label: 'Inactive', status: 'inactive' },
];

export default function EmployeesScreen() {
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const goBack = () => { if (from === 'transactions') router.replace('/(tabs)/transactions' as any); else router.back(); };
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<Emp[]>([]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams();
      if (q.trim()) query.set('q', q.trim());
      const chip = CHIPS.find((c) => c.key === filter);
      if (chip?.status) query.set('status', chip.status);
      const path = `/employees${query.toString() ? `?${query.toString()}` : ''}`;
      const res = await api.get<Emp[]>(path);
      setItems(res || []);
    } catch (_e) {
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [q, filter]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => { setRefreshing(true); load(); };

  const empty = !loading && items.length === 0;

  const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('');

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

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
          style={styles.chipsScroll}
        >
          {CHIPS.map((c) => {
            const active = filter === c.key;
            return (
              <Pressable
                key={c.key}
                testID={`chip-${c.key}`}
                onPress={() => setFilter(c.key)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {loading && items.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brandPrimary} size="large" />
        </View>
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
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          renderItem={({ item }) => (
            <Pressable
              testID={`emp-row-${item.id}`}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
              onPress={() => router.push(from === 'transactions' ? `/ledger/${item.id}` : `/employee/${item.id}`)}
            >
              {item.photo ? (
                <Image source={{ uri: item.photo }} style={styles.avatarPhoto} />
              ) : (
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initials(item.name)}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {item.designation || '—'}  ·  {item.department || '—'}
                </Text>
                <Text style={styles.rowCode}>{item.employee_code}</Text>
              </View>
              <StatusChip status={item.status} />
              <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
            </Pressable>
          )}
        />
      )}

      <Pressable style={styles.fab} onPress={() => router.push('/employee/new')} testID="fab-add-employee">
        <Ionicons name="add" size={26} color={colors.onBrandPrimary} />
      </Pressable>
    </SafeAreaView>
  );
}

function StatusChip({ status }: { status: 'active' | 'inactive' | 'on_leave' }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const map = {
    active: { label: 'Active', bg: colors.success, bd: colors.onSuccess, fg: colors.onSuccess },
    on_leave: { label: 'On Leave', bg: colors.warning, bd: colors.onWarning, fg: colors.onWarning },
    inactive: { label: 'Inactive', bg: colors.error, bd: colors.onError, fg: colors.onError },
  } as const;
  const s = map[status] || map.active;
  return (
    <View style={[styles.statusChip, { backgroundColor: s.bg, borderColor: s.bd }]}>
      <Text style={[styles.statusChipText, { color: s.fg }]}>{s.label}</Text>
    </View>
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

  chipsScroll: { height: 40 },
  chipsRow: { gap: spacing.sm, paddingRight: spacing.lg, alignItems: 'center', height: 40 },
  chip: {
    flexShrink: 0, height: 36, paddingHorizontal: spacing.lg,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: colors.onBrandPrimary },

  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 100 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, minHeight: 72,
  },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.brand,
  },
  avatarText: { color: colors.brandSecondary, fontWeight: '700', fontSize: 16 },
  avatarPhoto: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surfaceTertiary },
  rowName: { color: colors.onSurface, fontSize: 15, fontWeight: '600' },
  rowSub: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  rowCode: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  statusChip: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill,
    borderWidth: 1,
  },
  statusChipText: { fontSize: 11, fontWeight: '700' },

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
