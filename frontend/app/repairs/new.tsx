import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, Platform, KeyboardAvoidingView, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { PhotoCaptureModal } from '@/src/components/PhotoCaptureModal';
import { enqueueRecordPhoto } from '@/src/utils/uploadQueue';

// Small (~420px) thumbnail kept for fast display after the full image lands in Drive.
async function makeIntakeThumb(dataUri: string): Promise<string> {
  if (typeof document === 'undefined') return '';
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const im = new (window as any).Image(); im.onload = () => res(im); im.onerror = rej; im.src = dataUri;
    });
    const scale = Math.min(1, 420 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7).split(',', 2)[1] || '';
  } catch { return ''; }
}
import { DateField } from '@/src/components/DateField';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Customer = { id: string; name: string; mobile: string; address: string };
type RepairType = { id: string; name: string; default_labour: number; requires_karigar_default: boolean; active: boolean };
type ItemMaster = { id: string; name: string; purity: number; category: string; active: boolean };

type DraftItem = {
  key: string; item_master_id: string; item_type_name: string;
  description: string; repair_type: string;
  gross_weight: string; pc_count: string; labour_charge: string; needs_karigar: boolean;
  due_date: string; notes: string; intake_photo: string;
};

const blankItem = (): DraftItem => ({
  key: String(Date.now() + Math.random()), item_master_id: '', item_type_name: '',
  description: '', repair_type: '',
  gross_weight: '', pc_count: '1', labour_charge: '', needs_karigar: false, due_date: '', notes: '', intake_photo: '',
});

const addDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

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

  // Customer
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [query, setQuery] = useState('');
  const [custPickerOpen, setCustPickerOpen] = useState(false);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [newName, setNewName] = useState('');
  const [newMobile, setNewMobile] = useState('');
  const [newAddress, setNewAddress] = useState('');

  const filteredCustomers = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? allCustomers.filter((c) => c.name.toLowerCase().includes(q) || (c.mobile || '').includes(q))
      : allCustomers;
    return list.slice(0, 100);
  }, [allCustomers, query]);

  const pickCustomer = (c: Customer) => { setSelected(c); setCustPickerOpen(false); setQuery(''); };

  // Items
  const [items, setItems] = useState<DraftItem[]>([]);
  const [draft, setDraft] = useState<DraftItem>(blankItem());
  const [rtPickerOpen, setRtPickerOpen] = useState(false);
  const [imPickerOpen, setImPickerOpen] = useState(false);

  const pickRepairType = (rt: RepairType) => {
    setDraft((d) => ({
      ...d, repair_type: rt.name,
      labour_charge: rt.default_labour ? String(rt.default_labour) : d.labour_charge,
      needs_karigar: rt.requires_karigar_default,
    }));
    setRtPickerOpen(false);
  };

  const pickItemMaster = (im: ItemMaster) => {
    setDraft((d) => ({ ...d, item_master_id: im.id, item_type_name: `${im.name} (${im.purity}%)` }));
    setImPickerOpen(false);
  };

  const addItem = () => {
    if (!draft.description.trim()) { Alert.alert('Missing', 'Enter a description for this item'); return; }
    setItems((prev) => [...prev, draft]);
    setDraft(blankItem());
  };
  const removeItem = (key: string) => setItems((prev) => prev.filter((i) => i.key !== key));

  const [cameraOpen, setCameraOpen] = useState(false);

  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  const submit = async () => {
    if (submittingRef.current) return;
    if (mode === 'existing' && !selected) { Alert.alert('Missing', 'Pick a customer, or switch to New Customer'); return; }
    if (mode === 'new' && !newName.trim()) { Alert.alert('Missing', 'Enter the customer name'); return; }
    // Same rule as a ledger account: a new party must have a mobile number.
    if (mode === 'new' && newMobile.replace(/\D/g, '').length < 7) { Alert.alert('Missing', 'A mobile number is required for a new customer'); return; }
    if (items.length === 0) { Alert.alert('Missing', 'Add at least one item to this order'); return; }
    submittingRef.current = true;
    setSaving(true);
    try {
      const body: any = {
        items: items.map((i) => ({
          item_master_id: i.item_master_id || null,
          description: i.description.trim(), repair_type: i.repair_type,
          gross_weight: parseFloat(i.gross_weight) || 0, pc_count: parseInt(i.pc_count, 10) || 1,
          labour_charge: parseFloat(i.labour_charge) || 0, needs_karigar: i.needs_karigar,
          // Intake photos no longer live as base64 on the item — the high-res
          // goes to Drive via the record-photos queue after the item is created.
          due_date: i.due_date || null, notes: i.notes, intake_photo: '',
        })),
      };
      if (mode === 'existing') body.customer_id = selected!.id;
      else body.new_customer = { name: newName.trim(), mobile: newMobile, address: newAddress, notes: '' };

      const res = await api.post<{ order: { id: string }; items: { id: string }[] }>('/repair-orders', body);
      // Queue each captured intake photo against its freshly-created item
      // (the response returns items in the same order we sent them).
      await Promise.all(items.map(async (it, idx) => {
        const created = res.items?.[idx];
        if (!it.intake_photo || !created?.id) return;
        try {
          const full = await (await fetch(it.intake_photo)).blob();
          const thumb = await makeIntakeThumb(it.intake_photo);
          const pid = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${idx}`;
          await enqueueRecordPhoto({ id: pid, blob: full, filename: `repair-${created.id}.jpg`, thumb, ref_type: 'repair_item', ref_id: created.id });
        } catch { /* a failed enqueue shouldn't block navigating to the order */ }
      }));
      router.replace(`/repairs/${res.order.id}` as any);
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); submittingRef.current = false; }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="repair-new-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>New Repair Intake</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.section}>Customer</Text>
          <View style={styles.chipRow}>
            <Pressable onPress={() => setMode('existing')} style={[styles.chip, mode === 'existing' && styles.chipActive]} testID="mode-existing">
              <Text style={[styles.chipText, mode === 'existing' && styles.chipTextActive]}>Existing Customer</Text>
            </Pressable>
            <Pressable onPress={() => setMode('new')} style={[styles.chip, mode === 'new' && styles.chipActive]} testID="mode-new">
              <Text style={[styles.chipText, mode === 'new' && styles.chipTextActive]}>New Customer</Text>
            </Pressable>
          </View>

          {mode === 'existing' ? (
            selected ? (
              <View style={styles.selectedCard} testID="selected-customer">
                <View style={{ flex: 1 }}>
                  <Text style={styles.cName}>{selected.name}</Text>
                  <Text style={styles.cMeta}>{selected.mobile || 'No mobile on file'}</Text>
                </View>
                <Pressable onPress={() => setSelected(null)} style={styles.smallBtn} testID="change-customer-btn">
                  <Text style={styles.smallBtnText}>Change</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <Pressable onPress={() => setCustPickerOpen((v) => !v)} style={styles.picker} testID="customer-picker-toggle">
                  <Text style={styles.pickerPlaceholder}>Choose a customer</Text>
                  <Ionicons name={custPickerOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedText} />
                </Pressable>
                {custPickerOpen && (
                  <View style={styles.pickerList} testID="customer-picker-list">
                    <View style={[styles.searchRow, { marginHorizontal: spacing.sm, marginTop: spacing.sm }]}>
                      <Ionicons name="search-outline" size={16} color={colors.mutedText} />
                      <TextInput
                        testID="customer-search" value={query} onChangeText={setQuery} autoFocus
                        placeholder="Search by name or mobile" placeholderTextColor={colors.mutedText}
                        style={styles.searchInput}
                      />
                    </View>
                    <ScrollView style={{ maxHeight: 260 }} keyboardShouldPersistTaps="handled">
                      {filteredCustomers.length === 0 ? (
                        <Text style={[styles.pickerRowMeta, { padding: spacing.md }]}>No customers found</Text>
                      ) : filteredCustomers.map((c) => (
                        <Pressable key={c.id} onPress={() => pickCustomer(c)} style={styles.pickerRow} testID={`customer-result-${c.id}`}>
                          <Text style={styles.pickerRowName}>{c.name}</Text>
                          <Text style={styles.pickerRowMeta}>{c.mobile || '—'}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </>
            )
          ) : (
            <View style={styles.formCard} testID="new-customer-form">
              <Text style={styles.label}>Name</Text>
              <TextInput testID="new-customer-name" value={newName} onChangeText={setNewName} placeholder="Customer name" placeholderTextColor={colors.mutedText} style={styles.input} />
              <Text style={styles.label}>Mobile <Text style={{ color: colors.onError }}>*</Text></Text>
              <TextInput testID="new-customer-mobile" value={newMobile} onChangeText={setNewMobile} keyboardType="phone-pad" placeholder="98xxxxxxxx" placeholderTextColor={colors.mutedText} style={styles.input} />
              <Text style={styles.label}>Address (optional)</Text>
              <TextInput testID="new-customer-address" value={newAddress} onChangeText={setNewAddress} placeholder="Address" placeholderTextColor={colors.mutedText} style={styles.input} />
            </View>
          )}

          <Text style={[styles.section, { marginTop: spacing.xl }]}>Add Item</Text>
          <View style={styles.formCard} testID="item-draft-form">
            <Text style={styles.label}>Item</Text>
            <Pressable onPress={() => setImPickerOpen((v) => !v)} style={styles.picker} testID="item-im-toggle">
              <Text style={draft.item_type_name ? styles.pickerValue : styles.pickerPlaceholder}>{draft.item_type_name || 'Choose an item type (optional)'}</Text>
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

            <View style={styles.row2}>
              <View style={{ flex: 1.6 }}>
                <Text style={styles.label}>Description</Text>
                <TextInput testID="item-description" value={draft.description} onChangeText={(v) => setDraft((d) => ({ ...d, description: v }))} placeholder="e.g. Gold chain, clasp" placeholderTextColor={colors.mutedText} style={styles.input} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Weight (g)</Text>
                <TextInput testID="item-weight" value={draft.gross_weight} onChangeText={(v) => setDraft((d) => ({ ...d, gross_weight: v.replace(/[^0-9.]/g, '') }))} keyboardType="decimal-pad" placeholder="0.000" placeholderTextColor={colors.mutedText} style={styles.input} />
              </View>
            </View>

            <View style={styles.row2}>
              <View style={{ flex: 1.4 }}>
                <Text style={styles.label}>Repair Type</Text>
                <Pressable onPress={() => setRtPickerOpen((v) => !v)} style={styles.picker} testID="item-rt-toggle">
                  <Text style={draft.repair_type ? styles.pickerValue : styles.pickerPlaceholder} numberOfLines={1}>{draft.repair_type || 'Choose'}</Text>
                  <Ionicons name={rtPickerOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedText} />
                </Pressable>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Labour (₹)</Text>
                <TextInput testID="item-labour" value={draft.labour_charge} onChangeText={(v) => setDraft((d) => ({ ...d, labour_charge: v.replace(/[^0-9.]/g, '') }))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={styles.input} />
              </View>
            </View>
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

            <DateField label="Due Date" value={draft.due_date} onChange={(v) => setDraft((d) => ({ ...d, due_date: v }))} testID="item-due" />
            <View style={styles.chipRow}>
              {[1, 3, 7, 15, 30].map((n) => (
                <Pressable key={n} onPress={() => setDraft((d) => ({ ...d, due_date: addDays(n) }))} style={styles.dayChip} testID={`due-in-${n}`}>
                  <Text style={styles.dayChipText}>+{n}d</Text>
                </Pressable>
              ))}
            </View>

            <Pressable onPress={() => setDraft((d) => ({ ...d, needs_karigar: !d.needs_karigar }))} style={styles.checkRow} testID="item-needs-karigar">
              <View style={[styles.checkbox, draft.needs_karigar && styles.checkboxOn]}>{draft.needs_karigar && <Ionicons name="checkmark" size={13} color={colors.onBrandPrimary} />}</View>
              <Text style={styles.checkLabel}>Needs to be issued to a karigar</Text>
            </Pressable>

            <Text style={styles.label}>Reference Photo (optional)</Text>
            {draft.intake_photo ? (
              <View style={styles.photoRow}>
                <Image source={{ uri: draft.intake_photo }} style={styles.photoThumb} />
                <Pressable onPress={() => setCameraOpen(true)} style={styles.smallBtn} testID="item-retake-photo">
                  <Text style={styles.smallBtnText}>Retake</Text>
                </Pressable>
                <Pressable onPress={() => setDraft((d) => ({ ...d, intake_photo: '' }))} style={styles.delBtn} hitSlop={10} testID="item-remove-photo">
                  <Ionicons name="close" size={16} color={colors.onError} />
                </Pressable>
              </View>
            ) : (
              <Pressable onPress={() => setCameraOpen(true)} style={styles.photoBtn} testID="item-add-photo">
                <Ionicons name="camera-outline" size={16} color={colors.onSurfaceSecondary} />
                <Text style={styles.actionBtnText}>Add Photo</Text>
              </Pressable>
            )}

            <Pressable onPress={addItem} style={styles.addItemBtn} testID="add-item-btn">
              <Ionicons name="add" size={16} color={colors.onBrandPrimary} />
              <Text style={styles.addItemBtnText}>Add Item to Order</Text>
            </Pressable>
          </View>

          {items.length > 0 && (
            <>
              <Text style={[styles.section, { marginTop: spacing.xl }]}>Items in this Order · {items.length}</Text>
              {items.map((i) => (
                <View key={i.key} style={styles.itemRow} testID={`draft-item-${i.key}`}>
                  {i.intake_photo ? <Image source={{ uri: i.intake_photo }} style={styles.itemThumb} /> : null}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cName}>{i.item_type_name ? `${i.item_type_name} · ` : ''}{i.description}</Text>
                    <Text style={styles.cMeta}>{i.repair_type || 'No type'} · {i.gross_weight || '0'}g · ₹{i.labour_charge || '0'}{i.needs_karigar ? ' · karigar' : ''}</Text>
                  </View>
                  <Pressable onPress={() => removeItem(i.key)} style={styles.delBtn} hitSlop={10} testID={`remove-item-${i.key}`}>
                    <Ionicons name="close" size={16} color={colors.onError} />
                  </Pressable>
                </View>
              ))}
            </>
          )}

          <Pressable onPress={submit} disabled={saving || items.length === 0} style={[styles.submitBtn, (saving || items.length === 0) && { opacity: 0.5 }]} testID="submit-order-btn">
            {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.submitBtnText}>{items.length === 0 ? 'Add an item first' : 'Create Repair Order'}</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      <PhotoCaptureModal
        visible={cameraOpen}
        title="Item Photo"
        highRes
        onClose={() => setCameraOpen(false)}
        onCapture={async (photo) => { setDraft((d) => ({ ...d, intake_photo: photo })); setCameraOpen(false); }}
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
  chip: { flexGrow: 1, alignItems: 'center', paddingVertical: 10, paddingHorizontal: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: colors.onBrandPrimary },
  dayChip: { paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  dayChipText: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: '700' },

  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, marginBottom: spacing.sm,
  },
  searchInput: { flex: 1, color: colors.onSurface, paddingVertical: 12, fontSize: 14 },
  resultRow: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  selectedCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md,
  },

  formCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },
  row2: { flexDirection: 'row', gap: spacing.sm },
  picker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
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

  photoBtn: {
    flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: 12, marginTop: 4,
  },
  actionBtnText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 },
  photoThumb: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  itemThumb: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },

  addItemBtn: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: 12, marginTop: spacing.md,
  },
  addItemBtnText: { color: colors.onSurface, fontWeight: '700', fontSize: 13 },

  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  cName: { color: colors.onSurface, fontWeight: '700', fontSize: 14 },
  cMeta: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  smallBtn: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: colors.border },
  smallBtnText: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: '700' },
  delBtn: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: colors.error,
    borderColor: colors.onError, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },

  submitBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 15, alignItems: 'center', marginTop: spacing.xl },
  submitBtnText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 15 },
});
