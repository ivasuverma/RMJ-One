import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, Platform, KeyboardAvoidingView, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Form = {
  name: string; latitude: string; longitude: string; radius_m: string;
  work_start: string; work_end: string; grace_min: string; round_net_salary: boolean;
  printer_ip: string; printer_port: string;
  biometric_webhook_secret: string;
};

const EMPTY: Form = {
  name: '', latitude: '', longitude: '', radius_m: '150',
  work_start: '10:00', work_end: '19:30', grace_min: '15', round_net_salary: false,
  printer_ip: '', printer_port: '9100',
  biometric_webhook_secret: '',
};

export default function StoreSettings() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [form, setForm] = useState<Form>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pickingLoc, setPickingLoc] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const s = await api.get<any>('/settings/store');
        if (s?.id) {
          setForm({
            name: s.name || '', latitude: String(s.latitude ?? ''), longitude: String(s.longitude ?? ''),
            radius_m: String(s.radius_m ?? 150), work_start: s.work_start || '10:00',
            work_end: s.work_end || '19:30', grace_min: String(s.grace_min ?? 15),
            round_net_salary: !!s.round_net_salary,
            printer_ip: s.printer_ip || '', printer_port: String(s.printer_port ?? 9100),
            biometric_webhook_secret: s.biometric_webhook_secret || '',
          });
        }
      } finally { setLoading(false); }
    })();
  }, []);

  const useCurrent = async () => {
    setPickingLoc(true);
    try {
      const existing = await Location.getForegroundPermissionsAsync();
      let perm = existing;
      if (!existing.granted && existing.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Location denied', 'Enable location permission to use current location.', [
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
          { text: 'Cancel', style: 'cancel' },
        ]);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setForm((f) => ({ ...f, latitude: pos.coords.latitude.toFixed(6), longitude: pos.coords.longitude.toFixed(6) }));
    } catch (_e) {
      Alert.alert('Failed', 'Could not fetch current location.');
    } finally { setPickingLoc(false); }
  };

  const submittingRef = useRef(false);
  const save = async () => {
    if (submittingRef.current) return;
    const lat = parseFloat(form.latitude), lng = parseFloat(form.longitude);
    if (!form.name.trim() || Number.isNaN(lat) || Number.isNaN(lng)) {
      Alert.alert('Missing', 'Store name and valid coordinates are required.'); return;
    }
    submittingRef.current = true;
    setSaving(true);
    try {
      await api.put('/settings/store', {
        name: form.name.trim(), latitude: lat, longitude: lng,
        radius_m: parseInt(form.radius_m || '150', 10),
        work_start: form.work_start, work_end: form.work_end,
        grace_min: parseInt(form.grace_min || '15', 10),
        round_net_salary: form.round_net_salary,
        printer_ip: form.printer_ip.trim() || null,
        printer_port: parseInt(form.printer_port || '9100', 10),
        biometric_webhook_secret: form.biometric_webhook_secret.trim() || null,
      });
      router.back();
    } catch (e: any) {
      Alert.alert('Failed', e?.detail || 'Please try again');
    } finally { setSaving(false); submittingRef.current = false; }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }} />
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.centered}><ActivityIndicator color={colors.brandPrimary} size="large" /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="store-settings-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Store Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          <SectionTitle text="Store" />
          <F label="Store Name" v={form.name} onC={(v) => setForm({ ...form, name: v })} testID="ss-name" />

          <SectionTitle text="Location & Fence" />
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <F label="Latitude" v={form.latitude} onC={(v) => setForm({ ...form, latitude: v.replace(/[^0-9.\-]/g, '') })} kt="numeric" testID="ss-lat" />
            </View>
            <View style={{ flex: 1 }}>
              <F label="Longitude" v={form.longitude} onC={(v) => setForm({ ...form, longitude: v.replace(/[^0-9.\-]/g, '') })} kt="numeric" testID="ss-lng" />
            </View>
          </View>
          <Pressable onPress={useCurrent} style={styles.locBtn} disabled={pickingLoc} testID="ss-use-current-btn">
            <Ionicons name="locate" size={16} color={colors.brandPrimary} />
            <Text style={styles.locBtnText}>{pickingLoc ? 'Fetching…' : 'Use my current location'}</Text>
          </Pressable>
          <F label="Fence Radius (metres)" v={form.radius_m} onC={(v) => setForm({ ...form, radius_m: v.replace(/[^0-9]/g, '') })} kt="numeric" testID="ss-radius" />

          <SectionTitle text="Shift Hours" />
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <F label="Start (HH:MM)" v={form.work_start} onC={(v) => setForm({ ...form, work_start: v })} testID="ss-start" />
            </View>
            <View style={{ flex: 1 }}>
              <F label="End (HH:MM)" v={form.work_end} onC={(v) => setForm({ ...form, work_end: v })} testID="ss-end" />
            </View>
          </View>
          <F label="Late Grace (minutes)" v={form.grace_min} onC={(v) => setForm({ ...form, grace_min: v.replace(/[^0-9]/g, '') })} kt="numeric" testID="ss-grace" />

          <SectionTitle text="Payroll" />
          <Pressable
            onPress={() => setForm({ ...form, round_net_salary: !form.round_net_salary })}
            style={styles.toggleRow}
            testID="ss-round-salary-toggle"
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Round final pay to nearest ₹10</Text>
              <Text style={styles.toggleSub}>e.g. ₹18,247 becomes ₹18,250</Text>
            </View>
            <View style={[styles.switch, form.round_net_salary && styles.switchOn]}>
              <View style={[styles.switchKnob, form.round_net_salary && styles.switchKnobOn]} />
            </View>
          </Pressable>

          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={16} color={colors.brandSecondary} />
            <Text style={styles.infoText}>Employees can only check in when within the fence radius of these coordinates.</Text>
          </View>

          <SectionTitle text="Thermal Printer" />
          <View style={styles.row2}>
            <View style={{ flex: 2 }}>
              <F label="Printer IP" v={form.printer_ip} onC={(v) => setForm({ ...form, printer_ip: v.replace(/[^0-9.]/g, '') })} kt="numeric" testID="ss-printer-ip" />
            </View>
            <View style={{ flex: 1 }}>
              <F label="Port" v={form.printer_port} onC={(v) => setForm({ ...form, printer_port: v.replace(/[^0-9]/g, '') })} kt="numeric" testID="ss-printer-port" />
            </View>
          </View>
          <View style={styles.infoBox}>
            <Ionicons name="print-outline" size={16} color={colors.brandSecondary} />
            <Text style={styles.infoText}>WiFi ESC/POS receipt printer (e.g. Retsol RTP82). Port 9100 is the standard raw/JetDirect port. Leave blank to disable direct printing.</Text>
          </View>

          <SectionTitle text="Biometric Attendance (eBioServer)" />
          <F
            label="Webhook Secret (optional)"
            v={form.biometric_webhook_secret}
            onC={(v) => setForm({ ...form, biometric_webhook_secret: v })}
            testID="ss-biometric-secret"
          />
          <View style={styles.infoBox}>
            <Ionicons name="finger-print-outline" size={16} color={colors.brandSecondary} />
            <Text style={styles.infoText}>
              Optional — if set, only pushes with this key in the webhook URL are accepted. Set it here, then find the full webhook URL to paste into eBioServer under Settings → Biometric Devices.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={styles.footer}>
        <Pressable onPress={save} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]} testID="ss-save-btn">
          {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Save Settings</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function SectionTitle({ text }: { text: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <Text style={styles.section}>{text}</Text>;
}
function F({ label, v, onC, kt, testID }: { label: string; v: string; onC: (s: string) => void; kt?: any; testID?: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput testID={testID} value={v} onChangeText={onC} keyboardType={kt} style={styles.input} autoCapitalize="none" autoCorrect={false} placeholderTextColor={colors.mutedText} />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  centered: { flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  title: {
    flex: 1, color: colors.onSurface, fontSize: 22, fontWeight: '600',
    fontFamily: fonts.display,
  },
  section: {
    color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase',
    marginTop: spacing.lg, marginBottom: spacing.sm,
  },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6 },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md,
    paddingVertical: 12, fontSize: 14,
  },
  row2: { flexDirection: 'row', gap: spacing.md },
  locBtn: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary, borderWidth: 1,
    borderRadius: radius.md, paddingVertical: 12, marginBottom: spacing.md,
  },
  locBtnText: { color: colors.brandSecondary, fontWeight: '700', fontSize: 13 },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md,
  },
  toggleLabel: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  toggleSub: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  switch: {
    width: 44, height: 26, borderRadius: 13, backgroundColor: colors.surfaceTertiary,
    borderWidth: 1, borderColor: colors.border, padding: 2, justifyContent: 'center',
  },
  switchOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  switchKnob: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: colors.onSurfaceTertiary,
  },
  switchKnobOn: { backgroundColor: colors.onBrandPrimary, transform: [{ translateX: 18 }] },
  infoBox: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginTop: spacing.md,
  },
  infoText: { color: colors.onSurfaceTertiary, fontSize: 12, flex: 1 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 16, alignItems: 'center' },
  saveText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 15 },
});
