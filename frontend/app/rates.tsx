import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Image, Platform, Linking } from 'react-native';
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

const REFRESH_MS = 60000;
const STORE_PHONE = '+919781800888';
const WHATSAPP_CHANNEL_URL = 'https://whatsapp.com/channel/0029VbBHBNPEKyZB1820vR3n';

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
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const router = useRouter();
  // Signed in (staff/owner opening it from the dashboard) vs. a customer on the public link.
  const internal = !!user;
  const isAdmin = user?.role === 'owner' || user?.role === 'admin';

  const [data, setData] = useState<PublicRates | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fetchingNew, setFetchingNew] = useState(false);
  const [purities, setPurities] = useState<Purity[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<PublicRates>('/public/rates');
      setData(res);
      setError('');
      // Signed-in staff also see 22K / 18K / 14K (Rate Master percentages of
      // the same live rate); the public page stays 24K + silver only.
      if (user) api.get<{ items: Purity[] }>('/rate-master/live').then((r) => setPurities(r.items)).catch(() => {});
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
      await api.post('/settings/gold-rate/refetch');
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
            <View style={{ width: 40 }} />
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
              </View>

              {purities.some((p) => p.sell) && (
                <View style={styles.metalCard} testID="rate-purities">
                  <Text style={styles.metalLabel}>GOLD PURITIES <Text style={styles.metalSub}>· per 10g</Text></Text>
                  <View style={styles.purityHead}>
                    <Text style={[styles.buySellLabel, { flex: 1.2, textAlign: 'left' }]}>Purity</Text>
                    <Text style={[styles.buySellLabel, styles.purityCol]}>Sell</Text>
                    <Text style={[styles.buySellLabel, styles.purityCol]}>Buyback</Text>
                  </View>
                  {purities.filter((p) => p.sell).map((p) => (
                    <View key={p.key} style={styles.purityRow} testID={`rate-${p.key}`}>
                      <View style={{ flex: 1.2 }}>
                        <Text style={styles.purityName}>{p.label.replace(/^Gold\s+/i, '')}</Text>
                        <Text style={styles.purityPct}>{p.percent}%</Text>
                      </View>
                      <Text style={[styles.purityVal, styles.purityCol, styles.sellValue]}>{fmtINR(p.sell)}</Text>
                      <Text style={[styles.purityVal, styles.purityCol]}>{fmtINR(p.buy)}</Text>
                    </View>
                  ))}
                </View>
              )}

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
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
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

  metalRow: { gap: spacing.md, marginBottom: spacing.md },
  metalCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg,
  },
  metalLabel: {
    color: colors.brandSecondary, fontSize: typography.label.fontSize, fontWeight: typography.label.fontWeight,
    letterSpacing: typography.label.letterSpacing, marginBottom: spacing.md,
  },
  metalSub: { color: colors.mutedText, fontWeight: '600' },
  buySellRow: { flexDirection: 'row', alignItems: 'center' },
  buySellCol: { flex: 1, alignItems: 'center' },
  buySellDivider: { width: 1, height: 44, backgroundColor: colors.divider },
  buySellLabel: { color: colors.onSurfaceSecondary, fontSize: typography.caption.fontSize, fontWeight: '600', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 },
  buySellValue: {
    color: colors.onSurface, fontFamily: fonts.display, fontSize: 24, fontWeight: '800', letterSpacing: -0.4,
  },
  sellValue: { color: colors.brandPrimary },
  purityHead: { flexDirection: 'row', alignItems: 'center', paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.divider },
  purityRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.divider },
  purityCol: { flex: 1, textAlign: 'center' },
  purityName: { color: colors.onSurface, fontSize: 16, fontWeight: '800' },
  purityPct: { color: colors.mutedText, fontSize: 11, marginTop: 1 },
  purityVal: { color: colors.onSurface, fontFamily: fonts.display, fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  backBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  compactHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  compactTitle: { flex: 1, textAlign: 'center', color: colors.onSurface, fontFamily: fonts.display, fontSize: 20, fontWeight: '700' },

  spotRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  spotTile: {
    flex: 1, backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing.md, paddingHorizontal: spacing.sm, alignItems: 'center',
  },
  spotLabel: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  spotValue: { color: colors.onSurface, fontFamily: fonts.display, fontSize: 16, fontWeight: '700', marginTop: 4 },
  spotUnit: { color: colors.mutedText, fontSize: 11, marginTop: 2 },
  spotDisclaimer: { color: colors.mutedText, fontSize: 11, textAlign: 'center', marginBottom: spacing.lg, lineHeight: 14 },

  statusRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', columnGap: spacing.md, rowGap: 6, marginBottom: spacing.md },
  updatedText: { color: colors.onSurface, fontSize: 14, fontWeight: '800' },
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
  disclaimerBox: { paddingTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.divider },
  disclaimerText: { color: colors.mutedText, fontSize: 11, lineHeight: 16, textAlign: 'center' },
});
