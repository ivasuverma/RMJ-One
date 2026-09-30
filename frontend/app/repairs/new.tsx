import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Platform, KeyboardAvoidingView, Image,
} from 'react-native';
import { notify } from '@/src/utils/notify';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { PhotoCaptureModal } from '@/src/components/PhotoCaptureModal';
import { enqueueRecordPhoto } from '@/src/utils/uploadQueue';
import { makeThumbFromDataUri } from '@/src/utils/imageThumb';
import { DateField } from '@/src/components/DateField';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { PartyByMobile, resolveParty } from '@/src/components/PartyByMobile';

type Customer = { id: string; name: string; mobile: string; address: string };
type RepairType = { id: string; name: string; default_labour: number; requires_karigar_default: boolean; active: boolean };
type ItemMaster = { id: string; name: string; purity: number; category: string; active: boolean };

const addDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// One item, one intake, one save — matches the same simplification already
// applied to Stock In/Out and Gold Loans: no batch-building UI, a small
// side photo button instead of a full-width bar, and a single "Save &
// Print" action that creates the order and immediately prints the
// customer's copy (the item tag is still printable separately from the
// order screen, for however many pieces the order ends up with).
export default function NewRepairOrderScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [repairTypes, setRepairTypes] = useState<RepairType[]>([]);
  const [itemMasters, setItemMasters] = useState<ItemMaster[]>([]);
  const [allCustomers, setAllCustomers] = useState<Customer[]>([]);
  const load = useCallback(async () => {
    try {
      const [rt, im, cu] = await Promise.all([
        api.get<RepairType[]>('/repair-types'), api.get<ItemMaster[]>('/item-master'), api.get<Customer[]>('/customers'),
      ]);
      setRepairTypes(rt); setItemMasters(im); setAllCustomers(cu);
    } catch (_e) { setRepairTypes([]); setItemMasters([]); setAllCustomers([]); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Customer, mobile first (see PartyByMobile): a saved number is that
  // customer, an unknown one plus a name is a new customer.
  const [custMobile, setCustMobile] = useState('');
  const [custName, setCustName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const cust = resolveParty(allCustomers, custMobile, custName, 'customer');

  // The one item
  const [itemMasterId, setItemMasterId] = useState('');
  const [itemTypeName, setItemTypeName] = useState('');
  const [description, setDescription] = useState('');
  const [repairType, setRepairType] = useState('');
  const [weight, setWeight] = useState('');
  const [labour, setLabour] = useState('');
  const [needsKarigar, setNeedsKarigar] = useState(false);
  const [dueDate, setDueDate] = useState('');
  const [photo, setPhoto] = useState('');
  const [rtPickerOpen, setRtPickerOpen] = useState(false);
  const [imPickerOpen, setImPickerOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  const pickRepairType = (rt: RepairType) => {
    setRepairType(rt.name);
    if (rt.default_labour) setLabour(String(rt.default_labour));
    setNeedsKarigar(rt.requires_karigar_default);
    setRtPickerOpen(false);
  };
  const pickItemMaster = (im: ItemMaster) => {
    setItemMasterId(im.id); setItemTypeName(`${im.name} (${im.purity}%)`);
    setImPickerOpen(false);
  };

  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  const submit = async () => {
    if (submittingRef.current) return;
    if (cust.kind === 'none') { notify('Missing', 'Enter the customer’s mobile number'); return; }
    if (cust.kind === 'error') { notify('Missing', cust.message); return; }
    if (!description.trim()) { notify('Missing', 'Enter a description for the item'); return; }
    if (!photo) { notify('Missing', 'Add a photo of the item before saving'); return; }
    submittingRef.current = true;
    setSaving(true);
    try {
      const body: any = {
        items: [{
          item_master_id: itemMasterId || null,
          description: description.trim(), repair_type: repairType,
          gross_weight: parseFloat(weight) || 0, pc_count: 1,
          labour_charge: parseFloat(labour) || 0, needs_karigar: needsKarigar,
          // Intake photo goes to Drive via the record-photos queue after create.
          due_date: dueDate || null, notes: '', intake_photo: '',
        }],
      };
      if (cust.kind === 'existing') body.customer_id = cust.party.id;
      else if (cust.kind === 'new') body.new_customer = { name: cust.name, mobile: cust.mobile, address: newAddress, notes: '' };

      const res = await api.post<{ order: { id: string }; items: { id: string }[] }>('/repair-orders', body);
      const createdItem = res.items?.[0];
      if (photo && createdItem?.id) {
        try {
          const full = await (await fetch(photo)).blob();
          const thumb = await makeThumbFromDataUri(photo);
          const pid = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}`;
          await enqueueRecordPhoto({ id: pid, blob: full, filename: `repair-${createdItem.id}.jpg`, thumb, ref_type: 'repair_item', ref_id: createdItem.id });
        } catch { /* a failed enqueue shouldn't block navigating to the order */ }
      }
      // Fire-and-forget — the printer socket has a multi-second timeout, and
      // awaiting it here would stall navigation whenever it's unreachable.
      api.post(`/repair-orders/${res.order.id}/slip/print`, {}).catch(() => { /* saved either way */ });
      router.replace(`/repairs/${res.order.id}` as any);
    } catch (e: any) { notify('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); submittingRef.current = false; }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="repair-new-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>New Repair Intake</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.section}>Customer</Text>
          <PartyByMobile list={allCustomers} mobile={custMobile} onMobile={setCustMobile} name={custName} onName={setCustName} kindLabel="customer" testID="customer">
            <Text style={styles.label}>Address (optional)</Text>
            <TextInput testID="new-customer-address" value={newAddress} onChangeText={setNewAddress} placeholder="Address" placeholderTextColor={colors.mutedText} style={styles.input} />
          </PartyByMobile>

          <Text style={[styles.section, { marginTop: spacing.xl }]}>Item</Text>
          <Pressable onPress={() => setImPickerOpen((v) => !v)} style={styles.picker} testID="item-im-toggle">
            <Text style={itemTypeName ? styles.pickerValue : styles.pickerPlaceholder}>{itemTypeName || 'Choose an item type (optional)'}</Text>
            <Ionicons name={imPickerOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedText} />
          </Pressable>
          {imPickerOpen && (
            <View style={styles.pickerList}>
              {itemMasters.filter((im) => im.active).map((im) => (
                <Pressable key={im.id} onPress={() => pickItemMaster(im)} style={styles.pickerRow} testID={`item-im-${im.id}`}>
                  <Text style={styles.pickerRowName}>{im.name}</Text>
                  <Text style={styles.pickerRowMeta}>{im.purity}%</Text>
                </Pressable>
              ))}
              {itemMasters.length === 0 && <Text style={[styles.pickerRowMeta, { padding: spacing.md }]}>No items set up yet — set purity for one in Utility &gt; Items &amp; Purity</Text>}
            </View>
          )}

          <Text style={styles.label}>Description</Text>
          <TextInput testID="item-description" value={description} onChangeText={setDescription} placeholder="e.g. Gold chain, clasp" placeholderTextColor={colors.mutedText} style={styles.input} />

          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
            <View style={{ flex: 1.4 }}>
              <Text style={styles.label}>Repair Type</Text>
              <Pressable onPress={() => setRtPickerOpen((v) => !v)} style={styles.picker} testID="item-rt-toggle">
                <Text style={repairType ? styles.pickerValue : styles.pickerPlaceholder} numberOfLines={1}>{repairType || 'Choose'}</Text>
                <Ionicons name={rtPickerOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedText} />
              </Pressable>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Weight (g)</Text>
              <TextInput testID="item-weight" value={weight} onChangeText={(v) => setWeight(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0.000" placeholderTextColor={colors.mutedText} style={styles.input} />
            </View>
            <Pressable onPress={() => setCameraOpen(true)} style={styles.photoSmallBtn} testID="item-photo-btn">
              {photo ? <Image source={{ uri: photo }} style={styles.photoSmallImg} /> : <Ionicons name="camera-outline" size={20} color={colors.onSurfaceSecondary} />}
            </Pressable>
          </View>
          {!!photo && (
            <Pressable onPress={() => setPhoto('')} style={styles.removePhotoLink} testID="item-remove-photo">
              <Text style={styles.removePhotoText}>Remove photo</Text>
            </Pressable>
          )}
          {rtPickerOpen && (
            <View style={styles.pickerList}>
              {repairTypes.filter((rt) => rt.active).map((rt) => (
                <Pressable key={rt.id} onPress={() => pickRepairType(rt)} style={styles.pickerRow} testID={`item-rt-${rt.id}`}>
                  <Text style={styles.pickerRowName}>{rt.name}</Text>
                  <Text style={styles.pickerRowMeta}>₹{rt.default_labour.toFixed(0)}</Text>
                </Pressable>
              ))}
              {repairTypes.length === 0 && <Text style={[styles.pickerRowMeta, { padding: spacing.md }]}>No repair types set up yet</Text>}
            </View>
          )}

          <Text style={styles.label}>Labour (₹)</Text>
          <TextInput testID="item-labour" value={labour} onChangeText={(v) => setLabour(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />

          <DateField label="Due Date" value={dueDate} onChange={setDueDate} testID="item-due" />
          <View style={styles.chipRow}>
            {[1, 3, 7, 15, 30].map((n) => (
              <Pressable key={n} onPress={() => setDueDate(addDays(n))} style={styles.dayChip} testID={`due-in-${n}`}>
                <Text style={styles.dayChipText}>+{n}d</Text>
              </Pressable>
            ))}
          </View>

          <Pressable onPress={() => setNeedsKarigar((v) => !v)} style={styles.checkRow} testID="item-needs-karigar">
            <View style={[styles.checkbox, needsKarigar && styles.checkboxOn]}>{needsKarigar && <Ionicons name="checkmark" size={13} color={colors.onBrandPrimary} />}</View>
            <Text style={styles.checkLabel}>Needs to be issued to a karigar</Text>
          </Pressable>

          <Pressable onPress={submit} disabled={saving} style={[styles.submitBtn, saving && { opacity: 0.6 }]} testID="submit-order-btn">
            {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
              <><Ionicons name="print-outline" size={17} color={colors.onBrandPrimary} /><Text style={styles.submitBtnText}>Save & Print</Text></>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      <PhotoCaptureModal
        visible={cameraOpen}
        title="Item Photo"
        highRes
        onClose={() => setCameraOpen(false)}
        onCapture={async (p) => { setPhoto(p); setCameraOpen(false); }}
      />
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

  section: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm },
  chipRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md, flexWrap: 'wrap' },
  dayChip: { paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  dayChipText: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: '700' },


  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6, marginTop: spacing.md },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },
  picker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 12,
  },
  pickerValue: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  pickerPlaceholder: { color: colors.mutedText, fontSize: 14 },
  pickerList: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginTop: spacing.xs, maxHeight: 220 },
  pickerRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: 10 },
  pickerRowName: { color: colors.onSurface, fontSize: 13, fontWeight: '600' },
  pickerRowMeta: { color: colors.mutedText, fontSize: 12 },

  checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.sm },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  checkboxOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  checkLabel: { color: colors.onSurfaceSecondary, fontSize: 13 },

  photoSmallBtn: {
    width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  photoSmallImg: { width: '100%', height: '100%' },
  removePhotoLink: { alignSelf: 'flex-end', marginTop: 6 },
  removePhotoText: { color: colors.onError, fontSize: 11, fontWeight: '700' },


  submitBtn: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 15, marginTop: spacing.xl,
  },
  submitBtnText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 15 },
});
