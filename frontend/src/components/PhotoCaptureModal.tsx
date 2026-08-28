import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Modal, Alert, Linking, Platform, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { DocumentScanner } from '@/src/components/DocumentScanner';

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
};

// Generic rear-camera capture modal (no location/selfie requirement) — used
// wherever the app needs a plain reference photo, e.g. repair item intake
// and final delivery photos.
export function PhotoCaptureModal({ visible, title, onClose, onCapture }: Props) {
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

  const onTakePhoto = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    if (!camPerm?.granted) {
      const p = await requestCamPerm();
      if (!p.granted) { submittingRef.current = false; return; }
    }
    setBusy(true);
    try {
      const photo = await camRef.current?.takePictureAsync({ quality: 0.5, base64: false, skipProcessing: true });
      if (!photo?.uri) throw new Error('Failed to capture');
      const shrunk = await manipulateAsync(
        photo.uri, [{ resize: { width: 720 } }],
        { compress: 0.6, format: SaveFormat.JPEG, base64: true },
      );
      const dataUri = `data:image/jpeg;base64,${shrunk.base64}`;
      // Land on a review step (with optional crop) instead of saving straight away.
      setCaptured(dataUri);
    } catch (e: any) {
      Alert.alert('Failed', e?.message || 'Please try again');
    } finally {
      setBusy(false);
      submittingRef.current = false;
    }
  }, [camPerm, requestCamPerm]);

  const usePhoto = useCallback(async () => {
    if (!captured || submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    try { await onCapture(captured); }
    finally { setBusy(false); submittingRef.current = false; }
  }, [captured, onCapture]);

  const camDenied = camPerm && !camPerm.granted && !camPerm.canAskAgain;

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
              {Platform.OS === 'web' && (
                <Pressable onPress={openCrop} style={styles.ghostBtn} testID="photo-crop"><Ionicons name="scan" size={18} color={colors.brandSecondary} /><Text style={styles.ghostText}>Crop</Text></Pressable>
              )}
              <Pressable onPress={usePhoto} disabled={busy} style={[styles.captureBtn, styles.usePhotoBtn, busy && { opacity: 0.6 }]} testID="photo-use">
                {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><Ionicons name="checkmark" size={20} color={colors.onBrandPrimary} /><Text style={styles.captureText}>Use photo</Text></>}
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
        <DocumentScanner
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
});

