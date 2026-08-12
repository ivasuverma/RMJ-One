import { useEffect } from 'react';
import { useRouter } from 'expo-router';

// Retired — fully superseded by (tabs)/utility.tsx (labeled "Settings" in the
// tab bar). Kept only as a redirect so any stale deep link/bookmark to this
// route doesn't 404. Not reachable from the tab bar (href: null in _layout).
export default function SettingsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/(tabs)/utility' as any); }, [router]);
  return null;
}
