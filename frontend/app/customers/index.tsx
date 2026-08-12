import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, Platform, KeyboardAvoidingView, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Customer = { id: string; name: string; mobile: string; address: string };

// Masters is for managing customer *accounts* only (add/edit). Repair history
// and ledger lookups live under Reports > Customer Ledger.
export default function CustomersScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [query, setQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const submittingRef = useRef(false);

  const load = useCallback(async (q?: string) => {
    try { setCustomers(await api.get<Customer[]>(`/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`)); }
    catch (_e) { setCustomers([]); }
    finally { setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const resetForm = () => { setName(''); setMobile(''); setAddress(''); setEditingId(null); setShowForm(false); };

  const openAdd = () => {
    if (showForm && !editingId) { resetForm(); return; }
    setEditingId(null); setName(''); setMobile(''); setAddress(''); setShowForm(true);
  };

  const openEdit = (c: Customer) => {
    setEditingId(c.id); setName(c.name); setMobile(c.mobile || ''); setAddress(c.address || ''); setShowForm(true);
  };

  const save = async () => {
    if (submittingRef.current) return;
    if (!name.trim()) { Alert.alert('Missing', 'Enter a name'); return; }
    submittingRef.current = true;
    setSaving(true);
    try {
      if (editingId) await api.put(`/customers/${editingId}`, { name: name.trim(), mobile, address, notes: '' });
      else await api.post('/customers', { name: name.trim(), mobile, address, notes: '' });
      resetForm(); await load(query);
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); submittingRef.current = false; }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="customers-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Customers</Text>
        <Pressable onPress={openAdd} style={[styles.iconBtn, styles.addBtn]} testID="new-customer-btn" hitSlop={12}>
          <Ionicons name={showForm && !editingId ? 'close' : 'add'} size={22} color={colors.onBrandPrimary} />
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(query); }} tintColor={colors.brandPrimary} />}
        >
          {showForm ? (
            <View style={styles.formCard} testID="customer-form">
              <View style={styles.formHeaderRow}>
                <Text style={styles.formHeaderText}>{editingId ? 'Edit Customer' : 'Add Customer'}</Text>
                <Pressable onPress={resetForm} hitSlop={10} testID="cancel-customer-form">
                  <Ionicons name="close" size={18} color={colors.mutedText} />
                </Pressable>
              </View>
              <Text style={styles.label}>Name</Text>
              <TextInput testID="customer-name" value={name} onChangeText={setName} placeholder="Customer name" placeholderTextColor={colors.mutedText} style={styles.input} />
              <Text style={styles.label}>Mobile</Text>
              <TextInput testID="customer-mobile" value={mobile} onChangeText={setMobile} keyboardType="phone-pad" placeholder="98xxxxxxxx" placeholderTextColor={colors.mutedText} style={styles.input} />
              <Text style={styles.label}>Address (optional)</Text>
              <TextInput testID="customer-address" value={address} onChangeText={setAddress} placeholder="Address" placeholderTextColor={colors.mutedText} style={styles.input} />
              <Pressable style={[styles.saveBtn, saving && { opacity: 0.6 }]} disabled={saving} onPress={save} testID="save-customer-btn">
                {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>{editingId ? 'Save Changes' : 'Add Customer'}</Text>}
              </Pressable>
            </View>
          ) : (
            <View style={styles.searchRow}>
              <Ionicons name="search-outline" size={16} color={colors.mutedText} />
              <TextInput
                testID="customer-search" value={query}
                onChangeText={(v) => { setQuery(v); load(v); }}
                placeholder="Search by name or mobile" placeholderTextColor={colors.mutedText}
                style={styles.searchInput}
              />
            </View>
          )}

          {customers.length === 0 ? (
            <View style={styles.empty}><Ionicons name="people-outline" size={36} color={colors.mutedText} /><Text style={styles.emptyText}>No customers found</Text></View>
          ) : customers.map((c) => (
            <Pressable key={c.id} onPress={() => openEdit(c)} style={styles.card} testID={`customer-${c.id}`}>
              <View style={styles.iconBox}><Ionicons name="person-outline" size={18} color={colors.brandSecondary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cName}>{c.name}</Text>
                <Text style={styles.cMeta}>{c.mobile || 'No mobile on file'}</Text>
              </View>
              <Ionicons name="pencil-outline" size={16} color={colors.mutedText} />
            </Pressable>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
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
  addBtn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '600', fontFamily: fonts.display },

  formCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.lg },
  formHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  formHeaderText: { color: colors.onSurface, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: spacing.md, marginBottom: 6 },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg },
  saveBtnText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 14 },

  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, marginBottom: spacing.lg,
  },
  searchInput: { flex: 1, color: colors.onSurface, paddingVertical: 12, fontSize: 14 },

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
});
