import { View, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/src/auth/AuthContext';
import { useTheme } from '@/src/theme/ThemeContext';
import AttendanceCalendarView from '@/src/components/AttendanceCalendarView';

export default function EmployeeCalendarTab() {
  const { user } = useAuth();
  const { colors } = useTheme();

  if (!user?.id) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.brandPrimary} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={['top']} testID="emp-calendar-screen">
      <AttendanceCalendarView empId={user.id} title="My Calendar" />
    </SafeAreaView>
  );
}
