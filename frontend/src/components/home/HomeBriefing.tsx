import { useMemo, useState } from 'react';
import { LayoutAnimation, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, UIManager } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { useCachedLoad } from '@/src/hooks/use-cached-load';
import { fmtCompactINR } from '@/src/utils/money';
import { istTime } from '@/src/utils/datetime';
import { spacing, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Skeleton } from '@/src/components/ui';
import { StickyHeader, useScrolled, HeaderSpacer } from '@/src/components/ui/StickyHeader';
import { TabBarSpacer } from '@/src/components/GlassTabBar';
import { UploadQueueBadge } from '@/src/components/UploadQueueBadge';
import { Marquee } from './Marquee';
import { NotifRow, notifTarget, Notif } from '@/src/components/notifications/NotifRow';
import { QuickEditSheet, EmployeePickSheet, QUICK_ICON } from './QuickSheets';
import { HomeSummary, isOk, NeedRow, QuickActions, StaffPerson } from './types';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) UIManager.setLayoutAnimationEnabledExperimental(true);

const inr = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (iso: string) => { const d = new Date(`${iso}T00:00:00`); return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const dayLabel = (iso: string, today: string) => {
  const d = new Date(`${iso}T00:00:00`); const t = new Date(`${today}T00:00:00`);
  const diff = Math.round((d.getTime() - t.getTime()) / 86400000);
  return diff === 1 ? 'Tomorrow' : `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
};

// Where each quick action opens: the module's create flow, not its list.
const QUICK_ROUTE: Record<string, string> = {
  cash_in: '/cashbook?new=received', cash_out: '/cashbook?new=paid', new_repair: '/repairs/new', issue_stock: '/samples/new',
  update_rate: '/gold-rate', send_rates: '/settings/rate-broadcast/send', new_loan: '/loans/new', add_task: '/tasks/new',
};
const MODULE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  gold_loans: 'cash-outline', repairs: 'construct-outline', samples: 'diamond-outline', tasks: 'checkbox-outline',
  documents: 'document-text-outline', rate_broadcast: 'megaphone-outline', attendance: 'people-outline', payroll: 'calendar-outline',
};

/**
 * Home for owner and admin: a daily briefing — the rate, where the money is, what needs
 * you today, who's in, what's owed and what's coming. Everything comes from one call
 * (GET /home/summary, already filtered to what this person may see); the last copy is
 * painted instantly from this device and refreshed in the background.
 */
export default function HomeBriefing() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { scrolled, onScroll } = useScrolled();
  const { data, loading, refresh, reload } = useCachedLoad<HomeSummary>(
    user?.id ? `home_summary_v1:${user.id}` : null,
    (fresh) => api.get<HomeSummary>(`/home/summary${fresh ? '?fresh=1' : ''}`),
  );
  const [pulling, setPulling] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  const [editQuick, setEditQuick] = useState(false);
  const [pickAdvance, setPickAdvance] = useState(false);
  const [quickOverride, setQuickOverride] = useState<QuickActions | null>(null);
  const go = (route: string) => router.push(route as any);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());   // tapped here, before the next refresh
  const openNotif = (n: Notif) => {
    if (!n.read && !readIds.has(n.id)) {
      setReadIds((p) => new Set(p).add(n.id));
      api.post(`/notifications/${n.id}/read`, {}).catch(() => {});
    }
    const to = notifTarget(n.url);
    if (to) go(to);
  };

  const header = isOk(data?.header) ? data!.header : null;
  const today = header?.date || new Date().toISOString().slice(0, 10);
  const firstName = header?.first_name || (user?.name || '').split(' ')[0];
  const greeting = header?.greeting || (() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; })();
  const quick = quickOverride || (isOk(data?.quick_actions) ? data!.quick_actions : null);

  const onPull = async () => { setPulling(true); await refresh(); setPulling(false); };
  const toggleCash = () => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setCashOpen((v) => !v); };

  return (
    <SafeAreaView style={s.root} edges={['top']} testID="home-briefing">
      <StickyHeader scrolled={scrolled}>
        <View style={s.top}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.date}>{longDate(today)}</Text>
            <Text style={s.hi} numberOfLines={1}>{greeting}{firstName ? `, ${firstName}` : ''}</Text>
          </View>
          <UploadQueueBadge />
          <Pressable onPress={() => go('/repairs/search')} style={s.roundBtn} accessibilityLabel="Search" testID="home-search"><Ionicons name="search-outline" size={19} color={colors.onSurface} /></Pressable>
          <Pressable onPress={() => go('/notifications')} style={s.roundBtn} accessibilityLabel="Notifications" testID="home-bell">
            <Ionicons name="notifications-outline" size={19} color={colors.onSurface} />
            {!!header?.unread_notifications && <View style={s.bellDot} />}
          </Pressable>
        </View>
      </StickyHeader>

      <ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} tintColor={colors.brandPrimary} />}>
        <HeaderSpacer />

        {/* Rate ticker — slides like a news ticker; tap a rate for the Rates page */}
        {isOk(data?.rates) ? (
          <View style={[s.edgeToEdge, s.ticker]}>
            <Marquee testID="home-rates">
              {data!.rates.items.map((r) => (
                <Pressable key={r.key} style={s.tk} onPress={() => go('/rates')} testID={`home-rate-${r.key}`}>
                  <Text style={s.tkLabel}>{r.label}</Text>
                  <Text style={s.tkRate}>{inr(r.rate)}</Text>
                  {r.change != null && r.change !== 0 && (
                    <Text style={[s.tkChange, { color: r.change > 0 ? colors.onSuccess : colors.onError }]}>{r.change > 0 ? '▲' : '▼'} {Math.abs(r.change).toLocaleString('en-IN')}</Text>
                  )}
                </Pressable>
              ))}
              {!!data!.rates.broadcast && (
                <Pressable style={[s.tk, { alignItems: 'center' }]} onPress={() => go('/settings/rate-broadcast')} testID="home-broadcast-chip">
                  <View style={[s.dot, { backgroundColor: data!.rates.broadcast.state === 'sent' ? colors.onSuccess : colors.onWarning }]} />
                  <Text style={s.tkNote}>
                    {data!.rates.broadcast.state === 'sent' ? `Sent to subscribers ${istTime(data!.rates.broadcast.sent_at || '')}`
                      : data!.rates.broadcast.state === 'template_not_approved' ? 'Template not approved' : 'Not sent today'}
                  </Text>
                </Pressable>
              )}
            </Marquee>
          </View>
        ) : !data ? (
          <View style={[s.edgeToEdge, s.ticker, { flexDirection: 'row', gap: 8, paddingHorizontal: spacing.lg }]}>
            {[0, 1, 2].map((i) => <Skeleton key={i} width={120} height={36} radius={12} />)}
          </View>
        ) : null}

        {/* Cash in hand */}
        {data?.cash !== null && (isOk(data?.cash) ? (
          <Pressable onPress={toggleCash} style={s.money} testID="home-cash">
            <View style={s.mrow}>
              <View style={{ flex: 1 }}>
                <Text style={s.mLbl}>Cash in hand</Text>
                <Text style={s.mBig}><Text style={s.mRs}>₹</Text>{Math.round(data!.cash.total).toLocaleString('en-IN')}</Text>
                <Text style={[s.mNet, { color: data!.cash.net_today >= 0 ? colors.onSuccess : colors.onError }]}>
                  {data!.cash.net_today >= 0 ? '▲' : '▼'} {inr(Math.abs(data!.cash.net_today))} net today
                </Text>
              </View>
              <View style={[s.chev, cashOpen && { transform: [{ rotate: '180deg' }] }]}><Ionicons name="chevron-down" size={16} color={colors.onSurfaceSecondary} /></View>
            </View>
            {cashOpen && (
              <View testID="home-cash-details">
                {data!.cash.locations.map((l) => (
                  <View key={l.id} style={s.loc}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.locName}>{l.name}</Text>
                      <Text style={s.locSub}>{l.last_entry_at ? `Last entry ${lastEntry(l.last_entry_at, today)}` : 'No entries yet'}</Text>
                      <View style={s.bar}><View style={[s.barFill, { width: `${Math.round(l.share * 100)}%` }]} /></View>
                    </View>
                    <Text style={s.locVal}>{inr(l.balance)}</Text>
                  </View>
                ))}
                <View style={s.inout}>
                  <View style={s.inoutCell}><Text style={s.inoutLbl}>Received today</Text><Text style={[s.inoutVal, { color: colors.onSuccess }]}>{inr(data!.cash.received_today)}</Text></View>
                  <View style={s.inoutCell}><Text style={s.inoutLbl}>Paid today</Text><Text style={[s.inoutVal, { color: colors.onError }]}>{inr(data!.cash.paid_today)}</Text></View>
                </View>
                <View style={s.mact}>
                  <Pressable onPress={() => go('/cashbook')} style={[s.mBtn, s.mBtnGold]} testID="home-open-cashbook"><Text style={s.mBtnGoldText}>Open Cash Book</Text></Pressable>
                </View>
              </View>
            )}
          </Pressable>
        ) : !data ? <Skeleton height={112} radius={22} style={{ marginTop: spacing.md }} /> : <Unavailable label="Cash" s={s} />)}

        {/* Quick actions */}
        {quick && (quick.tiles.length > 0 || quick.available.length > 0) && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.quick} style={s.edgeToEdge}>
            {quick.tiles.map((t) => (
              <Pressable key={t.key} style={({ pressed }) => [s.q, pressed && { backgroundColor: colors.surfaceTertiary }]} testID={`home-quick-${t.key}`}
                onPress={() => (t.key === 'advance' ? setPickAdvance(true) : go(QUICK_ROUTE[t.key]))}>
                <Ionicons name={QUICK_ICON[t.key] || 'ellipse-outline'} size={22} color={colors.brandSecondary} />
                <Text style={s.qText} numberOfLines={2}>{t.label}</Text>
              </Pressable>
            ))}
            <Pressable style={[s.q, s.qEdit]} onPress={() => setEditQuick(true)} testID="home-quick-edit">
              <Ionicons name="reorder-three-outline" size={22} color={colors.mutedText} />
              <Text style={s.qText}>Edit</Text>
            </Pressable>
          </ScrollView>
        )}

        {/* Needs you today */}
        {data?.needs_you === null ? null : Array.isArray(data?.needs_you) ? (
          <>
            <SectionHead s={s} title="Needs you today" right={data!.needs_you.length ? String(data!.needs_you.length) : undefined} />
            <View style={s.list} testID="home-needs">
              {data!.needs_you.length === 0 ? (
                <View style={s.item}>
                  <View style={[s.ic, { backgroundColor: colors.success }]}><Ionicons name="checkmark" size={17} color={colors.onSuccess} /></View>
                  <View style={s.mid}><Text style={s.t1}>All clear</Text><Text style={s.t2}>Nothing needs you right now</Text></View>
                </View>
              ) : data!.needs_you.map((r, i) => <NeedItem key={r.key} r={r} first={i === 0} s={s} colors={colors} onGo={go} />)}
            </View>
          </>
        ) : !data ? (
          <><SectionHead s={s} title="Needs you today" /><Skeleton height={150} radius={18} /></>
        ) : <Unavailable label="Needs you today" s={s} />}

        {/* In the shop */}
        {data?.staff !== null && data?.staff !== undefined && (isOk(data.staff) ? (
          data.staff.working_day && data.staff.people.length > 0 && (
            <>
              <SectionHead s={s} title="In the shop" right={`${data.staff.present} of ${data.staff.due} in`} onRight={() => go('/attendance')} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.staff} style={s.edgeToEdge}>
                {data.staff.people.map((p) => (
                  <Pressable key={p.id} style={s.p} onPress={() => go(`/attendance/calendar/${p.id}?name=${encodeURIComponent(p.name)}`)} testID={`home-staff-${p.id}`}>
                    <View style={[s.av, { borderColor: ringColor(p.status, colors) }, (p.status === 'not_in' || p.status === 'absent') && { opacity: 0.75 }]}>
                      {p.photo ? <Image source={{ uri: p.photo }} style={s.avImg} /> : <Text style={s.avText}>{initials(p.name)}</Text>}
                    </View>
                    <Text style={s.pName} numberOfLines={1}>{p.first_name}</Text>
                    <Text style={s.pIn}>{p.check_in || (p.status === 'leave' ? 'Leave' : p.status === 'due' ? 'Due' : '—')}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          )
        ) : <Unavailable label="In the shop" s={s} />)}

        {/* Owed to you */}
        {data?.owed !== null && data?.owed !== undefined && (isOk(data.owed) ? (
          <>
            <SectionHead s={s} title="Owed to you" right="Ledger" onRight={() => go('/(tabs)/ledger')} />
            <View style={s.owed}>
              {data.owed.customers && (
                <Pressable style={s.ow} onPress={() => go('/(tabs)/ledger')} testID="home-owed-customers">
                  <Text style={s.owLbl}>Customers</Text><Text style={s.owVal}>{fmtCompactINR(data.owed.customers.total)}</Text>
                  <Text style={[s.owSub, { color: colors.onWarning }]}>{data.owed.customers.accounts} account{data.owed.customers.accounts === 1 ? '' : 's'}</Text>
                </Pressable>
              )}
              {data.owed.loan_interest && (
                <Pressable style={s.ow} onPress={() => go('/loans?status=overdue')} testID="home-owed-loans">
                  <Text style={s.owLbl}>Loan interest</Text><Text style={s.owVal}>{fmtCompactINR(data.owed.loan_interest.total)}</Text>
                  <Text style={[s.owSub, { color: data.owed.loan_interest.overdue ? colors.onError : colors.mutedText }]}>{data.owed.loan_interest.overdue} overdue</Text>
                </Pressable>
              )}
              {data.owed.karigars && (
                <Pressable style={s.ow} onPress={() => go('/reports/karigar-ledger')} testID="home-owed-karigars">
                  <Text style={s.owLbl}>With karigars</Text><Text style={s.owVal}>{data.owed.karigars.fine.toFixed(1)} g</Text>
                  <Text style={[s.owSub, { color: colors.brandSecondary }]}>fine gold</Text>
                </Pressable>
              )}
            </View>
            {data.owed.top.length > 0 && (
              <View style={[s.list, { marginTop: spacing.sm }]}>
                {data.owed.top.map((c, i) => (
                  <Pressable key={c.id} style={[s.item, i > 0 && s.itemSep]} onPress={() => go(`/ledger/accounts/${c.id}`)} testID={`home-owed-top-${c.id}`}>
                    <View style={[s.ic, { backgroundColor: colors.warning }]}><Ionicons name="person-outline" size={16} color={colors.onWarning} /></View>
                    <View style={s.mid}>
                      <Text style={s.t1} numberOfLines={1}>{c.name}</Text>
                      <Text style={s.t2} numberOfLines={1}>{c.since ? `Since ${shortDate(c.since)} · ${c.days} day${c.days === 1 ? '' : 's'}` : 'Outstanding'}</Text>
                    </View>
                    <Text style={s.amt}>{inr(c.balance)}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </>
        ) : <Unavailable label="Owed to you" s={s} />)}

        {/* Coming up */}
        {isOk(data?.coming_up) && data!.coming_up.items.length > 0 && (
          <>
            <SectionHead s={s} title="Coming up" right={data!.coming_up.total > data!.coming_up.items.length ? `+${data!.coming_up.total - data!.coming_up.items.length} more` : 'Next 7 days'} />
            <View style={s.list} testID="home-coming">
              {data!.coming_up.items.map((c, i, arr) => (
                <View key={`${c.kind}-${c.date}-${i}`}>
                  {(i === 0 || arr[i - 1].date !== c.date) && <Text style={s.day}>{dayLabel(c.date, today)}</Text>}
                  <Pressable style={s.item} onPress={() => go(c.route)}>
                    <View style={[s.ic, { backgroundColor: colors.brandTertiary }]}><Ionicons name={MODULE_ICON[c.module] || 'ellipse-outline'} size={16} color={colors.brandSecondary} /></View>
                    <View style={s.mid}><Text style={s.t1} numberOfLines={1}>{c.title}</Text>{!!c.detail && <Text style={s.t2} numberOfLines={1}>{c.detail}</Text>}</View>
                  </Pressable>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Notifications — the latest few, same list the bell opens */}
        {isOk(data?.notifications) && (() => {
          const nt = data!.notifications;
          const fresh = Math.max(0, nt.unread - nt.items.filter((n) => !n.read && readIds.has(n.id)).length);
          return (
            <>
              <SectionHead s={s} title="Notifications" right={fresh ? `${fresh} new` : undefined} onRight={() => go('/notifications')} />
              <View style={s.list} testID="home-notifications">
                {nt.items.length === 0 ? (
                  <View style={s.item}>
                    <View style={[s.ic, { backgroundColor: colors.brandTertiary }]}><Ionicons name="notifications-outline" size={16} color={colors.brandSecondary} /></View>
                    <View style={s.mid}><Text style={s.t1}>No notifications yet</Text></View>
                  </View>
                ) : nt.items.map((n, i) => (
                  <NotifRow key={n.id} n={readIds.has(n.id) ? { ...n, read: true } : n} first={i === 0} onPress={() => openNotif(n)} testID={`home-notif-${n.id}`} />
                ))}
                <Pressable style={({ pressed }) => [s.item, s.itemSep, s.viewAll, pressed && { backgroundColor: colors.surfaceTertiary }]} onPress={() => go('/notifications')} testID="home-notif-all">
                  <Text style={s.viewAllText}>View all notifications</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.brandSecondary} />
                </Pressable>
              </View>
            </>
          );
        })()}

        {loading && !!data && <Text style={s.updating}>Updating…</Text>}
        <TabBarSpacer />
      </ScrollView>

      <QuickEditSheet visible={editQuick} data={quick} onClose={() => setEditQuick(false)} onSaved={(q) => { setQuickOverride(q); reload(); }} />
      <EmployeePickSheet visible={pickAdvance} onClose={() => setPickAdvance(false)}
        onPick={(id) => { setPickAdvance(false); go(`/ledger/new?emp=${id}&type=advance`); }} />
    </SafeAreaView>
  );
}

function lastEntry(iso: string, today: string): string {
  const t = istTime(iso);
  const d = new Date(iso);
  const ist = new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
  if (ist === today) return t;
  const yest = new Date(new Date(`${today}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
  return ist === yest ? 'yesterday' : shortDate(ist);
}
function shortDate(iso: string) { const d = new Date(`${iso}T00:00:00`); return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`; }
function initials(name: string) { return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase(); }
function ringColor(st: StaffPerson['status'], c: ThemeColors) {
  return st === 'present' ? c.onSuccess : st === 'late' ? c.onWarning : st === 'leave' ? c.mutedText : st === 'due' ? c.border : c.onError;
}

function SectionHead({ s, title, right, onRight }: { s: ReturnType<typeof makeStyles>; title: string; right?: string; onRight?: () => void }) {
  return (
    <View style={s.sh}>
      <Text style={s.shTitle}>{title}</Text>
      {!!right && (onRight ? <Pressable onPress={onRight} hitSlop={8}><Text style={s.shRight}>{right}</Text></Pressable> : <Text style={s.shRight}>{right}</Text>)}
    </View>
  );
}

function Unavailable({ label, s }: { label: string; s: ReturnType<typeof makeStyles> }) {
  return <Text style={s.unavail}>{label} couldn&apos;t load — pull down to try again.</Text>;
}

function NeedItem({ r, first, s, colors, onGo }: { r: NeedRow; first: boolean; s: ReturnType<typeof makeStyles>; colors: ThemeColors; onGo: (r: string) => void }) {
  const tone = r.severity === 'red' ? { bg: colors.error, fg: colors.onError } : r.severity === 'amber' ? { bg: colors.warning, fg: colors.onWarning } : { bg: colors.brandTertiary, fg: colors.brandSecondary };
  return (
    <Pressable style={[s.item, !first && s.itemSep]} onPress={() => onGo(r.route)} testID={`home-need-${r.key}`}>
      <View style={[s.ic, { backgroundColor: tone.bg }]}><Ionicons name={MODULE_ICON[r.module] || 'alert-circle-outline'} size={16} color={tone.fg} /></View>
      <View style={s.mid}>
        <Text style={s.t1} numberOfLines={1}>{r.title}</Text>
        {!!r.detail && <Text style={s.t2} numberOfLines={1}>{r.detail}</Text>}
      </View>
      <Pressable onPress={() => onGo(r.route)} style={s.act} hitSlop={6} testID={`home-need-act-${r.key}`}>
        <Text style={s.actText}>{r.can_act ? r.action : 'View'}</Text>
      </Pressable>
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  edgeToEdge: { marginHorizontal: -spacing.lg, flexGrow: 0 },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  date: { color: colors.mutedText, fontSize: 13, fontWeight: '600' },
  hi: { color: colors.onSurface, fontSize: 27, fontWeight: '800', letterSpacing: -0.8, fontFamily: fonts.display, marginTop: 1 },
  roundBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  bellDot: { position: 'absolute', top: 9, right: 10, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.onError, borderWidth: 1.5, borderColor: colors.surfaceSecondary },

  ticker: { paddingTop: spacing.sm },
  tk: { flexDirection: 'row', alignItems: 'baseline', gap: 7, backgroundColor: colors.surfaceSecondary, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  tkLabel: { color: colors.brandSecondary, fontSize: 11, fontWeight: '700' },
  tkRate: { color: colors.onSurface, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  tkChange: { fontSize: 11.5, fontWeight: '600' },
  tkNote: { color: colors.onSurfaceSecondary, fontSize: 12.5, fontWeight: '600' },
  dot: { width: 7, height: 7, borderRadius: 4 },

  money: { marginTop: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: 22, borderWidth: 1, borderColor: colors.brandTertiary, paddingHorizontal: 18, paddingVertical: 16 },
  mrow: { flexDirection: 'row', alignItems: 'flex-end' },
  mLbl: { color: colors.onSurfaceSecondary, fontSize: 13 },
  mBig: { color: colors.onSurface, fontSize: 34, fontWeight: '800', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  mRs: { fontSize: 19, color: colors.onSurfaceSecondary, fontWeight: '600' },
  mNet: { fontSize: 13.5, fontWeight: '600', marginTop: 1 },
  chev: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  loc: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider, marginTop: 4 },
  locName: { color: colors.onSurface, fontSize: 14.5 },
  locSub: { color: colors.mutedText, fontSize: 12 },
  locVal: { color: colors.onSurface, fontSize: 15.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  bar: { height: 4, borderRadius: 2, backgroundColor: colors.surfaceTertiary, marginTop: 6, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: colors.brandPrimary },
  inout: { flexDirection: 'row', gap: 10, marginTop: 6 },
  inoutCell: { flex: 1, backgroundColor: colors.surfaceTertiary, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
  inoutLbl: { color: colors.onSurfaceSecondary, fontSize: 12.5 },
  inoutVal: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  mact: { flexDirection: 'row', gap: 8, marginTop: 12 },
  mBtn: { flex: 1, borderRadius: 12, paddingVertical: 11, alignItems: 'center', backgroundColor: colors.surfaceTertiary },
  mBtnGold: { backgroundColor: colors.brandPrimary },
  mBtnText: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  mBtnGoldText: { color: colors.onBrandPrimary, fontSize: 14, fontWeight: '700' },

  quick: { paddingHorizontal: spacing.lg, gap: 8, paddingTop: spacing.md },
  q: { width: 78, backgroundColor: colors.surfaceSecondary, borderRadius: 16, paddingTop: 12, paddingBottom: 10, paddingHorizontal: 4, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  qEdit: { backgroundColor: 'transparent', borderStyle: 'dashed', borderColor: colors.borderStrong, borderWidth: 1 },
  qText: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: '600', marginTop: 5, textAlign: 'center', lineHeight: 13 },

  sh: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 26, marginBottom: 10, marginHorizontal: 4 },
  shTitle: { color: colors.onSurface, fontSize: 21, fontWeight: '800', letterSpacing: -0.4, fontFamily: fonts.display },
  shRight: { color: colors.brandSecondary, fontSize: 14, fontWeight: '600' },
  list: { backgroundColor: colors.surfaceSecondary, borderRadius: 18, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  itemSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  ic: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  mid: { flex: 1, minWidth: 0 },
  t1: { color: colors.onSurface, fontSize: 15, fontWeight: '600' },
  t2: { color: colors.mutedText, fontSize: 12.5, marginTop: 1 },
  act: { backgroundColor: colors.brandTertiary, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999 },
  actText: { color: colors.brandSecondary, fontSize: 13, fontWeight: '600' },
  amt: { color: colors.onSurface, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  viewAll: { justifyContent: 'space-between', paddingVertical: 14 },
  viewAllText: { color: colors.brandSecondary, fontSize: 15, fontWeight: '600' },
  day: { color: colors.mutedText, fontSize: 12.5, fontWeight: '700', paddingHorizontal: 14, paddingTop: 12, paddingBottom: 2 },

  staff: { paddingHorizontal: spacing.lg, gap: 10, paddingVertical: 2 },
  p: { width: 64, alignItems: 'center' },
  av: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avImg: { width: '100%', height: '100%' },
  avText: { color: colors.onSurfaceSecondary, fontWeight: '700', fontSize: 15 },
  pName: { color: colors.onSurfaceSecondary, fontSize: 11.5, marginTop: 5, maxWidth: 64 },
  pIn: { color: colors.mutedText, fontSize: 10.5 },

  owed: { flexDirection: 'row', gap: 8 },
  ow: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: 16, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  owLbl: { color: colors.mutedText, fontSize: 12, fontWeight: '600' },
  owVal: { color: colors.onSurface, fontSize: 17, fontWeight: '800', letterSpacing: -0.3, marginTop: 4, fontVariant: ['tabular-nums'] },
  owSub: { fontSize: 11.5, fontWeight: '600', marginTop: 2 },

  unavail: { color: colors.mutedText, fontSize: 13, marginTop: spacing.lg, marginHorizontal: 4 },
  updating: { color: colors.mutedText, fontSize: 12, textAlign: 'center', marginTop: spacing.lg },
});
