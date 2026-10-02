import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { istTime } from '@/src/utils/datetime';
import { spacing, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Skeleton } from '@/src/components/ui';
import { NotifRow, notifTarget, Notif } from '@/src/components/notifications/NotifRow';
import { Marquee } from './Marquee';
import { makeHomeStyles, HomeStyles } from './styles';
import { NeedRow, Rates } from './types';

// Pieces of Home used by both the owner/admin briefing and the employee Home.

const inr = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
export // Where each quick action opens: the module's create flow, not its list.
const QUICK_ROUTE: Record<string, string> = {
  cash_in: '/cashbook?new=received', cash_out: '/cashbook?new=paid', new_repair: '/repairs/new', issue_stock: '/samples/new',
  update_rate: '/gold-rate', send_rates: '/settings/rate-broadcast/send', new_loan: '/loans/new', add_task: '/tasks/new',
};
export const MODULE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  gold_loans: 'cash-outline', repairs: 'construct-outline', samples: 'diamond-outline', tasks: 'checkbox-outline',
  documents: 'document-text-outline', rate_broadcast: 'megaphone-outline', attendance: 'people-outline', payroll: 'calendar-outline', notifications: 'notifications-outline',
};

function useHomeStyles() {
  const { colors } = useTheme();
  const s = useMemo(() => makeHomeStyles(colors), [colors]);
  return { s, colors };
}

export function SectionHead({ s, title, right, onRight }: { s: HomeStyles; title: string; right?: string; onRight?: () => void }) {
  return (
    <View style={s.sh}>
      <Text style={s.shTitle}>{title}</Text>
      {!!right && (onRight ? <Pressable onPress={onRight} hitSlop={8}><Text style={s.shRight}>{right}</Text></Pressable> : <Text style={s.shRight}>{right}</Text>)}
    </View>
  );
}

export function Unavailable({ label, s }: { label: string; s: HomeStyles }) {
  return <Text style={s.unavail}>{label} couldn&apos;t load — pull down to try again.</Text>;
}

/** Rates sliding like a news ticker; tap a rate for the Rates page. `loading` shows placeholders. */
export function RateTicker({ rates, loading }: { rates: Rates | null; loading?: boolean }) {
  const { s, colors } = useHomeStyles();
  const router = useRouter();
  if (!rates) {
    return loading ? (
      <View style={[s.edgeToEdge, s.ticker, { flexDirection: 'row', gap: 8, paddingHorizontal: spacing.lg }]}>
        {[0, 1, 2].map((i) => <Skeleton key={i} width={120} height={36} radius={12} />)}
      </View>
    ) : null;
  }
  return (
    <View style={[s.edgeToEdge, s.ticker]}>
      <Marquee testID="home-rates">
        {rates.items.map((r) => (
          <Pressable key={r.key} style={s.tk} onPress={() => router.push('/rates' as any)} testID={`home-rate-${r.key}`}>
            <Text style={s.tkLabel}>{r.label}</Text>
            <Text style={s.tkRate}>{inr(r.rate)}</Text>
            {r.change != null && r.change !== 0 && (
              <Text style={[s.tkChange, { color: r.change > 0 ? colors.onSuccess : colors.onError }]}>{r.change > 0 ? '▲' : '▼'} {Math.abs(r.change).toLocaleString('en-IN')}</Text>
            )}
          </Pressable>
        ))}
        {!!rates.broadcast && (
          <Pressable style={[s.tk, { alignItems: 'center' }]} onPress={() => router.push('/settings/rate-broadcast' as any)} testID="home-broadcast-chip">
            <View style={[s.dot, { backgroundColor: rates.broadcast.state === 'sent' ? colors.onSuccess : colors.onWarning }]} />
            <Text style={s.tkNote}>
              {rates.broadcast.state === 'sent' ? `Sent to subscribers ${istTime(rates.broadcast.sent_at || '')}`
                : rates.broadcast.state === 'template_not_approved' ? 'Template not approved' : 'Not sent today'}
            </Text>
          </Pressable>
        )}
      </Marquee>
    </View>
  );
}

export type QuickItem = { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void };

/** A swipeable row of shortcut tiles, with an optional Edit tile at the end. */
export function QuickRow({ items, onEdit }: { items: QuickItem[]; onEdit?: () => void }) {
  const { s, colors } = useHomeStyles();
  if (!items.length && !onEdit) return null;
  return (
    <View style={[s.edgeToEdge, { flexGrow: 0 }]}>
      <QuickScroll s={s}>
        {items.map((t) => (
          <Pressable key={t.key} style={({ pressed }) => [s.q, pressed && { backgroundColor: colors.surfaceTertiary }]} testID={`home-quick-${t.key}`} onPress={t.onPress}>
            <Ionicons name={t.icon} size={22} color={colors.brandSecondary} />
            <Text style={s.qText} numberOfLines={2}>{t.label}</Text>
          </Pressable>
        ))}
        {onEdit && (
          <Pressable style={[s.q, s.qEdit]} onPress={onEdit} testID="home-quick-edit">
            <Ionicons name="reorder-three-outline" size={22} color={colors.mutedText} />
            <Text style={s.qText}>Edit</Text>
          </Pressable>
        )}
      </QuickScroll>
    </View>
  );
}

function QuickScroll({ s, children }: { s: HomeStyles; children: React.ReactNode }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.quick}>{children}</ScrollView>;
}

/** Needs you today: one row per rule that fired, each with its one action; "All clear" when none did. */
export function NeedsSection({ needs, loading }: { needs: NeedRow[] | { unavailable: true } | null | undefined; loading?: boolean }) {
  const { s, colors } = useHomeStyles();
  const router = useRouter();
  const go = (r: string) => router.push(r as any);
  if (needs === null) return null;
  if (Array.isArray(needs)) {
    return (
      <>
        <SectionHead s={s} title="Needs you today" right={needs.length ? String(needs.length) : undefined} />
        <View style={s.list} testID="home-needs">
          {needs.length === 0 ? (
            <View style={s.item}>
              <View style={[s.ic, { backgroundColor: colors.success }]}><Ionicons name="checkmark" size={17} color={colors.onSuccess} /></View>
              <View style={s.mid}><Text style={s.t1}>All clear</Text><Text style={s.t2}>Nothing needs you right now</Text></View>
            </View>
          ) : needs.map((r, i) => <NeedItem key={r.key} r={r} first={i === 0} s={s} colors={colors} onGo={go} />)}
        </View>
      </>
    );
  }
  if (needs === undefined && loading) return <><SectionHead s={s} title="Needs you today" /><Skeleton height={150} radius={18} /></>;
  return needs ? <Unavailable label="Needs you today" s={s} /> : null;
}

function NeedItem({ r, first, s, colors, onGo }: { r: NeedRow; first: boolean; s: HomeStyles; colors: ThemeColors; onGo: (r: string) => void }) {
  const tone = r.severity === 'red' ? { bg: colors.error, fg: colors.onError } : r.severity === 'amber' ? { bg: colors.warning, fg: colors.onWarning } : { bg: colors.brandTertiary, fg: colors.brandSecondary };
  return (
    <Pressable style={[s.item, !first && s.itemSep]} onPress={() => onGo(r.route)} testID={`home-need-${r.key}`}>
      <View style={[s.ic, { backgroundColor: tone.bg }]}><Ionicons name={MODULE_ICON[r.module] || 'alert-circle-outline'} size={16} color={tone.fg} /></View>
      <View style={s.mid}>
        <Text style={s.t1} numberOfLines={2}>{r.title}</Text>
        {!!r.detail && <Text style={s.t2} numberOfLines={2}>{r.detail}</Text>}
      </View>
      <Pressable onPress={() => onGo(r.route)} style={s.act} hitSlop={6} testID={`home-need-act-${r.key}`}>
        <Text style={s.actText}>{r.can_act ? r.action : 'View'}</Text>
      </Pressable>
    </Pressable>
  );
}

/** The latest few notifications (same list the bell opens), the unread count and View all. */
export function NotificationsSection({ data }: { data: { unread: number; items: Notif[]; staff?: { on: number; total: number } } | null }) {
  const { s, colors } = useHomeStyles();
  const router = useRouter();
  const [readIds, setReadIds] = useState<Set<string>>(new Set());   // tapped here, before the next refresh
  if (!data) return null;
  const open = (n: Notif) => {
    if (!n.read && !readIds.has(n.id)) {
      setReadIds((p) => new Set(p).add(n.id));
      api.post(`/notifications/${n.id}/read`, {}).catch(() => {});
    }
    const to = notifTarget(n.url);
    if (to) router.push(to as any);
  };
  const fresh = Math.max(0, data.unread - data.items.filter((n) => !n.read && readIds.has(n.id)).length);
  return (
    <>
      <SectionHead s={s} title="Notifications" right={fresh ? `${fresh} new` : undefined} onRight={() => router.push('/notifications' as any)} />
      <View style={s.list} testID="home-notifications">
        {data.items.length === 0 ? (
          <View style={s.item}>
            <View style={[s.ic, { backgroundColor: colors.brandTertiary }]}><Ionicons name="notifications-outline" size={16} color={colors.brandSecondary} /></View>
            <View style={s.mid}><Text style={s.t1}>No notifications yet</Text></View>
          </View>
        ) : data.items.map((n, i) => (
          <NotifRow key={n.id} n={readIds.has(n.id) ? { ...n, read: true } : n} first={i === 0} onPress={() => open(n)} testID={`home-notif-${n.id}`} />
        ))}
        {!!data.staff && (
          <Pressable style={({ pressed }) => [s.item, s.itemSep, pressed && { backgroundColor: colors.surfaceTertiary }]} onPress={() => router.push('/settings/staff-notifications' as any)} testID="home-staff-notif">
            <View style={[s.ic, { backgroundColor: data.staff.on < data.staff.total ? colors.warning : colors.success }]}>
              <Ionicons name="people-outline" size={16} color={data.staff.on < data.staff.total ? colors.onWarning : colors.onSuccess} />
            </View>
            <View style={s.mid}>
              <Text style={s.t1}>Staff notifications</Text>
              <Text style={s.t2}>{data.staff.on} of {data.staff.total} have them on{data.staff.on < data.staff.total ? ' · tap to remind' : ''}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.mutedText} />
          </Pressable>
        )}
        <Pressable style={({ pressed }) => [s.item, s.itemSep, s.viewAll, pressed && { backgroundColor: colors.surfaceTertiary }]} onPress={() => router.push('/notifications' as any)} testID="home-notif-all">
          <Text style={s.viewAllText}>View all notifications</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.brandSecondary} />
        </Pressable>
      </View>
    </>
  );
}
