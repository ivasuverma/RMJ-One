import { useEffect } from 'react';
import { useRouter } from 'expo-router';

// Masters is retired — Team/Karigars/Customers moved into Settings (formerly
// Utility). This file is kept only so the old route doesn't 404 for anyone
// with a stale deep link/bookmark.
export default function MastersRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/(tabs)/utility' as any); }, [router]);
  return null;
}
