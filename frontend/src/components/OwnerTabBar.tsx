import { useState } from 'react';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/auth/AuthContext';
import { QuickDocCapture } from '@/src/components/QuickDocCapture';
import { GlassTabBar, GlassTab } from '@/src/components/GlassTabBar';

// Owner/admin/accountant tab bar: Home, Work, Ledger, Settings in the frosted
// glass pill (GlassTabBar), plus the camera button that opens QuickDocCapture
// (not a routed tab — no screen owns it). A custom render rather than the
// default BottomTabBar, which has no slot for a non-routed button.
const VISIBLE_TABS = ['dashboard', 'work', 'ledger', 'utility'] as const;
const ICONS: Record<(typeof VISIBLE_TABS)[number], keyof typeof Ionicons.glyphMap> = {
  dashboard: 'home-outline', work: 'briefcase-outline', ledger: 'book-outline', utility: 'settings-outline',
};

export function OwnerTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { hasModule } = useAuth();
  const [captureDoc, setCaptureDoc] = useState(false);

  const focusedOptions = descriptors[state.routes[state.index].key]?.options;
  if (focusedOptions?.tabBarStyle && (focusedOptions.tabBarStyle as any).display === 'none') {
    return null;
  }

  const tabs: GlassTab[] = VISIBLE_TABS
    .map((name) => state.routes.find((r) => r.name === name))
    .filter((r): r is (typeof state.routes)[number] => !!r)
    .map((route) => {
      const { options } = descriptors[route.key];
      const focused = state.routes[state.index].key === route.key;
      return {
        key: route.key,
        label: (options.title ?? route.name) as string,
        icon: ICONS[route.name as keyof typeof ICONS],
        focused,
        testID: (options as any).tabBarButtonTestID,
        onPress: () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        },
        onLongPress: () => { navigation.emit({ type: 'tabLongPress', target: route.key }); },
      };
    });

  return (
    <>
      <GlassTabBar tabs={tabs} onCapture={hasModule('documents') ? () => setCaptureDoc(true) : undefined} captureTestID="owner-tab-capture-btn" />
      <QuickDocCapture visible={captureDoc} onClose={() => setCaptureDoc(false)} />
    </>
  );
}
