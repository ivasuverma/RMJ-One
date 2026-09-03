import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, Modal, Linking, Platform,
} from 'react-native';
import { notify } from '@/src/utils/notify';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

export type PunchResult = { selfie: string; latitude: number; longitude: number };

type Props = {
  visible: boolean;
  mode: 'check_in' | 'check_out';
  onClose: () => void;
  onCapture: (r: PunchResult) => Promise<void> | void;
};

// GPS can take a long time to get a fix indoors (a jewelry shop's metal/
// concrete surroundings are a known weak spot) or never resolve at all.
// getCurrentPositionAsync has no built-in timeout, so a stuck fix used to
// leave the capture button silently disabled forever with no feedback —
// looked exactly like "the button does nothing" to whoever tapped it,
// especially by evening when the fix seems to take longer. Race it against
// a hard timeout so a stuck attempt turns into a visible, retryable error
// instead of an indefinite spinner-less wait.
const LOCATION_TIMEOUT_MS = 15000;
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export function PunchCaptureModal({ visible, mode, onClose, onCapture }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [locPerm, setLocPerm] = useState<Location.PermissionResponse | null>(null);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locError, setLocError] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const camRef = useRef<CameraView | null>(null);
  const submittingRef = useRef(false);

  const reset = useCallback(() => {
    setBusy(false); setStatusMsg(''); setCoords(null); setLocError('');
  }, []);

  useEffect(() => { if (!visible) reset(); }, [visible, reset]);

  const askLocation = useCallback(async () => {
    setLocError('');
    try {
      let perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted) {
        if (!perm.canAskAgain) { setLocPerm(perm); return perm; }
        perm = await Location.requestForegroundPermissionsAsync();
      }
      setLocPerm(perm);
      if (!perm.granted) return perm;
      const pos = await withTimeout(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        LOCATION_TIMEOUT_MS,
      );
      setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      return perm;
    } catch (e: any) {
      setLocError(e?.message === 'timeout' ? "Couldn't get a location fix — tap to retry." : 'Location failed — tap to retry.');
      return locPerm;
    }
  }, [locPerm]);

  useEffect(() => {
    if (!visible) return;
    askLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

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
      try {
        const pos = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), LOCATION_TIMEOUT_MS);
        setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      } catch (_e) {
        setStatusMsg('');
        setLocError("Couldn't get a location fix — tap to retry.");
        submittingRef.current = false;
        return;
      }
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
        const p = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), LOCATION_TIMEOUT_MS);
        return { latitude: p.coords.latitude, longitude: p.coords.longitude };
      })());
      await onCapture({ selfie, latitude: pos.latitude, longitude: pos.longitude });
      setStatusMsg('');
    } catch (e: any) {
      notify('Failed', e?.detail || e?.message || 'Please try again');
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
          ) : locError ? (
            <Pressable onPress={() => askLocation()} style={{ flex: 1 }} testID="punch-location-retry">
              <Text style={styles.locDenied}>{locError}</Text>
            </Pressable>
          ) : locPerm?.granted && coords ? (
            <Text style={styles.locOk}>Location captured · {coords.latitude.toFixed(4)}, {coords.longitude.toFixed(4)}</Text>
          ) : (
            <Pressable onPress={() => askLocation()} style={{ flex: 1 }}>
              <Text style={styles.locWaiting}>Waiting for location… (tap to retry)</Text>
            </Pressable>
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
  locDenied: { color: colors.onError, fontSize: 12 },

  statusMsg: { color: colors.brandSecondary, textAlign: 'center', marginTop: spacing.sm, fontSize: 12 },

  footer: { padding: spacing.lg, paddingBottom: Platform.OS === 'ios' ? 36 : spacing.lg },
  captureBtn: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 16,
  },
  captureText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 15, letterSpacing: 0.3 },
  hint: { color: colors.mutedText, fontSize: 11, textAlign: 'center', marginTop: spacing.sm },
});
