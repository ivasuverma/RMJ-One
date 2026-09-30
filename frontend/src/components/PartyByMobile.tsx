import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { findByMobile, mobileKey } from '@/src/utils/mobile';

export type Party = { id: string; name: string; mobile?: string | null };

/**
 * Mobile-first customer/karigar entry. Customers and karigars are identified
 * by mobile number (no two share one), so the mobile is typed first:
 * - a saved number fills in the name, and that person is used;
 * - an unknown number needs a name, and a new one is created on save.
 * While typing, saved numbers containing the digits are offered to tap, and
 * the list button next to the field opens everyone to pick from. The parent keeps `mobile` and `name` (the name typed for a new one) and
 * resolves them with `resolveParty` when saving.
 */
export function PartyByMobile({
  list, mobile, onMobile, name, onName, kindLabel, testID, children, onPick,
}: {
  list: Party[];
  /** Picked from the list; by default that fills in their mobile number. */
  onPick?: (p: Party) => void;
  mobile: string; onMobile: (v: string) => void;
  name: string; onName: (v: string) => void;
  kindLabel: string;  // 'customer' | 'karigar' — for the labels
  testID: string;
  children?: React.ReactNode;  // extra fields shown only for a new one (e.g. address)
}) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const [focused, setFocused] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  // Without an onPick, picking fills in the number — so only people who have one are listed.
  const sorted = useMemo(
    () => list.filter((p) => onPick || mobileKey(p.mobile).length >= 7).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 500),
    [list, onPick],
  );
  const pick = (p: Party) => { setListOpen(false); if (onPick) onPick(p); else onMobile(p.mobile || ''); };
  const match = findByMobile(list, mobile);
  const digits = mobile.replace(/\D/g, '');
  const suggestions = useMemo(() => {
    if (match || listOpen || digits.length < 3) return [];
    return list.filter((p) => (p.mobile || '').replace(/\D/g, '').includes(digits)).slice(0, 5);
  }, [list, digits, match, listOpen]);
  const isNew = !match && mobileKey(mobile).length >= 7;

  return (
    <View>
      <Text style={s.label}>Mobile</Text>
      <View style={[s.inputRow, focused && s.inputRowFocused]}>
        <Ionicons name="call-outline" size={16} color={colors.mutedText} />
        <TextInput
          value={mobile} onChangeText={(v) => onMobile(v.replace(/[^\d+ ]/g, ''))} keyboardType="phone-pad"
          placeholder="98xxxxxxxx" placeholderTextColor={colors.mutedText} style={s.inputBare} testID={`${testID}-mobile`}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        />
        {!!mobile && (
          <Pressable onPress={() => { onMobile(''); onName(''); }} hitSlop={8} testID={`${testID}-clear`} accessibilityLabel="Clear">
            <Ionicons name="close-circle" size={18} color={colors.mutedText} />
          </Pressable>
        )}
        <Pressable onPress={() => setListOpen((v) => !v)} style={s.listBtn} hitSlop={6} testID={`${testID}-list-toggle`}
          accessibilityRole="button" accessibilityLabel={`Choose from saved ${kindLabel}s`}>
          <Ionicons name={listOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.onSurface} />
        </Pressable>
      </View>

      {listOpen && (
        <View style={s.suggest} testID={`${testID}-list`}>
          <ScrollView style={{ maxHeight: 280 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {sorted.length === 0 ? (
              <Text style={[s.suggestMeta, { padding: spacing.md }]}>No saved {kindLabel}s yet — type a mobile number to add one</Text>
            ) : sorted.map((p) => (
              <Pressable key={p.id} onPress={() => pick(p)} style={s.suggestRow} testID={`${testID}-list-${p.id}`}>
                <Text style={s.suggestName}>{p.name}</Text>
                <Text style={s.suggestMeta}>{p.mobile || '—'}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {suggestions.length > 0 && (
        <View style={s.suggest} testID={`${testID}-suggestions`}>
          {suggestions.map((p) => (
            <Pressable key={p.id} onPress={() => pick(p)} style={s.suggestRow} testID={`${testID}-suggest-${p.id}`}>
              <Text style={s.suggestName}>{p.name}</Text>
              <Text style={s.suggestMeta}>{p.mobile}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <Text style={s.label}>Name</Text>
      {match ? (
        <View style={[s.input, s.found]} testID={`${testID}-found`}>
          <Text style={s.foundName} numberOfLines={1}>{match.name}</Text>
          <View style={s.badge}><Text style={s.badgeText}>Saved {kindLabel}</Text></View>
        </View>
      ) : (
        <TextInput
          value={name} onChangeText={onName} editable={isNew}
          placeholder={isNew ? `New ${kindLabel}’s name` : 'Enter the mobile number first'} placeholderTextColor={colors.mutedText}
          style={[s.input, !isNew && s.inputDisabled]} testID={`${testID}-name`}
        />
      )}
      {isNew && <Text style={s.hint}>Not saved yet — a new {kindLabel} will be created with this number.</Text>}
      {isNew && children}
    </View>
  );
}

export type Resolved<T> =
  | { kind: 'none' }                         // nothing entered
  | { kind: 'existing'; party: T }
  | { kind: 'new'; name: string; mobile: string }
  | { kind: 'error'; message: string };

/** What the mobile + name entry means on save. */
export function resolveParty<T extends Party>(list: T[], mobile: string, name: string, kindLabel: string): Resolved<T> {
  if (!mobile.trim() && !name.trim()) return { kind: 'none' };
  const match = findByMobile(list, mobile);
  if (match) return { kind: 'existing', party: match };
  if (mobileKey(mobile).length < 7) return { kind: 'error', message: `Enter the ${kindLabel}’s mobile number` };
  if (!name.trim()) return { kind: 'error', message: `Enter the new ${kindLabel}’s name` };
  return { kind: 'new', name: name.trim(), mobile: mobile.trim() };
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6, marginTop: spacing.md },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md,
  },
  inputRowFocused: { borderColor: colors.onSurface },
  listBtn: {
    marginRight: -spacing.sm, paddingHorizontal: spacing.sm, alignSelf: 'stretch', justifyContent: 'center',
    borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border,
  },
  // The row draws the focus ring, so the bare input inside mustn't draw its own (web).
  inputBare: { flex: 1, color: colors.onSurface, paddingVertical: 12, fontSize: 15, letterSpacing: 0.3, outlineStyle: 'none' } as object,
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },
  inputDisabled: { backgroundColor: colors.surfaceTertiary },
  found: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderColor: colors.brandPrimary },
  foundName: { flex: 1, color: colors.onSurface, fontSize: 15, fontWeight: '700' },
  badge: { backgroundColor: colors.brandTertiary, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { color: colors.brandSecondary, fontSize: 11, fontWeight: '800' },
  hint: { color: colors.mutedText, fontSize: 12, marginTop: 6 },
  suggest: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginTop: spacing.xs },
  suggestRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: 10 },
  suggestName: { color: colors.onSurface, fontSize: 13, fontWeight: '600' },
  suggestMeta: { color: colors.mutedText, fontSize: 12 },
});
