import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform, Image } from 'react-native';
import { notify } from '@/src/utils/notify';
import { Ionicons } from '@expo/vector-icons';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Sheet } from '@/src/components/ui';
import { SimpleCropper } from '@/src/components/SimpleCropper';
import { pickWebFile } from '@/src/components/DocumentCaptureSheet';

async function dataUriToFile(uri: string): Promise<File> {
  const res = await fetch(uri);
  const blob = await res.blob();
  return new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' });
}
function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

type Props = {
  visible: boolean;
  title: string;
  onClose: () => void;
  onCapture: (photo: string) => Promise<void> | void;
  // When true, capture at higher resolution (for record photos that go to
  // Drive full-size). Default keeps the small 720px used for inline base64.
  highRes?: boolean;
};

// Generic rear-camera capture used wherever the app needs a plain reference
// photo (repair item intake/delivery, samples, gold loan pledge, task/record
// photos). Same bottom-sheet shell and same capture mechanism as document
// capture (DocumentCaptureSheet): a native file input (capture=environment)
// hands the actual photo-taking off to the phone's own camera app, which
// gets full autofocus/flash/zoom — a live in-page camera preview can't get
// continuous autofocus in a mobile browser on many phones and was producing
// permanently-blurry captures. Web only, same as document capture (there's
// no native build of this app — no eas.json — so this only ever runs web).
export function PhotoCaptureModal({ visible, title, onClose, onCapture, highRes }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [busy, setBusy] = useState(false);
  const [captured, setCaptured] = useState<string | null>(null);   // dataUri under review
  const [scanFile, setScanFile] = useState<File | null>(null);     // File handed to the cropper

  useEffect(() => { if (!visible) { setBusy(false); setCaptured(null); setScanFile(null); } }, [visible]);

  const openCrop = useCallback(async () => {
    if (!captured) return;
    try { setScanFile(await dataUriToFile(captured)); } catch { /* ignore */ }
  }, [captured]);

  const pick = useCallback(async (capture: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const f = await pickWebFile('image/*', capture);
      if (!f) return;
      const uri = URL.createObjectURL(f);
      try {
        const shrunk = await manipulateAsync(
          uri, [{ resize: { width: highRes ? 2000 : 720 } }],
          { compress: highRes ? 0.85 : 0.6, format: SaveFormat.JPEG, base64: true },
        );
        setCaptured(`data:image/jpeg;base64,${shrunk.base64}`);
      } finally { URL.revokeObjectURL(uri); }
    } catch (e: any) {
      notify('Failed', e?.message || 'Please try again');
    } finally {
      setBusy(false);
    }
  }, [busy, highRes]);

  const usePhoto = useCallback(async () => {
    if (!captured || busy) return;
    setBusy(true);
    try { await onCapture(captured); }
    finally { setBusy(false); }
  }, [captured, busy, onCapture]);

  return (
    <Sheet visible={visible} onClose={onClose} title={title} testID="photo-capture-sheet">
      {Platform.OS !== 'web' ? (
        <Text style={styles.hint}>Open the RMJ One web app to capture photos.</Text>
      ) : !captured ? (
        <>
          <Text style={styles.hint}>Take a clear reference photo.</Text>
          <Pressable onPress={() => pick(true)} disabled={busy} style={[styles.opt, styles.optPrimary, busy && { opacity: 0.6 }]} testID="photo-capture-btn">
            {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><Ionicons name="camera" size={20} color={colors.onBrandPrimary} /><Text style={styles.optPrimaryText}>Open Camera</Text></>}
          </Pressable>
          <View style={styles.altRow}>
            <Pressable onPress={() => pick(false)} disabled={busy} style={styles.alt} testID="photo-gallery-btn">
              <Ionicons name="images-outline" size={18} color={colors.brandSecondary} />
              <Text style={styles.altText}>Choose from Gallery</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <View style={styles.reviewTop}>
            <Image source={{ uri: captured }} style={styles.preview} resizeMode="cover" />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.reviewName} numberOfLines={2}>{title}</Text>
              <Pressable onPress={() => setCaptured(null)} hitSlop={8} testID="photo-retake"><Text style={styles.changeText}>Retake / change</Text></Pressable>
            </View>
            <Pressable onPress={openCrop} style={styles.cropBtn} testID="photo-crop">
              <Ionicons name="scan" size={16} color={colors.brandSecondary} />
              <Text style={styles.cropBtnText}>Scan / crop</Text>
            </Pressable>
          </View>
          <Pressable onPress={usePhoto} disabled={busy} style={[styles.opt, styles.optPrimary, busy && { opacity: 0.6 }, { marginTop: spacing.lg }]} testID="photo-use">
            {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><Ionicons name="checkmark-done" size={20} color={colors.onBrandPrimary} /><Text style={styles.optPrimaryText}>Use photo</Text></>}
          </Pressable>
        </>
      )}
      {scanFile && (
        <SimpleCropper
          file={scanFile}
          onCancel={() => setScanFile(null)}
          onResult={async (f) => { try { setCaptured(await fileToDataUri(f)); } catch { /* keep original */ } setScanFile(null); }}
        />
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
    borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  altText: { color: colors.onSurface, fontSize: 15, fontWeight: '700' },

  reviewTop: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  preview: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  reviewName: { color: colors.onSurface, fontSize: 15, fontWeight: '700' },
  changeText: { color: colors.brandSecondary, fontSize: 13, fontWeight: '700', marginTop: 4 },
  cropBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  cropBtnText: { color: colors.brandSecondary, fontSize: 12.5, fontWeight: '700' },
});
