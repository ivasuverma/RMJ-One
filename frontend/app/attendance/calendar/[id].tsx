import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { colors } from '@/src/theme';
import AttendanceCalendarView from '@/src/components/AttendanceCalendarView';

export default function AttendanceCalendarRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={['top']}>
      <AttendanceCalendarView empId={id!} onBack={() => router.back()} />
    </SafeAreaView>
  );
}
