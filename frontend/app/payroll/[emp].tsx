import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Platform, Alert, Linking, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

const fmtINR = (n: number) => `₹${(n || 0).toLocaleString('en-IN')}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function PayrollDetail() {
  const { emp, year, month } = useLocalSearchParams<{ emp: string; year: string; month: string }>();
  const y = parseInt(year || '0', 10), m = parseInt(month || '0', 10);
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const canWrite = user?.role === 'owner' || user?.role === 'accountant';
  const [row, setRow] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [addPaymentOpen, setAddPaymentOpen] = useState(false);
  const payGuard = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<any>(`/payroll/${y}/${m}`);
      const found = (res.rows || []).find((r: any) => r.employee_id === emp);
      setRow(found ? { ...found, _saved: res.saved, _locked: res.locked } : null);
      if (found?.id) {
        try { setPayments(await api.get<any[]>(`/payroll/entry/${found.id}/payments`)); }
        catch (_e) { setPayments([]); }
      } else setPayments([]);
    } finally { setLoading(false); }
  }, [emp, y, m]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const amountPaid = useMemo(() => payments.reduce((s, p) => s + (p.amount || 0), 0), [payments]);
  const remaining = Math.max(0, Math.round(((row?.net_salary || 0) - amountPaid) * 100) / 100);

  const addPayment = async (mode: 'cash' | 'bank' | 'upi' | 'cheque', amount: number, note: string) => {
    if (payGuard.current) return; // stop rapid double/triple taps from double-firing
    if (!row?.id) { Alert.alert('Generate payroll first', 'Save the payroll for this month before recording a payment.'); return; }
    payGuard.current = true;
    try {
      const res = await api.post<any>(`/payroll/entry/${row.id}/payments`, { payment_mode: mode, amount, note });
      setAddPaymentOpen(false);
      await load();
      Alert.alert(res.fully_paid ? 'Marked paid' : 'Payment recorded', res.fully_paid
        ? 'Salary receipt is ready to download.'
        : `₹${res.remaining.toLocaleString('en-IN')} still remaining.`);
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { payGuard.current = false; }
  };

  const removePayment = async (paymentId: string) => {
    if (payGuard.current) return;
    payGuard.current = true;
    try {
      await api.del(`/payroll/entry/${row.id}/payments/${paymentId}`);
      await load();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { payGuard.current = false; }
  };

  const downloadPdf = () => {
    if (!row?.id) { Alert.alert('Generate payroll first', 'Save the payroll for this month first.'); return; }
    const base = process.env.EXPO_PUBLIC_BACKEND_URL || '';
    const url = `${base}/api/payroll/entry/${row.id}/pdf`;
    // Server requires auth header; open via a signed URL not possible here so use API and open in browser after we fetch token — for now open via Linking; user is authed cookie-free so this is limited. For mobile, prefer expo-web-browser. Keep simple: alert with URL.
    Linking.openURL(url).catch(() => Alert.alert('Preview only', 'Deploy the app to download PDFs on device. Current URL: ' + url));
  };

  // Drill-down from a Breakdown row (Bonus/Advance/Fine/Deduction) into exactly
  // the ledger entries of that type within this payroll month, so the owner can
  // see what's behind the number and add/edit/delete right there.
  const openLedgerMonth = (type: 'advance' | 'bonus' | 'fine' | 'deduction', label: string) => {
    router.push({ pathname: '/ledger/[id]', params: { id: emp, year: String(y), month: String(m), type, label } });
  };

  if (loading) return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Header title="Payroll" onBack={() => router.back()} />
      <View style={styles.centered}><ActivityIndicator color={colors.brandPrimary} size="large" /></View>
    </SafeAreaView>
  );
  if (!row) return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Header title="Payroll" onBack={() => router.back()} />
      <View style={styles.centered}><Text style={{ color: colors.onSurface }}>Entry not found</Text></View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="payroll-detail-screen">
      <Header title={`${MONTHS[m - 1]} ${y}`} onBack={() => router.back()} />

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
        <View style={styles.head}>
          {row.photo ? (
            <Image source={{ uri: row.photo }} style={styles.avatarPhoto} />
          ) : (
            <View style={styles.avatar}><Text style={styles.avatarText}>{initials(row.name)}</Text></View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{row.name}</Text>
            <Text style={styles.meta}>{row.employee_code} · {row.designation || '—'}</Text>
          </View>
        </View>

        <Pressable
          style={styles.modifyBtn}
          testID="modify-attendance-btn"
          onPress={() => router.push(`/attendance/calendar/${row.employee_id}`)}
        >
          <Ionicons name="calendar-outline" size={16} color={colors.onSurface} />
          <Text style={styles.modifyBtnText}>Modify attendance for this month</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.onSurface} />
        </Pressable>

        <Line label="Base Salary" value={fmtINR(row.base_salary)} />
        <SectionTitle text="Days Summary" />
        <Line label="Present days" value={String(row.present_days)} />
        <Line label="Half days" value={String(row.half_days)} />
        <Line label="Sunday work (half-day bonus)" value={String(row.sunday_work)} />
        <Line label="Leave days (paid)" value={String(row.leave_days)} />
        <Line label="Holidays (paid)" value={String(row.holiday_days ?? 0)} />
        <Line label="Weekly off / Paid off" value={String(row.weekly_off_days ?? 0)} />
        <Line label="Effective / Total" value={`${row.effective_days} / ${row.total_days}`} accent />

        <SectionTitle text="Formula" />
        <View style={styles.formulaBox} testID="formula-box">
          <Text style={styles.formulaLine}>Per-day rate = Base ÷ Total days</Text>
          <Text style={styles.formulaCalc}>= {fmtINR(row.base_salary)} ÷ {row.total_days} = {fmtINR(row.per_day_rate ?? row.base_salary / row.total_days)}</Text>
          <View style={styles.formulaDivider} />
          <Text style={styles.formulaLine}>Earned = Per-day × Effective days + Per-day × 0.5 × Sunday work</Text>
          <Text style={styles.formulaCalc}>
            = {fmtINR(row.per_day_rate ?? 0)} × {row.effective_days} + {fmtINR(row.per_day_rate ?? 0)} × 0.5 × {row.sunday_work} = {fmtINR(row.earned)}
          </Text>
          <View style={styles.formulaDivider} />
          <Text style={styles.formulaLine}>Net = Earned + Bonus − Advance − Fine − Deduction {row.opening_balance ? '± Opening balance' : ''}</Text>
          <Text style={styles.formulaCalc}>
            = {fmtINR(row.earned)} + {fmtINR(row.bonus)} − {fmtINR(row.advance)} − {fmtINR(row.fine)} − {fmtINR(row.manual_deduction)}
            {row.opening_balance ? ` ${row.opening_balance > 0 ? '+' : '−'} ${fmtINR(Math.abs(row.opening_balance))}` : ''} = {fmtINR(row.net_salary_exact ?? row.net_salary)}
          </Text>
          {row.net_salary_exact !== undefined && row.net_salary_exact !== row.net_salary && (
            <>
              <View style={styles.formulaDivider} />
              <Text style={styles.formulaLine}>Rounded to nearest ₹10</Text>
              <Text style={styles.formulaCalc}>= {fmtINR(row.net_salary_exact)} → {fmtINR(row.net_salary)}</Text>
            </>
          )}
        </View>

        {row.opening_balance !== undefined && row.opening_balance !== 0 && (
          <>
            <SectionTitle text="Opening Balance" />
            <Line
              label={row.opening_balance > 0 ? 'Owed to employee (carry-in +)' : 'Owed by employee (carry-in −)'}
              value={`${row.opening_balance > 0 ? '+' : '−'} ${fmtINR(row.opening_balance)}`}
              pos={row.opening_balance > 0} neg={row.opening_balance < 0}
            />
          </>
        )}

        <SectionTitle text="Breakdown" />
        <Line label="Earned" value={fmtINR(row.earned)} accent />
        <Line
          label="Bonus" value={`+ ${fmtINR(row.bonus)}`} pos
          onPress={() => openLedgerMonth('bonus', 'Bonus')} testID="breakdown-bonus"
        />
        <Line
          label="Advance" value={`− ${fmtINR(row.advance)}`} neg
          onPress={() => openLedgerMonth('advance', 'Advance')} testID="breakdown-advance"
        />
        <Line
          label="Fine" value={`− ${fmtINR(row.fine)}`} neg
          onPress={() => openLedgerMonth('fine', 'Fine')} testID="breakdown-fine"
        />
        <Line
          label="Manual Deduction" value={`− ${fmtINR(row.manual_deduction)}`} neg
          onPress={() => openLedgerMonth('deduction', 'Manual Deduction')} testID="breakdown-deduction"
        />

        {row._saved && canWrite && !row._locked && !row.paid && (
          <OverridesEditor row={row} onSaved={load} />
        )}

        <View style={styles.netBox}>
          <Text style={styles.netLabel}>NET SALARY</Text>
          <Text style={styles.netVal}>{fmtINR(row.net_salary)}</Text>
        </View>

        {row._saved && payments.length > 0 && (
          <>
            <SectionTitle text="Payments Recorded" />
            {payments.map((p) => (
              <View key={p.id} style={styles.paymentRow} testID={`payment-${p.id}`}>
                <View style={styles.paymentIcon}>
                  <Ionicons name={PAY_ICON[p.payment_mode] || 'cash-outline'} size={15} color={colors.brandSecondary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.paymentMode}>{p.payment_mode.toUpperCase()}</Text>
                  {!!p.note && <Text style={styles.paymentNote}>{p.note}</Text>}
                </View>
                <Text style={styles.paymentAmount}>{fmtINR(p.amount)}</Text>
                {canWrite && !row.paid && (
                  <Pressable onPress={() => removePayment(p.id)} style={styles.paymentDelete} testID={`payment-${p.id}-delete`} hitSlop={8}>
                    <Ionicons name="close-circle" size={18} color={colors.onError} />
                  </Pressable>
                )}
              </View>
            ))}
            {!row.paid && (
              <View style={styles.remainingRow}>
                <Text style={styles.remainingLabel}>Remaining</Text>
                <Text style={styles.remainingValue}>{fmtINR(remaining)}</Text>
              </View>
            )}
          </>
        )}

        <View style={styles.actions}>
          {row._saved && !row.paid && canWrite && !addPaymentOpen && (
            <Pressable style={styles.payBtn} onPress={() => setAddPaymentOpen(true)} testID="mark-paid-btn">
              <Ionicons name="wallet-outline" size={18} color={colors.onBrandPrimary} />
              <Text style={styles.payText}>{payments.length > 0 ? 'Record Another Payment' : 'Record Payment'}</Text>
            </Pressable>
          )}
          {row._saved && !row.paid && canWrite && addPaymentOpen && (
            <RecordPaymentForm
              remaining={remaining}
              onCancel={() => setAddPaymentOpen(false)}
              onConfirm={addPayment}
            />
          )}
          {row._saved && (
            <Pressable style={styles.pdfBtn} onPress={downloadPdf} testID="download-pdf-btn">
              <Ionicons name="document-text-outline" size={18} color={colors.onSurface} />
              <Text style={styles.pdfText}>{row.paid ? 'Download Receipt' : 'Download Payslip'} (PDF)</Text>
            </Pressable>
          )}
          {row.paid && (
            <View style={styles.paidBanner}>
              <Ionicons name="checkmark-circle" size={20} color={colors.brandPrimary} />
              <Text style={styles.paidBannerText}>Paid</Text>
            </View>
          )}
          {!row._saved && (
            <View style={styles.hintBox}>
              <Ionicons name="information-circle-outline" size={16} color={colors.brandSecondary} />
              <Text style={styles.hintText}>Preview only. Generate payroll on the Payroll tab to unlock PDF & payment actions.</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const PAY_MODES = [
  { key: 'cash', label: 'Cash', icon: 'cash-outline' },
  { key: 'bank', label: 'Bank', icon: 'business-outline' },
  { key: 'upi', label: 'UPI', icon: 'phone-portrait-outline' },
  { key: 'cheque', label: 'Cheque', icon: 'document-text-outline' },
] as const;

const PAY_ICON: Record<string, any> = {
  cash: 'cash-outline', bank: 'business-outline', upi: 'phone-portrait-outline', cheque: 'document-text-outline',
};

// Records ONE payment toward an employee's net salary. A salary doesn't have to
// be paid in a single mode — e.g. part cash now, part bank transfer next week —
// so this form defaults the amount to whatever's still remaining but lets the
// admin split it, and the parent screen lists every payment made so far.
function RecordPaymentForm({ remaining, onCancel, onConfirm }: {
  remaining: number;
  onCancel: () => void;
  onConfirm: (mode: 'cash' | 'bank' | 'upi' | 'cheque', amount: number, note: string) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStylesOv(colors), [colors]);
  const [mode, setMode] = useState<'cash' | 'bank' | 'upi' | 'cheque' | null>(null);
  const [amount, setAmount] = useState(String(remaining || ''));
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);

  const confirm = () => {
    const amt = parseFloat(amount);
    if (!mode) { Alert.alert('Select a mode', 'Choose how this payment was made.'); return; }
    if (!amt || amt <= 0) { Alert.alert('Invalid amount', 'Enter an amount greater than 0.'); return; }
    if (amt > remaining + 0.5) { Alert.alert('Too much', `That's more than the ₹${remaining.toLocaleString('en-IN')} remaining.`); return; }
    setConfirming(true);
    onConfirm(mode, amt, note);
  };

  return (
    <View style={styles.payPicker} testID="pay-mode-picker">
      <Text style={styles.payPickerTitle}>Record a payment · ₹{remaining.toLocaleString('en-IN')} remaining</Text>
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
        {PAY_MODES.map((m) => (
          <Pressable
            key={m.key} testID={`pay-confirm-mode-${m.key}`}
            onPress={() => setMode(m.key)}
            style={[styles.mode, mode === m.key && styles.modeActive]}
          >
            <Ionicons name={m.icon as any} size={16} color={mode === m.key ? colors.onBrandPrimary : colors.onSurfaceTertiary} />
            <Text style={[styles.modeText, mode === m.key && { color: colors.onBrandPrimary }]}>{m.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.numLabel}>Amount (₹)</Text>
      <TextInput
        testID="pay-amount-input"
        value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ''))}
        keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText}
        style={[styles.numInput, { textAlign: 'left', fontSize: 16 }]}
      />

      <Text style={styles.numLabel}>Note (optional)</Text>
      <TextInput
        testID="pay-note-input"
        value={note} onChangeText={setNote}
        placeholder="e.g. UTR / cheque number" placeholderTextColor={colors.mutedText}
        style={styles.numInput}
      />

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
        <Pressable style={styles.payCancelBtn} onPress={onCancel} testID="pay-mode-cancel-btn">
          <Text style={styles.payCancelText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={[styles.payConfirmBtn, confirming && { opacity: 0.5 }]}
          onPress={confirm}
          disabled={confirming}
          testID="pay-mode-confirm-btn"
        >
          {confirming ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.payConfirmText}>Record Payment</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function OverridesEditor({ row, onSaved }: { row: any; onSaved: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const stylesOv = useMemo(() => makeStylesOv(colors), [colors]);
  const [bonus, setBonus] = useState(String(row.bonus || ''));
  const [fine, setFine] = useState(String(row.fine || ''));
  const [ded, setDed] = useState(String(row.manual_deduction || ''));
  const [note, setNote] = useState(row.note || '');
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  const save = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSaving(true);
    try {
      await api.put(`/payroll/entry/${row.id}`, {
        bonus_override: parseFloat(bonus || '0'),
        fine_override: parseFloat(fine || '0'),
        manual_deduction_override: parseFloat(ded || '0'),
        note,
      });
      onSaved();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); submittingRef.current = false; }
  };

  return (
    <View style={{ marginTop: spacing.lg }} testID="overrides-editor">
      <SectionTitle text="Adjust (before payment)" />
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <NumField label="Bonus" v={bonus} onC={setBonus} testID="ov-bonus" />
        <NumField label="Fine" v={fine} onC={setFine} testID="ov-fine" />
        <NumField label="Deduction" v={ded} onC={setDed} testID="ov-ded" />
      </View>
      <Text style={styles.section}>Note (shows on PDF)</Text>
      <TextInput
        testID="ov-note"
        value={note} onChangeText={setNote} multiline
        placeholder="Optional payslip note"
        placeholderTextColor={colors.mutedText}
        style={stylesOv.noteInput}
      />
      <Pressable onPress={save} disabled={saving} style={[stylesOv.saveBtn, saving && { opacity: 0.6 }]} testID="save-overrides-btn">
        {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={stylesOv.saveText}>Save Adjustments</Text>}
      </Pressable>
    </View>
  );
}

function NumField({ label, v, onC, testID }: { label: string; v: string; onC: (s: string) => void; testID?: string }) {
  const { colors } = useTheme();
  const stylesOv = useMemo(() => makeStylesOv(colors), [colors]);
  return (
    <View style={{ flex: 1 }}>
      <Text style={stylesOv.numLabel}>{label}</Text>
      <TextInput testID={testID} value={v} onChangeText={(x) => onC(x.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.mutedText} style={stylesOv.numInput} />
    </View>
  );
}

const makeStylesOv = (colors: ThemeColors) => StyleSheet.create({
  numLabel: { color: colors.mutedText, fontSize: 11, marginBottom: 4 },
  numInput: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, color: colors.onSurface, paddingHorizontal: 10,
    paddingVertical: 10, fontSize: 14, textAlign: 'right',
  },
  mode: {
    flex: 1, paddingVertical: 10, borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, alignItems: 'center',
  },
  modeActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  modeText: { color: colors.onSurfaceTertiary, fontWeight: '700', fontSize: 10 },
  noteInput: {
    minHeight: 60, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, color: colors.onSurface,
    fontSize: 13, textAlignVertical: 'top',
  },
  saveBtn: { marginTop: spacing.md, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center' },
  saveText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 14 },

  payPicker: {
    width: '100%', backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.brand, padding: spacing.md,
  },
  payPickerTitle: { color: colors.onSurface, fontSize: 13, fontWeight: '700' },
  payCancelBtn: {
    flex: 1, paddingVertical: 12, borderRadius: radius.md, alignItems: 'center',
    backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border,
  },
  payCancelText: { color: colors.onSurfaceSecondary, fontWeight: '700', fontSize: 13 },
  payConfirmBtn: { flex: 2, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center' },
  payConfirmText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 13 },
});

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
        <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
      </Pressable>
      <Text style={styles.title}>{title}</Text>
      <View style={{ width: 40 }} />
    </View>
  );
}

function SectionTitle({ text }: { text: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <Text style={styles.section}>{text}</Text>;
}
function Line({ label, value, pos, neg, accent, onPress, testID }: {
  label: string; value: string; pos?: boolean; neg?: boolean; accent?: boolean;
  onPress?: () => void; testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const c = pos ? colors.onSuccess : neg ? colors.onError : accent ? colors.brandPrimary : colors.onSurface;
  const Wrap = onPress ? Pressable : View;
  return (
    <Wrap style={styles.line} onPress={onPress} testID={testID}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Text style={styles.lineLabel}>{label}</Text>
        {!!onPress && <Ionicons name="chevron-forward" size={13} color={colors.mutedText} />}
      </View>
      <Text style={[styles.lineValue, { color: c }]}>{value}</Text>
    </Wrap>
  );
}

const initials = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('');

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

  modifyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderColor: colors.brand, borderWidth: 1,
    borderRadius: radius.md, padding: spacing.md,
  },
  modifyBtnText: { flex: 1, color: colors.onSurface, fontWeight: '700', fontSize: 13 },
  formulaBox: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  formulaLine: { color: colors.onSurfaceTertiary, fontSize: 12 },
  formulaCalc: { color: colors.brandSecondary, fontSize: 12, fontWeight: '700', marginTop: 2, marginBottom: 8 },
  formulaDivider: { height: 1, backgroundColor: colors.divider, marginVertical: 6 },
  head: {
    flexDirection: 'row', gap: spacing.md, alignItems: 'center',
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md,
  },
  avatar: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: colors.onBrandPrimary, fontSize: 18, fontWeight: '800' },
  avatarPhoto: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surfaceTertiary },
  name: { color: colors.onSurface, fontSize: 18, fontWeight: '700' },
  meta: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },

  section: {
    color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase',
    marginTop: spacing.lg, marginBottom: spacing.sm,
  },
  line: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, marginBottom: 4,
  },
  lineLabel: { color: colors.onSurfaceTertiary, fontSize: 13 },
  lineValue: { fontSize: 14, fontWeight: '700' },

  netBox: {
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, padding: spacing.lg,
    marginTop: spacing.lg, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  netLabel: { color: colors.onBrandPrimary, fontWeight: '800', letterSpacing: 1, fontSize: 13 },
  netVal: { color: colors.onBrandPrimary, fontSize: 26, fontWeight: '800' },

  actions: { marginTop: spacing.lg, gap: spacing.md },
  payBtn: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14,
  },
  payText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 15 },
  pdfBtn: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceSecondary, borderColor: colors.brand, borderWidth: 1,
    borderRadius: radius.md, paddingVertical: 14,
  },
  pdfText: { color: colors.onSurface, fontWeight: '700' },
  paidBanner: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary, borderWidth: 1,
    borderRadius: radius.md, paddingVertical: 12,
  },
  paidBannerText: { color: colors.brandSecondary, fontWeight: '700' },
  hintBox: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center',
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md,
  },
  hintText: { color: colors.onSurfaceTertiary, fontSize: 12, flex: 1 },

  paymentRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.sm, marginBottom: spacing.xs,
  },
  paymentIcon: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center',
  },
  paymentMode: { color: colors.onSurface, fontSize: 12, fontWeight: '700' },
  paymentNote: { color: colors.mutedText, fontSize: 11, marginTop: 1 },
  paymentAmount: { color: colors.onSurface, fontSize: 13, fontWeight: '700' },
  paymentDelete: { padding: 2 },
  remainingRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
  },
  remainingLabel: { color: colors.onSurfaceTertiary, fontSize: 12 },
  remainingValue: { color: colors.onWarning, fontSize: 13, fontWeight: '800' },
});
