import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';

// Shared types and styles for the Website editor (Work › Website) — not a
// route itself (expo-router ignores `_` files). Backend: routers/website.py.

export type Field = { key: string; label: string; default: string; multiline: boolean; value: string; edited: boolean };
export type PageImage = { key: string; label: string; default_url: string; url: string; edited: boolean };
export type PageSection = {
  key: string; label: string; hideable: boolean; pieces: boolean; visible: boolean;
  fields: Field[]; images: PageImage[];
};
export type Photo = { id: string; caption: string; url: string };
export type OwnSection = { id: string; title: string; text: string; visible: boolean; photos: Photo[] };
export type Brand = { logo: number; name: number };   // % of the built-in size
export type Content = {
  page: PageSection[]; sections: OwnSection[]; pieces: number;
  brand: Brand; brand_default: Brand; brand_range: [number, number];
};

export const SITE_URL = 'https://rmj.co.in';
const API_BASE = process.env.EXPO_PUBLIC_BACKEND_URL || '';
// Page photos come back either as the site's own https URL (original) or an
// /api/public/... path (uploaded here) — make the latter absolute.
export const abs = (url: string, thumb = false) =>
  url.startsWith('http') ? url : `${API_BASE}${url}${thumb ? '?thumb=true' : ''}`;

export function Header({ title, colors, right }: { title: string; colors: ThemeColors; right?: React.ReactNode }) {
  const router = useRouter();
  const s = makeStyles(colors);
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

export const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  centered: { flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '600', fontFamily: fonts.display, textAlign: 'center' },
  scroll: { padding: spacing.lg, paddingBottom: 140 },
  flex1: { flex: 1, minWidth: 0 },
  hint: { color: colors.mutedText, fontSize: 12.5, lineHeight: 18 },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginTop: spacing.md, gap: 8 },
  cardTitle: { color: colors.onSurface, fontSize: 15, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { color: colors.onSurfaceSecondary, fontSize: 12.5, fontWeight: '700' },
  // minWidth 0 + width 100%: a web <input> otherwise keeps an intrinsic width wider than a phone.
  input: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 11, fontSize: 14.5, minWidth: 0, width: '100%' },
  multiline: { minHeight: 96, textAlignVertical: 'top', lineHeight: 20 },
  link: { color: colors.brandPrimary, fontSize: 12.5, fontWeight: '700' },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  btnText: { color: colors.brandSecondary, fontSize: 13.5, fontWeight: '700' },
  primary: { alignItems: 'center', justifyContent: 'center', paddingVertical: 15, borderRadius: radius.md, backgroundColor: colors.brandPrimary },
  primaryText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: '800' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider },
  photo: { width: '100%', aspectRatio: 1.6, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  danger: { color: colors.onError, fontSize: 13.5, fontWeight: '700' },
});
