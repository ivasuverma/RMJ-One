import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, Platform, KeyboardAvoidingView, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { confirmAction } from '@/src/utils/confirm';
import { istDateTime } from '@/src/utils/datetime';
import { PhotoCaptureModal } from '@/src/components/PhotoCaptureModal';
import { DateField } from '@/src/components/DateField';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Sample = {
  id: string; sample_code: string; description: string; tag_number: string;
  weight: number; pc_count?: number; issue_type?: string; due_date: string | null;
  photo: string; karigar_id: string; karigar_name: string;
  status: 'with_karigar' | 'received';
  received_weight: number | null; weight_diff: number | null;
  issued_at: string; issued_by: string; received_at: string | null; received_by: string | null;
  note: string;
};

export default function SampleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const { hasRight } = useAuth();
  const canEdit = hasRight('samples', 'edit');
  const canDelete = hasRight('samples', 'delete');
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [sample, setSample] = useState<Sample | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  const [showEdit, setShowEdit] = useState(false);
  const [editDescription, setEditDescription] = useState('');
  const [editTagNumber, setEditTagNumber] = useState('');
  const [editWeight, setEditWeight] = useState('');
  const [editPcCount, setEditPcCount] = useState('');
  const [editIssueType, setEditIssueType] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editPhoto, setEditPhoto] = useState('');
  const [editNote, setEditNote] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  const load = useCallback(async () => {
    try { setSample(await api.get<Sample>(`/samples/${id}`)); }
    catch (_e) { /* ignore */ }
    finally { setLoading(false); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openEdit = () => {
    if (!sample) return;
    setEditDescription(sample.description); setEditTagNumber(sample.tag_number || '');
    setEditWeight(String(sample.weight ?? '')); setEditPcCount(String(sample.pc_count ?? '1'));
    setEditIssueType(sample.issue_type || ''); setEditDueDate(sample.due_date || '');
    setEditPhoto(sample.photo || ''); setEditNote('');
    setShowEdit(true);
  };

  const saveEdit = async () => {
    if (!editDescription.trim()) { Alert.alert('Missing', 'Description cannot be empty'); return; }
    const w = parseFloat(editWeight);
    if (!w || w <= 0) { Alert.alert('Missing', 'Enter a weight greater than 0'); return; }
    setSavingEdit(true);
    try {
      await api.put(`/samples/${id}`, {
        description: editDescription.trim(), tag_number: editTagNumber.trim(),
        weight: w, pc_count: parseInt(editPcCount, 10) || 1,
        issue_type: editIssueType.trim(), due_date: editDueDate || null,
        photo: editPhoto, note: editNote,
      });
      setShowEdit(false);
      await load();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setSavingEdit(false); }
  };

  const printThermal = async () => {
    setPrinting(true);
    try { await api.post(`/samples/${id}/issue-slip/print`, {}); }
    catch (e: any) { Alert.alert('Print failed', e?.detail || 'Could not reach the printer. Check Store Settings.'); }
    finally { setPrinting(false); }
  };

  const remove = () => {
    if (!sample) return;
    confirmAction(
      'Delete sample?',
      `Remove ${sample.sample_code}? This also undoes its effect on ${sample.karigar_name}'s gold balance. This cannot be undone.`,
      'Delete',
      async () => {
        setDeleting(true);
        try { await api.del(`/samples/${id}`); router.back(); }
        catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
        finally { setDeleting(false); }
      },
    );
  };

  if (loading || !sample) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }} />
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loader}><ActivityIndicator color={colors.brandPrimary} /></View>
      </SafeAreaView>
    );
  }

  const isWithKarigar = sample.status === 'with_karigar';

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="sample-detail-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{sample.sample_code}</Text>
        {isWithKarigar && canEdit && (
          <Pressable onPress={openEdit} style={styles.iconBtn} testID="edit-sample-btn" hitSlop={12}>
            <Ionicons name="pencil-outline" size={18} color={colors.onSurface} />
          </Pressable>
        )}
        {canDelete && (
          <Pressable onPress={remove} disabled={deleting} style={styles.iconBtn} testID="delete-sample-btn" hitSlop={12}>
            {deleting ? <ActivityIndicator size="small" color={colors.onError} /> : <Ionicons name="trash-outline" size={18} color={colors.onError} />}
          </Pressable>
        )}
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <View style={[styles.badge, isWithKarigar ? styles.badgeOut : styles.badgeReceived, { alignSelf: 'flex-start' }]}>
            <Text style={[styles.badgeText, isWithKarigar ? styles.badgeTextOut : styles.badgeTextReceived]}>
              {isWithKarigar ? 'With Karigar' : 'Received'}
            </Text>
          </View>

          {sample.photo ? <Image source={{ uri: sample.photo }} style={styles.photo} /> : null}

          <Text style={styles.description}>{sample.description}</Text>
          {!!sample.tag_number && <Text style={styles.tagNumber}>Tag {sample.tag_number}</Text>}

          <View style={styles.summaryRow}>
            <View style={styles.summaryTile}>
              <Text style={styles.summaryValue}>{sample.weight.toFixed(3)}g</Text>
              <Text style={styles.summaryLabel}>Issued weight</Text>
            </View>
            {sample.status === 'received' && (
              <View style={styles.summaryTile}>
                <Text style={styles.summaryValue}>{sample.received_weight?.toFixed(3)}g</Text>
                <Text style={styles.summaryLabel}>Received weight</Text>
              </View>
            )}
          </View>
          {sample.status === 'received' && !!sample.weight_diff && (
            <View style={styles.diffTile}>
              <Text style={[styles.summaryValue, { color: colors.onWarning }]}>{sample.weight_diff > 0 ? '+' : ''}{sample.weight_diff.toFixed(3)}g</Text>
              <Text style={styles.summaryLabel}>Difference vs issued</Text>
            </View>
          )}

          <View style={styles.detailCard}>
            <View style={styles.detailRow}><Text style={styles.detailLabel}>Karigar</Text><Text style={styles.detailValue}>{sample.karigar_name}</Text></View>
            <View style={styles.detailRow}><Text style={styles.detailLabel}>Pieces</Text><Text style={styles.detailValue}>{sample.pc_count ?? 1}</Text></View>
            {!!sample.issue_type && (
              <View style={styles.detailRow}><Text style={styles.detailLabel}>Issue Type</Text><Text style={styles.detailValue}>{sample.issue_type}</Text></View>
            )}
            {!!sample.due_date && (
              <View style={styles.detailRow}><Text style={styles.detailLabel}>Due Back</Text><Text style={styles.detailValue}>{sample.due_date}</Text></View>
            )}
            <View style={styles.detailRow}><Text style={styles.detailLabel}>Issued</Text><Text style={styles.detailValue}>{istDateTime(sample.issued_at)} · {sample.issued_by}</Text></View>
            {sample.received_at && (
              <View style={styles.detailRow}><Text style={styles.detailLabel}>Received</Text><Text style={styles.detailValue}>{istDateTime(sample.received_at)} · {sample.received_by}</Text></View>
            )}
            {!!sample.note && (
              <View style={[styles.detailRow, { flexDirection: 'column', alignItems: 'flex-start', gap: 4 }]}>
                <Text style={styles.detailLabel}>Note</Text>
                <Text style={styles.detailValue}>{sample.note}</Text>
              </View>
            )}
          </View>

          {isWithKarigar && showEdit && (
            <View style={styles.formCard} testID="edit-sample-form">
              <Text style={styles.formHeaderText}>Edit Sample</Text>
              <Text style={styles.formHint}>Same voucher as issue — editing the weight keeps {sample.karigar_name}'s gold ledger entry in sync.</Text>
              <Text style={styles.label}>Description</Text>
              <TextInput testID="edit-description" value={editDescription} onChangeText={setEditDescription} placeholderTextColor={colors.mutedText} style={styles.input} />
              <Text style={styles.label}>Tag Number</Text>
              <TextInput testID="edit-tag-number" value={editTagNumber} onChangeText={setEditTagNumber} placeholderTextColor={colors.mutedText} style={styles.input} />
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Weight (g)</Text>
                  <TextInput testID="edit-weight" value={editWeight} onChangeText={(v) => setEditWeight(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholderTextColor={colors.mutedText} style={styles.input} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Pieces</Text>
                  <TextInput testID="edit-pc-count" value={editPcCount} onChangeText={(v) => setEditPcCount(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" placeholderTextColor={colors.mutedText} style={styles.input} />
                </View>
              </View>
              <Text style={styles.label}>Type of Issue</Text>
              <TextInput testID="edit-issue-type" value={editIssueType} onChangeText={setEditIssueType} placeholder="e.g. Quoting, Reference" placeholderTextColor={colors.mutedText} style={styles.input} />
              <DateField label="Due back" value={editDueDate} onChange={setEditDueDate} testID="edit-due-date" />

              <Text style={styles.label}>Photo</Text>
              {editPhoto ? (
                <View style={styles.photoRow}>
                  <Image source={{ uri: editPhoto }} style={styles.photoThumb} />
                  <Pressable onPress={() => setCameraOpen(true)} style={styles.smallBtn} testID="edit-retake-photo">
                    <Text style={styles.smallBtnText}>Retake</Text>
                  </Pressable>
                  <Pressable onPress={() => setEditPhoto('')} style={styles.delBtn} hitSlop={10} testID="edit-remove-photo">
                    <Ionicons name="close" size={16} color={colors.onError} />
                  </Pressable>
                </View>
              ) : (
                <Pressable onPress={() => setCameraOpen(true)} style={styles.photoBtn} testID="edit-add-photo">
                  <Ionicons name="camera-outline" size={16} color={colors.onSurfaceSecondary} />
                  <Text style={styles.smallBtnText}>Add Photo</Text>
                </Pressable>
              )}

              <Text style={styles.label}>Add a note (optional)</Text>
              <TextInput testID="edit-note" value={editNote} onChangeText={setEditNote} placeholderTextColor={colors.mutedText} style={styles.input} multiline />
              <Pressable style={[styles.primaryBtn, savingEdit && { opacity: 0.6 }]} disabled={savingEdit} onPress={saveEdit} testID="save-edit-sample-btn">
                {savingEdit ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryBtnText}>Save Changes</Text>}
              </Pressable>
              <Pressable style={styles.secondaryBtn} onPress={() => setShowEdit(false)} testID="cancel-edit-sample-btn">
                <Text style={styles.secondaryBtnText}>Cancel</Text>
              </Pressable>
            </View>
          )}

          <PhotoCaptureModal
            visible={cameraOpen}
            title="Sample Photo"
            onClose={() => setCameraOpen(false)}
            onCapture={async (photo) => { setEditPhoto(photo); setCameraOpen(false); }}
          />

          {!showEdit && (
            <Pressable onPress={printThermal} disabled={printing} style={styles.actionBtn} testID="print-sample-issue-slip-btn">
              {printing ? <ActivityIndicator color={colors.onSurfaceSecondary} /> : <><Ionicons name="print-outline" size={16} color={colors.onSurfaceSecondary} /><Text style={styles.actionBtnText}>Print Thermal Slip (Karigar Issue)</Text></>}
            </Pressable>
          )}

          {isWithKarigar && !showEdit && (
            <Pressable style={styles.primaryBtn} onPress={() => router.push(`/samples/receive?id=${id}` as any)} testID="open-receive-sample-btn">
              <Text style={styles.primaryBtnText}>Receive Back</Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
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

  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.sm, marginBottom: spacing.md },
  badgeOut: { backgroundColor: colors.brandTertiary },
  badgeReceived: { backgroundColor: colors.success },
  badgeText: { fontSize: 10, fontWeight: '700' },
  badgeTextOut: { color: colors.brandSecondary },
  badgeTextReceived: { color: colors.onSuccess },

  photo: { width: '100%', height: 200, borderRadius: radius.lg, backgroundColor: colors.surfaceTertiary, marginBottom: spacing.md },
  description: { color: colors.onSurface, fontSize: 18, fontWeight: '700', fontFamily: fonts.display },
  tagNumber: { color: colors.mutedText, fontSize: 13, marginTop: 2, marginBottom: spacing.md },

  summaryRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  summaryTile: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center' },
  diffTile: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center', marginTop: spacing.sm },
  summaryValue: { color: colors.onSurface, fontSize: 18, fontWeight: '700' },
  summaryLabel: { color: colors.mutedText, fontSize: 11, marginTop: 4, textAlign: 'center' },

  detailCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginTop: spacing.md, marginBottom: spacing.lg,
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  detailLabel: { color: colors.mutedText, fontSize: 12 },
  detailValue: { color: colors.onSurface, fontSize: 13, fontWeight: '600' },

  formCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md },
  formHeaderText: { color: colors.onSurface, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  formHint: { color: colors.mutedText, fontSize: 11, marginTop: 4, marginBottom: spacing.sm },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: spacing.md, marginBottom: 6 },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 },
  photoThumb: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  photoBtn: {
    flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: 12, marginTop: 4,
  },
  smallBtn: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: colors.border },
  smallBtnText: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: '700' },
  delBtn: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: colors.error,
    borderColor: colors.onError, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  primaryBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg },
  primaryBtnText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 14 },
  actionBtn: {
    flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingVertical: 12, marginTop: spacing.lg,
  },
  actionBtnText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  secondaryBtn: { borderRadius: radius.md, paddingVertical: 12, alignItems: 'center', marginTop: spacing.sm },
  secondaryBtnText: { color: colors.mutedText, fontWeight: '700', fontSize: 13 },
});
