import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, Alert, Platform, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api, TOKEN_KEY } from '@/src/api/client';
import { storage } from '@/src/utils/storage';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

const KINDS: {
  key: string; label: string; icon: any;
  needsRange?: boolean; needsMonth?: boolean; needsEmp?: boolean;
}[] = [
  { key: 'attendance', label: 'Attendance', icon: 'time-outline', needsRange: true },
  { key: 'late', label: 'Late Punches', icon: 'alarm-outline', needsRange: true },
  { key: 'missing_punch', label: 'Missing Punch', icon: 'alert-circle-outline', needsRange: true },
  { key: 'leave', label: 'Leave', icon: 'calendar-outline', needsRange: true },
  { key: 'payroll', label: 'Payroll', icon: 'cash-outline', needsMonth: true },
  { key: 'ledger', label: 'Ledger (per employee)', icon: 'book-outline', needsEmp: true },
];

const today = new Date().toISOString().slice(0, 10);
const monthStart = today.slice(0, 7) + '-01';

export default function Reports() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [kind, setKind] = useState<typeof KINDS[number]['key']>('attendance');
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [empList, setEmpList] = useState<any[]>([]);
  const [empId, setEmpId] = useState<string>('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try { setEmpList(await api.get<any[]>('/employees')); }
      catch (_e) { setEmpList([]); }
    })();
  }, []);

  const cfg = KINDS.find((k) => k.key === kind)!;

  const generate = async () => {
    setBusy(true);
    try {
      const qs = new URLSearchParams();
      if (cfg.needsRange) { qs.set('from_date', from); qs.set('to_date', to); }
      if (cfg.needsMonth) { qs.set('year', year); qs.set('month', month); }
      if (cfg.needsEmp) {
        if (!empId) { Alert.alert('Select employee', 'Ledger report needs an employee'); return; }
        qs.set('employee_id', empId);
      }
      const base = process.env.EXPO_PUBLIC_BACKEND_URL || '';
      const url = `${base}/api/reports/${kind}/pdf?${qs.toString()}`;
      // Fetch with auth (Linking can't attach headers) then open blob
      const token = (await storage.secureGet<string>(TOKEN_KEY, '')) || '';
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Report failed (${res.status})`);
      if (Platform.OS === 'web') {
        const blob = await res.blob();
        const objUrl = URL.createObjectURL(blob);
        window.open(objUrl, '_blank');
      } else {
        // On native, opening the authenticated URL won't work — inform user.
        Alert.alert('Preview', 'Report generated successfully on server. Native PDF viewing will be available after deploy. URL: ' + url);
      }
    } catch (e: any) {
      Alert.alert('Failed', e?.message || 'Please try again');
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="reports-generate-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Reports</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
        <Text style={styles.section}>Report Type</Text>
        <View style={{ gap: spacing.sm }}>
          {KINDS.map((k) => (
            <Pressable
              key={k.key}
              testID={`report-kind-${k.key}`}
              onPress={() => setKind(k.key)}
              style={[styles.kindRow, kind === k.key && styles.kindRowActive]}
            >
              <View style={styles.kindIcon}><Ionicons name={k.icon} size={18} color={colors.brandSecondary} /></View>
              <Text style={[styles.kindLabel, kind === k.key && { color: colors.onSurface }]}>{k.label}</Text>
              {kind === k.key && <Ionicons name="checkmark-circle" size={20} color={colors.brandPrimary} />}
            </Pressable>
          ))}
        </View>

        <Text style={[styles.section, { marginTop: spacing.xl }]}>Parameters</Text>
        {cfg.needsRange && (
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>From</Text>
              <TextInput testID="report-from" value={from} onChangeText={setFrom} style={styles.input} autoCapitalize="none" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>To</Text>
              <TextInput testID="report-to" value={to} onChangeText={setTo} style={styles.input} autoCapitalize="none" />
            </View>
          </View>
        )}
        {cfg.needsMonth && (
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Year</Text>
              <TextInput testID="report-year" value={year} onChangeText={setYear} keyboardType="numeric" style={styles.input} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Month</Text>
              <TextInput testID="report-month" value={month} onChangeText={setMonth} keyboardType="numeric" style={styles.input} />
            </View>
          </View>
        )}
        {cfg.needsEmp && (
          <>
            <Text style={styles.label}>Employee</Text>
            <View style={styles.empList}>
              {empList.map((e) => (
                <Pressable key={e.id} onPress={() => setEmpId(e.id)} style={[styles.empRow, empId === e.id && styles.empRowActive]} testID={`report-emp-${e.employee_code}`}>
                  <Text style={[styles.empName, empId === e.id && { color: colors.onSurface }]}>{e.name}</Text>
                  <Text style={styles.empCode}>{e.employee_code}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={[styles.genBtn, busy && { opacity: 0.6 }]} disabled={busy} onPress={generate} testID="generate-report-btn">
          {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><Ionicons name="document-text-outline" size={18} color={colors.onBrandPrimary} /><Text style={styles.genText}>Generate PDF</Text></>}
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
    flex: 1, color: colors.onSurface, fontSize: 22, fontWeight: '600',
    fontFamily: fonts.display,
  },
  section: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: spacing.sm },
  kindRow: {
    flexDirection: 'row', gap: spacing.md, alignItems: 'center',
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md,
  },
  kindRowActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  kindIcon: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceTertiary,
    alignItems: 'center', justifyContent: 'center',
  },
  kindLabel: { flex: 1, color: colors.onSurfaceTertiary, fontSize: 14, fontWeight: '600' },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md,
    paddingVertical: 12, fontSize: 14,
  },
  empList: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  empRow: { padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  empRowActive: { backgroundColor: colors.brandTertiary },
  empName: { color: colors.onSurfaceTertiary, fontSize: 14 },
  empCode: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg,
    backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider,
  },
  genBtn: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 16,
  },
  genText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 15 },
});
