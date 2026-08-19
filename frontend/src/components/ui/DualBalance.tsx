import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { spacing, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

export type BalanceDirection = 'due' | 'advance' | 'payable' | 'settled';

/**
 * The one non-negotiable display primitive from the brief: every account,
 * ledger row, statement, and balance in this app carries two independent
 * values — Fine (gold weight, grams, 3dp) and Amount (₹) — and they must
 * NEVER be collapsed into a single number. A karigar can owe fine gold
 * while the shop owes them cash; this renders both, each with its own
 * direction, so that's always visible at a glance.
 *
 * Convention: pass signed values. Positive = owed *to* the shop (due).
 * Negative = owed *by* the shop (advance/payable — caller picks the word
 * that fits the account type, e.g. "advance" for an employee, "payable"
 * for a karigar/customer credit). Zero = settled.
 */
export function DualBalance({
  fineGrams, amount, negativeLabel = 'advance', size = 'md', layout = 'row', testID,
}: {
  fineGrams?: number | null;
  amount?: number | null;
  /** What to call a negative (shop-owes-them) balance — "advance", "payable", etc. */
  negativeLabel?: string;
  size?: 'sm' | 'md';
  layout?: 'row' | 'column';
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const showFine = fineGrams !== undefined && fineGrams !== null;
  const showAmount = amount !== undefined && amount !== null;

  return (
    <View style={[styles.wrap, layout === 'column' && styles.wrapColumn]} testID={testID}>
      {showFine && (
        <BalancePart
          value={fineGrams as number}
          formatted={`${Math.abs(fineGrams as number).toFixed(3)} g`}
          tintColor={colors.brandSecondary}
          negativeLabel={negativeLabel}
          size={size}
          testID={testID ? `${testID}-fine` : undefined}
        />
      )}
      {showAmount && (
        <BalancePart
          value={amount as number}
          formatted={`₹${Math.round(Math.abs(amount as number)).toLocaleString('en-IN')}`}
          tintColor={(amount as number) > 0 ? colors.onSuccess : (amount as number) < 0 ? colors.onWarning : colors.mutedText}
          negativeLabel={negativeLabel}
          size={size}
          testID={testID ? `${testID}-amount` : undefined}
        />
      )}
    </View>
  );
}

function directionFor(value: number, negativeLabel: string): BalanceDirection {
  if (value > 0) return 'due';
  if (value < 0) return (negativeLabel as BalanceDirection) || 'payable';
  return 'settled';
}

function BalancePart({ value, formatted, tintColor, negativeLabel, size, testID }: {
  value: number; formatted: string; tintColor: string; negativeLabel: string; size: 'sm' | 'md'; testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const direction = directionFor(value, negativeLabel);
  const directionText = direction === 'due' ? 'due' : direction === 'settled' ? 'settled' : negativeLabel;
  return (
    <View style={styles.part} testID={testID}>
      <Text style={[styles.value, size === 'sm' && styles.valueSm, { color: tintColor }]} numberOfLines={1}>
        {formatted}
      </Text>
      <Text style={[styles.direction, size === 'sm' && styles.directionSm]}>{directionText}</Text>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  wrap: { flexDirection: 'row', gap: spacing.lg },
  wrapColumn: { flexDirection: 'column', gap: spacing.xs },
  part: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  value: { fontSize: 15, fontWeight: '800' },
  valueSm: { fontSize: 13 },
  direction: { color: colors.mutedText, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3 },
  directionSm: { fontSize: 9.5 },
});
