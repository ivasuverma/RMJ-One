import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, Modal, Alert, Linking, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { colors, spacing, radius, fonts } from '@/src/theme';

export type PunchResult = { selfie: string; latitude: number; longitude: number };

type Props = {
  visible: boolean;
  mode: 'check_in' | 'check_out';
  onClose: () => void;
  onCapture: (r: PunchResult) => Promise<void> | void;
};

export function PunchCaptureModal({ visible, mode, onClose, onCapture }: Props) {
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [locPerm, setLocPerm] = useState<Location.PermissionResponse | null>(null);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const camRef = useRef<CameraView | null>(null);
  const submittingRef = useRef(false);

  const reset = useCallback(() => {
    setBusy(false); setStatusMsg(''); setCoords(null);
  }, []);

  useEffect(() => { if (!visible) reset(); }, [visible, reset]);

  const askLocation = useCallback(async () => {
    const existing = await Location.getForegroundPermissionsAsync();
    if (existing.granted) {
      setLocPerm(existing);
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      return existing;
    }
    if (!existing.canAskAgain) {
      setLocPerm(existing);
      return existing;
    }
    const p = await Location.requestForegroundPermissionsAsync();
    setLocPerm(p);
    if (p.granted) {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
    }
    return p;
  }, []);

  useEffect(() => {
    if (!visible) return;
    (async () => {
      try { await askLocation(); } catch (_e) { /* handled via state */ }
    })();
  }, [visible, askLocation]);

  const openSettings = () => Linking.openSettings().catch(() => {});

  const onTakePhoto = async () => {
    if (submittingRef.current) return; // guards rapid double/triple taps
    submittingRef.current = true;
    if (!camPerm?.granted) {
      const p = await requestCamPerm();
      if (!p.granted) { submittingRef.current = false; return; }
    }
    if (!locPerm?.granted) {
      const p = await askLocation();
      if (!p?.granted || !coords) {
        setStatusMsg('Location required.');
        submittingRef.current = false;
        return;
      }
    }
    if (!coords) {
      setStatusMsg('Getting location...');
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
    }
    setBusy(true);
    setStatusMsg('Capturing...');
    try {
      const photo = await camRef.current?.takePictureAsync({ quality: 0.4, base64: false, skipProcessing: true });
      if (!photo?.uri) throw new Error('Failed to capture');
      const shrunk = await manipulateAsync(
        photo.uri, [{ resize: { width: 480 } }],
        { compress: 0.5, format: SaveFormat.JPEG, base64: true },
      );
      const selfie = `data:image/jpeg;base64,${shrunk.base64}`;
      setStatusMsg('Uploading...');
      const pos = coords || (await (async () => {
        const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        return { latitude: p.coords.latitude, longitude: p.coords.longitude };
      })());
      await onCapture({ selfie, latitude: pos.latitude, longitude: pos.longitude });
      setStatusMsg('');
    } catch (e: any) {
      Alert.alert('Failed', e?.detail || e?.message || 'Please try again');
    } finally {
      setBusy(false);
      submittingRef.current = false;
    }
  };

  const camDenied = camPerm && !camPerm.granted && !camPerm.canAskAgain;
  const locDenied = locPerm && !locPerm.granted && !locPerm.canAskAgain;

  const title = mode === 'check_in' ? 'Check In' : 'Check Out';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={styles.root} testID="punch-modal">
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={14} testID="punch-close-btn">
            <Ionicons name="close" size={22} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.title}>{title}</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.cameraWrap}>
          {camPerm?.granted ? (
            <CameraView
              ref={(r) => { camRef.current = r; }}
              facing="front"
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <View style={styles.permBox}>
              <Ionicons name="camera-outline" size={44} color={colors.brandSecondary} />
              <Text style={styles.permTitle}>Camera access needed</Text>
              <Text style={styles.permSub}>
                {mode === 'check_in' ? 'Take a selfie to confirm your check-in.' : 'Take a selfie to confirm your check-out.'}
              </Text>
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

        {/* Location banner */}
        <View style={styles.locBanner} testID="punch-location-banner">
          <Ionicons name="location" size={16} color={coords ? colors.brandPrimary : colors.mutedText} />
          {locDenied ? (
            <Pressable onPress={openSettings} style={{ flex: 1 }}><Text style={styles.locDenied}>Location blocked. Tap to enable in Settings.</Text></Pressable>
          ) : locPerm?.granted && coords ? (
            <Text style={styles.locOk}>Location captured · {coords.latitude.toFixed(4)}, {coords.longitude.toFixed(4)}</Text>
          ) : (
            <Text style={styles.locWaiting}>Waiting for location…</Text>
          )}
        </View>

        {!!statusMsg && <Text style={styles.statusMsg} testID="punch-status">{statusMsg}</Text>}

        <View style={styles.footer}>
          <Pressable
            testID="punch-capture-btn"
            onPress={onTakePhoto}
            disabled={busy || !camPerm?.granted || !coords}
            style={({ pressed }) => [
              styles.captureBtn,
              (busy || !camPerm?.granted || !coords) && { opacity: 0.5 },
              pressed && { transform: [{ scale: 0.98 }] },
            ]}
          >
            {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
              <>
                <Ionicons name={mode === 'check_in' ? 'log-in-outline' : 'log-out-outline'} size={20} color={colors.onBrandPrimary} />
                <Text style={styles.captureText}>{mode === 'check_in' ? 'Capture & Check In' : 'Capture & Check Out'}</Text>
              </>
            )}
          </Pressable>
          <Text style={styles.hint}>Selfie + location are required. Position yourself in frame and tap the button.</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  title: {
    flex: 1, color: colors.onSurface, fontSize: 22, fontWeight: '700',
    fontFamily: fonts.display,
  },
  cameraWrap: { flex: 1, backgroundColor: '#000', overflow: 'hidden', marginHorizontal: spacing.lg, borderRadius: radius.lg, position: 'relative' },
  permBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  permTitle: { color: colors.onSurface, fontSize: 18, fontWeight: '700', marginTop: spacing.md },
  permSub: { color: colors.onSurfaceTertiary, textAlign: 'center', fontSize: 13 },
  permCta: { marginTop: spacing.md, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingHorizontal: spacing.xl, paddingVertical: 12 },
  permCtaText: { color: colors.onBrandPrimary, fontWeight: '700' },

  locBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md,
    marginHorizontal: spacing.lg, backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 10,
  },
  locOk: { color: colors.brandSecondary, fontSize: 12, flex: 1 },
  locWaiting: { color: colors.mutedText, fontSize: 12, flex: 1 },
  locDenied: { color: '#F1A9A9', fontSize: 12 },

  statusMsg: { color: colors.brandSecondary, textAlign: 'center', marginTop: spacing.sm, fontSize: 12 },

  footer: { padding: spacing.lg, paddingBottom: Platform.OS === 'ios' ? 36 : spacing.lg },
  captureBtn: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 16,
  },
  captureText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 15, letterSpacing: 0.3 },
  hint: { color: colors.mutedText, fontSize: 11, textAlign: 'center', marginTop: spacing.sm },
});
