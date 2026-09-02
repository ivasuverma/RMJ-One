import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator, Alert, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { istTime, istDate, todayIST, nowISTLongLabel, displayDateOnlyWithWeekday, localDateStr } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { haptics } from '@/src/utils/haptics';
import { FilterChips, useToast } from '@/src/components/ui';

// Attendance & Payroll — one screen inside Work, three segments (matches the
// v2 design comp): Today (daily in/out), Calendar (pick a person, edit any
// day), Payroll (salary auto-synced to the month's attendance). Reuses the
// existing endpoints and the shared AttendanceCalendarView so the calendar's
// month/day-edit logic isn't duplicated.
type Row = {
  employee_id: string; employee_code: string; name: string;
  department: string; department_id?: string | null; location_id?: string | null;
  designation: string; shift: string;
  status: string; check_in?: string | null; check_out?: string | null;
  is_late?: boolean; working_hours?: number; missing_punch?: boolean; photo?: string;
};
type Department = { id: string; name: string };
type Location = { id: string; name: string };
type PayRow = {
  employee_id: string; name: string; designation: string; photo?: string;
  total_days: number; effective_days: number; advance: number; net_salary: number; paid?: boolean; id?: string;
  present_days?: number; absent_days?: number; half_days?: number;
};
type PayrollResp = { year: number; month: number; rows: PayRow[]; total_net: number };
type Ev = { id: string; employee_name: string; type: 'check_in' | 'check_out'; timestamp: string; is_late?: boolean; working_hours?: number; source?: string };

type Seg = 'today' | 'live' | 'pay' | 'ledgers';
type EmpLedgerRow = { id: string; name: string; employee_code?: string; designation?: string; closing_balance: number };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const fmtINR = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
const fmtTime = (iso?: string | null) => (iso ? (istTime(iso) || '—') : '—');
const initials = (name: string) => (name || '?').trim()[0]?.toUpperCase() || '?';

// Present = punched in on time · Late = punched in after grace · Absent =
// marked absent/leave/holiday · Not in = expected but hasn't punched yet.
type Bucket = 'present' | 'late' | 'absent' | 'notin';
function bucketOf(r: Row): Bucket {
  if (r.status === 'absent') return 'absent';
  if (r.check_in) return r.is_late ? 'late' : 'present';
  return 'notin';
}
const PILL: Record<Bucket | 'half' | 'missing', { label: string; tone: 'good' | 'warn' | 'bad' | 'info' | 'muted' }> = {
  present: { label: 'Present', tone: 'good' },
  late: { label: 'Late', tone: 'warn' },
  absent: { label: 'Absent', tone: 'bad' },
  notin: { label: 'Not in', tone: 'muted' },
  half: { label: 'Half day', tone: 'info' },
  missing: { label: 'Missing punch', tone: 'warn' },
};
function pillFor(r: Row) {
  if (r.status === 'half_day') return PILL.half;
  if (r.status === 'missing_punch') return PILL.missing;
  return PILL[bucketOf(r)];
}

export default function OwnerAttendance() {
  const router = useRouter();
  const { from, seg: segParam } = useLocalSearchParams<{ from?: string; seg?: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const goBack = () => { if (from === 'work' || from === 'transactions') router.replace('/(tabs)/work' as any); else router.back(); };

  const [seg, setSeg] = useState<Seg>(segParam === 'pay' ? 'pay' : segParam === 'live' ? 'live' : 'today');
  const [date, setDate] = useState(todayIST());
  const [rows, setRows] = useState<Row[]>([]);
  const [pay, setPay] = useState<PayrollResp | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [todayFilter, setTodayFilter] = useState<Bucket | 'all'>('all');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [deptFilter, setDeptFilter] = useState('all');
  const [locFilter, setLocFilter] = useState('all');
  const [empLedgers, setEmpLedgers] = useState<EmpLedgerRow[] | null>(null);
  const [empLedgersError, setEmpLedgersError] = useState('');
  const [empQ, setEmpQ] = useState('');
  const [liveOpen, setLiveOpen] = useState<Record<string, boolean>>({});
  const isToday = date === todayIST();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const stepMonth = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m > 12) { m = 1; y += 1; }
    if (m < 1) { m = 12; y -= 1; }
    setMonth(m); setYear(y);
  };
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [running, setRunning] = useState(false);
  const [pendingApprovals, setPendingApprovals] = useState(0);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ date });
      if (deptFilter !== 'all') params.set('department_id', deptFilter);
      if (locFilter !== 'all') params.set('location_id', locFilter);
      const r = await api.get<Row[]>(`/attendance/today?${params.toString()}`).catch(() => [] as Row[]);
      setRows(r);
    } finally { setLoading(false); setRefreshing(false); }
  }, [date, deptFilter, locFilter]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    api.get<Department[]>('/departments').then(setDepartments).catch(() => setDepartments([]));
    api.get<Location[]>('/locations').then(setLocations).catch(() => setLocations([]));
  }, []);

  // Pending attendance corrections + leave requests, for the Approvals button badge.
  useFocusEffect(useCallback(() => {
    Promise.all([
      api.get<{ status: string }[]>('/attendance/corrections').catch(() => []),
      api.get<{ status: string }[]>('/leaves').catch(() => []),
    ]).then(([c, l]) => setPendingApprovals(
      c.filter((x) => x.status === 'pending').length + l.filter((x) => x.status === 'pending').length,
    )).catch(() => {});
  }, []));

  const loadPay = useCallback(async () => {
    try { setPay(await api.get<PayrollResp>(`/payroll/${year}/${month}`)); } catch { setPay(null); }
  }, [year, month]);
  useFocusEffect(useCallback(() => { if (seg === 'pay') loadPay(); }, [seg, loadPay]));

  const loadLive = useCallback(async () => {
    try { setEvents(await api.get<Ev[]>('/attendance/live?limit=120')); } catch { setEvents([]); }
  }, []);
  useFocusEffect(useCallback(() => { if (seg === 'live') loadLive(); }, [seg, loadLive]));

  const loadEmpLedgers = useCallback(async () => {
    try {
      const qs = empQ.trim() ? `?q=${encodeURIComponent(empQ.trim())}` : '';
      setEmpLedgers(await api.get<EmpLedgerRow[]>(`/employees${qs}`));
      setEmpLedgersError('');
    } catch (e: any) { setEmpLedgers([]); setEmpLedgersError(e?.detail || 'Failed to load'); }
  }, [empQ]);
  useFocusEffect(useCallback(() => { if (seg === 'ledgers') loadEmpLedgers(); }, [seg, loadEmpLedgers]));

  // Group the punch feed by IST date, newest day first, newest punch first.
  const liveByDate = useMemo(() => {
    const groups: { date: string; items: Ev[] }[] = [];
    const byDate = new Map<string, Ev[]>();
    for (const e of events) {
      const d = istDate(e.timestamp);
      if (!byDate.has(d)) { byDate.set(d, []); groups.push({ date: d, items: byDate.get(d)! }); }
      byDate.get(d)!.push(e);
    }
    return groups;
  }, [events]);

  const counts = useMemo(() => {
    const c = { present: 0, late: 0, absent: 0, notin: 0 };
    rows.forEach((r) => { c[bucketOf(r)]++; });
    return c;
  }, [rows]);
  const inCount = counts.present + counts.late;
  const shownRows = useMemo(() => (todayFilter === 'all' ? rows : rows.filter((r) => bucketOf(r) === todayFilter)), [rows, todayFilter]);

  const runPayroll = async () => {
    setRunning(true);
    try { await api.post('/payroll/save', { year, month }); await loadPay(); toast.success(`${MONTHS[month - 1]} ${year} salary is locked to the current attendance.`); }
    catch (e: any) { Alert.alert('Could not run payroll', e?.detail || 'Please try again'); }
    finally { setRunning(false); }
  };

  const subtitle = seg === 'today' ? (isToday ? `${nowISTLongLabel()} · ${inCount} of ${rows.length} in` : `${displayDateOnlyWithWeekday(date)} · ${inCount} of ${rows.length} in`)
    : seg === 'live' ? 'Every check-in and check-out, newest first'
      : seg === 'ledgers' ? 'Employee wage ledgers — tap to record payments'
        : `${MONTHS[month - 1]} ${year} · salary synced to attendance`;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="attendance-screen">
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); if (seg === 'pay') loadPay(); if (seg === 'live') loadLive(); }} tintColor={colors.brandPrimary} />}
      >
        <Pressable onPress={goBack} style={styles.backRow} hitSlop={8} testID="back-btn">
          <Ionicons name="chevron-back" size={18} color={colors.brandPrimary} />
          <Text style={styles.backText}>Work</Text>
        </Pressable>
        <View style={styles.titleRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.h1}>Attendance</Text>
            <Text style={styles.sub}>{subtitle}</Text>
          </View>
          <Pressable onPress={() => { if (seg !== 'live') haptics.selection(); setSeg('live'); loadLive(); }} style={[styles.apprBtn, seg === 'live' && styles.apprBtnOn]} testID="attendance-live-btn" hitSlop={8}>
            <Ionicons name="pulse-outline" size={22} color={seg === 'live' ? colors.onBrandPrimary : colors.onSurface} />
          </Pressable>
          <Pressable onPress={() => router.push('/approvals' as any)} style={[styles.apprBtn, { marginLeft: spacing.sm }]} testID="attendance-approvals" hitSlop={8}>
            <Ionicons name="checkmark-done-outline" size={22} color={colors.onSurface} />
            {pendingApprovals > 0 && <View style={styles.apprBadge}><Text style={styles.apprBadgeText}>{pendingApprovals}</Text></View>}
          </Pressable>
        </View>

        {/* Segmented control — Live moved next to Approvals in the header. */}
        <View style={styles.seg}>
          {(['today', 'pay', 'ledgers'] as Seg[]).map((s) => (
            <Pressable key={s} onPress={() => { if (s !== seg) haptics.selection(); setSeg(s); if (s === 'today') load(); else if (s === 'pay') loadPay(); else if (s === 'ledgers') loadEmpLedgers(); }} style={[styles.sg, seg === s && styles.sgOn]} testID={`seg-${s}`}>
              <Text style={[styles.sgText, seg === s && styles.sgTextOn]}>{s === 'today' ? 'Today' : s === 'pay' ? 'Payroll' : 'Ledgers'}</Text>
            </Pressable>
          ))}
        </View>

        {loading ? (
          <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 40 }} />
        ) : seg === 'today' ? (
          <>
            {locations.length > 1 && (
              <FilterChips
                testID="attendance-loc-filter"
                options={[{ key: 'all', label: 'All Locations' }, ...locations.map((l) => ({ key: l.id, label: l.name }))]}
                value={locFilter}
                onChange={setLocFilter}
              />
            )}
            {departments.length > 1 && (
              <View style={{ marginTop: locations.length > 1 ? spacing.sm : 0 }}>
                <FilterChips
                  testID="attendance-dept-filter"
                  options={[{ key: 'all', label: 'All Departments' }, ...departments.map((d) => ({ key: d.id, label: d.name }))]}
                  value={deptFilter}
                  onChange={setDeptFilter}
                />
              </View>
            )}
            {/* Date filter — step back/forward a day to review past attendance. */}
            <View style={styles.dateNav}>
              <Pressable onPress={() => setDate((d) => localDateStr(new Date(new Date(d + 'T12:00:00').getTime() - 86400000)))} style={styles.dateArrow} testID="date-prev" hitSlop={8}>
                <Ionicons name="chevron-back" size={18} color={colors.onSurface} />
              </Pressable>
              <Text style={styles.dateLabel}>{isToday ? 'Today' : displayDateOnlyWithWeekday(date)}</Text>
              <Pressable onPress={() => !isToday && setDate((d) => localDateStr(new Date(new Date(d + 'T12:00:00').getTime() + 86400000)))} disabled={isToday} style={[styles.dateArrow, isToday && { opacity: 0.3 }]} testID="date-next" hitSlop={8}>
                <Ionicons name="chevron-forward" size={18} color={colors.onSurface} />
              </Pressable>
              {!isToday && (
                <Pressable onPress={() => setDate(todayIST())} style={styles.dateToday} testID="date-today"><Text style={styles.dateTodayText}>Today</Text></Pressable>
              )}
            </View>
            <View style={styles.sumRow}>
              {([['present', 'Present', 'good', counts.present], ['late', 'Late', 'warn', counts.late], ['absent', 'Absent', 'bad', counts.absent], ['notin', 'Not in', 'info', counts.notin]] as const).map(([key, label, tone, n]) => (
                <SumChip key={key} n={n} label={label} tone={tone} colors={colors} active={todayFilter === key} onPress={() => setTodayFilter((f) => (f === key ? 'all' : key))} />
              ))}
            </View>
            <Text style={styles.sec}>{todayFilter === 'all' ? 'Daily in / out' : `Showing ${todayFilter === 'notin' ? 'not in' : todayFilter}`}</Text>
            {shownRows.length === 0 ? (
              <Text style={styles.empty}>{todayFilter === 'all' ? 'No team members to show.' : 'Nobody in this group.'}</Text>
            ) : shownRows.map((r) => {
              const p = pillFor(r);
              return (
                <Pressable key={r.employee_id} onPress={() => router.push(`/attendance/calendar/${r.employee_id}` as any)} style={({ pressed }) => [styles.erow, pressed && { opacity: 0.8 }]} testID={`att-row-${r.employee_id}`}>
                  <Avatar photo={r.photo} name={r.name} colors={colors} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.en} numberOfLines={1}>{r.name}</Text>
                    <Text style={styles.et} numberOfLines={1}>In <Text style={styles.etB}>{fmtTime(r.check_in)}</Text> · Out <Text style={styles.etB}>{fmtTime(r.check_out)}</Text></Text>
                  </View>
                  <View style={[styles.pill, { backgroundColor: toneBg(p.tone, colors) }]}><Text style={[styles.pillText, { color: toneFg(p.tone, colors) }]}>{p.label}</Text></View>
                </Pressable>
              );
            })}
          </>
        ) : seg === 'live' ? (
          liveByDate.length === 0 ? (
            <Text style={styles.empty}>No punches recorded yet.</Text>
          ) : liveByDate.map((g, gi) => {
            const open = liveOpen[g.date] ?? (gi === 0);   // newest day open by default
            return (
            <View key={g.date}>
              <Pressable onPress={() => setLiveOpen((m) => ({ ...m, [g.date]: !open }))} style={styles.liveDayHeader} testID={`live-day-${g.date}`}>
                <Text style={[styles.sec, { flex: 1 }]}>{displayDateOnlyWithWeekday(g.date)}</Text>
                <Text style={styles.liveDayCount}>{g.items.length}</Text>
                <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedText} />
              </Pressable>
              {open && g.items.map((e) => (
                <View key={e.id} style={styles.liveRow} testID={`live-${e.id}`}>
                  <View style={[styles.liveDot, { backgroundColor: e.type === 'check_in' ? colors.onSuccess : colors.onError }]} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.en} numberOfLines={1}>{e.employee_name}</Text>
                    <Text style={styles.et}>
                      {e.type === 'check_in' ? 'Checked in' : 'Checked out'}
                      {e.type === 'check_in' && e.is_late ? <Text style={{ color: colors.onWarning }}> · Late</Text> : null}
                      {e.type === 'check_out' && e.working_hours ? ` · ${e.working_hours}h` : ''}
                      {e.source === 'biometric' ? ' · device' : ''}
                    </Text>
                  </View>
                  <Text style={styles.liveTime}>{istTime(e.timestamp)}</Text>
                </View>
              ))}
            </View>
            );
          })
        ) : seg === 'pay' ? (
          <>
            {/* Month picker — pay last month's salary in the first week of the
                next month by stepping back to it here. */}
            <View style={styles.monthRow}>
              <Pressable onPress={() => stepMonth(-1)} style={styles.monthNav} testID="payroll-prev-month" hitSlop={8}>
                <Ionicons name="chevron-back" size={18} color={colors.onSurface} />
              </Pressable>
              <Text style={styles.monthLabel}>{MONTHS[month - 1]} {year}</Text>
              <Pressable onPress={() => !isCurrentMonth && stepMonth(1)} disabled={isCurrentMonth} style={[styles.monthNav, isCurrentMonth && { opacity: 0.3 }]} testID="payroll-next-month" hitSlop={8}>
                <Ionicons name="chevron-forward" size={18} color={colors.onSurface} />
              </Pressable>
            </View>
            {!!pay && pay.rows.length > 0 && (() => {
              const total = pay.rows.reduce((s, r) => s + (r.net_salary || 0), 0);
              const paid = pay.rows.filter((r) => r.paid).reduce((s, r) => s + (r.net_salary || 0), 0);
              const pending = Math.max(0, total - paid);
              return (
                <View style={styles.paySummary} testID="payroll-summary">
                  <View style={styles.paySumCell}><Text style={styles.paySumVal}>{fmtINR(total)}</Text><Text style={styles.paySumLbl}>Total</Text></View>
                  <View style={styles.paySumDiv} />
                  <View style={styles.paySumCell}><Text style={[styles.paySumVal, { color: colors.onSuccess }]}>{fmtINR(paid)}</Text><Text style={styles.paySumLbl}>Paid</Text></View>
                  <View style={styles.paySumDiv} />
                  <View style={styles.paySumCell}><Text style={[styles.paySumVal, { color: colors.onWarning }]}>{fmtINR(pending)}</Text><Text style={styles.paySumLbl}>Pending</Text></View>
                </View>
              );
            })()}
            <Text style={styles.sec}>Employees · {isCurrentMonth ? 'this cycle' : `${MONTHS[month - 1]} ${year}`}</Text>
            {!pay || pay.rows.length === 0 ? (
              <Text style={styles.empty}>No payroll for this month yet.</Text>
            ) : pay.rows.map((p) => (
              <Pressable key={p.employee_id} onPress={() => router.push({ pathname: '/payroll/[emp]', params: { emp: p.employee_id, year: String(year), month: String(month) } } as any)} style={({ pressed }) => [styles.erow, pressed && { opacity: 0.8 }]} testID={`pay-row-${p.employee_id}`}>
                <Avatar photo={p.photo} name={p.name} colors={colors} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.en} numberOfLines={1}>{p.name}</Text>
                  <Text style={styles.et} numberOfLines={1}>
                    <Text style={{ color: colors.onSuccess, fontWeight: '700' }}>{p.present_days ?? 0}P</Text>
                    {'  '}<Text style={{ color: colors.onError, fontWeight: '700' }}>{p.absent_days ?? 0}A</Text>
                    {'  '}<Text style={{ color: colors.onWarning, fontWeight: '700' }}>{p.half_days ?? 0}HD</Text>
                    {p.advance ? `  ·  ${fmtINR(p.advance)} adv` : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.payV}>{fmtINR(p.net_salary)}</Text>
                  {p.paid
                    ? <View style={styles.paidTick}><Ionicons name="checkmark-circle" size={13} color={colors.onSuccess} /><Text style={[styles.payS, { color: colors.onSuccess }]}>paid</Text></View>
                    : <Text style={styles.payS}>net payable</Text>}
                </View>
              </Pressable>
            ))}
            {!!pay && pay.rows.length > 0 && (
              <View style={styles.twoBtn}>
                <Pressable onPress={runPayroll} disabled={running} style={[styles.btn, styles.btnPri, running && { opacity: 0.6 }]} testID="run-payroll">
                  <Text style={styles.btnPriText}>{running ? 'Saving…' : 'Run payroll'}</Text>
                </Pressable>
                <Pressable onPress={() => router.push('/(tabs)/payroll?from=work' as any)} style={[styles.btn, styles.btnGhost]} testID="payroll-export">
                  <Text style={styles.btnGhostText}>Export</Text>
                </Pressable>
              </View>
            )}
          </>
        ) : (
          <>
            {/* Employee wage ledgers — tap to open and record payments. */}
            <View style={styles.searchWrap}>
              <Ionicons name="search" size={16} color={colors.mutedText} />
              <TextInput
                value={empQ} onChangeText={setEmpQ} onSubmitEditing={loadEmpLedgers}
                placeholder="Search employee" placeholderTextColor={colors.mutedText}
                style={styles.searchInput} returnKeyType="search" autoCapitalize="none" testID="ledgers-search"
              />
              {empQ.length > 0 && <Pressable onPress={() => { setEmpQ(''); setTimeout(loadEmpLedgers, 0); }} hitSlop={8}><Ionicons name="close-circle" size={16} color={colors.mutedText} /></Pressable>}
            </View>
            {!empLedgers ? (
              <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 30 }} />
            ) : empLedgersError && empLedgers.length === 0 ? (
              <Text style={styles.empty}>{empLedgersError}</Text>
            ) : empLedgers.length === 0 ? (
              <Text style={styles.empty}>No employees found.</Text>
            ) : empLedgers.map((e) => {
              const bal = e.closing_balance || 0;
              const owed = bal >= 0;
              return (
                <Pressable key={e.id} onPress={() => router.push(`/ledger/${e.id}` as any)} style={({ pressed }) => [styles.erow, pressed && { opacity: 0.8 }]} testID={`ledger-emp-${e.id}`}>
                  <Avatar photo={undefined} name={e.name} colors={colors} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.en} numberOfLines={1}>{e.name}</Text>
                    <Text style={styles.et} numberOfLines={1}>{e.employee_code || ''}{e.designation ? ` · ${e.designation}` : ''}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[styles.payV, { color: Math.abs(bal) < 0.5 ? colors.mutedText : owed ? colors.onSuccess : colors.onError }]}>
                      {Math.abs(bal) < 0.5 ? '—' : `${owed ? '+' : '−'} ${fmtINR(Math.abs(bal))}`}
                    </Text>
                    <Text style={styles.payS}>{Math.abs(bal) < 0.5 ? 'settled' : owed ? 'we owe' : 'owes us'}</Text>
                  </View>
                </Pressable>
              );
            })}
          </>
        )}
        <View style={{ height: spacing.xxxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const toneBg = (t: string, c: ThemeColors) => (t === 'good' ? c.success : t === 'warn' ? c.warning : t === 'bad' ? c.error : t === 'info' ? c.info : c.surfaceTertiary);
const toneFg = (t: string, c: ThemeColors) => (t === 'good' ? c.onSuccess : t === 'warn' ? c.onWarning : t === 'bad' ? c.onError : t === 'info' ? c.onInfo : c.mutedText);

function Avatar({ photo, name, colors }: { photo?: string; name: string; colors: ThemeColors }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (photo) return <Image source={{ uri: photo }} style={styles.avPhoto} />;
  return <View style={styles.av}><Text style={styles.avText}>{initials(name)}</Text></View>;
}

function SumChip({ n, label, tone, colors, active, onPress }: { n: number; label: string; tone: string; colors: ThemeColors; active?: boolean; onPress?: () => void }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable onPress={onPress} style={[styles.sc, active && { borderColor: toneFg(tone, colors), backgroundColor: toneBg(tone, colors) }]}>
      <Text style={[styles.scN, { color: toneFg(tone, colors) }]}>{n}</Text>
      <Text style={[styles.scL, active && { color: toneFg(tone, colors) }]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 6 },
  backText: { color: colors.brandPrimary, fontSize: 16, fontWeight: '500' },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  h1: { color: colors.onSurface, fontSize: 26, fontWeight: '800', fontFamily: fonts.display, letterSpacing: -0.5 },
  apprBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  apprBtnOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md },
  searchInput: { flex: 1, color: colors.onSurface, fontSize: 14, paddingVertical: 10 },
  apprBadge: { position: 'absolute', top: -3, right: -3, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface },
  apprBadgeText: { color: colors.onBrandPrimary, fontSize: 11, fontWeight: '800' },
  sub: { color: colors.onSurfaceSecondary, fontSize: 15, marginTop: 6 },

  seg: { flexDirection: 'row', backgroundColor: colors.surfaceTertiary, borderRadius: 12, padding: 4, gap: 3, marginTop: spacing.lg },
  sg: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 9 },
  sgOn: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.borderStrong },
  sgText: { color: colors.mutedText, fontSize: 14, fontWeight: '600' },
  sgTextOn: { color: colors.onSurface },

  dateNav: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg },
  dateArrow: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  dateLabel: { flex: 1, textAlign: 'center', color: colors.onSurface, fontSize: 15, fontWeight: '700' },
  dateToday: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: colors.brandPrimary },
  dateTodayText: { color: colors.onBrandPrimary, fontSize: 13, fontWeight: '700' },
  sumRow: { flexDirection: 'row', gap: 9, marginTop: spacing.lg },
  sc: { flex: 1, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: 15, paddingVertical: 13, alignItems: 'center' },
  scN: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  scL: { fontSize: 11, color: colors.mutedText, marginTop: 3, fontWeight: '600' },

  sec: { fontSize: 13, fontWeight: '700', letterSpacing: 0.7, color: colors.mutedText, textTransform: 'uppercase', marginTop: spacing.xl, marginBottom: spacing.md },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 6 },
  monthNav: { width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  monthLabel: { flex: 1, textAlign: 'center', color: colors.onSurface, fontWeight: '700', fontSize: 14 },
  paySummary: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.md, marginTop: spacing.md },
  paySumCell: { flex: 1, alignItems: 'center' },
  paySumDiv: { width: 1, alignSelf: 'stretch', backgroundColor: colors.divider, marginVertical: 4 },
  paySumVal: { color: colors.onSurface, fontSize: 15, fontWeight: '800' },
  paySumLbl: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  empty: { color: colors.onSurfaceTertiary, marginTop: spacing.lg },

  erow: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: 15, padding: 13, marginBottom: 10 },
  av: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  avPhoto: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surfaceTertiary },
  avText: { color: colors.brandSecondary, fontWeight: '700', fontSize: 16 },
  en: { color: colors.onSurface, fontSize: 15.5, fontWeight: '600' },
  et: { color: colors.mutedText, fontSize: 13, marginTop: 2 },
  etB: { color: colors.onSurfaceSecondary, fontWeight: '600' },
  pill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 9 },
  pillText: { fontSize: 11, fontWeight: '700' },

  liveRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
    borderRadius: 13, paddingVertical: 11, paddingHorizontal: 14, marginBottom: 8,
  },
  liveDot: { width: 9, height: 9, borderRadius: 5 },
  liveTime: { color: colors.onSurface, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },

  chips: { gap: 8, paddingVertical: spacing.md, paddingRight: spacing.lg },
  chip: { paddingHorizontal: 15, paddingVertical: 8, borderRadius: 11, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 13.5, fontWeight: '600' },
  chipTextOn: { color: colors.onBrandPrimary },

  payV: { fontSize: 16, fontWeight: '800', color: colors.brandSecondary },
  payS: { fontSize: 11, color: colors.mutedText, marginTop: 2 },
  paidTick: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  liveDayHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  liveDayCount: { color: colors.mutedText, fontSize: 12, fontWeight: '700' },
  twoBtn: { flexDirection: 'row', gap: 10, marginTop: spacing.md },
  btn: { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 13 },
  btnPri: { backgroundColor: colors.brandPrimary },
  btnPriText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: '700' },
  btnGhost: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.borderStrong },
  btnGhostText: { color: colors.onSurface, fontSize: 15, fontWeight: '700' },
});
