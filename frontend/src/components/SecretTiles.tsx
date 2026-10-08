import { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, TextStyle, StyleProp } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { spacing, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Sheet, useToast } from '@/src/components/ui';
import { haptics } from '@/src/utils/haptics';

// Tiles the owner keeps out of sight on the Work and Ledger tabs, for everyone
// (staff and employees). Double-tapping the tab's title shows them — and, for
// the owner, a gear to choose which ones are hidden. Leaving the tab hides
// them again. Only the tile is hidden; who can open the module is unchanged.
export type TileTab = 'work' | 'ledger';
export type TileInfo = { key: string; title: string; icon: keyof typeof Ionicons.glyphMap };

// The last known list, kept in memory and on the device, so a tab opens with its
// tiles already hidden instead of flashing them while the server is asked again.
const STORE_KEY = 'rmj.hidden_tiles';
let memo: string[] | null = null;
const readStored = (): string[] | null => {
  if (memo) return memo;
  try { const v = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); if (Array.isArray(v)) memo = v; } catch { /* no storage */ }
  return memo;
};
const remember = (keys: string[]) => {
  memo = keys;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(keys)); } catch { /* no storage */ }
};

export function useSecretTiles(tab: TileTab) {
  const { user } = useAuth();
  // null = not known yet (first ever open): every tile stays out until the list arrives.
  const [keys, setKeysState] = useState<string[] | null>(readStored);
  const setKeys = (k: string[]) => { remember(k); setKeysState(k); };
  const [revealed, setRevealed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useFocusEffect(useCallback(() => {
    api.get<{ keys: string[] }>('/hidden-tiles').then((r) => setKeys(r.keys || [])).catch(() => { if (!memo) setKeysState(['ledger:cash-ledger']); });
    return () => { setRevealed(false); setSettingsOpen(false); };
  }, []));
  const lastTap = useRef(0);
  const onTitleTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 350) { lastTap.current = 0; setRevealed((v) => !v); }
    else lastTap.current = now;
  };
  const hiddenSet = useMemo(() => new Set((keys || []).filter((k) => k.startsWith(`${tab}:`)).map((k) => k.slice(tab.length + 1))), [keys, tab]);
  const isHidden = (key: string) => hiddenSet.has(key);
  const filter = <T extends { key: string }>(rows: T[]) => (revealed ? rows : keys === null ? [] : rows.filter((r) => !hiddenSet.has(r.key)));
  const save = async (tabKeys: string[]) => {
    const next = [...(keys || []).filter((k) => !k.startsWith(`${tab}:`)), ...tabKeys.map((k) => `${tab}:${k}`)];
    const r = await api.put<{ keys: string[] }>('/hidden-tiles', { keys: next });
    setKeys(r.keys);
  };
  return {
    revealed, onTitleTap, isHidden, filter, hiddenSet, save,
    canChoose: user?.role === 'owner', settingsOpen, setSettingsOpen,
  };
}

/** The tab's big title: plain text that answers a double-tap (no button look, no highlight). */
export function SecretTitle({ text, style, onTap, testID }: { text: string; style: StyleProp<TextStyle>; onTap: () => void; testID?: string }) {
  return (
    <View onStartShouldSetResponder={() => true} onResponderRelease={onTap} testID={testID}
      style={{ alignSelf: 'flex-start', ...({ touchAction: 'manipulation', userSelect: 'none', WebkitTapHighlightColor: 'transparent' } as any) }}>
      <Text style={style} selectable={false}>{text}</Text>
    </View>
  );
}

/** The owner's gear, shown next to the title only while hidden tiles are revealed. */
export function SecretGear({ onPress, testID }: { onPress: () => void; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityLabel="Choose hidden tiles" testID={testID}
      style={({ pressed }) => [{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSecondary }, pressed && { opacity: 0.6 }]}>
      <Ionicons name="settings-outline" size={18} color={colors.onSurface} />
    </Pressable>
  );
}

/** Small mark on a tile that's normally hidden (shown only while revealed). */
export function HiddenMark() {
  const { colors } = useTheme();
  return <Ionicons name="eye-off-outline" size={15} color={colors.mutedText} style={{ marginLeft: 6 }} />;
}

/** Owner: pick which of this tab's tiles are hidden for everyone. */
export function HiddenTilesSheet({ visible, onClose, tabLabel, tiles, hidden, onSave }: {
  visible: boolean; onClose: () => void; tabLabel: string; tiles: TileInfo[]; hidden: Set<string>; onSave: (keys: string[]) => Promise<void>;
}) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const toggle = async (key: string) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key); else next.add(key);
    setBusy(key);
    try { await onSave([...next]); haptics.selection(); }
    catch (e: any) { toast.error(e?.detail || 'Could not save'); }
    finally { setBusy(null); }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={`Hidden on ${tabLabel}`} testID="hidden-tiles-sheet">
      <Text style={s.hint}>Hidden tiles don&apos;t show on {tabLabel} for anyone — you, staff or employees — until they double-tap the {tabLabel} title. Access to each module stays the same.</Text>
      <ScrollView style={{ maxHeight: 460 }}>
        <View style={s.group}>
          {tiles.map((t, i) => {
            const on = hidden.has(t.key);
            return (
              <Pressable key={t.key} onPress={() => toggle(t.key)} disabled={!!busy}
                style={({ pressed }) => [s.row, i > 0 && s.sep, pressed && { opacity: 0.6 }]} testID={`hidden-tile-${t.key}`}>
                <Ionicons name={t.icon} size={20} color={colors.brandSecondary} />
                <Text style={s.title}>{t.title}</Text>
                {busy === t.key ? <ActivityIndicator size="small" color={colors.mutedText} />
                  : <View style={[s.pill, on && s.pillOn]}><Ionicons name={on ? 'eye-off-outline' : 'eye-outline'} size={14} color={on ? colors.onBrandPrimary : colors.mutedText} /><Text style={[s.pillText, on && { color: colors.onBrandPrimary }]}>{on ? 'Hidden' : 'Shown'}</Text></View>}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </Sheet>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  hint: { color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 20, marginBottom: spacing.md },
  group: { backgroundColor: colors.surfaceSecondary, borderRadius: 12, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: spacing.md, paddingVertical: 12, minHeight: 52 },
  sep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  title: { flex: 1, color: colors.onSurface, fontSize: 16 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: colors.surfaceTertiary },
  pillOn: { backgroundColor: colors.brandPrimary },
  pillText: { color: colors.mutedText, fontSize: 13, fontWeight: '600' },
});
