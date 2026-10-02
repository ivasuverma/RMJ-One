import { Fragment, ReactNode, useMemo, useState } from 'react';
import { LayoutAnimation, Platform, Pressable, RefreshControl, ScrollView, Text, View, UIManager } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { useCachedLoad } from '@/src/hooks/use-cached-load';
import { fmtCompactINR } from '@/src/utils/money';
import { istTime } from '@/src/utils/datetime';
import { spacing, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Skeleton } from '@/src/components/ui';
import { StickyHeader, useScrolled, HeaderSpacer } from '@/src/components/ui/StickyHeader';
import { TabBarSpacer } from '@/src/components/GlassTabBar';
import { GlassButton } from '@/src/components/ui/GlassButton';
import { UploadQueueBadge } from '@/src/components/UploadQueueBadge';
import { makeHomeStyles } from './styles';
import { StaffSheet } from './StaffSheet';
import { RateTicker, QuickRow, NeedsSection, NotificationsSection, SectionHead, Unavailable, MODULE_ICON, QUICK_ROUTE } from './sections';
import { QuickEditSheet, EmployeePickSheet, QUICK_ICON } from './QuickSheets';
import { HomeSummary, isOk, QuickActions, StaffPerson } from './types';

const DEFAULT_ORDER = ['rates', 'cash', 'quick_actions', 'needs_you', 'staff', 'owed', 'coming_up', 'notifications'];

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


/**
 * Home for owner and admin: a daily briefing — the rate, where the money is, what needs
 * you today, who's in, what's owed and what's coming. Everything comes from one call
 * (GET /home/summary, already filtered to what this person may see); the last copy is
 * painted instantly from this device and refreshed in the background.
 */
export default function HomeBriefing() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const s = useMemo(() => makeHomeStyles(colors), [colors]);
  const router = useRouter();
  const { scrolled, onScroll } = useScrolled();
  const { data, loading, refresh, reload } = useCachedLoad<HomeSummary>(
    user?.id ? `home_summary_v1:${user.id}` : null,
    (fresh) => api.get<HomeSummary>(`/home/summary${fresh ? '?fresh=1' : ''}`),
  );
  const [pulling, setPulling] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  const [person, setPerson] = useState<StaffPerson | null>(null);
  const [editQuick, setEditQuick] = useState(false);
  const [pickAdvance, setPickAdvance] = useState(false);
  const [quickOverride, setQuickOverride] = useState<QuickActions | null>(null);
  const go = (route: string) => router.push(route as any);

  const header = isOk(data?.header) ? data!.header : null;
  const today = header?.date || new Date().toISOString().slice(0, 10);
  const firstName = header?.first_name || (user?.name || '').split(' ')[0];
  const greeting = header?.greeting || (() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; })();
  const quick = quickOverride || (isOk(data?.quick_actions) ? data!.quick_actions : null);

  const onPull = async () => { setPulling(true); await refresh(); setPulling(false); };
  const toggleCash = () => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setCashOpen((v) => !v); };

  // Each Home section, shown in this person's order (Settings › Home screen).
  const blocks: Record<string, ReactNode> = {
    rates: (
      <>
        <RateTicker rates={isOk(data?.rates) ? data!.rates : null} loading={!data} />
      </>
    ),
    cash: (
      <>
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
                      <Text style={s.locSub}>{l.closed_today ? 'Day closed' : l.last_entry_at ? `Last entry ${lastEntry(l.last_entry_at, today)}` : 'No entries yet'}</Text>
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
                  {data!.cash.can_edit && data!.cash.locations.some((l) => !l.closed_today) && (
                    <Pressable onPress={() => go('/cashbook')} style={s.mBtn} testID="home-close-day"><Text style={s.mBtnText}>Close the day</Text></Pressable>
                  )}
                </View>
              </View>
            )}
          </Pressable>
        ) : !data ? <Skeleton height={112} radius={22} style={{ marginTop: spacing.md }} /> : <Unavailable label="Cash" s={s} />)}
      </>
    ),
    quick_actions: (
      <>
        {/* Quick actions */}
        {quick && (quick.tiles.length > 0 || quick.available.length > 0) && (
          <QuickRow onEdit={() => setEditQuick(true)} items={quick.tiles.map((t) => ({
            key: t.key, label: t.label, icon: QUICK_ICON[t.key] || 'ellipse-outline',
            onPress: () => (t.key === 'advance' ? setPickAdvance(true) : go(QUICK_ROUTE[t.key])),
          }))} />
        )}
      </>
    ),
    needs_you: (
      <>
        {/* Needs you today */}
        <NeedsSection needs={data ? data.needs_you : undefined} loading={!data} />
      </>
    ),
    staff: (
      <>
        {/* In the shop */}
        {data?.staff !== null && data?.staff !== undefined && (isOk(data.staff) ? (
          data.staff.working_day && data.staff.people.length > 0 && (
            <>
              <SectionHead s={s} title="In the shop" right={`${data.staff.present} of ${data.staff.due} in`} onRight={() => go('/attendance')} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.staff} style={s.edgeToEdge}>
                {data.staff.people.map((p) => (
                  <Pressable key={p.id} style={s.p} onPress={() => setPerson(p)} testID={`home-staff-${p.id}`}>
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
      </>
    ),
    owed: (
      <>
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
      </>
    ),
    coming_up: (
      <>
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
                    <View style={s.mid}><Text style={s.t1} numberOfLines={2}>{c.title}</Text>{!!c.detail && <Text style={s.t2} numberOfLines={2}>{c.detail}</Text>}</View>
                  </Pressable>
                </View>
              ))}
            </View>
      </>
    )}
      </>
    ),
    notifications: (
      <>
        {/* Notifications — the latest few, same list the bell opens */}
        <NotificationsSection data={isOk(data?.notifications) ? data!.notifications : null} />
      </>
    ),
  };
  const order = data?.section_order?.length ? data.section_order : DEFAULT_ORDER;

  return (
    <SafeAreaView style={s.root} edges={['top']} testID="home-briefing">
      <StickyHeader scrolled={scrolled}>
        <View style={s.top}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.date}>{longDate(today)}</Text>
            <Text style={s.hi} numberOfLines={2}>{greeting}{firstName ? `, ${firstName}` : ''}</Text>
          </View>
          <UploadQueueBadge />
          <GlassButton onPress={() => go('/repairs/search')} style={s.roundBtn} accessibilityLabel="Search" testID="home-search"><Ionicons name="search-outline" size={19} color={colors.onSurface} /></GlassButton>
          <GlassButton onPress={() => go('/notifications')} style={s.roundBtn} accessibilityLabel="Notifications" testID="home-bell">
            <Ionicons name="notifications-outline" size={19} color={colors.onSurface} />
            {!!header?.unread_notifications && <View style={s.bellDot} />}
          </GlassButton>
        </View>
      </StickyHeader>

      <ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onPull} tintColor={colors.brandPrimary} />}>
        <HeaderSpacer />

        {order.map((k) => <Fragment key={k}>{blocks[k]}</Fragment>)}

        {loading && !!data && <Text style={s.updating}>Updating…</Text>}
        <TabBarSpacer />
      </ScrollView>

      <StaffSheet person={person} onClose={() => setPerson(null)} canSeePay={isOk(data?.staff) ? !!data!.staff.can_see_pay : false} />
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

