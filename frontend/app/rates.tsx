import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Image, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api/client';
import { istTime } from '@/src/utils/datetime';
import { spacing, radius, fonts, typography, images, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useAuth } from '@/src/auth/AuthContext';
import { useRouter } from 'expo-router';
import { RatesInstallHint } from '@/src/components/RatesInstallHint';
import { StickyHeader, useScrolled } from '@/src/components/ui/StickyHeader';
import { storage } from '@/src/utils/storage';
import { Sheet, Input, Button, useToast } from '@/src/components/ui';

type PublicRates = {
  store_name: string;
  fetched_at: string | null;
  gold_sell: number | null;
  gold_buy: number | null;
  silver_sell: number | null;
  silver_buy: number | null;
  xau_usd: number | null;
  xag_usd: number | null;
  usd_inr: number | null;
};
type Purity = { key: string; label: string; percent: number; sell: number | null; buy: number | null };
type Contact = { name: string; phone: string };

const REFRESH_MS = 60000;
const STORE_PHONE = '+919781800888';
const WHATSAPP_CHANNEL_URL = 'https://whatsapp.com/channel/0029VbBHBNPEKyZB1820vR3n';
const SOURCE_URL = 'https://ayodhyabullion.com';
// Ayodhya Bullion's own app, which the rates come from. A web page can't start an
// app that hasn't published a link for itself, so: iPhone → its App Store page
// (tap Open there); Android → ask Android to open the app by package, falling back
// to its Play Store page; a computer → the website.
const AYODHYA_IOS = 'https://apps.apple.com/app/id6777993751';
const AYODHYA_ANDROID_PKG = 'com.aybullion.com';
const AYODHYA_PLAY = `https://play.google.com/store/apps/details?id=${AYODHYA_ANDROID_PKG}`;
function openAyodhyaApp() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const ios = Platform.OS === 'ios' || /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document);
  const android = Platform.OS === 'android' || /Android/i.test(ua);
  if (ios) return Linking.openURL(AYODHYA_IOS);
  if (android) {
    if (Platform.OS === 'web') {
      window.location.href = `intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=${AYODHYA_ANDROID_PKG};S.browser_fallback_url=${encodeURIComponent(AYODHYA_PLAY)};end`;
      return;
    }
    return Linking.openURL(`market://details?id=${AYODHYA_ANDROID_PKG}`).catch(() => Linking.openURL(AYODHYA_PLAY));
  }
  return Linking.openURL(SOURCE_URL);
}

// wa.me wants the number in international form, digits only; a bare 10-digit number is Indian.
const waNumber = (phone: string) => { const d = phone.replace(/\D/g, '').replace(/^0+/, ''); return d.length === 10 ? `91${d}` : d; };
const fmtINR = (n: number | null) => (n == null ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`);
const fmtUSD = (n: number | null) => (n == null ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

// Public, unauthenticated — anyone with the link sees this, no login. Reads
// GET /api/public/rates (see backend/routers/public.py), which mirrors
// gold_rate.py's gold_rate_live cache — the same scrape the WhatsApp
// broadcast and RATE chatbot already use, so this page is never a second
// source of truth. Buy = sell minus the owner's own configured spread
// (Settings > WhatsApp), independent of anything the source page shows.
export default function PublicRatesScreen() {
  const { scrolled, onScroll } = useScrolled();
  const { colors } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  // Signed in (staff/owner opening it from the dashboard) vs. a customer on the public link.
  const internal = !!user;
  const styles = useMemo(() => makeStyles(colors, internal), [colors, internal]);
  const isAdmin = user?.role === 'owner' || user?.role === 'admin';

  const [data, setData] = useState<PublicRates | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fetchingNew, setFetchingNew] = useState(false);
  const [purities, setPurities] = useState<Purity[]>([]);
  const shownPurities = purities.filter((p) => p.sell);
  const [puritiesOpen, setPuritiesOpen] = useState(false);
  useEffect(() => { storage.getItem<boolean>('rmj.rates.purities_open', false).then((v) => setPuritiesOpen(!!v)); }, []);
  const togglePurities = () => setPuritiesOpen((v) => { storage.setItem('rmj.rates.purities_open', !v); return !v; });
  // The source's own GST-inclusive bullion rates (staff only) — see fetch_gold_rate.js.
  const [gst, setGst] = useState<{ gold: number | null; silver: number | null; gold_base?: number | null } | null>(null);
  // Cash+GST: how far the source's rate with GST is above its own gold rate
  // before our margin — (rate with GST − gold rate before margin) / rate with GST × 100.
  const gstDiff = gst?.gold && gst?.gold_base ? ((gst.gold - gst.gold_base) / gst.gold) * 100 : null;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Quick-call buttons (staff only): three people the owner/admin sets up here.
  const toast = useToast();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [editing, setEditing] = useState<Contact[] | null>(null);
  const [savingContacts, setSavingContacts] = useState(false);
  useEffect(() => {
    if (user) api.get<{ items: Contact[] }>('/rate-master/contacts').then((r) => setContacts(r.items || [])).catch(() => {});
  }, [user]);
  const saveContacts = async () => {
    if (!editing) return;
    setSavingContacts(true);
    try {
      const r = await api.put<{ items: Contact[] }>('/rate-master/contacts', { items: editing });
      setContacts(r.items);
      setEditing(null);
      toast.success('Call buttons saved');
    } catch (e: any) {
      toast.error(e?.detail || 'Could not save');
    } finally {
      setSavingContacts(false);
    }
  };
  const openEditor = () => setEditing([0, 1, 2].map((i) => ({ name: contacts[i]?.name || '', phone: contacts[i]?.phone || '' })));
  const callSlots = contacts.map((c, i) => ({ ...c, i })).filter((c) => c.phone || isAdmin);

  const load = useCallback(async () => {
    try {
      const res = await api.get<PublicRates>('/public/rates');
      setData(res);
      setError('');
      // Signed-in staff also see 22K / 18K / 14K (Rate Master percentages of
      // the same live rate); the public page stays 24K + silver only.
      if (user) api.get<{ items: Purity[]; gst?: { gold: number | null; silver: number | null; gold_base?: number | null } | null }>('/rate-master/live')
        .then((r) => { setPurities(r.items); setGst(r.gst || null); }).catch(() => {});
    } catch (e: any) {
      setError(e?.detail || 'Could not load rates right now');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, REFRESH_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [load]);

  // Admin-only — triggers an actual new scrape of the source page (same as
  // Settings > Rate Master's refetch), not just a re-read of the cached
  // gold_rate_live doc like the plain Refresh button below does.
  const fetchNewRate = async () => {
    setFetchingNew(true);
    try {
      await api.post('/settings/gold-rate/refetch', undefined, true, { timeoutMs: 90000 });   // the scrape takes up to ~45s
      await load();
    } catch (e: any) {
      setError(e?.detail || 'Could not fetch a new rate');
    } finally {
      setFetchingNew(false);
    }
  };

  const updatedLabel = data?.fetched_at ? `Updated ${istTime(data.fetched_at)} IST` : null;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']} testID="public-rates-screen">
      {internal && (
        // Staff inside the app: a compact bar, pinned, instead of the customer-facing masthead.
        <StickyHeader scrolled={scrolled} style={{ paddingHorizontal: spacing.xl }}>
          <View style={[styles.compactHeader, { marginBottom: 0, maxWidth: 560, width: '100%', alignSelf: 'center' }]}>
            {router.canGoBack() ? (
              <Pressable onPress={() => router.back()} style={styles.backBtn} testID="rates-back-btn" hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
                <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
              </Pressable>
            ) : <View style={{ width: 40 }} />}
            <Text style={styles.compactTitle}>Live Rates</Text>
            {/* Opens the Ayodhya Bullion app (the source of these rates) — see openAyodhyaApp. */}
            <Pressable onPress={openAyodhyaApp} style={styles.backBtn} testID="rates-source-btn" hitSlop={12}
              accessibilityRole="link" accessibilityLabel="Open the Ayodhya Bullion app">
              <Ionicons name="open-outline" size={19} color={colors.onSurface} />
            </Pressable>
          </View>
        </StickyHeader>
      )}
      <ScrollView contentContainerStyle={[styles.scroll, internal && { paddingTop: spacing.md }]} onScroll={onScroll} scrollEventThrottle={16}>
        {!internal && (
          <>
            <View style={styles.header}>
              <Image source={images.logo} style={styles.logo} />
              <Text style={styles.storeName}>{data?.store_name || 'Ram Murti Jewellers'}</Text>
              <Text style={styles.tagline}>Live Gold &amp; Silver Rates</Text>
            </View>
            <RatesInstallHint />
          </>
        )}

        {loading ? (
          <View style={styles.loaderBox}><ActivityIndicator color={colors.brandPrimary} size="large" /></View>
        ) : (
          <>
            {/* When the rate was fetched, up top and bold — the first thing to check before quoting it. */}
            <View style={styles.statusRow}>
              {!!error && <Text style={styles.errorText}>{error}</Text>}
              {!!updatedLabel && !error && <Text style={styles.updatedText}>{updatedLabel}</Text>}
              <Pressable onPress={load} style={styles.refreshBtn} testID="rates-refresh-btn" hitSlop={10} accessibilityRole="button" accessibilityLabel="Refresh">
                <Ionicons name="refresh" size={14} color={colors.onSurfaceSecondary} />
                <Text style={styles.refreshText}>Refresh</Text>
              </Pressable>
              {isAdmin && (
                <Pressable onPress={fetchNewRate} disabled={fetchingNew} style={styles.refreshBtn} testID="rates-fetch-new-btn" hitSlop={10}>
                  {fetchingNew ? (
                    <ActivityIndicator size="small" color={colors.brandSecondary} />
                  ) : (
                    <Ionicons name="cloud-download-outline" size={14} color={colors.brandSecondary} />
                  )}
                  <Text style={[styles.refreshText, { color: colors.brandSecondary }]}>Fetch New Rate</Text>
                </Pressable>
              )}
            </View>

            <View style={styles.metalRow}>
              {/* Rate with GST — the source's "Including GST" bullion rows, as they show them. */}
              {user && gst && (gst.gold || gst.silver) ? (
                <View style={styles.metalCard} testID="rate-gst">
                  <View style={styles.gstHead}>
                    <Text style={[styles.metalLabel, { marginBottom: 0 }]}>RATE WITH GST</Text>
                    {gstDiff !== null && (
                      <Text style={styles.gstDiff} testID="rate-gst-diff">Cash+GST = {gstDiff.toFixed(2)}%</Text>
                    )}
                  </View>
                  <View style={styles.buySellRow}>
                    <View style={styles.buySellCol}>
                      <Text style={styles.buySellLabel}>Gold · 99.50%</Text>
                      <Text style={styles.buySellValue}>{gst.gold ? fmtINR(gst.gold) : '—'}</Text>
                    </View>
                    <View style={styles.buySellDivider} />
                    <View style={styles.buySellCol}>
                      <Text style={styles.buySellLabel}>Silver · 99.99%</Text>
                      <Text style={styles.buySellValue}>{gst.silver ? fmtINR(gst.silver) : '—'}</Text>
                    </View>
                  </View>
                </View>
              ) : null}

              <View style={styles.metalCard} testID="rate-gold">
                <Text style={styles.metalLabel}>GOLD <Text style={styles.metalSub}>· 995 Purity / 10g</Text></Text>
                <View style={styles.buySellRow}>
                  <View style={styles.buySellCol}>
                    <Text style={styles.buySellLabel}>Sell</Text>
                    <Text style={[styles.buySellValue, styles.sellValue]}>{fmtINR(data?.gold_sell ?? null)}</Text>
                  </View>
                  <View style={styles.buySellDivider} />
                  <View style={styles.buySellCol}>
                    <Text style={styles.buySellLabel}>Buyback</Text>
                    <Text style={styles.buySellValue}>{fmtINR(data?.gold_buy ?? null)}</Text>
                  </View>
                </View>

                {/* 22K / 18K / 14K (Rate Master) — folded into the gold card, opened on tap. */}
                {shownPurities.length > 0 && (
                  <>
                    <Pressable onPress={togglePurities} style={styles.purityToggle} hitSlop={6} testID="rate-purities-toggle"
                      accessibilityRole="button" accessibilityState={{ expanded: puritiesOpen }}>
                      <Text style={styles.purityToggleText}>{shownPurities.map((p) => p.label.replace(/^Gold\s+/i, '')).join(' · ')}</Text>
                      <Ionicons name={puritiesOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.brandSecondary} />
                    </Pressable>
                    {puritiesOpen && (
                      <View testID="rate-purities">
                        <View style={styles.purityHead}>
                          <Text style={[styles.purityHeadText, { flex: 1.1, textAlign: 'left' }]}>Purity</Text>
                          <Text style={[styles.purityHeadText, styles.purityCol]}>Sell</Text>
                          <Text style={[styles.purityHeadText, styles.purityCol]}>Buyback</Text>
                        </View>
                        {shownPurities.map((p, i) => (
                          <View key={p.key} style={[styles.purityRow, i === shownPurities.length - 1 && { borderBottomWidth: 0 }]} testID={`rate-${p.key}`}>
                            <Text style={[styles.purityName, { flex: 1.1 }]}>{p.label.replace(/^Gold\s+/i, '')} <Text style={styles.purityPct}>{p.percent}%</Text></Text>
                            <Text style={[styles.purityVal, styles.purityCol, styles.sellValue]}>{fmtINR(p.sell)}</Text>
                            <Text style={[styles.purityVal, styles.purityCol]}>{fmtINR(p.buy)}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </>
                )}
              </View>

              <View style={styles.metalCard} testID="rate-silver">
                <Text style={styles.metalLabel}>SILVER <Text style={styles.metalSub}>· 999 Purity / 1kg</Text></Text>
                <View style={styles.buySellRow}>
                  <View style={styles.buySellCol}>
                    <Text style={styles.buySellLabel}>Sell</Text>
                    <Text style={[styles.buySellValue, styles.sellValue]}>{fmtINR(data?.silver_sell ?? null)}</Text>
                  </View>
                  <View style={styles.buySellDivider} />
                  <View style={styles.buySellCol}>
                    <Text style={styles.buySellLabel}>Buyback</Text>
                    <Text style={styles.buySellValue}>{fmtINR(data?.silver_buy ?? null)}</Text>
                  </View>
                </View>
              </View>
            </View>

            <View style={styles.spotRow}>
              <View style={styles.spotTile} testID="rate-xau">
                <Text style={styles.spotLabel}>GOLD (XAU)</Text>
                <Text style={styles.spotValue}>{fmtUSD(data?.xau_usd ?? null)}</Text>
                <Text style={styles.spotUnit}>per troy oz</Text>
              </View>
              <View style={styles.spotTile} testID="rate-xag">
                <Text style={styles.spotLabel}>SILVER (XAG)</Text>
                <Text style={styles.spotValue}>{fmtUSD(data?.xag_usd ?? null)}</Text>
                <Text style={styles.spotUnit}>per troy oz</Text>
              </View>
              <View style={styles.spotTile} testID="rate-usdinr">
                <Text style={styles.spotLabel}>USD/INR</Text>
                <Text style={styles.spotValue}>{data?.usd_inr == null ? '—' : `₹${data.usd_inr.toFixed(2)}`}</Text>
                <Text style={styles.spotUnit}>spot</Text>
              </View>
            </View>
            <Text style={styles.spotDisclaimer}>
              XAU/XAG are international spot benchmarks in USD — informational only, not the local ₹ rate above.
            </Text>

            {internal && callSlots.length > 0 && (
              <View testID="rates-quick-call">
                <View style={styles.callHead}>
                  <Text style={styles.callHeadText}>QUICK CALL</Text>
                  {isAdmin && (
                    <Pressable onPress={openEditor} hitSlop={10} style={styles.refreshBtn} testID="rates-call-edit"
                      accessibilityRole="button" accessibilityLabel="Edit call buttons">
                      <Ionicons name="create-outline" size={14} color={colors.brandSecondary} />
                      <Text style={[styles.refreshText, { color: colors.brandSecondary }]}>Edit</Text>
                    </Pressable>
                  )}
                </View>
                <View style={styles.contactRow}>
                  {callSlots.map((c) => (c.phone ? (
                    // One pill per person: phone call on the left, their WhatsApp chat on the right
                    // (WhatsApp has no link that starts a call itself — the chat is one tap from it).
                    <View key={c.i} style={styles.callPill}>
                      <Pressable onPress={() => Linking.openURL(`tel:${c.phone.replace(/[^\d+]/g, '')}`)}
                        style={({ pressed }) => [styles.callBtn, pressed && { opacity: 0.7 }]} testID={`rates-call-${c.i}`}
                        accessibilityRole="button" accessibilityLabel={`Call ${c.name || c.phone}`}>
                        <Ionicons name="call" size={13} color={colors.onBrandPrimary} />
                        <Text style={styles.callBtnText} numberOfLines={2}>{c.name || c.phone}</Text>
                      </Pressable>
                      <Pressable onPress={() => Linking.openURL(`https://wa.me/${waNumber(c.phone)}`)}
                        style={({ pressed }) => [styles.callWa, pressed && { opacity: 0.7 }]} testID={`rates-wa-${c.i}`}
                        accessibilityRole="button" accessibilityLabel={`WhatsApp ${c.name || c.phone}`}>
                        <Ionicons name="logo-whatsapp" size={17} color="#FFFFFF" />
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable key={c.i} onPress={openEditor} style={[styles.contactBtn, styles.callEmpty]} testID={`rates-call-add-${c.i}`}
                      accessibilityRole="button" accessibilityLabel="Add a person to call">
                      <Ionicons name="add" size={17} color={colors.mutedText} />
                      <Text style={[styles.contactBtnText, { color: colors.mutedText }]}>Add</Text>
                    </Pressable>
                  )))}
                </View>
              </View>
            )}

          </>
        )}

        {/* Customer-facing contact buttons and fine print — not shown to staff in the app. */}
        {!internal && (<>
        <View style={styles.contactRow}>
          <Pressable
            onPress={() => Linking.openURL(`tel:${STORE_PHONE}`)}
            style={styles.contactBtn}
            testID="rates-call-btn"
          >
            <Ionicons name="call-outline" size={17} color={colors.onSurface} />
            <Text style={styles.contactBtnText}>Call Us</Text>
          </Pressable>
          <Pressable
            onPress={() => Linking.openURL(`https://wa.me/${STORE_PHONE.replace('+', '')}?text=${encodeURIComponent('RATE')}`)}
            style={styles.contactBtn}
            testID="rates-whatsapp-btn"
          >
            <Ionicons name="logo-whatsapp" size={17} color={colors.onSurface} />
            <Text style={styles.contactBtnText}>WhatsApp</Text>
          </Pressable>
          <Pressable
            onPress={() => Linking.openURL(WHATSAPP_CHANNEL_URL)}
            style={styles.contactBtn}
            testID="rates-channel-btn"
          >
            <Ionicons name="megaphone-outline" size={17} color={colors.onSurface} />
            <Text style={styles.contactBtnText}>Daily Rate Channel</Text>
          </Pressable>
        </View>

        <View style={styles.disclaimerBox}>
          <Text style={styles.disclaimerText}>
            Rates shown are indicative and for reference only, and may change without notice through the day. They
            exclude making charges, wastage and GST, and do not constitute a firm offer to buy or sell. The rate
            applicable to any transaction is the one in effect at {data?.store_name || 'Ram Murti Jewellers'} at the
            time of billing, not the rate last shown here. Buyback is offered only on items purchased from{' '}
            {data?.store_name || 'Ram Murti Jewellers'}, subject to purity verification and our buyback policy at
            the time. Please confirm the final rate and terms with us before any transaction.
          </Text>
        </View>
        </>)}
      </ScrollView>

      <Sheet visible={!!editing} onClose={() => setEditing(null)} title="Quick call buttons" testID="rates-call-sheet">
        <Text style={styles.sheetHint}>Up to three people staff can call in one tap from Live Rates. Leave a row empty to hide its button.</Text>
        {editing?.map((c, i) => (
          <View key={i} style={styles.sheetRow}>
            <View style={{ flex: 1 }}>
              <Input label={`Person ${i + 1}`} value={c.name} placeholder="Name" maxLength={30} testID={`rates-call-name-${i}`}
                onChangeText={(v) => setEditing((e) => e && e.map((x, j) => (j === i ? { ...x, name: v } : x)))} />
            </View>
            <View style={{ flex: 1.2 }}>
              <Input label="Phone" value={c.phone} placeholder="+91 98765 43210" keyboardType="phone-pad" maxLength={20} testID={`rates-call-phone-${i}`}
                onChangeText={(v) => setEditing((e) => e && e.map((x, j) => (j === i ? { ...x, phone: v } : x)))} />
            </View>
          </View>
        ))}
        <View style={{ marginTop: spacing.md }}>
          <Button label="Save" onPress={saveContacts} loading={savingContacts} testID="rates-call-save" />
        </View>
      </Sheet>
    </SafeAreaView>
  );
}

// `compact`: the staff view — smaller type and padding so the whole board fits on one phone screen.
const makeStyles = (colors: ThemeColors, compact: boolean) => {
  const c = <T,>(full: T, small: T): T => (compact ? small : full);
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.xl, paddingBottom: spacing.xxxl, maxWidth: 560, width: '100%', alignSelf: 'center' },
  header: { alignItems: 'center', marginBottom: spacing.xxl },
  logo: { width: 56, height: 56, borderRadius: radius.lg, marginBottom: spacing.md },
  storeName: {
    color: colors.onSurface, fontFamily: fonts.display, textAlign: 'center',
    fontSize: typography.h1.fontSize, fontWeight: typography.h1.fontWeight,
    letterSpacing: typography.h1.letterSpacing, lineHeight: typography.h1.lineHeight,
  },
  tagline: { color: colors.onSurfaceSecondary, fontSize: typography.body.fontSize, marginTop: 2 },

  loaderBox: { paddingVertical: spacing.xxxl, alignItems: 'center' },

  metalRow: { gap: c(spacing.md, spacing.sm), marginBottom: c(spacing.md, spacing.sm) },
  metalCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: c(spacing.lg, spacing.md),
  },
  metalLabel: {
    color: colors.brandSecondary, fontSize: typography.label.fontSize, fontWeight: typography.label.fontWeight,
    letterSpacing: typography.label.letterSpacing, marginBottom: c(spacing.md, spacing.sm),
  },
  metalSub: { color: colors.mutedText, fontWeight: '600' },
  buySellRow: { flexDirection: 'row', alignItems: 'center' },
  buySellCol: { flex: 1, alignItems: 'center' },
  buySellDivider: { width: 1, height: c(44, 36), backgroundColor: colors.divider },
  buySellLabel: { color: colors.onSurfaceSecondary, fontSize: c(typography.caption.fontSize, 11), fontWeight: '600', marginBottom: c(4, 2), textTransform: 'uppercase', letterSpacing: 0.4 },
  buySellValue: {
    color: colors.onSurface, fontFamily: fonts.display, fontSize: c(24, 19), fontWeight: '800', letterSpacing: -0.4,
  },
  gstHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginBottom: c(spacing.md, spacing.sm) },
  gstDiff: { color: colors.onSurfaceSecondary, fontSize: c(12.5, 11.5), fontWeight: '800' },
  sellValue: { color: colors.brandPrimary },
  purityToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: c(spacing.md, spacing.sm), paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider,
  },
  purityToggleText: { color: colors.brandSecondary, fontSize: c(13, 12), fontWeight: '700', letterSpacing: 0.3 },
  purityHead: { flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: colors.divider },
  purityHeadText: { color: colors.mutedText, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  purityRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: c(7, 5), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  purityCol: { flex: 1, textAlign: 'center' },
  purityName: { color: colors.onSurface, fontSize: c(14, 13), fontWeight: '800' },
  purityPct: { color: colors.mutedText, fontSize: 11, fontWeight: '600' },
  purityVal: { color: colors.onSurface, fontFamily: fonts.display, fontSize: c(15, 14), fontWeight: '800', letterSpacing: -0.2 },
  backBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  compactHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  compactTitle: { flex: 1, textAlign: 'center', color: colors.onSurface, fontFamily: fonts.display, fontSize: 20, fontWeight: '700' },

  spotRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: c(spacing.lg, spacing.sm) },
  spotTile: {
    flex: 1, backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingVertical: c(spacing.md, spacing.sm), paddingHorizontal: spacing.sm, alignItems: 'center',
  },
  spotLabel: { color: colors.onSurfaceTertiary, fontSize: c(11, 10), fontWeight: '700', letterSpacing: 0.4 },
  spotValue: { color: colors.onSurface, fontFamily: fonts.display, fontSize: c(16, 14), fontWeight: '700', marginTop: c(4, 2) },
  spotUnit: { color: colors.mutedText, fontSize: c(11, 10), marginTop: c(2, 0) },
  spotDisclaimer: { color: colors.mutedText, fontSize: c(11, 10), textAlign: 'center', marginBottom: c(spacing.lg, spacing.md), lineHeight: 14 },

  statusRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', columnGap: spacing.md, rowGap: 6, marginBottom: c(spacing.md, spacing.sm) },
  updatedText: { color: colors.onSurface, fontSize: c(14, 13), fontWeight: '800' },
  errorText: { color: colors.onError, fontSize: typography.caption.fontSize },
  refreshBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  refreshText: { color: colors.onSurfaceSecondary, fontSize: typography.caption.fontSize, fontWeight: '600' },

  contactRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  contactBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingVertical: 12, paddingHorizontal: 8,
  },
  contactBtnText: { color: colors.onSurface, fontSize: 12.5, fontWeight: '700', textAlign: 'center' },
  callHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  callHeadText: { color: colors.brandSecondary, fontSize: typography.label.fontSize, fontWeight: typography.label.fontWeight, letterSpacing: typography.label.letterSpacing },
  callPill: { flex: 1, flexDirection: 'row', borderRadius: radius.md, overflow: 'hidden', minHeight: 44 },
  callBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    backgroundColor: colors.brandPrimary, paddingVertical: 6, paddingHorizontal: 5,
  },
  callWa: { width: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: '#25D366' },
  callBtnText: { color: colors.onBrandPrimary, fontSize: 12, fontWeight: '800', flexShrink: 1, textAlign: 'center' },
  callEmpty: { borderStyle: 'dashed' },
  sheetHint: { color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 18, marginBottom: spacing.md },
  sheetRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  disclaimerBox: { paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.divider },
  disclaimerText: { color: colors.mutedText, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  });
};
