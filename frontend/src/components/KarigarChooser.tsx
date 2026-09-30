import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api/client';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { findByMobile, mobileMatches } from '@/src/utils/mobile';
import { DuplicateMobileNotice } from '@/src/components/DuplicateMobileNotice';

export type ChooserKarigar = { id: string; name: string; mobile?: string; is_employee?: boolean };
export type KarigarMode = 'existing' | 'new';

/**
 * "Existing Karigar / New Karigar", the same pattern as the customer choice
 * on New Repair Intake: pick one from the list (with search), or type a new
 * karigar's name and mobile. The new one is only created when the form is
 * saved (see createKarigar), so backing out leaves nothing behind. Karigars
 * are found by mobile number, and a New Karigar whose number is already saved
 * is flagged (with a one-tap switch to that karigar) — the server refuses it too.
 */
export function KarigarChooser({
  karigars, picked, onPick, mode, onMode, newName, onNewName, newMobile, onNewMobile, placeholder = 'Choose a karigar', testID = 'karigar',
}: {
  karigars: ChooserKarigar[];
  picked: ChooserKarigar | null;
  onPick: (k: ChooserKarigar | null) => void;
  mode: KarigarMode;
  onMode: (m: KarigarMode) => void;
  newName: string; onNewName: (v: string) => void;
  newMobile: string; onNewMobile: (v: string) => void;
  placeholder?: string;
  testID?: string;
}) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const list = useMemo(() => karigars.filter((k) => mobileMatches(k.mobile, query)), [karigars, query]);
  const duplicate = mode === 'new' ? findByMobile(karigars, newMobile) : undefined;

  return (
    <View>
      <View style={s.chipRow}>
        {(['existing', 'new'] as const).map((m) => (
          <Pressable key={m} onPress={() => onMode(m)} style={[s.chip, mode === m && s.chipActive]} testID={`${testID}-mode-${m}`}>
            <Text style={[s.chipText, mode === m && s.chipTextActive]}>{m === 'existing' ? 'Existing Karigar' : 'New Karigar'}</Text>
          </Pressable>
        ))}
      </View>

      {mode === 'new' ? (
        <View>
          <TextInput value={newName} onChangeText={onNewName} placeholder="Karigar name" placeholderTextColor={colors.mutedText} style={s.input} testID={`${testID}-new-name`} />
          <TextInput value={newMobile} onChangeText={onNewMobile} placeholder="Mobile number" placeholderTextColor={colors.mutedText} keyboardType="phone-pad" style={[s.input, { marginTop: spacing.sm }]} testID={`${testID}-new-mobile`} />
          {duplicate && (
            <DuplicateMobileNotice name={duplicate.name} testID={`${testID}-duplicate`}
              onUse={() => { onPick(duplicate); onMode('existing'); onNewName(''); onNewMobile(''); }} />
          )}
        </View>
      ) : picked ? (
        <View style={s.selectedCard} testID={`${testID}-selected`}>
          <View style={{ flex: 1 }}>
            <Text style={s.cName}>{picked.name}</Text>
            <Text style={s.cMeta}>{picked.is_employee ? 'In-house' : picked.mobile || 'Outside'}</Text>
          </View>
          <Pressable onPress={() => onPick(null)} style={s.smallBtn} testID={`${testID}-change`}>
            <Text style={s.smallBtnText}>Change</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <Pressable onPress={() => setOpen((v) => !v)} style={s.picker} testID={`${testID}-toggle`}>
            <Text style={s.pickerPlaceholder}>{placeholder}</Text>
            <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedText} />
          </Pressable>
          {open && (
            <View style={s.pickerList}>
              <View style={s.searchRow}>
                <Ionicons name="call-outline" size={16} color={colors.mutedText} />
                <TextInput value={query} onChangeText={(v) => setQuery(v.replace(/\D/g, ''))} placeholder="Search by mobile number" placeholderTextColor={colors.mutedText} keyboardType="phone-pad" autoFocus style={s.searchInput} testID={`${testID}-search`} />
              </View>
              <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                {list.length === 0 ? (
                  <Text style={[s.pickerRowMeta, { padding: spacing.md }]}>{karigars.length ? 'No karigars found' : 'No karigars yet — use New Karigar'}</Text>
                ) : list.map((k) => (
                  <Pressable key={k.id} onPress={() => { onPick(k); setOpen(false); setQuery(''); }} style={s.pickerRow} testID={`${testID}-${k.id}`}>
                    <Text style={s.pickerRowName}>{k.name}</Text>
                    <Text style={s.pickerRowMeta}>{k.mobile || (k.is_employee ? 'In-house' : '—')}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}
        </>
      )}
    </View>
  );
}

/** Checks a New Karigar entry; returns a message for what's missing, or null. */
export function newKarigarProblem(name: string, mobile: string, karigars: ChooserKarigar[] = []): string | null {
  if (!name.trim()) return 'Enter the new karigar’s name';
  if (mobile.replace(/\D/g, '').length < 7) return 'A mobile number is required for a new karigar';
  const dup = findByMobile(karigars, mobile);
  if (dup) return `This mobile number is already saved as ${dup.name} — pick them under Existing Karigar`;
  return null;
}

/** Saves a New Karigar entry (an outside karigar) and returns it. */
export function createKarigar(name: string, mobile: string) {
  return api.post<ChooserKarigar>('/karigars', { name: name.trim(), mobile: mobile.trim(), is_employee: false });
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  chipRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  chip: { flex: 1, alignItems: 'center', paddingVertical: 10, paddingHorizontal: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: colors.onBrandPrimary },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },
  selectedCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md,
  },
  cName: { color: colors.onSurface, fontSize: 15, fontWeight: '700' },
  cMeta: { color: colors.mutedText, fontSize: 12, marginTop: 2 },
  smallBtn: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary },
  smallBtnText: { color: colors.onSurface, fontSize: 12, fontWeight: '700' },
  picker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 12,
  },
  pickerPlaceholder: { color: colors.mutedText, fontSize: 14 },
  pickerList: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginTop: spacing.xs },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceSecondary, margin: spacing.sm,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md,
  },
  searchInput: { flex: 1, color: colors.onSurface, paddingVertical: 10, fontSize: 14 },
  pickerRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: 10 },
  pickerRowName: { color: colors.onSurface, fontSize: 13, fontWeight: '600' },
  pickerRowMeta: { color: colors.mutedText, fontSize: 12 },
});
