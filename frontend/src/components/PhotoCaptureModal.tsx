import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Modal, Linking, Platform, Image } from 'react-native';
import { notify } from '@/src/utils/notify';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
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

// Generic rear-camera capture modal (no location/selfie requirement) — used
// wherever the app needs a plain reference photo, e.g. repair item intake
// and final delivery photos.
//
// On web this hands the actual capture off to the phone's own native camera
// app via a file input (capture=environment) — same approach as document
// capture (DocumentCaptureSheet). A live in-page camera preview (the old
// expo-camera CameraView route) can't get continuous autofocus in a mobile
// browser on many phones, producing permanently-blurry captures; the native
// camera app has full autofocus/flash/zoom. Native (compiled) builds keep
// the CameraView flow since there's no DOM/file input there.
export function PhotoCaptureModal({ visible, title, onClose, onCapture, highRes }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [captured, setCaptured] = useState<string | null>(null);   // dataUri under review
  const [scanFile, setScanFile] = useState<File | null>(null);     // File handed to the cropper
  const camRef = useRef<CameraView | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => { if (!visible) { setBusy(false); setCaptured(null); setScanFile(null); } }, [visible]);

  const openCrop = useCallback(async () => {
    if (!captured) return;
    try { setScanFile(await dataUriToFile(captured)); } catch { /* ignore */ }
  }, [captured]);

  const openSettings = () => Linking.openSettings().catch(() => {});

  const processUri = useCallback(async (uri: string) => {
    const shrunk = await manipulateAsync(
      uri, [{ resize: { width: highRes ? 2000 : 720 } }],
      { compress: highRes ? 0.85 : 0.6, format: SaveFormat.JPEG, base64: true },
    );
    return `data:image/jpeg;base64,${shrunk.base64}`;
  }, [highRes]);

  const onTakePhoto = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    if (!camPerm?.granted) {
      const p = await requestCamPerm();
      if (!p.granted) { submittingRef.current = false; return; }
    }
    setBusy(true);
    try {
      // quality here is the raw sensor capture itself — it was fixed at 0.5
      // for every caller, so `highRes` only ever changed the downstream
      // resize/compress step and the actual capture stayed low-fidelity no
      // matter what. Now the capture quality follows `highRes` too.
      const photo = await camRef.current?.takePictureAsync({ quality: highRes ? 0.92 : 0.5, base64: false, skipProcessing: true });
      if (!photo?.uri) throw new Error('Failed to capture');
      setCaptured(await processUri(photo.uri));
    } catch (e: any) {
      notify('Failed', e?.message || 'Please try again');
    } finally {
      setBusy(false);
      submittingRef.current = false;
    }
  }, [camPerm, requestCamPerm, highRes, processUri]);

  // Web: hand off to the OS camera (capture=true) or the photo library
  // (capture=false) via a native file input, same as document capture.
  const onPickWeb = useCallback(async (capture: boolean) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    try {
      const f = await pickWebFile('image/*', capture);
      if (!f) return;
      const uri = URL.createObjectURL(f);
      try { setCaptured(await processUri(uri)); }
      finally { URL.revokeObjectURL(uri); }
    } catch (e: any) {
      notify('Failed', e?.message || 'Please try again');
    } finally {
      setBusy(false);
      submittingRef.current = false;
    }
  }, [processUri]);

  const usePhoto = useCallback(async () => {
    if (!captured || submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    try { await onCapture(captured); }
    finally { setBusy(false); submittingRef.current = false; }
  }, [captured, onCapture]);

  const camDenied = camPerm && !camPerm.granted && !camPerm.canAskAgain;
  const isWeb = Platform.OS === 'web';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={styles.root} testID="photo-capture-modal">
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={14} testID="photo-close-btn">
            <Ionicons name="close" size={22} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.title}>{title}</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.cameraWrap}>
          {captured ? (
            <Image source={{ uri: captured }} style={StyleSheet.absoluteFill} resizeMode="contain" />
          ) : isWeb ? (
            <View style={styles.permBox}>
              <Ionicons name="camera-outline" size={44} color={colors.brandSecondary} />
              <Text style={styles.permTitle}>Ready to capture</Text>
              <Text style={styles.permSub}>Uses your phone&apos;s own camera app for a sharp, in-focus photo.</Text>
            </View>
          ) : camPerm?.granted ? (
            <CameraView ref={(r) => { camRef.current = r; }} facing="back" style={StyleSheet.absoluteFill} />
          ) : (
            <View style={styles.permBox}>
              <Ionicons name="camera-outline" size={44} color={colors.brandSecondary} />
              <Text style={styles.permTitle}>Camera access needed</Text>
              <Text style={styles.permSub}>Take a reference photo of the item.</Text>
              {camDenied ? (
                <Pressable onPress={openSettings} style={styles.permCta} testID="open-settings-btn">
                  <Text style={styles.permCtaText}>Open Settings</Text>
                </Pressable>
              ) : (
                <Pressable onPress={() => requestCamPerm()} style={styles.permCta} testID="grant-camera-btn">
                  <Text style={styles.permCtaText}>Enable Camera</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>

        <View style={styles.footer}>
          {captured ? (
            <View style={styles.reviewRow}>
              <Pressable onPress={() => setCaptured(null)} style={styles.ghostBtn} testID="photo-retake"><Ionicons name="camera-reverse-outline" size={18} color={colors.onSurface} /><Text style={styles.ghostText}>Retake</Text></Pressable>
              {isWeb && (
                <Pressable onPress={openCrop} style={styles.ghostBtn} testID="photo-crop"><Ionicons name="scan" size={18} color={colors.brandSecondary} /><Text style={styles.ghostText}>Crop</Text></Pressable>
              )}
              <Pressable onPress={usePhoto} disabled={busy} style={[styles.captureBtn, styles.usePhotoBtn, busy && { opacity: 0.6 }]} testID="photo-use">
                {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><Ionicons name="checkmark" size={20} color={colors.onBrandPrimary} /><Text style={styles.captureText}>Use photo</Text></>}
              </Pressable>
            </View>
          ) : isWeb ? (
            <View style={{ gap: spacing.sm }}>
              <Pressable
                testID="photo-capture-btn" onPress={() => onPickWeb(true)} disabled={busy}
                style={({ pressed }) => [styles.captureBtn, busy && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.98 }] }]}
              >
                {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
                  <><Ionicons name="camera" size={20} color={colors.onBrandPrimary} /><Text style={styles.captureText}>Open Camera</Text></>
                )}
              </Pressable>
              <Pressable onPress={() => onPickWeb(false)} disabled={busy} style={[styles.ghostBtn, styles.galleryBtn, busy && { opacity: 0.5 }]} testID="photo-gallery-btn">
                <Ionicons name="images-outline" size={18} color={colors.brandSecondary} />
                <Text style={styles.ghostText}>Choose from Gallery</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              testID="photo-capture-btn" onPress={onTakePhoto} disabled={busy || !camPerm?.granted}
              style={({ pressed }) => [styles.captureBtn, (busy || !camPerm?.granted) && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.98 }] }]}
            >
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
                <><Ionicons name="camera" size={20} color={colors.onBrandPrimary} /><Text style={styles.captureText}>Capture Photo</Text></>
              )}
            </Pressable>
          )}
        </View>
      </View>
      {scanFile && (
        <SimpleCropper
          file={scanFile}
          onCancel={() => setScanFile(null)}
          onResult={async (f) => { try { setCaptured(await fileToDataUri(f)); } catch { /* keep original */ } setScanFile(null); }}
        />
      )}
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingTop: Platform.OS === 'ios' ? 50 : 20,
    paddingBottom: spacing.md, gap: spacing.md,
  },
  closeBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '700', fontFamily: fonts.display },
  cameraWrap: { flex: 1, backgroundColor: '#000', overflow: 'hidden', marginHorizontal: spacing.lg, borderRadius: radius.lg, position: 'relative' },
  permBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  permTitle: { color: colors.onSurface, fontSize: 18, fontWeight: '700', marginTop: spacing.md },
  permSub: { color: colors.onSurfaceTertiary, textAlign: 'center', fontSize: 13 },
  permCta: { marginTop: spacing.md, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingHorizontal: spacing.xl, paddingVertical: 12 },
  permCtaText: { color: colors.onBrandPrimary, fontWeight: '700' },
  footer: { padding: spacing.lg, paddingBottom: Platform.OS === 'ios' ? 36 : spacing.lg },
  captureBtn: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 16,
  },
  captureText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 15, letterSpacing: 0.3 },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ghostBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 14, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  ghostText: { color: colors.onSurface, fontSize: 14, fontWeight: '700' },
  usePhotoBtn: { flex: 1, paddingVertical: 14 },
  galleryBtn: { justifyContent: 'center', paddingVertical: 16 },
});
