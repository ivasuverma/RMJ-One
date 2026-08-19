import { useMemo } from 'react';
import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import { radius, spacing, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

/** Themed labeled text field — same label-above-field shape as DateField.tsx
 * (kept deliberately consistent with it), plus an error slot and a required
 * marker. Forwards the rest of TextInput's props (keyboardType, multiline,
 * secureTextEntry, etc.) untouched. */
export function Input({
  label, value, onChangeText, error, required = false, testID, style, ...rest
}: {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  error?: string;
  required?: boolean;
  testID?: string;
} & Omit<TextInputProps, 'value' | 'onChangeText' | 'style'> & { style?: TextInputProps['style'] }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View>
      {!!label && (
        <Text style={styles.label}>
          {label}{required && <Text style={styles.required}> *</Text>}
        </Text>
      )}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={colors.mutedText}
        testID={testID}
        style={[styles.input, !!error && styles.inputError, style]}
        {...rest}
      />
      {!!error && <Text style={styles.errorText} testID={testID ? `${testID}-error` : undefined}>{error}</Text>}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6, marginTop: spacing.sm },
  required: { color: colors.onError },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 14,
  },
  inputError: { borderColor: colors.error },
  errorText: { color: colors.onError, fontSize: 11.5, marginTop: 4 },
});
