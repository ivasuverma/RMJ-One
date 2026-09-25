import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, ActivityIndicator } from 'react-native';
import { useEffect } from 'react';
import { useTheme } from '@/src/theme/ThemeContext';
import { useAuth } from '@/src/auth/AuthContext';
import { OwnerTabBar } from '@/src/components/OwnerTabBar';
import { EmployeeTabBar } from '@/src/components/EmployeeTabBar';
import { useTabBarSpace } from '@/src/components/GlassTabBar';

// Module landing pages that employees can be granted (see
// EMPLOYEE_ASSIGNABLE_MODULES in the backend) and that live in this group so
// owners get the bottom bar on them. Employees have their own tab shell
// ((emp)), so everything else in here bounces them home — but these four are
// linked to from the employee Home/Work/Transactions screens, so they must
// stay reachable, just without the owner tab bar.
// Screens that hide the bar get no bottom padding for it.
const NO_BAR = { paddingBottom: 0 };

const EMPLOYEE_SHARED_SCREENS = ['cashbook', 'documents', 'samples', 'repairs'];

export default function OwnerTabsLayout() {
  const { user, loading } = useAuth();
  const { colors } = useTheme();
  const router = useRouter();
  const isEmployee = user?.role === 'employee';
  const tabSpace = useTabBarSpace();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/login');
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.brandPrimary} size="large" />
      </View>
    );
  }

  return (
    <Tabs
      // Custom tabBar (OwnerTabBar) replaces the default bar entirely — it
      // renders Dashboard/Work/Ledger/Settings plus a 5th, unrouted center
      // capture button, which the default BottomTabBar has no slot for.
      // screenOptions here still matter: OwnerTabBar reads title/tabBarIcon/
      // tabBarButtonTestID/tabBarStyle off each route's own options.
      // Employees on a shared module screen get their OWN bar (same layout,
      // conditional tabs) — never the owner bar, whose tabs lead to
      // owner-only screens. EmployeeTabBar navigates by href, so it works
      // here even though this navigator's routes are the owner's.
      tabBar={(props) => (isEmployee ? <EmployeeTabBar /> : <OwnerTabBar {...props} />)}
      // Each module's landing screen below (cashbook/attendance/documents/
      // samples/loans/repairs) is registered here as its own tab so it keeps
      // the bottom bar, even though it's normally reached by pushing from
      // Work or a Dashboard tile rather than tapping a visible tab button.
      // React Navigation's tab back-behavior defaults to 'firstRoute' —
      // back/swipe-back from ANY tab always jumps to the first one declared
      // (dashboard) regardless of where you actually came from. 'history'
      // instead follows the real visit order, so leaving a module this way
      // returns to Work (or Dashboard) — whichever you pushed it from.
      backBehavior="history"
      // The glass bar floats over the screen; pad each scene so its content
      // ends just above it (see GlassTabBar / useTabBarSpace).
      screenOptions={{ headerShown: false, sceneStyle: { paddingBottom: tabSpace, backgroundColor: colors.surface } }}
      // Employees may only land on the shared module screens; anything else in
      // this group is owner-only and sends them home. This runs off the
      // navigator's own focus event, which names the screen actually being
      // opened. (It used to compare useSegments() against the allow-list, but
      // that value is only updated AFTER the new screen renders — so on the
      // first render it still held the previous route, the guard saw "not
      // allowed", and bounced employees home from Cash Book, Repairs, Stock
      // In/Out and Documents before they ever arrived.)
      screenListeners={({ navigation }) => ({
        focus: () => {
          if (!isEmployee) return;
          // Re-read the focused screen a tick later rather than trusting the
          // event that fired: a screen can be focused for an instant while the
          // navigator settles on the one that was actually requested.
          setTimeout(() => {
            const state = navigation.getState();
            const current = state?.routes?.[state.index]?.name;
            if (current && !EMPLOYEE_SHARED_SCREENS.includes(current)) router.replace('/(emp)/home');
          }, 0);
        },
      })}
    >
      {/* Four tabs (v3 IA): Dashboard, Work, Ledger, Settings — plus the
          center capture button OwnerTabBar renders between Work and Ledger.
          Ledger consolidates the four account ledgers that used to live only
          under Settings > Reports. */}
      <Tabs.Screen
        name="dashboard"
        options={{ title: 'Home', tabBarButtonTestID: 'tab-dashboard', tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="work"
        options={{ title: 'Work', tabBarButtonTestID: 'tab-work', tabBarIcon: ({ color, size }) => <Ionicons name="briefcase-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="ledger"
        options={{ title: 'Ledger', tabBarButtonTestID: 'tab-ledger', tabBarIcon: ({ color, size }) => <Ionicons name="book-outline" color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="utility"
        options={{ title: 'Settings', tabBarButtonTestID: 'tab-utility', tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" color={color} size={size} /> }}
      />
      {/* Still routable (Work tiles + deep links point into these, and old
          /(tabs)/transactions links still resolve) but no longer their own
          bottom tab — the v2 IA groups by action type, not by module.
          Transactions content now lives in the Work hub. (Reports was the
          same kind of hidden tab, but is now removed outright — both its
          tiles moved out: the ledgers to the Ledger tab, Custom PDF Report
          to Payroll's header.) Each has its own back button, so the root
          tab bar is hidden while it's active (href: null alone only drops
          the tappable icon, not the bar itself) — it would otherwise sit
          redundantly under a screen that already has its own way back. */}
      <Tabs.Screen name="transactions" options={{ href: null, tabBarStyle: { display: 'none' }, sceneStyle: NO_BAR }} />
      <Tabs.Screen name="employees" options={{ href: null, tabBarStyle: { display: 'none' }, sceneStyle: NO_BAR }} />
      <Tabs.Screen name="payroll" options={{ href: null, tabBarStyle: { display: 'none' }, sceneStyle: NO_BAR }} />
      <Tabs.Screen name="settings" options={{ href: null, tabBarStyle: { display: 'none' }, sceneStyle: NO_BAR }} />
      <Tabs.Screen name="masters" options={{ href: null }} />
      {/* Each module's landing/list screen lives here (no tabBarStyle
          override, so — like masters above — the bar stays visible) so it
          keeps the bottom bar and stays mounted in the background when you
          switch tabs and back, instead of unmounting like a plain stack push.
          Every sub-page (a single record, an edit form, a new-record screen)
          is intentionally left OUTSIDE this group as a normal stack route —
          the bar still hides there, same as before. Route paths are
          unchanged (a group folder adds no URL segment), so nothing that
          links to /cashbook, /documents, /samples, /loans, or /repairs
          needed updating. */}
      <Tabs.Screen name="cashbook" options={{ href: null }} />
      <Tabs.Screen name="attendance" options={{ href: null }} />
      <Tabs.Screen name="documents" options={{ href: null }} />
      <Tabs.Screen name="samples" options={{ href: null }} />
      <Tabs.Screen name="loans" options={{ href: null }} />
      <Tabs.Screen name="repairs" options={{ href: null }} />
    </Tabs>
  );
}
