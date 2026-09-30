import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api/client';
import { notify } from '@/src/utils/notify';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Sheet } from '@/src/components/ui';
import { ToggleSwitch } from '@/src/components/ui/ToggleSwitch';
import { QuickActions, QuickTile } from './types';

export const QUICK_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  cash_in: 'add-circle-outline', cash_out: 'remove-circle-outline', new_repair: 'construct-outline',
  issue_stock: 'diamond-outline', update_rate: 'trending-up-outline', send_rates: 'megaphone-outline',
  new_loan: 'cash-outline', add_task: 'checkbox-outline', advance: 'arrow-down-circle-outline',
};

/** Show/hide and reorder the Home quick actions. Saved on the server per person, so the
 * order follows them to any device. */
export function QuickEditSheet({ visible, data, onClose, onSaved }: {
  visible: boolean; data: QuickActions | null; onClose: () => void; onSaved: (q: QuickActions) => void;
}) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const [order, setOrder] = useState<QuickTile[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible && data) { setOrder(data.available); setHidden(new Set(data.hidden)); }
  }, [visible, data]);

  const move = (i: number, d: number) => setOrder((o) => {
    const j = i + d;
    if (j < 0 || j >= o.length) return o;
    const n = [...o]; [n[i], n[j]] = [n[j], n[i]]; return n;
  });
  const toggle = (k: string) => setHidden((h) => { const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const save = async () => {
    setSaving(true);
    try {
      const q = await api.put<QuickActions>('/home/quick-actions', { order: order.map((t) => t.key), hidden: [...hidden] });
      onSaved(q); onClose();
    } catch (e: any) { notify('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Quick actions" testID="quick-edit-sheet">
      <Text style={s.hint}>Choose which shortcuts show on Home and in what order. Saved to your account.</Text>
      <ScrollView style={{ maxHeight: 420 }}>
        {order.map((t, i) => (
          <View key={t.key} style={[s.row, i > 0 && s.sep]} testID={`quick-edit-${t.key}`}>
            <Ionicons name={QUICK_ICON[t.key] || 'ellipse-outline'} size={19} color={hidden.has(t.key) ? colors.mutedText : colors.brandSecondary} />
            <Text style={[s.label, hidden.has(t.key) && { color: colors.mutedText }]}>{t.label}</Text>
            <Pressable onPress={() => move(i, -1)} disabled={i === 0} hitSlop={6} style={s.arrow} accessibilityLabel={`Move ${t.label} up`}>
              <Ionicons name="chevron-up" size={17} color={i === 0 ? colors.border : colors.onSurface} />
            </Pressable>
            <Pressable onPress={() => move(i, 1)} disabled={i === order.length - 1} hitSlop={6} style={s.arrow} accessibilityLabel={`Move ${t.label} down`}>
              <Ionicons name="chevron-down" size={17} color={i === order.length - 1 ? colors.border : colors.onSurface} />
            </Pressable>
            <Pressable onPress={() => toggle(t.key)} accessibilityRole="switch" accessibilityState={{ checked: !hidden.has(t.key) }} testID={`quick-edit-toggle-${t.key}`}>
              <ToggleSwitch value={!hidden.has(t.key)} />
            </Pressable>
          </View>
        ))}
      </ScrollView>
      <Pressable onPress={save} disabled={saving} style={[s.save, saving && { opacity: 0.6 }]} testID="quick-edit-save">
        {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={s.saveText}>Save</Text>}
      </Pressable>
    </Sheet>
  );
}

/** Pick who an advance is for, then open the existing advance entry for them. */
export function EmployeePickSheet({ visible, onClose, onPick }: {
  visible: boolean; onClose: () => void; onPick: (id: string) => void;
}) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const [list, setList] = useState<{ id: string; name: string; designation?: string }[] | null>(null);
  useEffect(() => {
    if (!visible || list) return;
    api.get<{ id: string; name: string; designation?: string }[]>('/employees?status=active').then(setList).catch(() => setList([]));
  }, [visible, list]);
  return (
    <Sheet visible={visible} onClose={onClose} title="Advance for" testID="advance-pick-sheet">
      {!list ? <ActivityIndicator color={colors.brandPrimary} style={{ marginVertical: 30 }} /> : (
        <ScrollView style={{ maxHeight: 440 }}>
          {list.map((e, i) => (
            <Pressable key={e.id} onPress={() => onPick(e.id)} style={[s.row, i > 0 && s.sep]} testID={`advance-pick-${e.id}`}>
              <Text style={s.label}>{e.name}</Text>
              {!!e.designation && <Text style={s.meta}>{e.designation}</Text>}
              <Ionicons name="chevron-forward" size={16} color={colors.mutedText} />
            </Pressable>
          ))}
        </ScrollView>
      )}
    </Sheet>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  hint: { color: colors.mutedText, fontSize: 13, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 11 },
  sep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  label: { flex: 1, color: colors.onSurface, fontSize: 15, fontWeight: '600' },
  meta: { color: colors.mutedText, fontSize: 12.5 },
  arrow: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceTertiary },
  save: { marginTop: spacing.md, backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 13, alignItems: 'center' },
  saveText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: '700' },
});
