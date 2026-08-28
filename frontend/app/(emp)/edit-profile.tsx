import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { PhotoCaptureModal } from '@/src/components/PhotoCaptureModal';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Emp = {
  name?: string; mobile?: string; address?: string; aadhaar?: string; pan?: string;
  bank_account?: string; bank_ifsc?: string; bank_name?: string; photo?: string;
  employee_code?: string; designation?: string; department?: string;
};

export default function EmployeeEditProfile() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { refresh } = useAuth();
  const [form, setForm] = useState<Emp>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  const load = useCallback(async () => {
    try { setForm(await api.get<Emp>('/employees/me')); } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const set = (k: keyof Emp, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name?.trim()) { Alert.alert('Missing', 'Your name is required'); return; }
    setSaving(true);
    try {
      await api.put('/employees/me', {
        name: form.name?.trim(), mobile: form.mobile ?? '', address: form.address ?? '',
        aadhaar: form.aadhaar ?? '', pan: form.pan ?? '',
        bank_account: form.bank_account ?? '', bank_ifsc: form.bank_ifsc ?? '', bank_name: form.bank_name ?? '',
        photo: form.photo ?? '',
      });
      await refresh();
      router.back();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="emp-edit-profile">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} hitSlop={12} testID="back-btn"><Ionicons name="chevron-back" size={22} color={colors.onSurface} /></Pressable>
        <Text style={styles.title}>My Profile</Text>
        <View style={styles.iconBtn} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 40 }} />
      ) : (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
            {/* Photo */}
            <View style={styles.photoWrap}>
              {form.photo ? <Image source={{ uri: form.photo }} style={styles.photo} /> : <View style={[styles.photo, styles.photoEmpty]}><Ionicons name="person" size={40} color={colors.mutedText} /></View>}
              <Pressable onPress={() => setCameraOpen(true)} style={styles.photoBtn} testID="edit-photo"><Ionicons name="camera" size={16} color={colors.onBrandPrimary} /><Text style={styles.photoBtnText}>{form.photo ? 'Change photo' : 'Add photo'}</Text></Pressable>
            </View>
            <Text style={styles.readonly}>{form.employee_code || ''}{form.designation ? ` · ${form.designation}` : ''}{form.department ? ` · ${form.department}` : ''}</Text>

            <Text style={styles.section}>Personal</Text>
            <Field label="Full name" value={form.name} onChangeText={(v: string) => set('name', v)} styles={styles} />
            <Field label="Mobile" value={form.mobile} onChangeText={(v: string) => set('mobile', v)} keyboardType="phone-pad" styles={styles} />
            <Field label="Address" value={form.address} onChangeText={(v: string) => set('address', v)} multiline styles={styles} />

            <Text style={styles.section}>KYC</Text>
            <Field label="Aadhaar" value={form.aadhaar} onChangeText={(v: string) => set('aadhaar', v)} keyboardType="number-pad" styles={styles} />
            <Field label="PAN" value={form.pan} onChangeText={(v: string) => set('pan', v.toUpperCase())} autoCapitalize="characters" styles={styles} />

            <Text style={styles.section}>Bank</Text>
            <Field label="Account number" value={form.bank_account} onChangeText={(v: string) => set('bank_account', v)} keyboardType="number-pad" styles={styles} />
            <Field label="IFSC" value={form.bank_ifsc} onChangeText={(v: string) => set('bank_ifsc', v.toUpperCase())} autoCapitalize="characters" styles={styles} />
            <Field label="Bank name" value={form.bank_name} onChangeText={(v: string) => set('bank_name', v)} styles={styles} />

            <Pressable onPress={() => router.push('/settings/account' as any)} style={styles.accountRow} testID="emp-account-row">
              <Ionicons name="key-outline" size={18} color={colors.brandSecondary} />
              <Text style={styles.accountText}>Change username / password</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.mutedText} />
            </Pressable>
          </ScrollView>
          <View style={styles.footer}>
            <Pressable onPress={save} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]} testID="save-profile-btn">
              {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Save changes</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}

      <PhotoCaptureModal visible={cameraOpen} title="Profile photo" onClose={() => setCameraOpen(false)} onCapture={(p) => { set('photo', p); setCameraOpen(false); }} />
    </SafeAreaView>
  );
}

function Field({ label, value, onChangeText, styles, ...rest }: any) {
  return (
    <View style={{ marginBottom: spacing.sm }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput value={value || ''} onChangeText={onChangeText} style={[styles.input, rest.multiline && { height: 72, textAlignVertical: 'top' }]} {...rest} />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '700', fontFamily: fonts.display },
  photoWrap: { alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  photo: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.surfaceTertiary },
  photoEmpty: { alignItems: 'center', justifyContent: 'center' },
  photoBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.brandPrimary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill },
  photoBtnText: { color: colors.onBrandPrimary, fontSize: 12.5, fontWeight: '800' },
  readonly: { color: colors.mutedText, fontSize: 12.5, textAlign: 'center', marginBottom: spacing.md },
  section: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: '800', marginTop: spacing.lg, marginBottom: spacing.sm },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6 },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 15 },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xl, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  accountText: { flex: 1, color: colors.onSurface, fontSize: 15, fontWeight: '600' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg, paddingTop: spacing.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider },
  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 15, alignItems: 'center' },
  saveText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: '700' },
});
