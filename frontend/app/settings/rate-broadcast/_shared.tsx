import { ReactNode } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';

// Shared types, labels and styles for the Rate Broadcast screens (index =
// hub, number, templates, people, send) — not a route itself (expo-router
// ignores files prefixed with `_`). Backend: routers/rate_broadcast.py; the
// official number itself: whatsapp_meta.py via /settings/whatsapp-meta.

export type Plan = 'daily' | 'weekly';
export type Audience = Plan | 'all' | 'list';
export type Tpl = { exists: boolean; status: string | null; reason: string | null; error: string | null };
export type Settings = {
  weekly_enabled: boolean; weekday: number; time: string;
  daily_enabled: boolean; daily_time: string; daily_skip_sunday: boolean; daily_limit: number;
};
export type Job = {
  id: string; created_at: string; trigger: string; audience?: Audience; status: string; total: number;
  states?: Record<string, number>; delivery?: Record<string, number>;
  list_id?: string | null; list_name?: string | null; template_id?: string | null; template_label?: string | null;
  taps?: Record<string, number>;   // quick-reply button taps, per button
};
// Custom lists and the owner's own templates — routers/broadcasts.py.
export type BList = { id: string; name: string; count: number };
export type BtnType = 'quick_reply' | 'url' | 'phone';
export type BButton = { type: BtnType; text: string; url?: string; phone?: string };
export type BCard = { media_id: string; media_url?: string; body: string; button: BButton };
export type TplKind = 'text' | 'image' | 'carousel';
export type MyTpl = {
  id: string; label: string; name: string; kind: TplKind; body: string; media_id?: string | null; media_url?: string;
  buttons: BButton[]; cards: BCard[]; ack_text: string; status: string | null; reason?: string | null; created_at: string;
};
export const KIND_LABEL: Record<TplKind, string> = { text: 'Text', image: 'Photo', carousel: 'Scrollable photos' };
export type Overview = {
  settings: Settings; weekdays: string[]; counts: { daily: number; weekly: number; opted_out: number };
  rates: { gold: number; silver: number } | null; preview: string; buttons: string[];
  photo_url: string; photo_custom: boolean; subscribe_link: string | null;
  template: Tpl; meta_configured: boolean; sending: Job[]; sent_today: number;
  my_lists?: number; my_templates?: number;
};
export type MetaStatus = { configured: boolean; connected: boolean; phone: string | null; display_name: string | null };
export type Sub = { id: string; name: string; mobile: string; status: 'active' | 'opted_out'; plan?: Plan | 'none'; source?: string; lists?: string[] };

export const SHORT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const AUDIENCE_LABEL: Record<Audience, string> = { daily: 'Daily subscribers', weekly: 'Customer list', all: 'Everyone', list: 'A list' };
export const jobAudience = (j: Job) => (j.audience === 'list' ? j.list_name || 'A list' : AUDIENCE_LABEL[j.audience || 'weekly']);
export function statusLabel(status: string | null | undefined): string {
  if (status === 'APPROVED') return 'Approved';
  if (status === 'REJECTED') return 'Rejected';
  if (status === 'PAUSED' || status === 'DISABLED') return 'Paused by Meta';
  return 'In review';
}
export const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export const num = (n: number) => n.toLocaleString('en-IN');

export function templateLine(ov: Overview): string {
  const t = ov.template;
  if (!ov.meta_configured) return 'Set up the official number first';
  if (t.error) return t.error;
  if (!t.exists) return 'Not created yet';
  if (t.status === 'APPROVED') return 'Approved by Meta';
  if (t.status === 'REJECTED') return `Rejected by Meta${t.reason ? `: ${t.reason}` : ''}`;
  return `Waiting for Meta’s review (${(t.status || 'pending').toLowerCase()})`;
}

export function Header({ title, colors, right }: { title: string; colors: ThemeColors; right?: ReactNode }) {
  const router = useRouter();
  const s = headerStyles(colors);
  return (
    <View style={s.header}>
      <Pressable onPress={() => router.back()} style={s.iconBtn} hitSlop={12} testID="back-btn" accessibilityRole="button" accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
      </Pressable>
      <Text style={s.title} numberOfLines={1}>{title}</Text>
      {right || <View style={{ width: 40 }} />}
    </View>
  );
}

const headerStyles = (colors: ThemeColors) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '600', fontFamily: fonts.display, textAlign: 'center' },
});

export const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  centered: { flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  scroll: { padding: spacing.lg, paddingBottom: 120 },
  flex1: { flex: 1, minWidth: 0 },
  hint: { color: colors.mutedText, fontSize: 12.5, lineHeight: 18, marginVertical: 4 },
  body: { color: colors.onSurfaceSecondary, fontSize: 13.5, lineHeight: 19 },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginTop: spacing.md, gap: 8 },
  cardTitle: { color: colors.onSurface, fontSize: 15, fontWeight: '800' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radius.md, padding: spacing.md },
  ok: { backgroundColor: colors.success }, warn: { backgroundColor: colors.warning },
  statusText: { flex: 1, fontSize: 12.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { color: colors.onSurface, fontSize: 13.5, fontWeight: '700' },
  small: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.sm },
  // minWidth 0 + width 100%: a web <input> otherwise keeps a ~20-character
  // minimum width, which pushed two side-by-side fields off a phone screen.
  input: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 11, fontSize: 14, minWidth: 0, width: '100%' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 12.5, fontWeight: '600' }, chipTextOn: { color: colors.brandPrimary },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 10, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  btnText: { color: colors.brandSecondary, fontSize: 13.5, fontWeight: '700' },
  primary: { alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: radius.md, backgroundColor: colors.brandPrimary },
  primaryText: { color: colors.onBrandPrimary, fontSize: 14.5, fontWeight: '800' },
  linkBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  linkText: { color: colors.onSurface, fontSize: 13 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  listName: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  listMeta: { color: colors.mutedText, fontSize: 12 },
});
