import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Image, Platform, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api/client';
import { istTime } from '@/src/utils/datetime';
import { spacing, radius, fonts, typography, images, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useAuth } from '@/src/auth/AuthContext';

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
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const isAdmin = user?.role === 'owner' || user?.role === 'admin';

  const [data, setData] = useState<PublicRates | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fetchingNew, setFetchingNew] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<PublicRates>('/public/rates');
      setData(res);
      setError('');
    } catch (e: any) {
      setError(e?.detail || 'Could not load rates right now');
    } finally {
      setLoading(false);
    }
  }, []);

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
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Image source={images.logo} style={styles.logo} />
          <Text style={styles.storeName}>{data?.store_name || 'Ram Murti Jewellers'}</Text>
          <Text style={styles.tagline}>Live Gold &amp; Silver Rates</Text>
        </View>

        {loading ? (
          <View style={styles.loaderBox}><ActivityIndicator color={colors.brandPrimary} size="large" /></View>
        ) : (
          <>
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

            <View style={styles.statusRow}>
              {!!error && <Text style={styles.errorText}>{error}</Text>}
              {!!updatedLabel && !error && <Text style={styles.updatedText}>{updatedLabel}</Text>}
              <Pressable onPress={load} style={styles.refreshBtn} testID="rates-refresh-btn" hitSlop={10}>
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
          </>
        )}

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

  spotRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  spotTile: {
    flex: 1, backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing.md, paddingHorizontal: spacing.sm, alignItems: 'center',
  },
  spotLabel: { color: colors.onSurfaceTertiary, fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  spotValue: { color: colors.onSurface, fontFamily: fonts.display, fontSize: 16, fontWeight: '700', marginTop: 4 },
  spotUnit: { color: colors.mutedText, fontSize: 10, marginTop: 2 },
  spotDisclaimer: { color: colors.mutedText, fontSize: 10.5, textAlign: 'center', marginBottom: spacing.lg, lineHeight: 14 },

  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginBottom: spacing.xl },
  updatedText: { color: colors.mutedText, fontSize: typography.caption.fontSize },
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
