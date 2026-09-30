import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { istDisplayDate, istTime } from '@/src/utils/datetime';
import { ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

export type Notif = { id: string; title: string; body: string; url: string; read: boolean; created_at: string };

type Meta = { icon: keyof typeof Ionicons.glyphMap; tone: 'gold' | 'green' | 'blue' | 'red' | 'amber' | 'grey'; label: string };

/** Which part of the app a notification is about, from where it opens — each gets
 * its own icon and colour, like app icons in iOS Notification Centre. */
export function notifMeta(url: string): Meta {
  const u = (url || '').replace('/(tabs)', '').replace('/(emp)', '');
  if (u.startsWith('/repairs') || u.startsWith('/transactions')) return { icon: 'construct', tone: 'gold', label: 'Repairs' };
  if (u.startsWith('/samples')) return { icon: 'diamond', tone: 'gold', label: 'Stock In/Out' };
  if (u.startsWith('/loans')) return { icon: 'cash', tone: 'amber', label: 'Gold Loans' };
  if (u.startsWith('/cashbook')) return { icon: 'wallet', tone: 'green', label: 'Cash Book' };
  if (u.startsWith('/documents')) return { icon: 'document-text', tone: 'blue', label: 'Documents' };
  if (u.startsWith('/tasks')) return { icon: 'checkbox', tone: 'blue', label: 'Tasks' };
  if (u.startsWith('/attendance') || u.startsWith('/shifts') || u.startsWith('/calendar')) return { icon: 'time', tone: 'green', label: 'Attendance' };
  if (u.startsWith('/leaves')) return { icon: 'airplane', tone: 'blue', label: 'Leave' };
  if (u.startsWith('/payroll') || u.startsWith('/ledger')) return { icon: 'card', tone: 'green', label: 'Payroll' };
  if (u.startsWith('/approvals')) return { icon: 'checkmark-done', tone: 'amber', label: 'Approvals' };
  if (u.startsWith('/rates') || u.startsWith('/gold-rate') || u.includes('rate-broadcast')) return { icon: 'trending-up', tone: 'gold', label: 'Rates' };
  if (u.startsWith('/employees') || u.startsWith('/profile')) return { icon: 'person', tone: 'blue', label: 'Team' };
  if (u.startsWith('/settings')) return { icon: 'settings', tone: 'grey', label: 'Settings' };
  return { icon: 'notifications', tone: 'red', label: 'RMJ One' };
}

/** Old notifications were saved pointing at the retired Transactions tab. */
export function notifTarget(url: string): string | null {
  if (url === '/(tabs)/transactions' || url === '/(emp)/transactions') return '/repairs';
  return url && url !== '/' ? url : null;
}

/** iOS style: "now", "12m", "3h", yesterday's time, then the date. */
export function notifTime(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 6) return `${Math.round(mins / 60)}h ago`;
  if (mins < 60 * 24 * 2) return istTime(iso);
  return istDisplayDate(iso);
}

export function toneColors(tone: Meta['tone'], c: ThemeColors) {
  switch (tone) {
    case 'green': return { bg: c.success, fg: c.onSuccess };
    case 'blue': return { bg: c.info, fg: c.onInfo };
    case 'red': return { bg: c.error, fg: c.onError };
    case 'amber': return { bg: c.warning, fg: c.onWarning };
    case 'grey': return { bg: c.surfaceTertiary, fg: c.onSurfaceSecondary };
    default: return { bg: c.brandTertiary, fg: c.brandSecondary };
  }
}

/** One notification in an inset grouped list: app icon, source + time on top, bold
 * title, two lines of body, and a dot while unread. */
export function NotifRow({ n, first, onPress, testID }: { n: Notif; first?: boolean; onPress: () => void; testID?: string }) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const meta = notifMeta(n.url);
  const tone = toneColors(meta.tone, colors);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.surfaceTertiary }]} testID={testID}
      accessibilityRole="button" accessibilityLabel={`${n.read ? '' : 'Unread. '}${meta.label}. ${n.title}. ${n.body}`}>
      <View style={s.dotCol}>{!n.read && <View style={s.dot} />}</View>
      <View style={[s.icon, { backgroundColor: tone.bg }]}><Ionicons name={meta.icon} size={17} color={tone.fg} /></View>
      <View style={[s.main, !first && s.sep]}>
        <View style={s.top}>
          <Text style={s.src} numberOfLines={1}>{meta.label}</Text>
          <Text style={s.time}>{notifTime(n.created_at)}</Text>
        </View>
        <Text style={[s.title, n.read && s.titleRead]} numberOfLines={1}>{n.title}</Text>
        {!!n.body && <Text style={s.body} numberOfLines={2}>{n.body}</Text>}
      </View>
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingRight: 14 },
  dotCol: { width: 18, alignItems: 'center', paddingTop: 22 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brandPrimary },
  icon: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginTop: 12, marginRight: 12 },
  main: { flex: 1, minWidth: 0, paddingVertical: 11 },
  sep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  src: { flex: 1, color: colors.mutedText, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  time: { color: colors.mutedText, fontSize: 12.5 },
  title: { color: colors.onSurface, fontSize: 15, fontWeight: '700', marginTop: 2 },
  titleRead: { fontWeight: '600' },
  body: { color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 19, marginTop: 1 },
});
