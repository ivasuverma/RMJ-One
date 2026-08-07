import { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { colors, spacing, radius } from '@/src/theme';

const TYPES = [
  { key: 'advance', label: 'Advance', icon: 'cash-outline', color: '#F1A9A9' },
  { key: 'bonus', label: 'Bonus', icon: 'gift-outline', color: '#B7EFC5' },
  { key: 'fine', label: 'Fine', icon: 'warning-outline', color: '#F1A9A9' },
  { key: 'deduction', label: 'Deduction', icon: 'remove-circle-outline', color: '#F1A9A9' },
] as const;

export default function NewLedgerEntry() {
  const { emp } = useLocalSearchParams<{ emp: string }>();
  const router = useRouter();
  const [type, setType] = useState<typeof TYPES[number]['key']>('advance');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { Alert.alert('Invalid', 'Amount must be greater than 0'); return; }
    setSaving(true);
    try {
      await api.post('/ledger/entries', { employee_id: emp, entry_type: type, amount: amt, note });
      Alert.alert('Added', 'Ledger entry recorded.', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="ledger-new-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Add Ledger Entry</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Type</Text>
          <View style={styles.typeGrid}>
            {TYPES.map((t) => (
              <Pressable
                key={t.key}
                onPress={() => setType(t.key)}
                style={[styles.typeBtn, type === t.key && styles.typeBtnActive]}
                testID={`ledger-type-${t.key}`}
              >
                <View style={styles.typeIcon}><Ionicons name={t.icon} size={20} color={t.color} /></View>
                <Text style={[styles.typeLabel, type === t.key && { color: colors.onSurface }]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Amount (₹)</Text>
          <TextInput
            testID="ledger-amount"
            value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ''))}
            keyboardType="numeric" placeholder="0" placeholderTextColor={colors.mutedText}
            style={[styles.input, { fontSize: 22, textAlign: 'right' }]}
          />

          <Text style={styles.label}>Note (optional)</Text>
          <TextInput
            testID="ledger-note"
            value={note} onChangeText={setNote} multiline
            placeholder="Reason or reference..." placeholderTextColor={colors.mutedText}
            style={styles.textArea}
          />

          <View style={styles.info}>
            <Ionicons name="information-circle-outline" size={16} color={colors.brandSecondary} />
            <Text style={styles.infoText}>Advance / Fine / Deduction reduce net payroll. Bonus adds to it.</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={styles.footer}>
        <Pressable style={[styles.submit, saving && { opacity: 0.6 }]} disabled={saving} onPress={submit} testID="ledger-save-btn">
          {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.submitText}>Add Entry</Text>}
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
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: spacing.md, marginBottom: 6 },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md,
    paddingVertical: 14, fontSize: 15,
  },
  textArea: {
    minHeight: 90, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, color: colors.onSurface,
    textAlignVertical: 'top', fontSize: 14,
  },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  typeBtn: {
    flexBasis: '48%', flexGrow: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center', gap: spacing.xs,
  },
  typeBtnActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  typeIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  typeLabel: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: '700' },

  info: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center',
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, marginTop: spacing.md,
  },
  infoText: { color: colors.onSurfaceTertiary, fontSize: 12, flex: 1 },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider },
  submit: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 16, alignItems: 'center' },
  submitText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 15 },
});
