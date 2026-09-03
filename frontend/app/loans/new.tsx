import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, Platform, KeyboardAvoidingView, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { PhotoCaptureModal } from '@/src/components/PhotoCaptureModal';
import { DateField } from '@/src/components/DateField';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Customer = { id: string; name: string; mobile: string; address: string };

export default function NewGoldLoanScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [allCustomers, setAllCustomers] = useState<Customer[]>([]);
  const load = useCallback(async () => {
    try { setAllCustomers(await api.get<Customer[]>('/customers')); } catch (_e) { setAllCustomers([]); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Customer — existing/new, same pattern as a repair intake.
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [query, setQuery] = useState('');
  const [custPickerOpen, setCustPickerOpen] = useState(false);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [newName, setNewName] = useState('');
  const [newMobile, setNewMobile] = useState('');
  const [newAddress, setNewAddress] = useState('');

  const filteredCustomers = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? allCustomers.filter((c) => c.name.toLowerCase().includes(q) || (c.mobile || '').includes(q)) : allCustomers;
    return list.slice(0, 100);
  }, [allCustomers, query]);
  const pickCustomer = (c: Customer) => { setSelected(c); setCustPickerOpen(false); setQuery(''); };

  const [description, setDescription] = useState('');
  const [weight, setWeight] = useState('');
  const [pcCount, setPcCount] = useState('1');
  const [photo, setPhoto] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [principal, setPrincipal] = useState('');
  const [rate, setRate] = useState('');
  const [loanDate, setLoanDate] = useState('');
  const [estimateDate, setEstimateDate] = useState('');
  const [note, setNote] = useState('');

  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  const submit = async () => {
    if (submittingRef.current) return;
    if (mode === 'existing' && !selected) { Alert.alert('Missing', 'Pick a customer, or switch to New Customer'); return; }
    if (mode === 'new' && !newName.trim()) { Alert.alert('Missing', 'Enter the customer name'); return; }
    if (mode === 'new' && newMobile.replace(/\D/g, '').length < 7) { Alert.alert('Missing', 'A mobile number is required for a new customer'); return; }
    if (!description.trim()) { Alert.alert('Missing', 'Describe what is being pledged'); return; }
    const w = parseFloat(weight);
    if (!w || w <= 0) { Alert.alert('Missing', 'Enter a weight greater than 0'); return; }
    const p = parseFloat(principal);
    if (!p || p <= 0) { Alert.alert('Missing', 'Enter the amount paid to the customer'); return; }
    const r = parseFloat(rate);
    if (!rate || r < 0) { Alert.alert('Missing', 'Enter the monthly interest rate'); return; }

    submittingRef.current = true;
    setSaving(true);
    try {
      const body: any = {
        description: description.trim(), weight: w, pc_count: parseInt(pcCount, 10) || 1, photo,
        principal: p, interest_rate_percent: r,
        loan_date: loanDate || null, estimate_return_date: estimateDate || null, note: note.trim(),
      };
      if (mode === 'existing') body.customer_id = selected!.id;
      else body.new_customer = { name: newName.trim(), mobile: newMobile, address: newAddress, notes: '' };

      const created = await api.post<{ id: string }>('/gold-loans', body);
      try { await api.post(`/gold-loans/${created.id}/voucher/print`, {}); } catch { /* saved either way */ }
      router.replace(`/loans/${created.id}` as any);
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); submittingRef.current = false; }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="loan-new-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Loan Against Gold</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Customer</Text>
          <View style={styles.chipRow}>
            <Pressable onPress={() => setMode('existing')} style={[styles.chip, mode === 'existing' && styles.chipActive]} testID="cust-mode-existing">
              <Text style={[styles.chipText, mode === 'existing' && styles.chipTextActive]}>Existing</Text>
            </Pressable>
            <Pressable onPress={() => setMode('new')} style={[styles.chip, mode === 'new' && styles.chipActive]} testID="cust-mode-new">
              <Text style={[styles.chipText, mode === 'new' && styles.chipTextActive]}>New Customer</Text>
            </Pressable>
          </View>

          {mode === 'existing' ? (
            <>
              <Pressable onPress={() => setCustPickerOpen((v) => !v)} style={styles.picker} testID="loan-customer-toggle">
                <Text style={selected ? styles.pickerValue : styles.pickerPlaceholder}>{selected ? selected.name : 'Choose a customer'}</Text>
                <Ionicons name={custPickerOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedText} />
              </Pressable>
              {custPickerOpen && (
                <View style={styles.pickerList}>
                  <TextInput value={query} onChangeText={setQuery} placeholder="Search name or mobile" placeholderTextColor={colors.mutedText} style={styles.searchInput} testID="loan-customer-search" />
                  <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                    {filteredCustomers.map((c) => (
                      <Pressable key={c.id} onPress={() => pickCustomer(c)} style={styles.pickerRow} testID={`loan-cust-${c.id}`}>
                        <Text style={styles.pickerRowName}>{c.name}</Text>
                        <Text style={styles.pickerRowMeta}>{c.mobile}</Text>
                      </Pressable>
                    ))}
                    {filteredCustomers.length === 0 && <Text style={[styles.pickerRowMeta, { padding: spacing.md }]}>No matches</Text>}
                  </ScrollView>
                </View>
              )}
            </>
          ) : (
            <>
              <TextInput testID="loan-new-name" value={newName} onChangeText={setNewName} placeholder="Customer name" placeholderTextColor={colors.mutedText} style={styles.input} />
              <TextInput testID="loan-new-mobile" value={newMobile} onChangeText={setNewMobile} placeholder="Mobile number" placeholderTextColor={colors.mutedText} keyboardType="phone-pad" style={[styles.input, { marginTop: spacing.sm }]} />
              <TextInput testID="loan-new-address" value={newAddress} onChangeText={setNewAddress} placeholder="Address (optional)" placeholderTextColor={colors.mutedText} style={[styles.input, { marginTop: spacing.sm }]} multiline />
            </>
          )}

          <Text style={styles.label}>Description</Text>
          <TextInput testID="loan-description" value={description} onChangeText={setDescription} placeholder="e.g. 2 gold bangles + 1 chain" placeholderTextColor={colors.mutedText} style={styles.input} multiline />

          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
            <View style={{ flex: 2 }}>
              <Text style={styles.label}>Weight (g)</Text>
              <TextInput testID="loan-weight" value={weight} onChangeText={(v) => setWeight(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0.000" placeholderTextColor={colors.mutedText} style={styles.input} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Pieces</Text>
              <TextInput testID="loan-pc-count" value={pcCount} onChangeText={(v) => setPcCount(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" placeholder="1" placeholderTextColor={colors.mutedText} style={styles.input} />
            </View>
            <Pressable onPress={() => setCameraOpen(true)} style={styles.photoSmallBtn} testID="loan-photo-btn">
              {photo ? <Image source={{ uri: photo }} style={styles.photoSmallImg} /> : <Ionicons name="camera-outline" size={20} color={colors.onSurfaceSecondary} />}
            </Pressable>
          </View>
          {!!photo && (
            <Pressable onPress={() => setPhoto('')} style={styles.removePhotoLink} testID="loan-remove-photo">
              <Text style={styles.removePhotoText}>Remove photo</Text>
            </Pressable>
          )}

          <View style={styles.moneyCard}>
            <Text style={styles.label}>Amount paid to customer (₹)</Text>
            <TextInput testID="loan-principal" value={principal} onChangeText={(v) => setPrincipal(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />

            <Text style={styles.label}>Interest rate — per month (%)</Text>
            <TextInput testID="loan-rate" value={rate} onChangeText={(v) => setRate(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="e.g. 2" placeholderTextColor={colors.mutedText} style={styles.input} />
            <Text style={styles.hintText}>Interest posts automatically each month on the outstanding principal, starting one month after the loan date.</Text>
          </View>

          <DateField label="Loan date" value={loanDate} onChange={setLoanDate} testID="loan-date" />
          <DateField label="Estimated return date (optional)" value={estimateDate} onChange={setEstimateDate} testID="loan-estimate-date" />

          <Text style={styles.label}>Note (optional)</Text>
          <TextInput testID="loan-note" value={note} onChangeText={setNote} placeholder="Anything worth remembering" placeholderTextColor={colors.mutedText} style={styles.input} multiline />

          <Pressable onPress={submit} disabled={saving} style={[styles.submitBtn, saving && { opacity: 0.6 }]} testID="submit-loan-btn">
            {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
              <><Ionicons name="print-outline" size={17} color={colors.onBrandPrimary} /><Text style={styles.submitBtnText}>Save & Print</Text></>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      <PhotoCaptureModal visible={cameraOpen} title="Pledge Photo" onClose={() => setCameraOpen(false)} highRes onCapture={async (p) => { setPhoto(p); setCameraOpen(false); }} />
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

  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6, marginTop: spacing.md },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },
  hintText: { color: colors.mutedText, fontSize: 11, marginTop: 6 },

  chipRow: { flexDirection: 'row', gap: spacing.sm },
  chip: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: colors.onBrandPrimary },

  picker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 12,
  },
  pickerValue: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  pickerPlaceholder: { color: colors.mutedText, fontSize: 14 },
  pickerList: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginTop: spacing.xs, overflow: 'hidden', padding: spacing.xs },
  searchInput: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 10, fontSize: 13, marginBottom: spacing.xs,
  },
  pickerRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.sm, paddingVertical: 10 },
  pickerRowName: { color: colors.onSurface, fontSize: 13, fontWeight: '600' },
  pickerRowMeta: { color: colors.mutedText, fontSize: 12 },

  photoSmallBtn: {
    width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  photoSmallImg: { width: '100%', height: '100%' },
  removePhotoLink: { alignSelf: 'flex-end', marginTop: 6 },
  removePhotoText: { color: colors.onError, fontSize: 11, fontWeight: '700' },

  moneyCard: {
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginTop: spacing.lg,
  },

  submitBtn: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 15, marginTop: spacing.xl,
  },
  submitBtnText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 15 },
});
