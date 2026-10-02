import { Platform } from 'react-native';

// Picks up a new deploy on the web app without anyone having to close it.
// The page's main script has the build's hash in its name, so when the app
// comes back to the screen it fetches the page again and compares names; if a
// newer build is live it reloads then (never in the middle of typing). A home-
// screen app on iPhone can otherwise keep running an old build for days.
const ENTRY = /\/_expo\/static\/js\/web\/entry-[a-f0-9]+\.js/;
const CHECK_EVERY_MS = 5 * 60 * 1000;

function currentEntry(): string | null {
  for (const s of Array.from(document.scripts)) {
    const m = s.src.match(ENTRY);
    if (m) return m[0];
  }
  return null;
}

async function liveEntry(): Promise<string | null> {
  try {
    const res = await fetch(`/?_v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.text()).match(ENTRY)?.[0] ?? null;
  } catch { return null; }
}

let started = false;
export function startUpdateWatch(): void {
  if (Platform.OS !== 'web' || started || typeof document === 'undefined') return;
  const mine = currentEntry();
  if (!mine) return;   // dev server: no hashed entry to compare
  started = true;
  let lastCheck = 0;
  let newer = false;

  const check = async () => {
    if (Date.now() - lastCheck < CHECK_EVERY_MS) return;
    lastCheck = Date.now();
    const live = await liveEntry();
    if (live && live !== mine) newer = true;
  };

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    if (newer) { window.location.reload(); return; }
    lastCheck = 0;   // always look on return
    await check();
    if (newer) window.location.reload();
  });
  // While the app stays open, look now and then; reload on the next return to it.
  setInterval(() => { if (document.visibilityState === 'visible') check(); }, CHECK_EVERY_MS);
}
