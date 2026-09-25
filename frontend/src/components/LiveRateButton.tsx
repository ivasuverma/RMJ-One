import { useCallback, useMemo, useState } from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

const REFRESH_MS = 60000;
const fmtINR = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

// Header pill showing the live 24K gold rate (same public /public/rates data
// as app/rates.tsx), refreshed every minute while the screen is focused. Tap
// opens the full live rate screen, which adds 22K / 18K / 14K for signed-in
// users. Used on both the owner dashboard and the employee home.
export function LiveRateButton({ testID = 'live-rate-btn' }: { testID?: string }) {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [gold, setGold] = useState<number | null>(null);

  useFocusEffect(useCallback(() => {
    let alive = true;
    const load = () => {
      api.get<{ gold_sell: number | null }>('/public/rates')
        .then((r) => { if (alive) setGold(r.gold_sell); }).catch(() => {});
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
  }, []));

  if (gold == null) return null;
  return (
    <Pressable
      onPress={() => router.push('/rates')}
      style={styles.btn}
      testID={testID}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`Gold 24K ${fmtINR(gold)}. Open live rates`}
    >
      <Text style={styles.label}>24K</Text>
      <Text style={styles.value} numberOfLines={1}>{fmtINR(gold)}</Text>
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  btn: {
    height: 38, borderRadius: 19, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  label: { color: colors.brandSecondary, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.4 },
  value: { color: colors.onSurface, fontSize: 13.5, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
