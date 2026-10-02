import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform, TextInput } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { api, getToken } from '@/src/api/client';
import { confirmAction } from '@/src/utils/confirm';
import { displayDateOnly } from '@/src/utils/datetime';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Sheet, useToast } from '@/src/components/ui';
import { pickWebFiles, shrinkImage, makeThumb } from '@/src/components/DocumentCaptureSheet';
import { PhotoViewer } from '@/src/components/PhotoViewer';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || '';

// The kinds of ID kept for an employee. The type is saved as the document's
// remark, so it also names the file in Documents and Google Drive.
export const ID_TYPES = ['Aadhaar front', 'Aadhaar back', 'PAN card', 'Voter ID', 'Driving licence', 'Passport', 'Photo'];

type IdDoc = { id: string; created_at: string; note?: string; file: { mime: string } };

const fileUri = (docId: string, thumb = false) => `${BASE}/api/documents/${docId}/file${thumb ? '?thumb=1' : '?full=1'}`;
const order = (d: IdDoc) => { const i = ID_TYPES.indexOf(d.note || ''); return i < 0 ? ID_TYPES.length : i; };

/** An employee's ID proofs: labelled tiles, an Add sheet (pick the type, then
 *  take photos one after another or pick several from the gallery / files),
 *  and a full-screen viewer with Share and — for owner/admin — Delete. Each
 *  proof is a done document in the "ids" category linked to the employee. */
export function EmployeeIdProofs({ employee, canDelete }: { employee: { id: string; name: string }; canDelete: boolean }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const [docs, setDocs] = useState<IdDoc[]>([]);
  const [token, setToken] = useState('');
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState<IdDoc | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ items: IdDoc[] }>(`/documents?category=ids&status=done&linked_ref_type=employee&linked_ref_id=${employee.id}`);
      setDocs((res.items || []).slice().sort((a, b) => order(a) - order(b) || a.created_at.localeCompare(b.created_at)));
    } catch { setDocs([]); }
  }, [employee.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { getToken().then((t) => setToken(t || '')); }, []);

  const del = (d: IdDoc) => confirmAction(`Delete ${d.note || 'this ID proof'}?`, 'It is removed from Documents and Google Drive.', 'Delete', async () => {
    try { await api.del(`/documents/${d.id}`); setViewing(null); load(); toast.success('Deleted'); }
    catch (e: any) { toast.error(e?.detail || 'Could not delete'); }
  });

  return (
    <View testID="id-proofs">
      <View style={styles.head}>
        <Text style={styles.headText}>ID proofs{docs.length ? ` · ${docs.length}` : ''}</Text>
        <Pressable onPress={() => setAdding(true)} style={styles.addBtn} hitSlop={8} testID="add-id-proof-row">
          <Ionicons name="add" size={16} color={colors.onBrandPrimary} />
          <Text style={styles.addText}>Add</Text>
        </Pressable>
      </View>
      {docs.length === 0 ? (
        <Text style={styles.empty}>No ID proofs yet. Add Aadhaar (front and back), PAN, or any other ID.</Text>
      ) : (
        <View style={styles.grid}>
          {docs.map((d) => (
            <Pressable key={d.id} onPress={() => setViewing(d)} style={styles.tile} testID={`id-doc-${d.id}`}>
              <View style={styles.imgWrap}>
                {d.file?.mime === 'application/pdf' ? (
                  <View style={styles.pdf}><Ionicons name="document-text-outline" size={28} color={colors.brandSecondary} /><Text style={styles.pdfText}>PDF</Text></View>
                ) : token ? (
                  <Image source={{ uri: fileUri(d.id, true), headers: { Authorization: `Bearer ${token}` } }} style={styles.img} contentFit="cover" cachePolicy="memory-disk" />
                ) : null}
              </View>
              <Text style={styles.tileLabel} numberOfLines={1}>{d.note || 'ID proof'}</Text>
              <Text style={styles.tileDate}>{displayDateOnly(d.created_at.slice(0, 10))}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <Text style={styles.foot}>ID proofs are stored in Documents and backed up to Google Drive.</Text>

      <AddIdProofSheet visible={adding} employee={employee} onClose={() => setAdding(false)} onAdded={load} />
      {viewing && token ? (
        <PhotoViewer
          url={fileUri(viewing.id)} token={token}
          name={`${viewing.note || 'ID proof'} ${employee.name}`.replace(/[^\w-]+/g, '-')}
          title={`${viewing.note || 'ID proof'} · ${employee.name}`}
          onClose={() => setViewing(null)}
          onDelete={canDelete ? () => del(viewing) : undefined}
        />
      ) : null}
    </View>
  );
}

function AddIdProofSheet({ visible, employee, onClose, onAdded }: {
  visible: boolean; employee: { id: string; name: string }; onClose: () => void; onAdded: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [type, setType] = useState<string | null>(null);
  const [other, setOther] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [added, setAdded] = useState<{ label: string; count: number }[]>([]);
  const [error, setError] = useState('');

  useEffect(() => { if (!visible) { setType(null); setOther(''); setProgress(null); setAdded([]); setError(''); } }, [visible]);

  const label = type === 'Other' ? other.trim() : type;

  const upload = async (file: File, note: string) => {
    const blob = await shrinkImage(file);
    const thumb = await makeThumb(file);
    const stamp = new Date().toISOString().slice(0, 10);
    const base = `${note}-${employee.name}`.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'id-proof';
    const form = new FormData();
    form.append('file', blob as any, file.type === 'application/pdf' ? `${base}-${stamp}.pdf` : `${base}-${stamp}.jpg`);
    form.append('category_key', 'ids');
    form.append('note', note);
    if (thumb) form.append('thumb', thumb);
    const doc = await api.upload<{ id: string }>('/documents', form);
    try {
      await api.patch(`/documents/${doc.id}/record`, {
        linked_ref_type: 'employee', linked_ref_id: employee.id, linked_ref_label: employee.name, note,
      });
    } catch (e) {
      // Don't leave an unfiled copy behind in Documents → Pending.
      api.del(`/documents/${doc.id}`).catch(() => {});
      throw e;
    }
  };

  const pick = async (accept: string, opts: { capture?: boolean; multiple?: boolean }) => {
    if (!label || progress) return;
    const files = await pickWebFiles(accept, opts);
    if (!files.length) return;
    setError('');
    let ok = 0;
    setProgress({ done: 0, total: files.length });
    for (const f of files) {
      try { await upload(f, label); ok += 1; }
      catch (e: any) { setError(e?.detail || 'Could not save one of them — please try again'); }
      setProgress({ done: ok, total: files.length });
    }
    setProgress(null);
    if (ok) {
      setAdded((a) => [...a, { label, count: ok }]);
      setType(null); setOther('');
      onAdded();
    }
  };

  const busy = !!progress;
  const ready = !!label && !busy;

  return (
    <Sheet visible={visible} onClose={onClose} title="Add ID proof" testID="id-proof-sheet">
      {Platform.OS !== 'web' ? (
        <Text style={styles.hint}>Open the RMJ One web app to add ID proofs.</Text>
      ) : (
        <>
          {added.length > 0 && (
            <View style={styles.addedBox} testID="id-proof-added">
              {added.map((a, i) => (
                <View key={i} style={styles.addedRow}>
                  <Ionicons name="checkmark-circle" size={18} color={colors.onSuccess} />
                  <Text style={styles.addedText}>{a.label}{a.count > 1 ? ` · ${a.count} files` : ''} saved</Text>
                </View>
              ))}
            </View>
          )}

          <Text style={styles.fieldLabel}>{added.length ? 'Add another — what is it?' : 'What is it?'}</Text>
          <View style={styles.chips}>
            {[...ID_TYPES, 'Other'].map((t) => {
              const on = t === type;
              return (
                <Pressable key={t} onPress={() => setType(t)} disabled={busy} style={[styles.chip, on && styles.chipOn]} testID={`id-type-${t.toLowerCase().replace(/\s+/g, '-')}`}>
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{t}</Text>
                </Pressable>
              );
            })}
          </View>
          {type === 'Other' && (
            <TextInput
              value={other} onChangeText={setOther} placeholder="e.g. Ration card, Bank passbook"
              placeholderTextColor={colors.mutedText} style={styles.input} autoFocus testID="id-type-other-name"
            />
          )}

          {busy ? (
            <View style={styles.saving} testID="id-proof-saving">
              <ActivityIndicator color={colors.brandPrimary} />
              <Text style={styles.savingText}>Saving {Math.min(progress!.done + 1, progress!.total)} of {progress!.total}…</Text>
            </View>
          ) : (
            <>
              <Pressable onPress={() => pick('image/*', { capture: true })} disabled={!ready} style={[styles.opt, styles.optPrimary, !ready && { opacity: 0.5 }]} testID="id-proof-camera">
                <Ionicons name="camera" size={20} color={colors.onBrandPrimary} />
                <Text style={styles.optPrimaryText}>{label ? `Take photo of ${label}` : 'Pick what it is first'}</Text>
              </Pressable>
              <View style={styles.altRow}>
                <Pressable onPress={() => pick('image/*', { multiple: true })} disabled={!ready} style={[styles.alt, !ready && { opacity: 0.5 }]} testID="id-proof-gallery">
                  <Ionicons name="images-outline" size={18} color={colors.brandSecondary} />
                  <Text style={styles.altText}>Gallery</Text>
                </Pressable>
                <Pressable onPress={() => pick('image/*,application/pdf', { multiple: true })} disabled={!ready} style={[styles.alt, !ready && { opacity: 0.5 }]} testID="id-proof-files">
                  <Ionicons name="document-attach-outline" size={18} color={colors.brandSecondary} />
                  <Text style={styles.altText}>Files / PDF</Text>
                </Pressable>
              </View>
              <Text style={styles.hint}>You can pick several photos at once from the gallery.</Text>
            </>
          )}
          {!!error && <Text style={styles.error}>{error}</Text>}

          {added.length > 0 && !busy && (
            <Pressable onPress={onClose} style={styles.done} testID="id-proof-done">
              <Text style={styles.altText}>Done</Text>
            </Pressable>
          )}
        </>
      )}
    </Sheet>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md, marginBottom: spacing.sm },
  headText: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: '700' },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.brandPrimary, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill },
  addText: { color: colors.onBrandPrimary, fontSize: 12.5, fontWeight: '800' },
  empty: { color: colors.mutedText, fontSize: 13, lineHeight: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: { width: 104 },
  imgWrap: { width: 104, height: 80, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surfaceTertiary },
  img: { width: '100%', height: '100%' },
  pdf: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  pdfText: { color: colors.brandSecondary, fontSize: 11, fontWeight: '800' },
  tileLabel: { color: colors.onSurface, fontSize: 12.5, fontWeight: '700', marginTop: 5 },
  tileDate: { color: colors.mutedText, fontSize: 11 },
  foot: { color: colors.mutedText, fontSize: 11.5, marginTop: spacing.sm, lineHeight: 16 },

  hint: { color: colors.mutedText, fontSize: 12.5, marginTop: spacing.sm, textAlign: 'center' },
  fieldLabel: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600', marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  chipOn: { borderColor: colors.brandPrimary, backgroundColor: colors.brandPrimary },
  chipText: { color: colors.onSurface, fontSize: 13.5, fontWeight: '600' },
  chipTextOn: { color: colors.onBrandPrimary },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 15, marginBottom: spacing.md,
  },
  opt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 15, borderRadius: radius.md },
  optPrimary: { backgroundColor: colors.brandPrimary },
  optPrimaryText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: '700' },
  altRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  alt: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13,
    borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  altText: { color: colors.onSurface, fontSize: 15, fontWeight: '700' },
  saving: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: spacing.lg },
  savingText: { color: colors.onSurface, fontSize: 15, fontWeight: '700' },
  addedBox: { backgroundColor: colors.success, borderRadius: radius.md, padding: spacing.md, gap: 6, marginBottom: spacing.md },
  addedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addedText: { color: colors.onSuccess, fontSize: 14, fontWeight: '700' },
  error: { color: colors.onError, fontSize: 13, marginTop: spacing.sm, textAlign: 'center' },
  done: {
    alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: radius.md, marginTop: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
});
