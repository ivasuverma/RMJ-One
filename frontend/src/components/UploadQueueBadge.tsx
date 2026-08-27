import { useEffect, useState } from 'react';
import { Pressable, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { onOutboxChange } from '@/src/utils/uploadQueue';
import { useTheme } from '@/src/theme/ThemeContext';

// A small pill that appears only while document photos are still uploading from
// the on-device queue, showing how many are left. Tapping opens Documents.
export function UploadQueueBadge() {
  const { colors } = useTheme();
  const router = useRouter();
  const [count, setCount] = useState(0);

  useEffect(() => onOutboxChange(setCount), []);

  if (count <= 0) return null;
  return (
    <Pressable
      onPress={() => router.push('/documents?tab=pending' as any)}
      style={[styles.btn, { backgroundColor: colors.surfaceSecondary, borderColor: colors.brand }]}
      testID="upload-queue-badge"
      hitSlop={8}
    >
      <ActivityIndicator size="small" color={colors.brandSecondary} />
      <Text style={[styles.txt, { color: colors.onSurface }]}>{count}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 44, paddingHorizontal: 12, borderRadius: 22, borderWidth: 1 },
  txt: { fontSize: 14, fontWeight: '800' },
});
