import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { notify } from '@/src/utils/notify';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

// Split out of Store Settings — the thermal printer's IP/port is hardware
// config a shop sets once and rarely touches, unlike the store profile
// fields it used to sit alongside. PUT /settings/store is a full-document
// replace (see StoreSettingsIn in server.py), so this page still round-trips
// the rest of the store settings doc unchanged rather than sending a
// partial body.
export default function PrinterSettings() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [store, setStore] = useState<any>(null);
  const [ip, setIp] = useState('');
  const [port, setPort] = useState('9100');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const s = await api.get<any>('/settings/store');
        setStore(s || {});
        setIp(s?.printer_ip || '');
        setPort(String(s?.printer_port ?? 9100));
      } finally { setLoading(false); }
    })();
  }, []);

  const submittingRef = useRef(false);
  const save = async () => {
    if (submittingRef.current || !store) return;
    submittingRef.current = true;
    setSaving(true);
    try {
      await api.put('/settings/store', {
        ...store,
        printer_ip: ip.trim() || null,
        printer_port: parseInt(port || '9100', 10),
      });
      router.back();
    } catch (e: any) {
      notify('Failed', e?.detail || 'Please try again');
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
    <SafeAreaView style={styles.root} edges={['top']} testID="printer-settings-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Printer Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.section}>Thermal Printer</Text>
          <View style={styles.row2}>
            <View style={{ flex: 2 }}>
              <Text style={styles.label}>Printer IP</Text>
              <TextInput
                testID="printer-ip"
                value={ip}
                onChangeText={(v) => setIp(v.replace(/[^0-9.]/g, ''))}
                keyboardType="numeric"
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
                placeholderTextColor={colors.mutedText}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Port</Text>
              <TextInput
                testID="printer-port"
                value={port}
                onChangeText={(v) => setPort(v.replace(/[^0-9]/g, ''))}
                keyboardType="numeric"
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
                placeholderTextColor={colors.mutedText}
              />
            </View>
          </View>
          <View style={styles.infoBox}>
            <Ionicons name="print-outline" size={16} color={colors.brandSecondary} />
            <Text style={styles.infoText}>WiFi ESC/POS receipt printer (e.g. Retsol RTP82). Port 9100 is the standard raw/JetDirect port. Leave blank to disable direct printing.</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={styles.footer}>
        <Pressable onPress={save} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]} testID="printer-save-btn">
          {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Save Settings</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
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
    marginBottom: spacing.sm,
  },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6 },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md,
    paddingVertical: 12, fontSize: 14,
  },
  row2: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  infoBox: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginTop: spacing.md,
  },
  infoText: { color: colors.onSurfaceTertiary, fontSize: 12, flex: 1 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 16, alignItems: 'center' },
  saveText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 15 },
});
