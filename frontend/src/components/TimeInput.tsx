import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, TextInputProps, View, StyleSheet } from 'react-native';
import { radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Period = 'AM' | 'PM';

/**
 * Formats a 12-hour time while it's typed, so nobody has to find the colon on
 * a phone keypad: "830" → "08:30", "1145" → "11:45", "7" → "07:".
 * Deleting works normally (the colon isn't put back while backspacing).
 */
export function formatTimeTyping(prev: string, next: string): string {
  const deleting = next.length < prev.length;
  let d = next.replace(/\D/g, '').slice(0, 4);
  // 2–9 can only be a single-digit hour: pad it ("8" → "08").
  if (d.length >= 1 && +d[0] > 1) d = `0${d}`.slice(0, 4);
  // "13"–"19" isn't a 12-hour hour: the second digit starts the minutes.
  if (d.length >= 2 && d[0] === '1' && +d[1] > 2) d = `0${d}`.slice(0, 4);
  // "00" isn't one either: read it as 12.
  if (d.length >= 2 && d.startsWith('00')) d = `12${d.slice(2)}`;
  if (d.length > 2) return `${d.slice(0, 2)}:${d.slice(2)}`;
  if (d.length === 2 && !deleting) return `${d}:`;
  return d;
}

/** "19:30" (24-hour, what the app stores) → { text: "07:30", period: "PM" }. */
export function to12(v: string): { text: string; period: Period | null } {
  const m = /^(\d{1,2}):(\d{2})$/.exec((v || '').trim());
  if (!m) return { text: v || '', period: null };
  const h = +m[1];
  return { text: `${String(h % 12 || 12).padStart(2, '0')}:${m[2]}`, period: h < 12 ? 'AM' : 'PM' };
}

/** "07:30" + "PM" → "19:30"; null while the time is incomplete or invalid. */
export function to24(text: string, period: Period): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const h = +m[1], min = +m[2];
  if (h < 1 || h > 12 || min > 59) return null;
  const h24 = (h % 12) + (period === 'PM' ? 12 : 0);
  return `${String(h24).padStart(2, '0')}:${m[2]}`;
}

// Shop hours: 9, 10, 11 are mornings; 12 and 1–8 are afternoons/evenings.
const guessPeriod = (text: string): Period => {
  const h = parseInt(text, 10);
  return h >= 9 && h <= 11 ? 'AM' : 'PM';
};

/**
 * A 12-hour time box with an AM/PM switch. The value it takes and gives back
 * stays 24-hour "HH:MM" (what the server stores), so callers don't change;
 * while the time is only partly typed it gives back the raw text (which the
 * caller's HH:MM check rejects), and '' when empty.
 */
export function TimeInput({ value, onChangeText, style, testID, ...rest }: Omit<TextInputProps, 'value' | 'onChangeText'> & {
  value: string; onChangeText: (v: string) => void;
}) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const init = to12(value);
  const [text, setText] = useState(init.text);
  const [period, setPeriod] = useState<Period | null>(init.period);
  const emitted = useRef(value);

  // A value set from outside (prefilled, reset) replaces what's shown.
  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    const v = to12(value);
    setText(v.text);
    setPeriod(v.period);
  }, [value]);

  const emit = (t: string, p: Period | null) => {
    const out = !t ? '' : (p && to24(t, p)) || t;
    emitted.current = out;
    onChangeText(out);
  };

  const onType = (raw: string) => {
    const t = formatTimeTyping(text, raw);
    // First complete time with no AM/PM picked yet: pick the likely one for shop hours.
    const p = period ?? (/^\d{2}:\d{2}$/.test(t) ? guessPeriod(t) : null);
    setText(t);
    setPeriod(p);
    emit(t, p);
  };

  const pick = (p: Period) => {
    setPeriod(p);
    emit(text, p);
  };

  return (
    <View style={s.row}>
      <TextInput
        value={text}
        onChangeText={onType}
        keyboardType="number-pad"
        maxLength={5}
        autoCapitalize="none"
        autoCorrect={false}
        testID={testID}
        style={[style, s.input]}
        {...rest}
      />
      <View style={s.toggle}>
        {(['AM', 'PM'] as const).map((p) => (
          <Pressable key={p} onPress={() => pick(p)} style={[s.opt, period === p && s.optOn]} hitSlop={4}
            accessibilityRole="button" accessibilityState={{ selected: period === p }} testID={testID ? `${testID}-${p.toLowerCase()}` : undefined}>
            <Text style={[s.optText, period === p && s.optTextOn]}>{p}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  row: { flexGrow: 1, flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  input: { flex: 1, minWidth: 0 },
  toggle: { flexDirection: 'row', borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  opt: { paddingHorizontal: 7, paddingVertical: 6, backgroundColor: colors.surface },
  optOn: { backgroundColor: colors.brandPrimary },
  optText: { color: colors.mutedText, fontSize: 11.5, fontWeight: '800' },
  optTextOn: { color: colors.onBrandPrimary },
});
