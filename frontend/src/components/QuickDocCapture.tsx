import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View, ActivityIndicator, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api/client';
import { haptics } from '@/src/utils/haptics';
import { enqueueUpload, updateOutboxNote, kickUpload, cancelUpload, releaseHeld } from '@/src/utils/uploadQueue';
import { blobsToPdf } from '@/src/utils/imagesToPdf';
import { Sheet } from '@/src/components/ui';
import { pickWebFile, makeThumb, type DocCategory } from '@/src/components/DocumentCaptureSheet';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

// Compress a captured photo. "Balanced" keeps receipts easily readable at a
// fraction of the size; toggle off to upload the untouched original.
export async function compressImage(file: File, on: boolean): Promise<Blob> {
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

// One photo (or file) captured during the current stretch. `id` is its entry in
// the upload outbox, where it sits held-back until the stretch is finished.
type Shot = { id: string; blob: Blob; thumb: string; isImage: boolean };

// Fast document capture for the Home/Work camera button: pick a category once,
// the camera opens immediately, and "Capture another" keeps going.
//
// Photos taken in one stretch — from picking a category until Done or
// closing the sheet — become ONE document with ONE caption: they're merged
// into a single multi-page PDF. (One document, not several, so the
// Pending count, the "new document to record" notification, recording it,
// deleting it and its Drive file are all one thing.) A stretch of a single
// photo stays a plain image, exactly as before.
//
// Every shot is saved to the durable upload outbox the instant it's taken, just
// held back from uploading — so a crash or a killed app mid-stretch never loses
// a photo; the held photos simply upload on their own as single photos after 15
// minutes (see HOLD_MS in uploadQueue).
export function QuickDocCapture({ visible, onClose, onSaved }: {
  visible: boolean; onClose: () => void; onSaved?: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [cats, setCats] = useState<DocCategory[]>([]);
  const [catKey, setCatKey] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('category');
  const [compress, setCompress] = useState(true);
  // Quick Capture's whole point is "tap a category, camera opens immediately"
  // — this toggle is the one exception: switch to gallery mode first, then
  // tapping a category opens the file picker (images + PDFs) instead of the
  // camera, so an existing photo or a PDF someone already has doesn't need
  // the full Documents module just to get in.
  const [galleryMode, setGalleryMode] = useState(false);
  const [shots, setShotsState] = useState<Shot[]>([]);
  const [caption, setCaption] = useState('');
  const shooting = useRef(false);
  const finalizing = useRef(false);
  // Mirrors `shots`: finalize() can be reached from a stale closure (the sheet's
  // own onClose), so it reads the live list from here rather than from state.
  const shotsRef = useRef<Shot[]>([]);
  const setShots = (next: Shot[]) => { shotsRef.current = next; setShotsState(next); };

  useEffect(() => {
    if (visible) {
      api.get<DocCategory[]>('/document-categories').then((cs) => setCats(cs.filter((c) => c.can_view !== false))).catch(() => {});
    } else {
      setCatKey(null); setPhase('category'); setShots([]); setCaption(''); shooting.current = false; finalizing.current = false;
    }
  }, [visible]);

  const selectedCat = cats.find((c) => c.key === catKey);
  const imageCount = shots.filter((s) => s.isImage).length;

  // End the current stretch: turn what was captured into its one document (or
  // documents, if a PDF was picked alongside photos) and let it upload.
  const finalize = async () => {
    const batch = shotsRef.current;
    if (batch.length === 0 || finalizing.current) return;
    finalizing.current = true;
    const key = catKey || '';
    const note = caption.trim();
    const images = batch.filter((s) => s.isImage);
    const others = batch.filter((s) => !s.isImage);   // e.g. a PDF picked in gallery mode: its own document
    const release: string[] = others.map((s) => s.id);
    try {
      if (images.length > 1) setPhase('saving');   // building the PDF takes a moment
      for (const o of others) if (note) await updateOutboxNote(o.id, note);
      if (images.length === 1) {
        if (note) await updateOutboxNote(images[0].id, note);
        release.push(images[0].id);
      } else if (images.length > 1) {
        try {
          const pdf = await blobsToPdf(images.map((s) => s.blob), compress ? 1600 : 2400);
          const stamp = new Date().toISOString().slice(0, 10);
          const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
          const clean = note.replace(/[^\w -]+/g, '').replace(/\s+/g, '-').slice(0, 60);
          // The merged document goes in FIRST and the single photos are cancelled
          // only after it's safely stored — a failure part-way leaves duplicates
          // to tidy up, never a lost photo.
          await enqueueUpload({
            id, blob: pdf, filename: `${clean || `${key}-${stamp}`}.pdf`, category_key: key, note,
            thumb: images[0].thumb, pages: images.length,
          }, { drainNow: false });
          for (const s of images) await cancelUpload(s.id);
        } catch {
          // Couldn't build the PDF (a photo wouldn't decode, out of memory…).
          // Fall back to uploading the photos individually, all sharing the caption.
          for (const s of images) { if (note) await updateOutboxNote(s.id, note); release.push(s.id); }
        }
      }
      await releaseHeld(release);
    } finally {
      setShots([]); setCaption(''); finalizing.current = false;
    }
    kickUpload();
    onSaved?.();
  };

  const close = async () => { await finalize(); kickUpload(); onClose(); };

  const removeShot = async (id: string) => {
    await cancelUpload(id);
    const next = shotsRef.current.filter((s) => s.id !== id);
    setShots(next);
    if (next.length === 0) setPhase('category');
  };

  const shoot = async (key: string) => {
    if (shooting.current || Platform.OS !== 'web') return;
    shooting.current = true;
    try {
      // capture:true forces the camera on mobile (see pickWebFile); gallery
      // mode omits it, which opens the normal file/photo picker instead, and
      // widens the accept type to PDFs since that's the other thing people
      // reach for a file browser to grab rather than the camera.
      const f = await pickWebFile(galleryMode ? 'image/*,application/pdf' : 'image/*', !galleryMode);
      if (!f) { shooting.current = false; return; }   // cancelled — stay where we are
      setPhase('saving');
      const isImage = f.type.startsWith('image/');
      const blob = await compressImage(f, compress);
      const thumb = await makeThumb(f);
      const stamp = new Date().toISOString().slice(0, 10);
      const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      // Matches DocumentCaptureSheet's naming: an image always gets a
      // generated .jpg name; a non-image (a PDF picked from gallery mode)
      // keeps its real filename and extension instead.
      const filename = isImage ? `${key}-${stamp}.jpg` : (f.name || `${key}-${stamp}.pdf`);
      // Stored durably right now, but held back from uploading until the
      // stretch ends (see finalize) so the photos can be merged first.
      await enqueueUpload({ id, blob, filename, category_key: key, note: '', thumb }, { drainNow: false, hold: true });
      haptics.success();
      setShots([...shotsRef.current, { id, blob, thumb, isImage }]);
      setPhase('saved');
    } catch {
      haptics.error();
      setPhase(shotsRef.current.length > 0 ? 'saved' : 'category');
    } finally { shooting.current = false; }
  };

  const pickCategory = (key: string) => { setCatKey(key); shoot(key); };

  const busy = phase === 'saving';

  return (
    <Sheet visible={visible} onClose={close} title={phase === 'saved' ? 'Saved' : 'Quick capture'} testID="quick-doc-capture">
      {Platform.OS !== 'web' ? (
        <Text style={styles.hint}>Open the RMJ One web app to capture documents.</Text>
      ) : phase === 'saving' ? (
        <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} size="large" /><Text style={styles.savingText}>Saving…</Text></View>
      ) : phase === 'saved' ? (
        <View style={styles.savedWrap} testID="quick-saved">
          <View style={styles.savedCircle}><Ionicons name="checkmark" size={38} color={colors.onSuccess} /></View>
          <Text style={styles.savedTitle}>
            {imageCount > 1 ? `${imageCount} photos` : 'Saved'}{selectedCat ? ` · ${selectedCat.label}` : ''}
          </Text>
          <Text style={styles.savedSub}>
            {imageCount > 1
              ? 'These will be saved together as one document.'
              : 'Uploading in the background — safe to close.'}
          </Text>

          {/* What's in this stretch — tap ✕ to drop one that came out badly. */}
          {shots.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.shotStrip} contentContainerStyle={{ gap: spacing.sm, paddingVertical: 4 }}>
              {shots.map((s, i) => (
                <View key={s.id} style={styles.shotWrap} testID={`quick-shot-${i}`}>
                  {s.thumb
                    ? <Image source={{ uri: `data:image/jpeg;base64,${s.thumb}` }} style={styles.shotThumb} />
                    : <View style={[styles.shotThumb, styles.shotBlank]}><Ionicons name="document-text-outline" size={20} color={colors.brandSecondary} /></View>}
                  <Pressable onPress={() => removeShot(s.id)} style={styles.shotRemove} hitSlop={6} testID={`quick-shot-remove-${i}`}>
                    <Ionicons name="close" size={12} color={colors.onBrandPrimary} />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}

          {/* One caption for everything captured in this stretch (also the
              document's name). Applied when the stretch ends. */}
          <View style={styles.remarkWrap}>
            <TextInput
              value={caption}
              onChangeText={setCaption}
              placeholder={imageCount > 1 ? 'Add a caption for all of them (optional)' : 'Add a caption (optional) — e.g. name or bill no.'}
              placeholderTextColor={colors.mutedText}
              style={styles.remarkInput}
              testID="quick-remark"
            />
          </View>

          <View style={{ alignSelf: 'stretch', flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            <Pressable onPress={() => catKey && shoot(catKey)} disabled={busy} style={[styles.btn, styles.btnPrimary, { flex: 1 }]} testID="quick-capture-another">
              <Ionicons name="camera" size={20} color={colors.onBrandPrimary} />
              <Text style={styles.btnPrimaryText}>Capture another</Text>
            </Pressable>
            <Pressable onPress={close} disabled={busy} style={[styles.btnGhost, { flex: 1 }]} testID="quick-done">
              <Text style={styles.btnGhostText}>Done</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <>
          <Text style={styles.hint}>{galleryMode ? 'Pick a category — the file picker opens right away.' : 'Pick a category — the camera opens right away.'}</Text>
          <View style={styles.pillRow}>
            <Pressable onPress={() => setCompress((v) => !v)} style={[styles.pill, compress && styles.pillOn]} testID="quick-compress-toggle" hitSlop={6}>
              <Ionicons name={compress ? 'checkbox' : 'square-outline'} size={14} color={compress ? colors.brandPrimary : colors.mutedText} />
              <Text style={[styles.pillText, compress && styles.pillTextOn]}>Compress</Text>
            </Pressable>
            <Pressable onPress={() => setGalleryMode((v) => !v)} style={[styles.pill, galleryMode && styles.pillOn]} testID="quick-gallery-toggle" hitSlop={6}>
              <Ionicons name="images-outline" size={14} color={galleryMode ? colors.brandPrimary : colors.mutedText} />
              <Text style={[styles.pillText, galleryMode && styles.pillTextOn]}>From gallery</Text>
            </Pressable>
          </View>
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
  pillRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  pillOn: { backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary },
  pillText: { color: colors.mutedText, fontSize: 11.5, fontWeight: '600' },
  pillTextOn: { color: colors.brandPrimary },
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
  shotStrip: { alignSelf: 'stretch', flexGrow: 0, marginTop: spacing.xs },
  shotWrap: { width: 56, height: 56 },
  shotThumb: { width: 56, height: 56, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
  shotBlank: { alignItems: 'center', justifyContent: 'center' },
  shotRemove: {
    position: 'absolute', top: -5, right: -5, width: 18, height: 18, borderRadius: 9,
    backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: colors.surface,
  },
  remarkWrap: { alignSelf: 'stretch', flexDirection: 'row', gap: spacing.sm, alignItems: 'center', marginTop: spacing.md },
  remarkInput: {
    flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 11, fontSize: 14,
  },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 14, borderRadius: radius.md },
  btnPrimary: { backgroundColor: colors.brandPrimary },
  btnPrimaryText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: '800' },
  btnGhost: { alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  btnGhostText: { color: colors.onSurface, fontWeight: '700' },
});
