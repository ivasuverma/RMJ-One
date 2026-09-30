import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Platform, KeyboardAvoidingView, Image,
} from 'react-native';
import { notify } from '@/src/utils/notify';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { PhotoCaptureModal } from '@/src/components/PhotoCaptureModal';
import { DateField } from '@/src/components/DateField';
import { enqueueRecordPhoto } from '@/src/utils/uploadQueue';
import { makeThumbFromDataUri } from '@/src/utils/imageThumb';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { PartyByMobile, resolveParty } from '@/src/components/PartyByMobile';

type Customer = { id: string; name: string; mobile: string; address: string };
type GoldLoan = {
  id: string; customer_name: string; description: string; weight: number; pc_count?: number;
  principal: number; interest_rate_percent: number; loan_date: string; estimate_return_date: string | null; note: string;
};

const fmtINR = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;

// One form for issuing a new gold loan (POST /gold-loans) and editing an
// existing one (?id=..., PUT /gold-loans/{id}) — editing opens this exact
// form pre-filled instead of a separately-coded copy, same pattern already
// used by samples/new.tsx. Principal/rate/customer can't be changed once a
// loan exists (GoldLoanUpdateIn excludes them — see server.py), so those
// fields become read-only in edit mode.
export default function NewGoldLoanScreen() {
  const router = useRouter();
  const { id: editId } = useLocalSearchParams<{ id?: string }>();
  const isEdit = !!editId;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [allCustomers, setAllCustomers] = useState<Customer[]>([]);
  const load = useCallback(async () => {
    try { setAllCustomers(await api.get<Customer[]>('/customers')); } catch (_e) { setAllCustomers([]); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Customer, mobile first (see PartyByMobile), same as a repair intake: a
  // saved number is that customer, an unknown one plus a name is a new customer.
  const [custMobile, setCustMobile] = useState('');
  const [custName, setCustName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const cust = resolveParty(allCustomers, custMobile, custName, 'customer');

  const [customerName, setCustomerName] = useState(''); // display-only in edit mode — customer can't be changed after issue
  const [description, setDescription] = useState('');
  const [weight, setWeight] = useState('');
  const [pcCount, setPcCount] = useState('1');
  // A freshly-captured pledge photo only, held locally until save — it goes
  // to Drive via the record-photos queue after create/update (see submit),
  // never sent inline in the loan body. Existing photos live in the
  // RecordPhotos gallery on the loan detail screen, so nothing to preload here.
  const [photo, setPhoto] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [principal, setPrincipal] = useState('');
  const [rate, setRate] = useState('');
  const [loanDate, setLoanDate] = useState('');
  const [estimateDate, setEstimateDate] = useState('');
  const [note, setNote] = useState('');

  const [loadingLoan, setLoadingLoan] = useState(isEdit);
  useEffect(() => {
    if (!editId) return;
    (async () => {
      try {
        const l = await api.get<GoldLoan>(`/gold-loans/${editId}`);
        setCustomerName(l.customer_name);
        setDescription(l.description); setWeight(String(l.weight ?? ''));
        setPcCount(String(l.pc_count ?? '1'));
        setPrincipal(String(l.principal ?? '')); setRate(String(l.interest_rate_percent ?? ''));
        setLoanDate(l.loan_date || ''); setEstimateDate(l.estimate_return_date || ''); setNote(l.note || '');
      } catch (e: any) { notify('Failed', e?.detail || 'Could not load this loan'); router.back(); }
      finally { setLoadingLoan(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  // Live preview shown right on the entry fields — same rate math as the
  // backend's monthly auto-post (server.py's check_interest_due), just
  // computed client-side against whatever is currently typed.
  const monthlyInterest = useMemo(() => {
    const p = parseFloat(principal);
    const r = parseFloat(rate);
    if (!p || p <= 0 || !r || r < 0) return null;
    return p * (r / 100);
  }, [principal, rate]);

  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  const submit = async () => {
    if (submittingRef.current) return;
    if (!isEdit && cust.kind === 'none') { notify('Missing', 'Enter the customer’s mobile number'); return; }
    if (!isEdit && cust.kind === 'error') { notify('Missing', cust.message); return; }
    if (!description.trim()) { notify('Missing', 'Describe what is being pledged'); return; }
    const w = parseFloat(weight);
    if (!w || w <= 0) { notify('Missing', 'Enter a weight greater than 0'); return; }
    const p = parseFloat(principal);
    if (!p || p <= 0) { notify('Missing', 'Enter the amount paid to the customer'); return; }
    const r = parseFloat(rate);
    if (!rate || r < 0) { notify('Missing', 'Enter the monthly interest rate'); return; }
    if (!isEdit && !photo) { notify('Missing', 'Add a pledge photo before saving'); return; }

    submittingRef.current = true;
    setSaving(true);
    try {
      let loanId = editId as string;
      if (isEdit) {
        await api.put(`/gold-loans/${editId}`, {
          description: description.trim(), weight: w, pc_count: parseInt(pcCount, 10) || 1,
          estimate_return_date: estimateDate || null, note: note.trim(),
        });
      } else {
        const body: any = {
          description: description.trim(), weight: w, pc_count: parseInt(pcCount, 10) || 1,
          principal: p, interest_rate_percent: r,
          loan_date: loanDate || null, estimate_return_date: estimateDate || null, note: note.trim(),
        };
        if (cust.kind === 'existing') body.customer_id = cust.party.id;
        else if (cust.kind === 'new') body.new_customer = { name: cust.name, mobile: cust.mobile, address: newAddress, notes: '' };

        const created = await api.post<{ id: string }>('/gold-loans', body);
        loanId = created.id;
      }
      // Pledge photo goes to Drive via the record-photos queue, same as
      // repairs/samples — never sent inline in the loan body (that used to
      // make every fetch of this loan, including voucher generation, drag a
      // multi-hundred-KB base64 blob out of Mongo for no reason).
      if (photo && loanId) {
        try {
          const full = await (await fetch(photo)).blob();
          const thumb = await makeThumbFromDataUri(photo);
          const pid = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
          await enqueueRecordPhoto({ id: pid, blob: full, filename: `gold-loan-${loanId}.jpg`, thumb, ref_type: 'gold_loan', ref_id: loanId });
        } catch { /* a failed enqueue shouldn't block navigating away */ }
      }
      if (isEdit) router.back();
      else router.replace(`/loans/${loanId}` as any);
    } catch (e: any) { notify('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); submittingRef.current = false; }
  };

  if (loadingLoan) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }} />
        </View>
        <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="loan-new-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{isEdit ? 'Edit Gold Loan' : 'Loan Against Gold'}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Customer</Text>
          {isEdit ? (
            <View style={[styles.picker, styles.pickerDisabled]} testID="loan-customer-readonly">
              <Text style={styles.pickerValue}>{customerName}</Text>
            </View>
          ) : (
            <PartyByMobile list={allCustomers} mobile={custMobile} onMobile={setCustMobile} name={custName} onName={setCustName} kindLabel="customer" testID="loan-customer">
              <TextInput testID="loan-new-address" value={newAddress} onChangeText={setNewAddress} placeholder="Address (optional)" placeholderTextColor={colors.mutedText} style={[styles.input, { marginTop: spacing.sm }]} multiline />
            </PartyByMobile>
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
            {isEdit ? (
              <View style={[styles.input, styles.readonlyInput]}><Text style={styles.readonlyText}>{fmtINR(parseFloat(principal) || 0)}</Text></View>
            ) : (
              <TextInput testID="loan-principal" value={principal} onChangeText={(v) => setPrincipal(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />
            )}

            <Text style={styles.label}>Interest rate — per month (%)</Text>
            {isEdit ? (
              <View style={[styles.input, styles.readonlyInput]}><Text style={styles.readonlyText}>{rate}%</Text></View>
            ) : (
              <TextInput testID="loan-rate" value={rate} onChangeText={(v) => setRate(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="e.g. 2" placeholderTextColor={colors.mutedText} style={styles.input} />
            )}
            {monthlyInterest !== null && (
              <View style={styles.interestPreview} testID="loan-interest-preview">
                <Text style={styles.interestPreviewLabel}>Interest per month</Text>
                <Text style={styles.interestPreviewValue}>{fmtINR(monthlyInterest)}</Text>
              </View>
            )}
            {!isEdit && <Text style={styles.hintText}>Interest posts automatically each month on the outstanding principal, starting one month after the loan date.</Text>}
            {isEdit && <Text style={styles.hintText}>Amount and rate can&apos;t be changed after the loan is created — close this loan and open a new one for a renegotiation.</Text>}
          </View>

          {isEdit ? (
            <>
              <Text style={styles.label}>Loan date</Text>
              <View style={[styles.input, styles.readonlyInput]}><Text style={styles.readonlyText}>{loanDate}</Text></View>
            </>
          ) : (
            <DateField label="Loan date" value={loanDate} onChange={setLoanDate} testID="loan-date" />
          )}
          <DateField label="Estimated return date (optional)" value={estimateDate} onChange={setEstimateDate} testID="loan-estimate-date" />

          <Text style={styles.label}>Note (optional)</Text>
          <TextInput testID="loan-note" value={note} onChangeText={setNote} placeholder="Anything worth remembering" placeholderTextColor={colors.mutedText} style={styles.input} multiline />

          <Pressable onPress={submit} disabled={saving} style={[styles.submitBtn, saving && { opacity: 0.6 }]} testID="submit-loan-btn">
            {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
              <><Ionicons name="checkmark" size={17} color={colors.onBrandPrimary} /><Text style={styles.submitBtnText}>{isEdit ? 'Save Changes' : 'Save'}</Text></>
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
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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


  picker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 12,
  },
  pickerValue: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  pickerDisabled: { opacity: 0.7 },
  readonlyInput: { justifyContent: 'center' },
  readonlyText: { color: colors.onSurfaceSecondary, fontSize: 14, fontWeight: '600' },

  interestPreview: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 10, marginTop: spacing.sm,
  },
  interestPreviewLabel: { color: colors.mutedText, fontSize: 12, fontWeight: '600' },
  interestPreviewValue: { color: colors.brandPrimary, fontSize: 15, fontWeight: '800' },

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
