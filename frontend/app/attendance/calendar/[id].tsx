import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '@/src/theme/ThemeContext';
import AttendanceCalendarView from '@/src/components/AttendanceCalendarView';

export default function AttendanceCalendarRoute() {
  const { id, name, year, month } = useLocalSearchParams<{ id: string; name?: string; year?: string; month?: string }>();
  const { colors } = useTheme();
  const router = useRouter();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={['top']}>
      <AttendanceCalendarView empId={id!} onBack={() => router.back()} title={name || 'Calendar'}
        initialYear={Number(year) || undefined} initialMonth={Number(month) || undefined} />
    </SafeAreaView>
  );
}
