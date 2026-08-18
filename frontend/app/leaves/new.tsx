import { useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, Alert,
  ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { todayIST } from '@/src/utils/datetime';
import { DateField } from '@/src/components/DateField';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

const TYPES = ['casual', 'sick'] as const;

export default function NewLeave() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const today = todayIST();
  const [type, setType] = useState<typeof TYPES[number]>('casual');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  const submit = async () => {
    if (submittingRef.current) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      Alert.alert('Invalid date', 'Use format YYYY-MM-DD'); return;
    }
    submittingRef.current = true;
    setSaving(true);
    try {
      await api.post('/leaves', { from_date: from, to_date: to, leave_type: type, reason });
      router.back();
    } catch (e: any) {
      Alert.alert('Failed', e?.detail || 'Please try again');
    } finally { setSaving(false); submittingRef.current = false; }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="leave-form-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Apply for Leave</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Leave Type</Text>
          <View style={styles.typeRow}>
            {TYPES.map((t) => (
              <Pressable key={t} testID={`leave-type-${t}`} onPress={() => setType(t)}
                style={[styles.typeBtn, type === t && styles.typeBtnActive]}>
                <Text style={[styles.typeText, type === t && styles.typeTextActive]}>{t.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.rowFields}>
            <View style={{ flex: 1 }}>
              <DateField label="From" value={from} onChange={setFrom} testID="leave-from" />
            </View>
            <View style={{ flex: 1 }}>
              <DateField label="To" value={to} onChange={setTo} testID="leave-to" />
            </View>
          </View>

          <Text style={styles.label}>Reason</Text>
          <TextInput
            testID="leave-reason"
            value={reason} onChangeText={setReason} multiline
            placeholder="Brief reason for your leave..." placeholderTextColor={colors.mutedText}
            style={styles.textArea}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={styles.footer}>
        <Pressable onPress={submit} disabled={saving} style={[styles.submitBtn, saving && { opacity: 0.6 }]} testID="leave-submit-btn">
          {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.submitText}>Submit Request</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
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
    fontFamily: fonts.display,
  },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6, marginTop: spacing.md, fontWeight: '600' },
  typeRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  typeBtn: {
    flex: 1, minWidth: 70, paddingVertical: 10, borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, alignItems: 'center',
  },
  typeBtnActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  typeText: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: '700' },
  typeTextActive: { color: colors.onBrandPrimary },

  rowFields: { flexDirection: 'row', gap: spacing.md },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md,
    paddingVertical: 12, fontSize: 14,
  },
  textArea: {
    minHeight: 100, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, color: colors.onSurface,
    textAlignVertical: 'top', fontSize: 14,
  },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider },
  submitBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 16, alignItems: 'center' },
  submitText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 15 },
});
