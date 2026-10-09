import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { GlassButton } from '@/src/components/ui/GlassButton';

type WhatsAppStatus = { configured: boolean; connected: boolean; phone: string | null };

export default function WhatsAppSettingsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [loading, setLoading] = useState(true);


  const load = async () => {
    try {
      const w = await api.get<any>('/settings/whatsapp');
      setStatus({ configured: !!w.configured, connected: !!w.connected, phone: w.phone || null });
    } catch (_e) { /* ignore — form stays at defaults */ }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.header}>
          <GlassButton onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </GlassButton>
          <View style={{ flex: 1 }} />
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.centered}><ActivityIndicator color={colors.brandPrimary} size="large" /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="whatsapp-settings-screen">
      <View style={styles.header}>
        <GlassButton onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </GlassButton>
        <Text style={styles.title}>WhatsApp</Text>
        <GlassButton onPress={load} style={styles.iconBtn} testID="whatsapp-refresh-btn" hitSlop={12} accessibilityRole="button" accessibilityLabel="Refresh">
          <Ionicons name="refresh" size={18} color={colors.onSurface} />
        </GlassButton>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <View style={[styles.infoBox, status?.connected ? styles.infoBoxOk : styles.infoBoxWarn]} testID="whatsapp-status">
          <Ionicons name={status?.connected ? 'logo-whatsapp' : 'alert-circle-outline'} size={18} color={status?.connected ? colors.onSuccess : colors.onWarning} />
          <Text style={[styles.infoText, { color: status?.connected ? colors.onSuccess : colors.onWarning }]}>
            {status === null ? 'Checking connection…'
              : !status.configured ? 'WhatsApp gateway not configured on the server.'
              : status.connected ? `Connected — sending as ${status.phone}`
              : 'Gateway configured but not connected — scan the QR again in the WhatsApp dashboard.'}
          </Text>
        </View>

        <Pressable onPress={() => router.push('/settings/whatsapp-templates' as any)} style={styles.navRow} testID="whatsapp-templates-link">
          <View style={styles.navIcon}><Ionicons name="document-text-outline" size={20} color={colors.brandSecondary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleLabel}>Message Templates</Text>
            <Text style={styles.toggleSub}>Repair notices, chatbot RATE reply, rate channel post and the Message Broadcast message</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
        </Pressable>

        <Pressable onPress={() => router.push('/settings/whatsapp-messages' as any)} style={styles.navRow} testID="whatsapp-messages-link">
          <View style={styles.navIcon}><Ionicons name="list-outline" size={20} color={colors.brandSecondary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleLabel}>Sent Messages Log</Text>
            <Text style={styles.toggleSub}>Every WhatsApp send — shop number and broadcasts — with real delivery status</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
        </Pressable>

        {/* On/off for every message type is on the Notifications page (General), so it has one switch. */}
        <Pressable onPress={() => router.push('/settings/notifications' as any)} style={styles.navRow} testID="whatsapp-switches-link">
          <View style={styles.navIcon}><Ionicons name="toggle-outline" size={20} color={colors.brandSecondary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleLabel}>Turn messages on or off</Text>
            <Text style={styles.toggleSub}>WhatsApp on/off, customer repair messages and auto-replies are in Settings › Notifications › General</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
        </Pressable>

        {/* The official Meta number sends only Message Broadcast messages (when "Official (Meta)" is picked there). */}
        <Text style={styles.groupTitle}>Official number (Meta)</Text>
        <Pressable onPress={() => router.push('/settings/rate-broadcast/number' as any)} style={styles.navRow} testID="whatsapp-meta-link">
          <View style={styles.navIcon}><Ionicons name="shield-checkmark-outline" size={20} color={colors.brandSecondary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleLabel}>Official number</Text>
            <Text style={styles.toggleSub}>Connection, health, messages from Meta and the website sign-up link</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
        </Pressable>
        <Pressable onPress={() => router.push('/settings/rate-broadcast/templates' as any)} style={styles.navRow} testID="whatsapp-meta-templates-link">
          <View style={styles.navIcon}><Ionicons name="document-text-outline" size={20} color={colors.brandSecondary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleLabel}>Meta templates</Text>
            <Text style={styles.toggleSub}>The rate update template and your own offer templates, sent for Meta approval</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
        </Pressable>

        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={16} color={colors.brandSecondary} />
          <Text style={styles.infoText}>Message wording is in WhatsApp Templates; switching each message on or off is in Notifications › General.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  centered: { flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  title: { flex: 1, color: colors.onSurface, fontSize: 22, fontWeight: '600', fontFamily: fonts.display },
  groupTitle: { color: colors.mutedText, fontSize: 13, fontWeight: '600', marginTop: spacing.md, marginBottom: spacing.sm },
  navRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, marginBottom: spacing.lg,
  },
  navIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  groupCard: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.lg,
  },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  groupHeaderIcon: { width: 32, height: 32, borderRadius: 9, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  groupHeaderTitle: { color: colors.onSurface, fontSize: 15, fontWeight: '700', fontFamily: fonts.display },
  groupDivider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.md },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md,
  },
  toggleLabel: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  toggleSub: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  toggleRowWarn: { borderColor: colors.warning },
  keywordToggle: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md,
  },
  switchKnobOn: { backgroundColor: colors.onBrandPrimary, transform: [{ translateX: 18 }] },
  infoBox: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
  },
  infoBoxOk: { backgroundColor: colors.success, borderColor: colors.success },
  infoBoxWarn: { backgroundColor: colors.warning, borderColor: colors.warning },
  infoText: { color: colors.onSurfaceTertiary, fontSize: 12, flex: 1 },
  hint: { color: colors.mutedText, fontSize: 12, marginBottom: spacing.md },
  fieldLabel: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  row2: { flexDirection: 'row', gap: spacing.sm },
  input: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14, marginBottom: spacing.md,
  },
  altBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12,
    borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
  },
  altBtnText: { color: colors.brandSecondary, fontSize: 13.5, fontWeight: '700' },
});
