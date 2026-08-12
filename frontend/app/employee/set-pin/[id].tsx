import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

// Superseded by /employee/set-credentials/[id] — employees now log in with a
// username + password instead of a 4-digit PIN. This route is kept only as a
// redirect so any stale bookmarks/links don't 404.
export default function SetPinRedirect() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  useEffect(() => { router.replace(`/employee/set-credentials/${id}`); }, [id, router]);
  return null;
}
