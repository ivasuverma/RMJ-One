import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, ActivityIndicator, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api/client';
import { haptics } from '@/src/utils/haptics';
import { enqueueUpload, updateOutboxNote, kickUpload } from '@/src/utils/uploadQueue';
import { Sheet } from '@/src/components/ui';
import { pickWebFile, makeThumb, type DocCategory } from '@/src/components/DocumentCaptureSheet';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

// Compress a captured photo. "Balanced" keeps receipts easily readable at a
// fraction of the size; toggle off to upload the untouched original.
async function compressImage(file: File, on: boolean): Promise<Blob> {
  if (!on || typeof document === 'undefined' || !file.type.startsWith('image/')) return file;
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const im = new (window as any).Image(); im.onload = () => res(im); im.onerror = rej; im.src = url;
    });
    const max = 1600;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.8));
    return blob && blob.size < file.size ? blob : file;
  } catch { return file; }
}

type Phase = 'category' | 'saving' | 'saved';

// Fast document capture for the Home/Work camera button: pick a category once,
// the camera opens immediately, and each shot is queued straight away with a
// "capture another" prompt — no crop/remark steps. PDFs and gallery uploads
// live in the Documents module instead (this is the quick path).
export function QuickDocCapture({ visible, onClose, onSaved }: {
  visible: boolean; onClose: () => void; onSaved?: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [cats, setCats] = useState<DocCategory[]>([]);
  const [catKey, setCatKey] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('category');
  const [compress, setCompress] = useState(true);
  const [lastId, setLastId] = useState('');
  const [remark, setRemark] = useState('');
  const [remarkSaved, setRemarkSaved] = useState(false);
  const shooting = useRef(false);

  useEffect(() => {
    if (visible) {
      api.get<DocCategory[]>('/document-categories').then((cs) => setCats(cs.filter((c) => c.can_view !== false))).catch(() => {});
    } else {
      setCatKey(null); setPhase('category'); setLastId(''); setRemark(''); setRemarkSaved(false); shooting.current = false;
    }
  }, [visible]);

  const saveRemark = async () => {
    if (!lastId) return;
    await updateOutboxNote(lastId, remark.trim());
    setRemarkSaved(true);
  };

  const selectedCat = cats.find((c) => c.key === catKey);

  const close = () => { kickUpload(); onClose(); };

  const shoot = async (key: string) => {
    if (shooting.current || Platform.OS !== 'web') return;
    kickUpload();   // flush any previously-held photo before starting a new one
    shooting.current = true;
    try {
      const f = await pickWebFile('image/*', true);
      if (!f) { shooting.current = false; return; }   // cancelled — stay where we are
      setPhase('saving');
      const blob = await compressImage(f, compress);
      const thumb = await makeThumb(f);
      const stamp = new Date().toISOString().slice(0, 10);
      const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      // Hold the upload until the user leaves the Saved screen, so an optional
      // remark can set the filename before the photo goes up.
      await enqueueUpload({ id, blob, filename: `${key}-${stamp}.jpg`, category_key: key, note: '', thumb }, { drainNow: false });
      haptics.success();
      onSaved?.();
      setLastId(id); setRemark(''); setRemarkSaved(false);
      setPhase('saved');
    } catch {
      haptics.error();
      setPhase(catKey ? 'saved' : 'category');
    } finally { shooting.current = false; }
  };

  const pickCategory = (key: string) => { setCatKey(key); shoot(key); };

  return (
    <Sheet visible={visible} onClose={close} title={phase === 'saved' ? 'Saved' : 'Quick capture'} testID="quick-doc-capture">
      {Platform.OS !== 'web' ? (
        <Text style={styles.hint}>Open the RMJ One web app to capture documents.</Text>
      ) : phase === 'saving' ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} size="large" /><Text style={styles.savingText}>Saving…</Text></View>
      ) : phase === 'saved' ? (
        <View style={styles.savedWrap} testID="quick-saved">
          <View style={styles.savedCircle}><Ionicons name="checkmark" size={38} color={colors.onSuccess} /></View>
          <Text style={styles.savedTitle}>Saved{selectedCat ? ` · ${selectedCat.label}` : ''}</Text>
          <Text style={styles.savedSub}>Uploading in the background — safe to close.</Text>

          {/* Optional remark (used as the document's name). */}
          <View style={styles.remarkWrap}>
            <TextInput
              value={remark}
              onChangeText={(v) => { setRemark(v); setRemarkSaved(false); }}
              placeholder="Add a remark (optional) — e.g. name or bill no."
              placeholderTextColor={colors.mutedText}
              style={styles.remarkInput}
              testID="quick-remark"
            />
            {!!remark.trim() && (
              <Pressable onPress={saveRemark} style={styles.remarkBtn} testID="quick-remark-save">
                <Ionicons name={remarkSaved ? 'checkmark' : 'save-outline'} size={16} color={colors.onBrandPrimary} />
                <Text style={styles.remarkBtnText}>{remarkSaved ? 'Saved' : 'Save remark'}</Text>
              </Pressable>
            )}
          </View>

          <View style={{ alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.md }}>
            <Pressable onPress={() => catKey && shoot(catKey)} style={[styles.btn, styles.btnPrimary]} testID="quick-capture-another">
              <Ionicons name="camera" size={20} color={colors.onBrandPrimary} />
              <Text style={styles.btnPrimaryText}>Capture another</Text>
            </Pressable>
            <Pressable onPress={() => { kickUpload(); setPhase('category'); }} style={styles.btnGhost} testID="quick-change-category">
              <Text style={styles.btnGhostText}>Change category</Text>
            </Pressable>
            <Pressable onPress={close} style={styles.btnGhost} testID="quick-done">
              <Text style={styles.btnGhostText}>Done</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <>
          <Text style={styles.hint}>Pick a category — the camera opens right away.</Text>
          <Pressable onPress={() => setCompress((v) => !v)} style={styles.compressRow} testID="quick-compress-toggle">
            <Ionicons name={compress ? 'checkbox' : 'square-outline'} size={20} color={compress ? colors.brandPrimary : colors.mutedText} />
            <View style={{ flex: 1 }}>
              <Text style={styles.compressLabel}>Compress photo</Text>
              <Text style={styles.compressSub}>Smaller & faster to upload — stays readable for receipts.</Text>
            </View>
          </Pressable>
          <View style={styles.catGrid}>
            {cats.map((c) => (
              <Pressable key={c.id} onPress={() => pickCategory(c.key)} style={styles.cat} testID={`quick-cat-${c.key}`}>
                <View style={styles.catIcon}><Ionicons name={c.icon || 'document-outline'} size={22} color={colors.brandSecondary} /></View>
                <Text style={styles.catLabel} numberOfLines={2}>{c.label}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
    </Sheet>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  hint: { color: colors.mutedText, fontSize: 13, marginBottom: spacing.md },
  center: { alignItems: 'center', gap: 10, paddingVertical: spacing.xxl },
  savingText: { color: colors.onSurface, fontSize: 16, fontWeight: '700', marginTop: spacing.sm },
  compressRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md,
  },
  compressLabel: { color: colors.onSurface, fontSize: 14, fontWeight: '700' },
  compressSub: { color: colors.mutedText, fontSize: 11.5, marginTop: 2 },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cat: {
    flexBasis: '31%', flexGrow: 1, minWidth: 96, alignItems: 'center', gap: 8, paddingVertical: spacing.md,
    borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  catIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  catLabel: { color: colors.onSurface, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  savedWrap: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  savedCircle: { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },
  savedTitle: { color: colors.onSurface, fontSize: 20, fontWeight: '800' },
  savedSub: { color: colors.mutedText, fontSize: 13, textAlign: 'center' },
  remarkWrap: { alignSelf: 'stretch', flexDirection: 'row', gap: spacing.sm, alignItems: 'center', marginTop: spacing.md },
  remarkInput: {
    flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 11, fontSize: 14,
  },
  remarkBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 11 },
  remarkBtnText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 12.5 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 14, borderRadius: radius.md },
  btnPrimary: { backgroundColor: colors.brandPrimary },
  btnPrimaryText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: '800' },
  btnGhost: { alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  btnGhostText: { color: colors.onSurface, fontWeight: '700' },
});
