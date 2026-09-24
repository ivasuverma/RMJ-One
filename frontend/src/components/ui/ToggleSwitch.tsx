import { useEffect, useRef } from 'react';
import { Platform, Switch, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/src/theme/ThemeContext';

/** The app's one on/off switch look (the platform Switch, in brand colours).
 * Display-only: the surrounding row is the tap target, so this ignores
 * touches itself — otherwise a tap on the switch would toggle twice. */
export function ToggleSwitch({ value, disabled }: { value: boolean; disabled?: boolean }) {
  const { colors } = useTheme();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
  }, [value]);
  return (
    <View pointerEvents="none" style={disabled ? { opacity: 0.5 } : undefined}>
      <Switch
        value={value}
        disabled={disabled}
        trackColor={{ true: colors.brandPrimary, false: colors.border }}
        thumbColor={colors.surface}
        {...({ activeThumbColor: colors.surface } as object)}
      />
    </View>
  );
}
