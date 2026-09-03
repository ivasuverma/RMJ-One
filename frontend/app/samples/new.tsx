import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, Platform, KeyboardAvoidingView, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { PhotoCaptureModal } from '@/src/components/PhotoCaptureModal';
import { enqueueRecordPhoto } from '@/src/utils/uploadQueue';
import { makeThumbFromDataUri } from '@/src/utils/imageThumb';
import { DateField } from '@/src/components/DateField';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Karigar = { id: string; name: string; active: boolean };
type Sample = {
  id: string; sample_code: string; description: string; tag_number: string;
  weight: number; pc_count?: number; issue_type?: string; due_date: string | null;
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
  const load = useCallback(async () => {
    try { setKarigars((await api.get<Karigar[]>('/karigars')).filter((k) => k.active)); }
    catch (_e) { setKarigars([]); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const [karigarId, setKarigarId] = useState('');
  const [karigarName, setKarigarName] = useState(''); // display-only in edit mode — the karigar can't be changed after issue
  const [karigarPickerOpen, setKarigarPickerOpen] = useState(false);
  const pickedKarigar = karigars.find((k) => k.id === karigarId) || null;

  const [issueType, setIssueType] = useState('');
  const [description, setDescription] = useState('');
  const [weight, setWeight] = useState('');
  const [pcCount, setPcCount] = useState('1');
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);

  const [loadingSample, setLoadingSample] = useState(isEdit);
  useEffect(() => {
    if (!editId) return;
    (async () => {
      try {
        const s = await api.get<Sample>(`/samples/${editId}`);
        setKarigarId(s.karigar_id); setKarigarName(s.karigar_name);
        setIssueType(s.issue_type || ''); setDescription(s.description);
        setWeight(String(s.weight ?? '')); setPcCount(String(s.pc_count ?? '1'));
        setDueDate(s.due_date || ''); setNote(s.note || ''); setPhoto(s.photo || '');
      } catch (e: any) { Alert.alert('Failed', e?.detail || 'Could not load this sample'); router.back(); }
      finally { setLoadingSample(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  const printIssueSlip = async (sampleId: string) => {
    try { await api.post(`/samples/${sampleId}/issue-slip/print`, {}); }
    catch (e: any) { Alert.alert('Print failed', e?.detail || 'Could not reach the printer. Check Store Settings.'); }
  };

  const submit = async () => {
    if (submittingRef.current) return;
    if (!isEdit && !karigarId) { Alert.alert('Missing', 'Pick which karigar this sample goes to'); return; }
    if (!description.trim()) { Alert.alert('Missing', 'Describe the sample piece'); return; }
    const w = parseFloat(weight);
    if (!w || w <= 0) { Alert.alert('Missing', 'Enter a weight greater than 0'); return; }
    submittingRef.current = true;
    setSaving(true);
    try {
      if (isEdit) {
        await api.put(`/samples/${editId}`, {
          description: description.trim(), weight: w, pc_count: parseInt(pcCount, 10) || 1,
          issue_type: issueType.trim(), due_date: dueDate || null, photo, note,
        });
        router.back();
      } else {
        const created = await api.post<{ id: string }[]>('/samples', {
          karigar_id: karigarId, note: note.trim(), issue_type: issueType.trim(), due_date: dueDate || null,
          items: [{ description: description.trim(), tag_number: '', weight: w, pc_count: parseInt(pcCount, 10) || 1, photo: '' }],
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
        if (rec?.id) await printIssueSlip(rec.id);
        router.replace('/samples' as any);
      }
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); submittingRef.current = false; }
  };

  if (loadingSample) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }} />
        </View>
        <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="sample-new-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
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
            <>
              <Pressable onPress={() => setKarigarPickerOpen((v) => !v)} style={styles.picker} testID="sample-karigar-toggle">
                <Text style={pickedKarigar ? styles.pickerValue : styles.pickerPlaceholder}>{pickedKarigar ? pickedKarigar.name : 'Choose a karigar'}</Text>
                <Ionicons name={karigarPickerOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedText} />
              </Pressable>
              {karigarPickerOpen && (
                <View style={styles.pickerList}>
                  {karigars.map((k) => (
                    <Pressable key={k.id} onPress={() => { setKarigarId(k.id); setKarigarPickerOpen(false); }} style={styles.pickerRow} testID={`sample-karigar-${k.id}`}>
                      <Text style={styles.pickerRowName}>{k.name}</Text>
                    </Pressable>
                  ))}
                  {karigars.length === 0 && <Text style={[styles.pickerRowMeta, { padding: spacing.md }]}>No karigars set up yet</Text>}
                </View>
              )}
            </>
          )}

          <Text style={styles.label}>Type of Issue (optional)</Text>
          <TextInput testID="sample-issue-type" value={issueType} onChangeText={setIssueType} placeholder="e.g. Quoting, Reference, Exhibition" placeholderTextColor={colors.mutedText} style={styles.input} />

          <Text style={styles.label}>Description</Text>
          <TextInput testID="sample-description" value={description} onChangeText={setDescription} placeholder="e.g. 22K sample ring design" placeholderTextColor={colors.mutedText} style={styles.input} />

          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
            <View style={{ flex: 2 }}>
              <Text style={styles.label}>Weight (g)</Text>
              <TextInput testID="sample-weight" value={weight} onChangeText={(v) => setWeight(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0.000" placeholderTextColor={colors.mutedText} style={styles.input} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Pieces</Text>
              <TextInput testID="sample-pc-count" value={pcCount} onChangeText={(v) => setPcCount(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" placeholder="1" placeholderTextColor={colors.mutedText} style={styles.input} />
            </View>
            <Pressable onPress={() => setCameraOpen(true)} style={styles.photoSmallBtn} testID="sample-photo-btn">
              {photo ? <Image source={{ uri: photo }} style={styles.photoSmallImg} /> : <Ionicons name="camera-outline" size={20} color={colors.onSurfaceSecondary} />}
            </Pressable>
          </View>
          {!!photo && (
            <Pressable onPress={() => setPhoto('')} style={styles.removePhotoLink} testID="sample-remove-photo">
              <Text style={styles.removePhotoText}>Remove photo</Text>
            </Pressable>
          )}

          <DateField label="Due back (optional)" value={dueDate} onChange={setDueDate} testID="sample-due-date" />

          <Text style={styles.label}>Note (optional)</Text>
          <TextInput testID="sample-note" value={note} onChangeText={setNote} placeholder="Anything worth remembering" placeholderTextColor={colors.mutedText} style={styles.input} multiline />

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
