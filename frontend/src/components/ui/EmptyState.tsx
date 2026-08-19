import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Button } from './Button';

/** Icon + title (+ optional message and action) shown when a list/screen
 * genuinely has nothing in it — e.g. "No Cash Book counters yet". Keeps the
 * empty-state shape consistent instead of every screen writing its own
 * icon+text block. */
export function EmptyState({ icon = 'file-tray-outline', title, message, actionLabel, onAction, testID }: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.wrap} testID={testID}>
      <Ionicons name={icon} size={36} color={colors.mutedText} />
      <Text style={styles.title}>{title}</Text>
      {!!message && <Text style={styles.message}>{message}</Text>}
      {!!actionLabel && !!onAction && (
        <View style={styles.actionWrap}>
          <Button label={actionLabel} onPress={onAction} size="sm" fullWidth={false} leftIcon="add" />
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.xxl, paddingHorizontal: spacing.xl },
  title: { color: colors.onSurface, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  message: { color: colors.onSurfaceTertiary, fontSize: 13, textAlign: 'center' },
  actionWrap: { marginTop: spacing.sm },
});
