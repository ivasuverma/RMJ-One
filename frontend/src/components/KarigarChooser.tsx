import { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { api } from '@/src/api/client';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { mobileKey } from '@/src/utils/mobile';
import { PartyByMobile, resolveParty, Resolved } from '@/src/components/PartyByMobile';

export type ChooserKarigar = { id: string; name: string; mobile?: string; is_employee?: boolean };

/**
 * Karigar entry, mobile first (see PartyByMobile): a saved number fills in
 * the karigar, an unknown one takes a name and creates a new karigar on save.
 * In-house karigars (staff) may have no mobile saved, so they're offered as
 * one-tap chips instead.
 */
export function KarigarChooser({
  karigars, mobile, onMobile, name, onName, inHouse, onInHouse, testID = 'karigar',
}: {
  karigars: ChooserKarigar[];
  mobile: string; onMobile: (v: string) => void;
  name: string; onName: (v: string) => void;
  inHouse: ChooserKarigar | null; onInHouse: (k: ChooserKarigar | null) => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const noMobile = useMemo(() => karigars.filter((k) => mobileKey(k.mobile).length < 7), [karigars]);

  return (
    <View>
      {inHouse ? (
        <View style={s.picked} testID={`${testID}-inhouse-picked`}>
          <Text style={s.pickedName}>{inHouse.name}</Text>
          <Text style={s.pickedMeta}>In-house</Text>
          <Pressable onPress={() => onInHouse(null)} style={s.smallBtn} testID={`${testID}-inhouse-clear`}>
            <Text style={s.smallBtnText}>Change</Text>
          </Pressable>
        </View>
      ) : (
        <PartyByMobile list={karigars} mobile={mobile} onMobile={onMobile} name={name} onName={onName} kindLabel="karigar" testID={testID} />
      )}
      {!inHouse && !mobile && noMobile.length > 0 && (
        <View style={s.chips}>
          <Text style={s.chipsLabel}>In-house:</Text>
          {noMobile.map((k) => (
            <Pressable key={k.id} onPress={() => onInHouse(k)} style={s.chip} testID={`${testID}-inhouse-${k.id}`}>
              <Text style={s.chipText}>{k.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

/** What the karigar entry means on save (see resolveParty). */
export function resolveKarigar<T extends ChooserKarigar>(karigars: T[], mobile: string, name: string, inHouse: T | null): Resolved<T> {
  if (inHouse) return { kind: 'existing', party: inHouse };
  return resolveParty(karigars, mobile, name, 'karigar');
}

/** Saves a new (outside) karigar and returns it. */
export function createKarigar(name: string, mobile: string) {
  return api.post<ChooserKarigar>('/karigars', { name: name.trim(), mobile: mobile.trim(), is_employee: false });
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  picked: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.brandPrimary, padding: spacing.md,
  },
  pickedName: { flex: 1, color: colors.onSurface, fontSize: 15, fontWeight: '700' },
  pickedMeta: { color: colors.mutedText, fontSize: 12 },
  smallBtn: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary },
  smallBtnText: { color: colors.onSurface, fontSize: 12, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  chipsLabel: { color: colors.mutedText, fontSize: 12, marginRight: 2 },
  chip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border },
  chipText: { color: colors.onSurface, fontSize: 12, fontWeight: '600' },
});
