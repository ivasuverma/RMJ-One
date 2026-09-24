import { useMemo, useState } from 'react';
import { View, Text, Pressable, Switch, StyleSheet, LayoutAnimation, Platform, UIManager } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { AccessEditor } from '@/src/hooks/use-access-editor';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
function animateNext() {
  try { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); } catch { /* web: no-op */ }
}

// Content-only building blocks (no card/heading chrome — callers wrap these
// in whatever container matches their own screen: a tabbed detail card on
// the employee profile, a titled Section card on the staff-login editor).

// Only owner/admin accounts ever receive an `admin_only` event (see
// server.py's NOTIFICATION_SCRIPTS) — showing that toggle to anyone else
// would be a switch that visibly does nothing, so it's filtered out per the
// account being edited rather than shown identically to everyone.
function canReceiveAdminOnly(role?: string) {
  return role === 'owner' || role === 'admin';
}

export function NotificationsSection({ editor, testIdPrefix }: { editor: AccessEditor; testIdPrefix: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const {
    acc, notifOn, setNotifOn, notifModules, notifPrefs, setNotifPrefs, notifPrefsWhatsapp, setNotifPrefsWhatsapp,
  } = editor;
  const canAdminOnly = canReceiveAdminOnly(acc?.role);
  // Collapsed by default — a module's detail (its individual events) is a
  // drill-down, not something shown all at once for every category, the
  // way an iOS grouped settings list works. Presentation-only, not saved.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (key: string) => {
    animateNext();
    setExpanded((p) => {
      const n = new Set(p);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  };

  return (
    <>
      <View style={styles.masterRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.switchTitle}>Allow notifications</Text>
          <Text style={styles.switchSub}>Push, in-app &amp; WhatsApp alerts for this person</Text>
        </View>
        <Switch value={notifOn} onValueChange={setNotifOn} trackColor={{ true: colors.brandPrimary, false: colors.border }} thumbColor={colors.surface} {...({ activeThumbColor: colors.surface } as object)} testID={`${testIdPrefix}-notif-master`} />
      </View>
      {notifOn && !acc?.mobile && (
        <Text style={styles.mobileHint}>No mobile number saved for this person — the WhatsApp switches below won&apos;t deliver anything until one is added.</Text>
      )}

      {notifOn && (
        <>
          <View style={styles.channelHeadRow}>
            <View style={{ flex: 1 }} />
            <Ionicons name="notifications-outline" size={13} color={colors.mutedText} style={styles.channelHeadIcon} />
            <Ionicons name="logo-whatsapp" size={13} color={colors.mutedText} style={styles.channelHeadIcon} />
          </View>

          <View style={styles.group}>
            {notifModules.map((nm, i) => {
              const on = notifPrefs[nm.key] !== false;
              const onWa = notifPrefsWhatsapp[nm.key] !== false;
              const allEvents = nm.events || [];
              // Hide events that can never fire for this account — and if
              // EVERY event under this module is one of those (e.g. Tasks/
              // Payroll/Cash Book for a regular employee — every event they
              // carry is admin_only), the whole module row does nothing for
              // this account either, so skip rendering it entirely rather
              // than show switches with no effect.
              const events = canAdminOnly ? allEvents : allEvents.filter((ev) => !ev.admin_only);
              if (allEvents.length > 0 && events.length === 0) return null;
              const isOpen = expanded.has(nm.key);
              const canExpand = events.length > 0;
              return (
                <View key={nm.key} style={[styles.moduleRow, i > 0 && styles.moduleRowDivider]}>
                  <View style={styles.moduleHeaderRow}>
                    <Pressable
                      onPress={() => canExpand && toggleExpanded(nm.key)}
                      disabled={!canExpand}
                      style={styles.moduleLabelTap}
                      hitSlop={6}
                      testID={`${testIdPrefix}-notif-expand-${nm.key}`}
                    >
                      <Ionicons
                        name={canExpand ? (isOpen ? 'chevron-down' : 'chevron-forward') : 'remove'}
                        size={15}
                        color={canExpand ? colors.mutedText : 'transparent'}
                        style={styles.chevron}
                      />
                      <Text style={styles.notifModLabel} numberOfLines={1}>{nm.label}</Text>
                    </Pressable>
                    <Switch
                      value={on}
                      onValueChange={(v) => setNotifPrefs((p) => ({ ...p, [nm.key]: v }))}
                      trackColor={{ true: colors.brandPrimary, false: colors.border }}
                      thumbColor={colors.surface} {...({ activeThumbColor: colors.surface } as object)}
                      style={styles.channelSwitch}
                      testID={`${testIdPrefix}-notif-${nm.key}`}
                    />
                    <Switch
                      value={onWa}
                      onValueChange={(v) => setNotifPrefsWhatsapp((p) => ({ ...p, [nm.key]: v }))}
                      trackColor={{ true: colors.brandPrimary, false: colors.border }}
                      thumbColor={colors.surface} {...({ activeThumbColor: colors.surface } as object)}
                      style={styles.channelSwitch}
                      testID={`${testIdPrefix}-notif-wa-${nm.key}`}
                    />
                  </View>
                  {isOpen && (
                    <View style={styles.eventList}>
                      {events.map((ev) => {
                        // Unset (never individually toggled) visually inherits
                        // the module's own current state for that same
                        // channel — toggling it pins an explicit override for
                        // just this one event, independently per channel.
                        const evOn = ev.key in notifPrefs ? notifPrefs[ev.key] !== false : on;
                        const evOnWa = ev.key in notifPrefsWhatsapp ? notifPrefsWhatsapp[ev.key] !== false : onWa;
                        return (
                          <View key={ev.key} style={styles.eventRow}>
                            <Text style={styles.eventText}>{ev.label}</Text>
                            <Switch
                              value={evOn}
                              onValueChange={(v) => setNotifPrefs((p) => ({ ...p, [ev.key]: v }))}
                              trackColor={{ true: colors.brandPrimary, false: colors.border }}
                              thumbColor={colors.surface} {...({ activeThumbColor: colors.surface } as object)}
                              style={styles.eventSwitch}
                              testID={`${testIdPrefix}-notif-${ev.key}`}
                            />
                            <Switch
                              value={evOnWa}
                              onValueChange={(v) => setNotifPrefsWhatsapp((p) => ({ ...p, [ev.key]: v }))}
                              trackColor={{ true: colors.brandPrimary, false: colors.border }}
                              thumbColor={colors.surface} {...({ activeThumbColor: colors.surface } as object)}
                              style={styles.eventSwitch}
                              testID={`${testIdPrefix}-notif-wa-${ev.key}`}
                            />
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </>
      )}
    </>
  );
}

export function AccessSection({ editor, testIdPrefix }: { editor: AccessEditor; testIdPrefix: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const {
    isOwner, isEmployee, availableModules, mods, toggleMod, rights, toggleRight,
    counters, counterSel, toggleCounter, docCats, docRights, toggleDoc, seeDone, setSeeDone,
  } = editor;

  if (isOwner) {
    return <Text style={styles.ownerNote}>The owner always has full access to every module and document. There&apos;s nothing to restrict here.</Text>;
  }

  return (
    <>
      {availableModules.map((m) => {
        const on = mods.has(m.key);
        const showRights = on && m.employee_assignable && isEmployee;
        const r = rights[m.key] || {};
        return (
          <View key={m.key}>
            <Pressable onPress={() => toggleMod(m.key)} style={styles.modRow} testID={`${testIdPrefix}-mod-${m.key}`}>
              <View style={[styles.checkbox, on && styles.checkboxOn]}>{on && <Ionicons name="checkmark" size={13} color={colors.onBrandPrimary} />}</View>
              <Text style={styles.modLabel}>{m.label}</Text>
            </Pressable>
            {showRights && (
              <View style={styles.chipRow}>
                <Pressable onPress={() => toggleRight(m.key, 'edit')} style={[styles.chip, r.edit && styles.chipOn]} testID={`${testIdPrefix}-edit-${m.key}`}>
                  <Ionicons name={r.edit ? 'checkmark-circle' : 'ellipse-outline'} size={13} color={r.edit ? colors.onBrandPrimary : colors.mutedText} />
                  <Text style={[styles.chipText, r.edit && styles.chipTextOn]}>Edit</Text>
                </Pressable>
                <Pressable onPress={() => toggleRight(m.key, 'delete')} style={[styles.chip, r.delete && styles.chipOn]} testID={`${testIdPrefix}-delete-${m.key}`}>
                  <Ionicons name={r.delete ? 'checkmark-circle' : 'ellipse-outline'} size={13} color={r.delete ? colors.onBrandPrimary : colors.mutedText} />
                  <Text style={[styles.chipText, r.delete && styles.chipTextOn]}>Delete</Text>
                </Pressable>
              </View>
            )}
            {on && m.key === 'cash_book' && isEmployee && (
              <View style={styles.countersBox}>
                <Text style={styles.countersLabel}>{counters.length === 0 ? 'No Cash Book counters yet' : 'Counters this person can see'}</Text>
                <View style={styles.chipRow}>
                  {counters.map((c) => {
                    const con = counterSel.has(c.id);
                    return (
                      <Pressable key={c.id} onPress={() => toggleCounter(c.id)} style={[styles.chip, con && styles.chipOn]} testID={`${testIdPrefix}-counter-${c.id}`}>
                        <Ionicons name={con ? 'checkmark-circle' : 'ellipse-outline'} size={13} color={con ? colors.onBrandPrimary : colors.mutedText} />
                        <Text style={[styles.chipText, con && styles.chipTextOn]}>{c.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}
          </View>
        );
      })}

      {mods.has('documents') && docCats.length > 0 && (
        <View style={styles.docBlock}>
          <Text style={styles.docBlockTitle}>Documents — folder access</Text>
          {docCats.map((dc) => {
            const dr = docRights[dc.key] || {};
            return (
              <View key={dc.key} style={styles.docRow}>
                <Text style={styles.docLabel} numberOfLines={1}>{dc.label}</Text>
                <Pressable onPress={() => toggleDoc(dc.key, 'view')} style={[styles.chip, dr.view && styles.chipOn]} testID={`${testIdPrefix}-docview-${dc.key}`}>
                  <Ionicons name={dr.view ? 'checkmark-circle' : 'ellipse-outline'} size={13} color={dr.view ? colors.onBrandPrimary : colors.mutedText} />
                  <Text style={[styles.chipText, dr.view && styles.chipTextOn]}>Snap</Text>
                </Pressable>
                <Pressable onPress={() => toggleDoc(dc.key, 'record')} style={[styles.chip, dr.record && styles.chipOn]} testID={`${testIdPrefix}-docrec-${dc.key}`}>
                  <Ionicons name={dr.record ? 'checkmark-circle' : 'ellipse-outline'} size={13} color={dr.record ? colors.onBrandPrimary : colors.mutedText} />
                  <Text style={[styles.chipText, dr.record && styles.chipTextOn]}>Record</Text>
                </Pressable>
              </View>
            );
          })}
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.switchTitle}>See &quot;Done&quot; folder</Text>
              <Text style={styles.switchSub}>Browse filed documents</Text>
            </View>
            <Switch value={seeDone} onValueChange={setSeeDone} trackColor={{ true: colors.brandPrimary, false: colors.border }} thumbColor={colors.surface} {...({ activeThumbColor: colors.surface } as object)} testID={`${testIdPrefix}-seedone`} />
          </View>
          <Text style={styles.docHint}>Leave every category unchecked to fall back to this person&apos;s role defaults.</Text>
        </View>
      )}
    </>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  switchTitle: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  switchSub: { color: colors.mutedText, fontSize: 11.5, marginTop: 2 },
  notifModLabel: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 14 },
  masterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 8 },
  mobileHint: { color: colors.mutedText, fontSize: 11.5, lineHeight: 16, paddingBottom: 4 },
  channelHeadRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: 4, paddingBottom: 2 },
  channelHeadIcon: { width: 40, textAlign: 'center' },

  // The module list reads as one rounded "grouped table" card (iOS Settings
  // style) rather than a flat list of individually-bordered rows — each
  // module is a drill-down row inside it, not its own standalone card.
  group: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  moduleRow: { paddingHorizontal: spacing.md },
  moduleRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  moduleHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 46 },
  moduleLabelTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12 },
  chevron: { width: 15 },
  channelSwitch: { transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] },

  eventList: { paddingLeft: 21, paddingBottom: 12, gap: 9 },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eventText: { color: colors.mutedText, fontSize: 12.5, flex: 1 },
  eventSwitch: { transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] },

  modRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 9 },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  checkboxOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  modLabel: { color: colors.onSurface, fontSize: 14.5 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingLeft: 28, paddingBottom: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.mutedText, fontSize: 11, fontWeight: '600' },
  chipTextOn: { color: colors.onBrandPrimary },
  countersBox: { paddingLeft: 28, paddingBottom: 6 },
  countersLabel: { color: colors.mutedText, fontSize: 11, fontWeight: '600', marginBottom: 6 },

  docBlock: { marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
  docBlockTitle: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: '800', marginBottom: spacing.sm },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  docLabel: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 14 },
  docHint: { color: colors.mutedText, fontSize: 11, marginTop: 6, lineHeight: 15 },

  ownerNote: { color: colors.mutedText, fontSize: 13, lineHeight: 19 },
});
