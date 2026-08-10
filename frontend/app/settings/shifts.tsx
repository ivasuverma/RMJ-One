import { useCallback, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, Platform, KeyboardAvoidingView, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { colors, spacing, radius, fonts } from '@/src/theme';

type Shift = { id: string; name: string; start: string; end: string; grace_min: number; is_active: boolean };

export default function ShiftsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Shift[]>([]);
  const [name, setName] = useState('');
  const [start, setStart] = useState('10:00');
  const [end, setEnd] = useState('19:30');
  const [grace, setGrace] = useState('15');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await api.get<Shift[]>('/shifts')); }
    catch (_e) { setItems([]); }
    finally { setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const submittingRef = useRef(false);
  const add = async () => {
    if (submittingRef.current) return;
    if (!name.trim()) { Alert.alert('Missing', 'Shift name is required'); return; }
    submittingRef.current = true;
    setSaving(true);
    try {
      await api.post('/shifts', { name: name.trim(), start, end, grace_min: parseInt(grace || '0', 10), is_active: true });
      setName(''); setStart('10:00'); setEnd('19:30'); setGrace('15'); await load();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); submittingRef.current = false; }
  };

  const remove = (s: Shift) => {
    Alert.alert('Delete shift', `Remove ${s.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { try { await api.del(`/shifts/${s.id}`); await load(); } catch (_e) {} } },
    ]);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="shifts-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Shifts</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        >
          <Text style={styles.section}>Add Shift</Text>
          <TextInput testID="shift-name" value={name} onChangeText={setName} placeholder="Shift name" placeholderTextColor={colors.mutedText} style={styles.input} />
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Start</Text>
              <TextInput testID="shift-start" value={start} onChangeText={setStart} placeholder="10:00" placeholderTextColor={colors.mutedText} style={styles.input} autoCapitalize="none" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>End</Text>
              <TextInput testID="shift-end" value={end} onChangeText={setEnd} placeholder="19:30" placeholderTextColor={colors.mutedText} style={styles.input} autoCapitalize="none" />
            </View>
          </View>
          <Text style={styles.label}>Grace (min)</Text>
          <TextInput testID="shift-grace" value={grace} onChangeText={(v) => setGrace(v.replace(/[^0-9]/g, ''))} keyboardType="numeric" style={styles.input} />
          <Pressable style={[styles.addBtn, saving && { opacity: 0.6 }]} disabled={saving} onPress={add} testID="add-shift-btn">
            {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><Ionicons name="add" size={16} color={colors.onBrandPrimary} /><Text style={styles.addBtnText}>Add Shift</Text></>}
          </Pressable>

          <Text style={[styles.section, { marginTop: spacing.xl }]}>Existing Shifts</Text>
          {items.map((s) => (
            <View key={s.id} style={styles.card} testID={`shift-${s.id}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cName}>{s.name}</Text>
                <Text style={styles.cMeta}>{s.start} – {s.end} · Grace {s.grace_min}m</Text>
              </View>
              <Pressable onPress={() => remove(s)} style={styles.delBtn} hitSlop={10} testID={`del-shift-${s.id}`}>
                <Ionicons name="trash-outline" size={16} color="#F1A9A9" />
              </Pressable>
            </View>
          ))}
        </ScrollView>
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
    fontFamily: fonts.display,
  },
  section: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 4, marginTop: 6 },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md,
    paddingVertical: 12, fontSize: 14, marginBottom: spacing.sm,
  },
  row2: { flexDirection: 'row', gap: spacing.md },
  addBtn: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, marginTop: spacing.sm,
  },
  addBtnText: { color: colors.onBrandPrimary, fontWeight: '700' },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  cName: { color: colors.onSurface, fontWeight: '700', fontSize: 14 },
  cMeta: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  delBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(122,40,40,0.15)',
    borderColor: colors.error, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
});
