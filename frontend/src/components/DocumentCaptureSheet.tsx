import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, ActivityIndicator, TextInput, Image, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api/client';
import { haptics } from '@/src/utils/haptics';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Sheet, useToast } from '@/src/components/ui';
import { DocumentScanner } from '@/src/components/DocumentScanner';
import { enqueueUpload } from '@/src/utils/uploadQueue';

export type DocCategory = { id: string; key: string; label: string; icon: keyof typeof Ionicons.glyphMap; can_record?: boolean };

// The app ships as a web export, so capture uses a native file input — which
// gives us camera (capture=environment), photo library, and Files/PDF for free
// with no extra native module.
function pickWebFile(accept: string, capture?: boolean): Promise<File | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') { resolve(null); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    if (capture) input.setAttribute('capture', 'environment');
    // The input MUST be in the DOM for .click() to open the picker on mobile
    // browsers (iOS Safari/WebView silently ignore a detached input).
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.top = '0';
    input.style.opacity = '0';
    let done = false;
    const finish = (f: File | null) => {
      if (done) return;
      done = true;
      window.removeEventListener('focus', onFocus);
      try { input.remove(); } catch { /* already gone */ }
      resolve(f);
    };
    const onFocus = () => { setTimeout(() => { if (!input.files || input.files.length === 0) finish(null); }, 400); };
    input.onchange = () => finish(input.files && input.files[0] ? input.files[0] : null);
    document.body.appendChild(input);
    window.addEventListener('focus', onFocus);
    input.click();
  });
}

// Downscale a captured photo before upload: a modern phone camera produces
// 3–6 MB images, slow to upload and heavy to store. ~1600px / JPEG q0.8 keeps
// receipts/IDs legible at a fraction of the size. Non-images pass through.
async function shrinkImage(file: File): Promise<Blob> {
  if (typeof document === 'undefined' || !file.type.startsWith('image/') || file.size < 900_000) return file;
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const im = new (window as any).Image();
      im.onload = () => res(im); im.onerror = rej; im.src = url;
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

// A tiny (~520px) JPEG kept locally after the full image lands in Drive.
async function makeThumb(file: File): Promise<string> {
  if (typeof document === 'undefined' || !file.type.startsWith('image/')) return '';
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const im = new (window as any).Image();
      im.onload = () => res(im); im.onerror = rej; im.src = url;
    });
    const scale = Math.min(1, 520 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    return dataUrl.split(',', 2)[1] || '';
  } catch { return ''; }
}

type Phase = 'capture' | 'review' | 'saving' | 'saved';

export function DocumentCaptureSheet({ visible, onClose, onSaved, autoCamera }: {
  visible: boolean; onClose: () => void; onSaved?: () => void; autoCamera?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const [cats, setCats] = useState<DocCategory[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [catKey, setCatKey] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('capture');
  const [scanning, setScanning] = useState(false);
  const autoFired = useRef(false);

  useEffect(() => {
    if (visible) {
      // Only categories this person may RECORD into (that's what filing needs).
      api.get<DocCategory[]>('/document-categories').then((cs) => setCats(cs.filter((c) => c.can_record !== false))).catch(() => {});
    } else {
      setFile(null); setNote(''); setCatKey(null); setPhase('capture'); autoFired.current = false;
    }
  }, [visible]);

  useEffect(() => {
    if (file && file.type.startsWith('image/') && typeof URL !== 'undefined') {
      const u = URL.createObjectURL(file);
      setPreviewUrl(u);
      return () => { try { URL.revokeObjectURL(u); } catch { /* ignore */ } };
    }
    setPreviewUrl(null);
  }, [file]);

  const openPicker = async (accept: string, capture?: boolean) => {
    const f = await pickWebFile(accept, capture);
    if (f) { setFile(f); setPhase('review'); }
  };

  // Launched from the round scan button → jump straight to the camera.
  useEffect(() => {
    if (visible && autoCamera && !autoFired.current && phase === 'capture' && Platform.OS === 'web') {
      autoFired.current = true;
      openPicker('image/*', true);
    }
  }, [visible, autoCamera, phase]);

  const retake = () => { setFile(null); setCatKey(null); setPhase('capture'); autoFired.current = false; };

  const save = async () => {
    if (!file || !catKey || phase === 'saving') return;
    const cat = cats.find((c) => c.key === catKey);
    if (!cat) return;
    setPhase('saving');
    try {
      const blob = await shrinkImage(file);
      const thumb = await makeThumb(file);
      const remark = note.trim();
      const stamp = new Date().toISOString().slice(0, 10);
      const base = (remark || cat.label || 'document').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'document';
      const name = file.type.startsWith('image/') ? `${base}-${stamp}.jpg` : (file.name || `${base}-${stamp}.pdf`);
      const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      // Save to the on-device outbox and return instantly — the upload happens
      // in the background and survives an app close, so no photo is ever lost.
      await enqueueUpload({ id, blob, filename: name, category_key: cat.key, note: remark, thumb });
      haptics.success();
      onSaved?.();
      setPhase('saved');
    } catch (e: any) {
      haptics.error();
      toast.error(e?.detail || 'Could not save the document');
      setPhase('review');
    }
  };

  const addAnother = () => { setFile(null); setNote(''); setCatKey(null); setPhase('capture'); autoFired.current = false; };

  const selectedCat = cats.find((c) => c.key === catKey);

  return (
    <Sheet visible={visible} onClose={onClose} title={phase === 'saved' ? 'Saved' : 'Add document'} testID="doc-capture-sheet">
      {Platform.OS !== 'web' ? (
        <Text style={styles.hint}>Open the RMJ One web app to capture documents.</Text>
      ) : phase === 'saved' ? (
        // Strong, unmissable confirmation — the whole point: nobody loses a photo.
        <View style={styles.savedWrap} testID="doc-saved">
          <View style={styles.savedCircle}><Ionicons name="checkmark" size={40} color={colors.onSuccess} /></View>
          <Text style={styles.savedTitle}>Saved</Text>
          <Text style={styles.savedSub}>
            Saved{selectedCat ? ` · ${selectedCat.label}` : ''}. It&apos;s uploading in the background and will keep trying even if you close the app — safe to close.
          </Text>
          <View style={styles.savedBtns}>
            <Pressable onPress={addAnother} style={[styles.opt, styles.optPrimary]} testID="doc-add-another">
              <Ionicons name="camera" size={20} color={colors.onBrandPrimary} />
              <Text style={styles.optPrimaryText}>Capture another</Text>
            </Pressable>
            <Pressable onPress={onClose} style={styles.savedDone} testID="doc-done">
              <Text style={styles.altText}>Done</Text>
            </Pressable>
          </View>
        </View>
      ) : phase === 'saving' ? (
        <View style={styles.savingWrap} testID="doc-saving">
          <ActivityIndicator color={colors.brandPrimary} size="large" />
          <Text style={styles.savingText}>Saving…</Text>
          <Text style={styles.hint}>Hold on — don&apos;t close yet.</Text>
        </View>
      ) : !file ? (
        <>
          <Text style={styles.hint}>Snap a receipt, KYC, cash sheet or bill.</Text>
          <Pressable onPress={() => openPicker('image/*', true)} style={[styles.opt, styles.optPrimary]} testID="doc-take-photo">
            <Ionicons name="camera" size={20} color={colors.onBrandPrimary} />
            <Text style={styles.optPrimaryText}>Open camera</Text>
          </Pressable>
          <View style={styles.altRow}>
            <Pressable onPress={() => openPicker('image/*')} style={styles.alt} testID="doc-library">
              <Ionicons name="images-outline" size={18} color={colors.brandSecondary} />
              <Text style={styles.altText}>Library</Text>
            </Pressable>
            <Pressable onPress={() => openPicker('image/*,application/pdf')} style={styles.alt} testID="doc-files">
              <Ionicons name="document-attach-outline" size={18} color={colors.brandSecondary} />
              <Text style={styles.altText}>Files / PDF</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.reviewTop}>
            {previewUrl
              ? <Image source={{ uri: previewUrl }} style={styles.preview} resizeMode="cover" />
              : <View style={[styles.preview, styles.previewPdf]}><Ionicons name="document-text-outline" size={30} color={colors.brandSecondary} /></View>}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.reviewName} numberOfLines={2}>{note.trim() || file.name}</Text>
              <Pressable onPress={retake} hitSlop={8} testID="doc-retake"><Text style={styles.changeText}>Retake / change</Text></Pressable>
            </View>
            {file.type.startsWith('image/') && (
              <Pressable onPress={() => setScanning(true)} style={styles.cropBtn} testID="doc-scan">
                <Ionicons name="scan" size={16} color={colors.brandSecondary} />
                <Text style={styles.cropBtnText}>Scan / crop</Text>
              </Pressable>
            )}
          </View>

          <Text style={styles.fieldLabel}>Remark (optional — used as the name)</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="e.g. Ramesh Kumar 98xxxxxx01, or bill no."
            placeholderTextColor={colors.mutedText}
            style={styles.input}
            testID="doc-remark"
          />

          <Text style={styles.fieldLabel}>Category</Text>
          <View style={styles.catGrid}>
            {cats.map((c) => {
              const on = c.key === catKey;
              return (
                <Pressable key={c.id} onPress={() => setCatKey(c.key)} style={[styles.cat, on && styles.catOn]} testID={`doc-cat-${c.key}`}>
                  <View style={[styles.catIcon, on && styles.catIconOn]}><Ionicons name={c.icon || 'document-outline'} size={20} color={on ? colors.onBrandPrimary : colors.brandSecondary} /></View>
                  <Text style={[styles.catLabel, on && styles.catLabelOn]} numberOfLines={2}>{c.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable onPress={save} disabled={!catKey} style={[styles.opt, styles.optPrimary, !catKey && { opacity: 0.5 }, { marginTop: spacing.lg }]} testID="doc-save">
            <Ionicons name="checkmark-done" size={20} color={colors.onBrandPrimary} />
            <Text style={styles.optPrimaryText}>{catKey ? 'Save to Pending' : 'Pick a category'}</Text>
          </Pressable>
        </ScrollView>
      )}
      {scanning && file && (
        <DocumentScanner file={file} onCancel={() => setScanning(false)} onResult={(f) => { setFile(f); setScanning(false); }} />
      )}
    </Sheet>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  hint: { color: colors.mutedText, fontSize: 13, marginBottom: spacing.md },
  opt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 15, borderRadius: radius.md },
  optPrimary: { backgroundColor: colors.brandPrimary },
  optPrimaryText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: '700' },
  altRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  alt: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13,
    borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, marginTop: spacing.sm,
  },
  altText: { color: colors.onSurface, fontSize: 15, fontWeight: '700' },

  reviewTop: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', marginBottom: spacing.md },
  preview: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  previewPdf: { alignItems: 'center', justifyContent: 'center' },
  reviewName: { color: colors.onSurface, fontSize: 15, fontWeight: '700' },
  changeText: { color: colors.brandSecondary, fontSize: 13, fontWeight: '700', marginTop: 4 },
  cropBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  cropBtnText: { color: colors.brandSecondary, fontSize: 12.5, fontWeight: '700' },

  fieldLabel: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600', marginBottom: 8, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 15,
  },

  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cat: {
    flexBasis: '31%', flexGrow: 1, minWidth: 96, alignItems: 'center', gap: 8, paddingVertical: spacing.md,
    borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  catOn: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  catIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  catIconOn: { backgroundColor: colors.brandPrimary },
  catLabel: { color: colors.onSurface, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  catLabelOn: { color: colors.brandSecondary },

  savingWrap: { alignItems: 'center', gap: 10, paddingVertical: spacing.xxl },
  savingText: { color: colors.onSurface, fontSize: 17, fontWeight: '700', marginTop: spacing.sm },

  savedWrap: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg },
  savedCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },
  savedTitle: { color: colors.onSurface, fontSize: 22, fontWeight: '800' },
  savedSub: { color: colors.mutedText, fontSize: 13.5, textAlign: 'center', lineHeight: 19, paddingHorizontal: spacing.md },
  savedBtns: { alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.sm },
  savedDone: {
    alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
});
