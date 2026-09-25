import { useMemo, useState } from 'react';
import { View, Text, Pressable, Switch, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { AccessEditor, Rights } from '@/src/hooks/use-access-editor';

// Attendance isn't a grantable access module (every employee has their own
// attendance, nothing to permission), so it never appeared in availableModules
// and its alerts were invisible here — even though the employee always gets
// them. These five are sent by notify_user() unconditionally (see server.py's
// _check_missed_attendance/_check_missed_checkout/_check_daily_absentee_summary
// and routers/attendance.py's check-in/check-out) — never gated by the
// Notification Settings module toggle, so they're shown read-only rather than
// as switches that would do nothing if flipped.
const ATTENDANCE_ALWAYS_ON = [
  'Checked in',
  'Checked out',
  "Missed check-in reminder",
  "Missed check-out reminder",
  'Marked absent',
];

const MODULE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  repairs: 'construct-outline',
  samples: 'swap-horizontal-outline',
  cash_book: 'cash-outline',
  documents: 'document-text-outline',
  customer_ledger: 'people-outline',
  karigar_ledger: 'hammer-outline',
  gold_rate: 'trending-up-outline',
  website: 'globe-outline',
  rate_broadcast: 'megaphone-outline',
};

type Level = 'view' | 'edit' | 'full';
const LEVELS: { key: Level; label: string }[] = [
  { key: 'view', label: 'View' }, { key: 'edit', label: 'Edit' }, { key: 'full', label: 'Full' },
];
const LEVEL_NOTE: Record<Level, string> = {
  view: 'Can see entries, can’t change them.',
  edit: 'Can add and edit, can’t delete.',
  full: 'Add, edit and delete.',
};

// Delete-without-edit is an inconsistent state the old two-checkbox editor
// could produce — treated as Full here (delete is the stronger right).
function levelFor(r?: Rights): Level {
  if (r?.delete) return 'full';
  if (r?.edit) return 'edit';
  return 'view';
}
function rightsForLevel(level: Level): Rights {
  if (level === 'full') return { edit: true, delete: true };
  if (level === 'edit') return { edit: true, delete: false };
  return { edit: false, delete: false };
}

// Employee profile's merged Access & Alerts tab: one card per module an
// employee could be granted, driven from the module registry
// (editor.availableModules) rather than a hardcoded list, so a new
// employee-assignable module appears here automatically. Turning a
// module's access off collapses its card and — enforced server-side, see
// _notify_module_impl's module_gated check — stops its alerts immediately,
// independent of whatever alert choices were made while it was on; turning
// it back on restores them (they're just preferences, never cleared).
export function EmployeeAccessAlerts({ editor, onSave }: { editor: AccessEditor; onSave: () => Promise<void> | void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const {
    availableModules, notifModules, docCats,
    mods, toggleMod, rights, setModuleRights, counterSel, toggleCounter, counters,
    notifOn, setNotifOn, notifPrefs, setNotifPrefs, notifPrefsWhatsapp, setNotifPrefsWhatsapp,
    docRights, toggleDoc, seeDone, setSeeDone, saving,
  } = editor;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (key: string) => setExpanded((p) => {
    const n = new Set(p); if (n.has(key)) n.delete(key); else n.add(key); return n;
  });

  const onCount = availableModules.filter((m) => mods.has(m.key)).length;

  return (
    <>
      <View style={styles.masterCard}>
        <View style={styles.masterRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.masterTitle}>Allow notifications</Text>
            <Text style={styles.masterSub}>Push &amp; WhatsApp for modules he can access</Text>
          </View>
          <Switch value={notifOn} onValueChange={setNotifOn} trackColor={{ true: colors.brandPrimary, false: colors.border }} thumbColor={colors.surface} {...({ activeThumbColor: colors.surface } as object)} testID="ea-notif-master" />
        </View>
      </View>

      <Text style={styles.groupLabel}>Attendance</Text>
      <View style={styles.card}>
        <Pressable
          onPress={() => toggleExpanded('attendance')}
          style={styles.cardHead}
          testID="ea-attendance-head"
        >
          <View style={styles.modIcon}><Ionicons name="time-outline" size={16} color={colors.brandSecondary} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.modTitle}>Attendance</Text>
            <Text style={styles.modSub} numberOfLines={1}>Always on · {ATTENDANCE_ALWAYS_ON.length} alerts</Text>
          </View>
          <Ionicons name={expanded.has('attendance') ? 'chevron-down' : 'chevron-forward'} size={15} color={colors.mutedText} style={{ marginRight: 4 }} />
        </Pressable>
        {expanded.has('attendance') && (
          <View style={styles.cardBody}>
            <Text style={styles.levelNote}>Tells them about their own check-in, check-out and absences — always sent, can&apos;t be turned off.</Text>
            {ATTENDANCE_ALWAYS_ON.map((label) => (
              <View key={label} style={styles.alertRow}>
                <Text style={styles.alertLabel}>{label}</Text>
                <Ionicons name="notifications" size={13} color={colors.brandSecondary} />
                <Ionicons name="logo-whatsapp" size={13} color={colors.brandSecondary} />
              </View>
            ))}
          </View>
        )}
      </View>

      <Text style={styles.groupLabel}>Modules · {onCount} of {availableModules.length} on</Text>

      {availableModules.map((m) => {
        const on = mods.has(m.key);
        const r = rights[m.key] || {};
        const level = levelFor(r);
        const nm = notifModules.find((n) => n.key === m.key);
        const allEvents = (nm?.events || []).filter((ev) => !ev.admin_only);
        const moduleOn = notifPrefs[m.key] !== false;
        const moduleOnWa = notifPrefsWhatsapp[m.key] !== false;
        const alertCount = allEvents.filter((ev) => {
          const evOn = ev.key in notifPrefs ? notifPrefs[ev.key] !== false : moduleOn;
          const evOnWa = ev.key in notifPrefsWhatsapp ? notifPrefsWhatsapp[ev.key] !== false : moduleOnWa;
          return evOn || evOnWa;
        }).length;
        const summary = on
          ? `${LEVELS.find((l) => l.key === level)!.label}${notifOn && allEvents.length ? ` · ${alertCount} alert${alertCount === 1 ? '' : 's'}` : ''}`
          : 'No access';
        const isOpen = expanded.has(m.key) && on;

        return (
          <View key={m.key} style={styles.card}>
            <Pressable
              onPress={() => on && toggleExpanded(m.key)}
              disabled={!on}
              style={styles.cardHead}
              testID={`ea-mod-head-${m.key}`}
            >
              <View style={styles.modIcon}><Ionicons name={MODULE_ICON[m.key] || 'apps-outline'} size={16} color={colors.brandSecondary} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.modTitle}>{m.label}</Text>
                <Text style={styles.modSub} numberOfLines={1}>{summary}</Text>
              </View>
              {on && <Ionicons name={isOpen ? 'chevron-down' : 'chevron-forward'} size={15} color={colors.mutedText} style={{ marginRight: 4 }} />}
              <Switch
                value={on}
                onValueChange={(v) => { toggleMod(m.key); if (v) setExpanded((p) => new Set(p).add(m.key)); }}
                trackColor={{ true: colors.brandPrimary, false: colors.border }}
                thumbColor={colors.surface} {...({ activeThumbColor: colors.surface } as object)}
                testID={`ea-mod-switch-${m.key}`}
              />
            </Pressable>

            {isOpen && (
              <View style={styles.cardBody}>
                <View style={styles.levelRow}>
                  {LEVELS.map((lv) => (
                    <Pressable
                      key={lv.key}
                      onPress={() => setModuleRights(m.key, rightsForLevel(lv.key))}
                      style={[styles.levelBtn, level === lv.key && styles.levelBtnOn]}
                      testID={`ea-level-${m.key}-${lv.key}`}
                    >
                      <Text style={[styles.levelBtnText, level === lv.key && styles.levelBtnTextOn]}>{lv.label}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.levelNote}>{LEVEL_NOTE[level]}</Text>

                {m.key === 'cash_book' && counters.length > 0 && (
                  <>
                    <Text style={styles.subLabel}>Assigned counters</Text>
                    <View style={styles.chipRow}>
                      {counters.map((c) => {
                        const sel = counterSel.has(c.id);
                        return (
                          <Pressable key={c.id} onPress={() => toggleCounter(c.id)} style={[styles.chip, sel && styles.chipOn]} testID={`ea-counter-${c.id}`}>
                            <Text style={[styles.chipText, sel && styles.chipTextOn]}>{c.name}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </>
                )}

                {m.key === 'documents' && docCats.length > 0 && (
                  <>
                    <Text style={styles.subLabel}>Document folders</Text>
                    {docCats.map((dc) => {
                      const dr = docRights[dc.key] || {};
                      return (
                        <View key={dc.key} style={styles.folderRow}>
                          <Text style={styles.folderLabel} numberOfLines={1}>{dc.label}</Text>
                          <Pressable onPress={() => toggleDoc(dc.key, 'view')} style={[styles.chip, dr.view && styles.chipOn]} testID={`ea-docview-${dc.key}`}>
                            <Text style={[styles.chipText, dr.view && styles.chipTextOn]}>Snap</Text>
                          </Pressable>
                          <Pressable onPress={() => toggleDoc(dc.key, 'record')} style={[styles.chip, dr.record && styles.chipOn]} testID={`ea-docrec-${dc.key}`}>
                            <Text style={[styles.chipText, dr.record && styles.chipTextOn]}>Record</Text>
                          </Pressable>
                        </View>
                      );
                    })}
                    <View style={styles.seeDoneRow}>
                      <Text style={styles.folderLabel}>Browse &quot;Done&quot; folder</Text>
                      <Switch value={seeDone} onValueChange={setSeeDone} trackColor={{ true: colors.brandPrimary, false: colors.border }} thumbColor={colors.surface} {...({ activeThumbColor: colors.surface } as object)} testID="ea-see-done" />
                    </View>
                  </>
                )}

                {allEvents.length > 0 && (
                  notifOn ? (
                    <>
                      <View style={styles.alertsHead}>
                        <Text style={styles.subLabel}>Alerts</Text>
                        <View style={styles.channelIcons}>
                          <Ionicons name="notifications-outline" size={13} color={colors.mutedText} />
                          <Ionicons name="logo-whatsapp" size={13} color={colors.mutedText} />
                        </View>
                      </View>
                      {allEvents.map((ev) => {
                        const evOn = ev.key in notifPrefs ? notifPrefs[ev.key] !== false : moduleOn;
                        const evOnWa = ev.key in notifPrefsWhatsapp ? notifPrefsWhatsapp[ev.key] !== false : moduleOnWa;
                        return (
                          <View key={ev.key} style={styles.alertRow}>
                            <Text style={styles.alertLabel}>{ev.label}</Text>
                            <ChannelChip icon="notifications" on={evOn} onPress={() => setNotifPrefs((p) => ({ ...p, [ev.key]: !evOn }))} testID={`ea-alert-push-${ev.key}`} />
                            <ChannelChip icon="logo-whatsapp" on={evOnWa} onPress={() => setNotifPrefsWhatsapp((p) => ({ ...p, [ev.key]: !evOnWa }))} testID={`ea-alert-wa-${ev.key}`} />
                          </View>
                        );
                      })}
                    </>
                  ) : (
                    <Text style={styles.levelNote}>Notifications are off for this person.</Text>
                  )
                )}
              </View>
            )}
          </View>
        );
      })}

      <Text style={styles.foot}>Turning a module off removes its alerts too — nobody gets notified about something they can&apos;t open.</Text>

      <Pressable onPress={onSave} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]} testID="ea-save">
        {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveBtnText}>Save changes</Text>}
      </Pressable>
    </>
  );
}

function ChannelChip({ icon, on, onPress, testID }: { icon: keyof typeof Ionicons.glyphMap; on: boolean; onPress: () => void; testID?: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable onPress={onPress} style={[styles.channelChip, on && styles.channelChipOn]} testID={testID}>
      <Ionicons name={icon} size={13} color={on ? colors.brandSecondary : colors.mutedText} />
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  masterCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  masterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  masterTitle: { color: colors.onSurface, fontSize: 14.5, fontWeight: '600' },
  masterSub: { color: colors.mutedText, fontSize: 11.5, marginTop: 2 },

  groupLabel: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginTop: spacing.lg, marginBottom: spacing.sm },

  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm, overflow: 'hidden' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  modIcon: { width: 30, height: 30, borderRadius: 8, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  modTitle: { color: colors.onSurface, fontSize: 15, fontWeight: '600' },
  modSub: { color: colors.mutedText, fontSize: 12, marginTop: 1 },

  cardBody: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider, padding: spacing.md, gap: 4 },
  levelRow: { flexDirection: 'row', backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, padding: 3, gap: 2 },
  levelBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.sm },
  levelBtnOn: { backgroundColor: colors.surface },
  levelBtnText: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: '600' },
  levelBtnTextOn: { color: colors.onSurface, fontWeight: '700' },
  levelNote: { color: colors.mutedText, fontSize: 12, marginTop: 6, marginBottom: 6 },

  subLabel: { color: colors.mutedText, fontSize: 11.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: spacing.sm, marginBottom: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  chipOn: { backgroundColor: colors.brandTertiary },
  chipText: { color: colors.mutedText, fontSize: 12, fontWeight: '600' },
  chipTextOn: { color: colors.brandSecondary },

  folderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  folderLabel: { flex: 1, color: colors.onSurface, fontSize: 13.5 },
  seeDoneRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider, marginTop: 2 },

  alertsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  channelIcons: { flexDirection: 'row', gap: 10, paddingRight: 4 },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  alertLabel: { flex: 1, color: colors.onSurface, fontSize: 13, lineHeight: 17 },
  channelChip: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceTertiary },
  channelChipOn: { backgroundColor: colors.brandTertiary },

  foot: { color: colors.mutedText, fontSize: 11.5, marginTop: spacing.sm, lineHeight: 16 },

  saveBtn: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg },
  saveBtnText: { color: colors.onBrandPrimary, fontSize: 14, fontWeight: '700' },
});
