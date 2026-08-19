import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radius, spacing, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Button } from './Button';

/** Message + retry — for when a load genuinely failed (network error, 500,
 * etc.), as opposed to EmptyState which is for a load that succeeded but
 * came back with nothing. */
export function ErrorState({ message, onRetry, testID }: {
  message: string;
  onRetry?: () => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.card} testID={testID}>
      <Ionicons name="warning-outline" size={22} color={colors.brandSecondary} />
      <Text style={styles.text}>{message}</Text>
      {!!onRetry && (
        <View style={styles.actionWrap}>
          <Button label="Retry" onPress={onRetry} size="sm" fullWidth={false} />
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.error, padding: spacing.xl, alignItems: 'center', gap: spacing.md,
  },
  text: { color: colors.onError, textAlign: 'center', fontSize: 13 },
  actionWrap: { marginTop: spacing.xs },
});
