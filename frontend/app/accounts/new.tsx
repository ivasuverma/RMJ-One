import { useCallback, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { useSubmitGuard } from '@/src/hooks/use-submit-guard';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Input, Button, useToast } from '@/src/components/ui';

type AccountType = { id: string; name: string; key: string };

export default function NewAccountScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const guard = useSubmitGuard();
  const { type: presetType } = useLocalSearchParams<{ type?: string }>();

  const [types, setTypes] = useState<AccountType[]>([]);
  const [typeId, setTypeId] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [openingFine, setOpeningFine] = useState('');
  const [openingAmount, setOpeningAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; type?: string }>({});

  useFocusEffect(useCallback(() => {
    api.get<AccountType[]>('/account-types').then((ts) => {
      setTypes(ts);
      // Preselect by ?type=<key> (e.g. from a "new customer" shortcut) or the first type.
      setTypeId((prev) => prev || ts.find((t) => t.key === presetType)?.id || ts[0]?.id || '');
    }).catch(() => {});
  }, [presetType]));

  const submit = () => guard(async () => {
    const e: typeof errors = {};
    if (!name.trim()) e.name = 'Name is required';
    if (!typeId) e.type = 'Pick a type';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const created = await api.post<{ id: string }>('/accounts', {
        type_id: typeId,
        name: name.trim(),
        phone: phone.trim(),
        opening_fine: parseFloat(openingFine) || 0,
        opening_amount: parseFloat(openingAmount) || 0,
      });
      toast.success('Account created');
      // Replace so back returns to the ledger list, not this form.
      router.replace(`/accounts/${created.id}` as any);
    } catch (err: any) {
      toast.error(err?.detail || 'Could not create account');
    } finally { setBusy(false); }
  });

  const num = (v: string) => v.replace(/[^0-9.-]/g, '');

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="account-new-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>New Account</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Type{errors.type ? <Text style={styles.err}> · {errors.type}</Text> : null}</Text>
          <View style={styles.typeRow}>
            {types.map((t) => (
              <Pressable
                key={t.id}
                onPress={() => { setTypeId(t.id); setErrors((p) => ({ ...p, type: undefined })); }}
                style={[styles.typeChip, typeId === t.id && styles.typeChipActive]}
                testID={`account-type-${t.key}`}
              >
                <Text style={[styles.typeChipText, typeId === t.id && styles.typeChipTextActive]}>{t.name}</Text>
              </Pressable>
            ))}
          </View>

          <Input label="Name" value={name} onChangeText={(v) => { setName(v); setErrors((p) => ({ ...p, name: undefined })); }} required error={errors.name} placeholder="e.g. Ajay Sood, Bagga Jewellers" testID="account-name" />
          <Input label="Phone (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="Mobile number" testID="account-phone" />

          <Text style={styles.sectionLabel}>Opening balance</Text>
          <Text style={styles.hint}>Where this account starts. Positive = they owe the shop; negative = the shop owes them. Fine and cash are independent — set either or both.</Text>
          <Input label="Opening fine (g)" value={openingFine} onChangeText={(v) => setOpeningFine(num(v))} keyboardType="numbers-and-punctuation" placeholder="0.000" testID="account-opening-fine" />
          <Input label="Opening amount (₹)" value={openingAmount} onChangeText={(v) => setOpeningAmount(num(v))} keyboardType="numbers-and-punctuation" placeholder="0" testID="account-opening-amount" />

          <View style={{ height: spacing.lg }} />
          <Button label="Create account" onPress={submit} loading={busy} leftIcon="checkmark" testID="account-save" />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.md,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '700', fontFamily: fonts.display },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6, marginTop: spacing.sm },
  err: { color: colors.onError, fontWeight: '700' },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  typeChip: {
    paddingHorizontal: spacing.md, paddingVertical: 9, borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  typeChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  typeChipText: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: '700' },
  typeChipTextActive: { color: colors.onBrandPrimary },
  sectionLabel: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginTop: spacing.xl, marginBottom: spacing.sm },
  hint: { color: colors.mutedText, fontSize: 12, marginBottom: spacing.sm },
});
