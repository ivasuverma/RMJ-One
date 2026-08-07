import { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, Alert,
  ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { colors, spacing, radius } from '@/src/theme';

const OPTIONS = [
  { key: 'forgot_check_in', label: 'Forgot Check-In', icon: 'log-in-outline' },
  { key: 'forgot_check_out', label: 'Forgot Check-Out', icon: 'log-out-outline' },
  { key: 'machine_error', label: 'Machine Error', icon: 'warning-outline' },
  { key: 'other', label: 'Other', icon: 'ellipsis-horizontal-outline' },
] as const;

export default function CorrectionForm() {
  const router = useRouter();
  const [type, setType] = useState<typeof OPTIONS[number]['key']>('forgot_check_in');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await api.post('/attendance/corrections', { reason_type: type, note });
      Alert.alert('Submitted', 'Your correction request was sent to the owner.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert('Failed', e?.detail || 'Please try again');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="correction-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Attendance Correction</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>What happened?</Text>
          <View style={{ gap: spacing.sm }}>
            {OPTIONS.map((o) => (
              <Pressable
                key={o.key}
                testID={`corr-opt-${o.key}`}
                onPress={() => setType(o.key)}
                style={[styles.optRow, type === o.key && styles.optRowActive]}
              >
                <View style={styles.optIcon}><Ionicons name={o.icon} size={18} color={colors.brandSecondary} /></View>
                <Text style={[styles.optLabel, type === o.key && { color: colors.onSurface }]}>{o.label}</Text>
                {type === o.key && <Ionicons name="checkmark-circle" size={20} color={colors.brandPrimary} />}
              </Pressable>
            ))}
          </View>

          <Text style={[styles.label, { marginTop: spacing.xl }]}>Note (optional)</Text>
          <TextInput
            testID="corr-note-input"
            value={note} onChangeText={setNote} multiline
            placeholder="Add details for the owner..."
            placeholderTextColor={colors.mutedText}
            style={styles.textArea}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={styles.footer}>
        <Pressable onPress={submit} disabled={saving} style={[styles.submitBtn, saving && { opacity: 0.6 }]} testID="corr-submit-btn">
          {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.submitText}>Submit Correction</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  title: {
    flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '600',
    fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }),
  },
  label: { color: colors.onSurfaceSecondary, fontSize: 13, marginBottom: spacing.md, fontWeight: '600' },
  optRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  optRowActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  optIcon: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceTertiary,
    alignItems: 'center', justifyContent: 'center',
  },
  optLabel: { flex: 1, color: colors.onSurfaceTertiary, fontSize: 14, fontWeight: '600' },
  textArea: {
    minHeight: 100, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, color: colors.onSurface,
    textAlignVertical: 'top', fontSize: 14,
  },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider },
  submitBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 16, alignItems: 'center' },
  submitText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 15 },
});
