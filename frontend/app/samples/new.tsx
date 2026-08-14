import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, Platform, KeyboardAvoidingView, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { PhotoCaptureModal } from '@/src/components/PhotoCaptureModal';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Karigar = { id: string; name: string; active: boolean };

type DraftSample = { key: string; description: string; tag_number: string; weight: string; photo: string };
const blankDraft = (): DraftSample => ({ key: String(Date.now() + Math.random()), description: '', tag_number: '', weight: '', photo: '' });

export default function NewSampleScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [karigars, setKarigars] = useState<Karigar[]>([]);
  const load = useCallback(async () => {
    try { setKarigars((await api.get<Karigar[]>('/karigars')).filter((k) => k.active)); }
    catch (_e) { setKarigars([]); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const [karigarId, setKarigarId] = useState('');
  const [karigarPickerOpen, setKarigarPickerOpen] = useState(false);
  const pickedKarigar = karigars.find((k) => k.id === karigarId) || null;

  const [note, setNote] = useState('');
  const [items, setItems] = useState<DraftSample[]>([]);
  const [draft, setDraft] = useState<DraftSample>(blankDraft());
  const [cameraOpen, setCameraOpen] = useState(false);

  const addItem = () => {
    if (!draft.description.trim()) { Alert.alert('Missing', 'Describe the sample piece'); return; }
    const w = parseFloat(draft.weight);
    if (!w || w <= 0) { Alert.alert('Missing', 'Enter a weight greater than 0'); return; }
    setItems((prev) => [...prev, draft]);
    setDraft(blankDraft());
  };
  const removeItem = (key: string) => setItems((prev) => prev.filter((i) => i.key !== key));

  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  const submit = async () => {
    if (submittingRef.current) return;
    if (!karigarId) { Alert.alert('Missing', 'Pick which karigar these samples go to'); return; }
    if (items.length === 0) { Alert.alert('Missing', 'Add at least one sample to issue'); return; }
    submittingRef.current = true;
    setSaving(true);
    try {
      await api.post('/samples', {
        karigar_id: karigarId, note: note.trim(),
        items: items.map((i) => ({
          description: i.description.trim(), tag_number: i.tag_number.trim(),
          weight: parseFloat(i.weight) || 0, photo: i.photo,
        })),
      });
      router.replace('/samples' as any);
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); submittingRef.current = false; }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="sample-new-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Issue Sample(s)</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.section}>Karigar</Text>
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

          <Text style={[styles.section, { marginTop: spacing.xl }]}>Add Sample</Text>
          <View style={styles.formCard} testID="sample-draft-form">
            <Text style={styles.label}>Description</Text>
            <TextInput testID="sample-description" value={draft.description} onChangeText={(v) => setDraft((d) => ({ ...d, description: v }))} placeholder="e.g. 22K sample ring design" placeholderTextColor={colors.mutedText} style={styles.input} />

            <Text style={styles.label}>Tag Number (optional)</Text>
            <TextInput testID="sample-tag-number" value={draft.tag_number} onChangeText={(v) => setDraft((d) => ({ ...d, tag_number: v }))} placeholder="e.g. T-104" placeholderTextColor={colors.mutedText} style={styles.input} />

            <Text style={styles.label}>Weight (g)</Text>
            <TextInput testID="sample-weight" value={draft.weight} onChangeText={(v) => setDraft((d) => ({ ...d, weight: v.replace(/[^0-9.]/g, '') }))} keyboardType="decimal-pad" placeholder="0.000" placeholderTextColor={colors.mutedText} style={styles.input} />

            <Text style={styles.label}>Photo (optional)</Text>
            {draft.photo ? (
              <View style={styles.photoRow}>
                <Image source={{ uri: draft.photo }} style={styles.photoThumb} />
                <Pressable onPress={() => setCameraOpen(true)} style={styles.smallBtn} testID="sample-retake-photo">
                  <Text style={styles.smallBtnText}>Retake</Text>
                </Pressable>
                <Pressable onPress={() => setDraft((d) => ({ ...d, photo: '' }))} style={styles.delBtn} hitSlop={10} testID="sample-remove-photo">
                  <Ionicons name="close" size={16} color={colors.onError} />
                </Pressable>
              </View>
            ) : (
              <Pressable onPress={() => setCameraOpen(true)} style={styles.photoBtn} testID="sample-add-photo">
                <Ionicons name="camera-outline" size={16} color={colors.onSurfaceSecondary} />
                <Text style={styles.smallBtnText}>Add Photo</Text>
              </Pressable>
            )}

            <Pressable onPress={addItem} style={styles.addItemBtn} testID="add-sample-btn">
              <Ionicons name="add" size={16} color={colors.onBrandPrimary} />
              <Text style={styles.addItemBtnText}>Add Sample to Batch</Text>
            </Pressable>
          </View>

          {items.length > 0 && (
            <>
              <Text style={[styles.section, { marginTop: spacing.xl }]}>Samples to Issue · {items.length}</Text>
              {items.map((i) => (
                <View key={i.key} style={styles.itemRow} testID={`draft-sample-${i.key}`}>
                  {i.photo ? <Image source={{ uri: i.photo }} style={styles.itemThumb} /> : null}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cName}>{i.tag_number ? `Tag ${i.tag_number} · ` : ''}{i.description}</Text>
                    <Text style={styles.cMeta}>{i.weight || '0'}g</Text>
                  </View>
                  <Pressable onPress={() => removeItem(i.key)} style={styles.delBtn} hitSlop={10} testID={`remove-sample-${i.key}`}>
                    <Ionicons name="close" size={16} color={colors.onError} />
                  </Pressable>
                </View>
              ))}
            </>
          )}

          <Text style={[styles.section, { marginTop: spacing.xl }]}>Note (optional, applies to this batch)</Text>
          <TextInput testID="sample-batch-note" value={note} onChangeText={setNote} placeholder="Anything worth remembering" placeholderTextColor={colors.mutedText} style={styles.input} multiline />

          <Pressable onPress={submit} disabled={saving} style={[styles.submitBtn, saving && { opacity: 0.6 }]} testID="submit-samples-btn">
            {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.submitBtnText}>Issue {items.length || ''} Sample{items.length === 1 ? '' : 's'}</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      <PhotoCaptureModal
        visible={cameraOpen}
        title="Sample Photo"
        onClose={() => setCameraOpen(false)}
        onCapture={async (photo) => { setDraft((d) => ({ ...d, photo })); setCameraOpen(false); }}
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
  formCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
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
  pickerRow: { paddingHorizontal: spacing.md, paddingVertical: 10 },
  pickerRowName: { color: colors.onSurface, fontSize: 13, fontWeight: '600' },
  pickerRowMeta: { color: colors.mutedText, fontSize: 12 },

  photoBtn: {
    flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: 12, marginTop: 4,
  },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 },
  photoThumb: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  itemThumb: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  smallBtn: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: colors.border },
  smallBtnText: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: '700' },
  delBtn: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: colors.error,
    borderColor: colors.onError, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },

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

  submitBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 15, alignItems: 'center', marginTop: spacing.xl },
  submitBtnText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 15 },
});
