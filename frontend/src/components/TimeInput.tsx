import { useRef } from 'react';
import { TextInput, TextInputProps } from 'react-native';

/**
 * Formats a 24-hour time while it's typed, so nobody has to find the colon on
 * a phone keypad: "1930" → "19:30", "8" → "08:", "0830" → "08:30".
 * Deleting works normally (the colon isn't put back while backspacing).
 */
export function formatTimeTyping(prev: string, next: string): string {
  const deleting = next.length < prev.length;
  let d = next.replace(/\D/g, '').slice(0, 4);
  // A first digit of 3–9 can only be a single-digit hour: pad it ("8" → "08").
  if (d.length >= 1 && +d[0] > 2) d = `0${d}`.slice(0, 4);
  // "24"–"29" isn't an hour either: treat the second digit as the start of the minutes.
  if (d.length >= 2 && d[0] === '2' && +d[1] > 3) d = `0${d}`.slice(0, 4);
  if (d.length > 2) return `${d.slice(0, 2)}:${d.slice(2)}`;
  if (d.length === 2 && !deleting) return `${d}:`;
  return d;
}

/** A TextInput for HH:MM (24-hour) that adds the colon by itself. */
export function TimeInput({ value, onChangeText, ...rest }: Omit<TextInputProps, 'value' | 'onChangeText'> & {
  value: string; onChangeText: (v: string) => void;
}) {
  const last = useRef(value);
  last.current = value;
  return (
    <TextInput
      value={value}
      onChangeText={(t) => onChangeText(formatTimeTyping(last.current, t))}
      keyboardType="number-pad"
      maxLength={5}
      autoCapitalize="none"
      autoCorrect={false}
      {...rest}
    />
  );
}
