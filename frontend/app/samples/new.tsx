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
import { enqueueRecordPhoto } from '@/src/utils/uploadQueue';
import { makeThumbFromDataUri } from '@/src/utils/imageThumb';
import { DueBackField } from '@/src/components/DueBackField';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { KarigarChooser, createKarigar, resolveKarigar } from '@/src/components/KarigarChooser';
import { GlassButton } from '@/src/components/ui/GlassButton';

type Karigar = { id: string; name: string; mobile?: string; active: boolean };
type ItemMaster = { id: string; name: string; purity: number; category: string; active: boolean };
type Sample = {
  id: string; sample_code: string; description: string; tag_number: string;
  weight: number; purity?: number | null; pc_count?: number; issue_type?: string; due_date: string | null;
  photo: string; karigar_id: string; karigar_name: string; note: string;
};

// One sample, one voucher, one save — same screen for issuing a new one
// (POST /samples with a single-item batch) and editing an existing one
// (?id=..., PUT /samples/{id}); editing opens this exact form pre-filled
// instead of a separately-coded copy, so the two never drift apart.
export default function NewSampleScreen() {
  const router = useRouter();
  const { id: editId } = useLocalSearchParams<{ id?: string }>();
  const isEdit = !!editId;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [karigars, setKarigars] = useState<Karigar[]>([]);
  const [issueTypes, setIssueTypes] = useState<string[]>([]);
  const [itemMasters, setItemMasters] = useState<ItemMaster[]>([]);
  const load = useCallback(async () => {
    try { setKarigars((await api.get<Karigar[]>('/karigars')).filter((k) => k.active)); }
    catch (_e) { setKarigars([]); }
    // Owner-configurable at Settings › Masters › Sample Issue Types.
    try { setIssueTypes((await api.get<{ issue_types: string[] }>('/samples/issue-types')).issue_types); }
    catch (_e) { setIssueTypes([]); }
    // Settings › Items & Purity — picking one just pre-fills the Purity %
    // field below (still freely editable after), same as repairs/new.tsx.
    try { setItemMasters(await api.get<ItemMaster[]>('/item-master')); }
    catch (_e) { setItemMasters([]); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const [karigarName, setKarigarName] = useState(''); // display-only in edit mode — the karigar can't be changed after issue
  // Karigar, mobile first (see KarigarChooser): a saved number is that
  // karigar, an unknown one plus a name is a new karigar saved with the sample.
  const [kMobile, setKMobile] = useState('');
  const [kName, setKName] = useState('');
  const [kInHouse, setKInHouse] = useState<Karigar | null>(null);
  const kEntry = resolveKarigar(karigars, kMobile, kName, kInHouse);

  const [issueType, setIssueType] = useState('');
  const [issueTypeOther, setIssueTypeOther] = useState(false);
  const [issueTypePickerOpen, setIssueTypePickerOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [weight, setWeight] = useState('');
  const [pcCount, setPcCount] = useState('1');
  const [purity, setPurity] = useState('');
  const [itemMasterId, setItemMasterId] = useState('');
  const [imPickerOpen, setImPickerOpen] = useState(false);
  const pickItemMaster = (im: ItemMaster) => { setItemMasterId(im.id); setPurity(String(im.purity)); setImPickerOpen(false); };
  // Purity is picked from Settings › Items & Purity and shown as its value;
  // an older sample's purity that matches no item still shows as its %.
  const pickedItem = itemMasters.find((im) => im.id === itemMasterId)
    || (purity ? itemMasters.find((im) => im.active && Math.abs(im.purity - parseFloat(purity)) < 0.001) : undefined);
  const purityLabel = pickedItem ? `${pickedItem.purity}%` : purity ? `${purity}%` : '';   // the value only, e.g. 91.6%
  const [dueDate, setDueDate] = useState('');
  const [photo, setPhoto] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);

  const [loadingSample, setLoadingSample] = useState(isEdit);
  useEffect(() => {
    if (!editId) return;
    (async () => {
      try {
        const s = await api.get<Sample>(`/samples/${editId}`);
        setKarigarName(s.karigar_name);
        setIssueType(s.issue_type || '');
        // issueTypes (fetched in `load`, above) may not have arrived yet —
        // the effect below re-checks once it does.
        setIssueTypeOther(!!s.issue_type && !issueTypes.includes(s.issue_type));
        setDescription(s.description);
        setWeight(String(s.weight ?? '')); setPcCount(String(s.pc_count ?? '1')); setPurity(s.purity ? String(s.purity) : '');
        setDueDate(s.due_date || ''); setPhoto(s.photo || '');
      } catch (e: any) { notify('Failed', e?.detail || 'Could not load this sample'); router.back(); }
      finally { setLoadingSample(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  // Re-checks predefined-vs-Other once issueTypes finishes loading, in case
  // it arrived after the sample fetch above did.
  useEffect(() => {
    if (isEdit && issueType) setIssueTypeOther(!issueTypes.includes(issueType));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueTypes]);

  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  const printIssueSlip = async (sampleId: string) => {
    try { await api.post(`/samples/${sampleId}/issue-slip/print`, {}); }
    catch (e: any) { notify('Print failed', e?.detail || 'Could not reach the printer. Check Printer Settings.'); }
  };

  const submit = async () => {
    if (submittingRef.current) return;
    if (!issueType.trim()) { notify('Missing', issueTypeOther ? 'Type the type of issue' : 'Choose the type of issue'); return; }
    if (!isEdit && kEntry.kind === 'none') { notify('Missing', 'Enter the mobile number of the karigar this sample goes to'); return; }
    if (!isEdit && kEntry.kind === 'error') { notify('Missing', kEntry.message); return; }
    const w = parseFloat(weight);
    if (!w || w <= 0) { notify('Missing', 'Enter a weight greater than 0'); return; }
    const pur = parseFloat(purity);
    if (!pur || pur <= 0 || pur > 100) { notify('Missing', itemMasters.length ? 'Choose the purity' : 'Enter the purity (100 for pure gold, 92 for 22K, 75 for 18K)'); return; }
    // Description is optional; a blank one takes the purity item's name (e.g. "22K") so lists aren't blank.
    const desc = description.trim() || pickedItem?.name || '';
    if (!isEdit && !photo) { notify('Missing', 'Add a photo of the sample before saving'); return; }
    if (!dueDate) { notify('Missing', 'Choose when the sample is due back'); return; }
    submittingRef.current = true;
    setSaving(true);
    try {
      if (isEdit) {
        await api.put(`/samples/${editId}`, {
          description: desc, weight: w, purity: pur, pc_count: parseInt(pcCount, 10) || 1,
          issue_type: issueType.trim(), due_date: dueDate || null, photo,
        });
        router.back();
      } else {
        let kid = kEntry.kind === 'existing' ? kEntry.party.id : '';
        if (kEntry.kind === 'new') {
          // Added to the list, so a retry after a failed save finds it by its number instead of adding it twice.
          const k = await createKarigar(kEntry.name, kEntry.mobile);
          setKarigars((list) => [...list, { id: k.id, name: k.name, mobile: k.mobile, active: true }].sort((a, b) => a.name.localeCompare(b.name)));
          kid = k.id;
        }
        const created = await api.post<{ id: string }[]>('/samples', {
          karigar_id: kid, issue_type: issueType.trim(), due_date: dueDate || null,
          items: [{ description: desc, tag_number: '', weight: w, purity: pur, pc_count: parseInt(pcCount, 10) || 1, photo: '' }],
        });
        const rec = created?.[0];
        if (photo && rec?.id) {
          try {
            const full = await (await fetch(photo)).blob();
            const thumb = await makeThumbFromDataUri(photo);
            const pid = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}`;
            await enqueueRecordPhoto({ id: pid, blob: full, filename: `sample-${rec.id}.jpg`, thumb, ref_type: 'sample', ref_id: rec.id });
          } catch { /* don't block navigation on a queue hiccup */ }
        }
        // Fire-and-forget — same reasoning as repairs/new.tsx: the printer
        // socket has a multi-second timeout and shouldn't stall navigation.
        if (rec?.id) printIssueSlip(rec.id);
        router.replace('/samples' as any);
      }
    } catch (e: any) { notify('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); submittingRef.current = false; }
  };

  if (loadingSample) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <GlassButton onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </GlassButton>
          <View style={{ flex: 1 }} />
        </View>
        <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="sample-new-screen">
      <View style={styles.header}>
        <GlassButton onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </GlassButton>
        <Text style={styles.title}>{isEdit ? 'Edit Sample' : 'Issue Sample'}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Karigar</Text>
          {isEdit ? (
            <View style={[styles.picker, styles.pickerDisabled]} testID="sample-karigar-readonly">
              <Text style={styles.pickerValue}>{karigarName}</Text>
            </View>
          ) : (
            <KarigarChooser
              karigars={karigars} mobile={kMobile} onMobile={setKMobile} name={kName} onName={setKName}
              inHouse={kInHouse} onInHouse={(k) => setKInHouse(k as Karigar | null)}
              testID="sample-karigar"
            />
          )}

          <Text style={styles.label}>Type of Issue</Text>
          <Pressable onPress={() => setIssueTypePickerOpen((v) => !v)} style={styles.picker} testID="sample-issue-type-toggle">
            <Text style={issueType || issueTypeOther ? styles.pickerValue : styles.pickerPlaceholder}>
              {issueTypeOther ? 'Other' : issueType || 'Choose a type'}
            </Text>
            <Ionicons name={issueTypePickerOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedText} />
          </Pressable>
          {issueTypePickerOpen && (
            <ScrollView style={styles.pickerList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {issueTypes.length === 0 && <Text style={[styles.pickerRowMeta, { padding: spacing.md }]}>No types set up yet — Settings › Masters › Sample Issue Types</Text>}
              {issueTypes.map((t) => (
                <Pressable key={t} onPress={() => { setIssueType(t); setIssueTypeOther(false); setIssueTypePickerOpen(false); }} style={styles.pickerRow} testID={`sample-issue-type-${t}`}>
                  <Text style={styles.pickerRowName}>{t}</Text>
                </Pressable>
              ))}
              <Pressable onPress={() => { setIssueType(''); setIssueTypeOther(true); setIssueTypePickerOpen(false); }} style={styles.pickerRow} testID="sample-issue-type-other">
                <Text style={styles.pickerRowName}>Other</Text>
              </Pressable>
            </ScrollView>
          )}
          {issueTypeOther && (
            <TextInput
              testID="sample-issue-type-custom" value={issueType} onChangeText={setIssueType}
              placeholder="Describe the reason" placeholderTextColor={colors.mutedText}
              style={[styles.input, { marginTop: spacing.sm }]}
            />
          )}

          <Text style={styles.label}>Description (optional)</Text>
          <TextInput testID="sample-description" value={description} onChangeText={setDescription} placeholder="e.g. sample ring design" placeholderTextColor={colors.mutedText} style={styles.input} />

          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
            <View style={{ flex: 2 }}>
              <Text style={styles.label}>Weight (g)</Text>
              <TextInput testID="sample-weight" value={weight} onChangeText={(v) => setWeight(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0.000" placeholderTextColor={colors.mutedText} style={styles.input} />
            </View>
            <View style={{ flex: 2 }}>
              <Text style={styles.label}>Purity</Text>
              {itemMasters.length > 0 ? (
                <Pressable onPress={() => setImPickerOpen((v) => !v)} style={[styles.picker, styles.purityPicker]} testID="sample-item-master-toggle">
                  <Text style={purityLabel ? styles.pickerValue : styles.pickerPlaceholder} numberOfLines={1}>{purityLabel || 'Choose'}</Text>
                  <Ionicons name={imPickerOpen ? 'chevron-up' : 'chevron-down'} size={15} color={colors.mutedText} />
                </Pressable>
              ) : (
                // Nothing set up in Settings › Items & Purity yet: type the % instead.
                <TextInput testID="sample-purity" value={purity} onChangeText={(v) => { setPurity(v.replace(/[^0-9.]/g, '')); setItemMasterId(''); }} keyboardType="decimal-pad" placeholder="92 %" placeholderTextColor={colors.mutedText} style={styles.input} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Pieces</Text>
              <TextInput testID="sample-pc-count" value={pcCount} onChangeText={(v) => setPcCount(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" placeholder="1" placeholderTextColor={colors.mutedText} style={styles.input} />
            </View>
            <View>
              <Text style={styles.label}>Photo{!isEdit && <Text style={{ color: colors.onError }}> *</Text>}</Text>
              <Pressable onPress={() => setCameraOpen(true)} style={[styles.photoSmallBtn, !photo && !isEdit && { borderColor: colors.brandPrimary, borderWidth: 1.5 }]}
                testID="sample-photo-btn" accessibilityRole="button" accessibilityLabel={photo ? 'Retake photo' : 'Take photo (required)'}>
                {photo ? <Image source={{ uri: photo }} style={styles.photoSmallImg} /> : <Ionicons name="camera-outline" size={20} color={isEdit ? colors.onSurfaceSecondary : colors.brandSecondary} />}
              </Pressable>
            </View>
          </View>
          {imPickerOpen && (
            <ScrollView style={styles.pickerList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {itemMasters.filter((im) => im.active).map((im) => (
                <Pressable key={im.id} onPress={() => pickItemMaster(im)} style={styles.pickerRow} testID={`sample-item-master-${im.id}`}>
                  <Text style={styles.pickerRowName}>{im.name}</Text>
                  <Text style={styles.pickerRowMeta}>{im.purity}%</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          {!!photo && (
            <Pressable onPress={() => setPhoto('')} style={styles.removePhotoLink} testID="sample-remove-photo">
              <Text style={styles.removePhotoText}>Remove photo</Text>
            </Pressable>
          )}

          <DueBackField label="Due back" value={dueDate} onChange={setDueDate} days={[1, 3, 5]} testID="sample-due-date" />

          <Pressable onPress={submit} disabled={saving} style={[styles.submitBtn, saving && { opacity: 0.6 }]} testID="submit-sample-btn">
            {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
              <>
                <Ionicons name={isEdit ? 'checkmark' : 'print-outline'} size={17} color={colors.onBrandPrimary} />
                <Text style={styles.submitBtnText}>{isEdit ? 'Save Changes' : 'Save & Print'}</Text>
              </>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      <PhotoCaptureModal
        visible={cameraOpen}
        title="Sample Photo"
        onClose={() => setCameraOpen(false)}
        highRes
        onCapture={async (p) => { setPhoto(p); setCameraOpen(false); }}
      />
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
  picker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 12,
  },
  pickerDisabled: { opacity: 0.7 },
  pickerValue: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  pickerPlaceholder: { color: colors.mutedText, fontSize: 14 },
  purityPicker: { paddingHorizontal: spacing.sm },
  pickerList: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginTop: spacing.xs, maxHeight: 220 },
  pickerRow: { paddingHorizontal: spacing.md, paddingVertical: 10 },
  pickerRowName: { color: colors.onSurface, fontSize: 13, fontWeight: '600' },
  pickerRowMeta: { color: colors.mutedText, fontSize: 12 },

  // Small square button — a compact photo affordance living inside the
  // Weight/Pieces row instead of its own full-width "Add Photo" bar.
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
