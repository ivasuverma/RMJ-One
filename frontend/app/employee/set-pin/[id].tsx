import { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { colors, spacing, radius } from '@/src/theme';

export default function SetPin() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!/^\d{4}$/.test(pin)) { Alert.alert('Invalid', 'PIN must be exactly 4 digits'); return; }
    if (pin !== confirm) { Alert.alert('Mismatch', 'PIN and confirmation don\'t match'); return; }
    setSaving(true);
    try {
      await api.post(`/employees/${id}/set-pin`, { pin });
      Alert.alert('Updated', 'PIN was updated.', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e: any) {
      Alert.alert('Failed', e?.detail || 'Please try again');
    } finally { setSaving(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="set-pin-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Set Employee PIN</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={{ padding: spacing.xl }}>
          <Text style={styles.info}>Set a new 4-digit PIN. The employee will use this PIN with their code to log in and punch attendance.</Text>

          <Text style={styles.label}>New PIN</Text>
          <TextInput
            testID="pin-input"
            value={pin} onChangeText={(v) => setPin(v.replace(/[^0-9]/g, '').slice(0, 4))}
            keyboardType="number-pad" secureTextEntry maxLength={4}
            placeholder="••••" placeholderTextColor={colors.mutedText}
            style={styles.input}
          />

          <Text style={styles.label}>Confirm PIN</Text>
          <TextInput
            testID="pin-confirm-input"
            value={confirm} onChangeText={(v) => setConfirm(v.replace(/[^0-9]/g, '').slice(0, 4))}
            keyboardType="number-pad" secureTextEntry maxLength={4}
            placeholder="••••" placeholderTextColor={colors.mutedText}
            style={styles.input}
          />

          <Pressable onPress={submit} disabled={saving} style={[styles.submit, saving && { opacity: 0.6 }]} testID="pin-save-btn">
            {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.submitText}>Save PIN</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
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
    flex: 1, color: colors.onSurface, fontSize: 22, fontWeight: '600',
    fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }),
  },
  info: { color: colors.onSurfaceTertiary, fontSize: 13, marginBottom: spacing.lg },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6, marginTop: spacing.md },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.lg,
    paddingVertical: 16, fontSize: 22, letterSpacing: 12, textAlign: 'center',
  },
  submit: { marginTop: spacing.xl, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 16, alignItems: 'center' },
  submitText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 15 },
});
