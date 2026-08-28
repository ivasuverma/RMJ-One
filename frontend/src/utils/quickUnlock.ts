// Quick unlock — a device-bound biometric gate (Face ID / Touch ID /
// fingerprint) on top of an already-stored session.
//
// The app keeps a persisted login token on the device (the normal "stay
// signed in" behavior). Quick unlock does NOT replace the password login and
// carries no server-side secret: it simply gates re-entry to the app behind
// the platform authenticator so that picking up an unlocked phone doesn't hand
// someone the till. A fresh device (e.g. a computer) has no stored session and
// no enrolled credential, so it always falls back to username + password.
//
// Web only: this uses WebAuthn's platform authenticator, which surfaces as the
// device's own Face ID / fingerprint prompt inside the PWA. There is no native
// build shipped yet, so on native we report "unsupported" and callers keep the
// plain login flow.

import { Platform } from 'react-native';
import { storage } from '@/src/utils/storage';

// Stored on this device only. The credential id is what we hand back to
// navigator.credentials.get() to trigger the biometric prompt; the user id is
// kept so a different account signing in on the same device re-enrolls rather
// than reusing someone else's credential.
const CRED_KEY = 'rmj.quickunlock.credId';
const USER_KEY = 'rmj.quickunlock.userId';

export type QuickUnlockResult = { ok: boolean; reason?: string };

function webAvailable(): boolean {
  return (
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    !!window.PublicKeyCredential &&
    !!(navigator?.credentials)
  );
}

// True when the device actually has a usable platform authenticator (Face ID,
// Touch ID, Windows Hello, Android fingerprint). Async because the browser has
// to probe the hardware.
export async function isQuickUnlockSupported(): Promise<boolean> {
  if (!webAvailable()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function isQuickUnlockEnabled(): Promise<boolean> {
  const id = await storage.getItem<string>(CRED_KEY, '');
  return !!id;
}

// Whose account quick unlock was enrolled for on this device (empty if none).
export async function quickUnlockUserId(): Promise<string> {
  return (await storage.getItem<string>(USER_KEY, '')) || '';
}

function b64uFromBuf(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bufFromB64u(b64u: string): ArrayBuffer {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function randomBytes(n: number): BufferSource {
  const a = new Uint8Array(new ArrayBuffer(n));
  (window.crypto || (window as any).msCrypto).getRandomValues(a);
  return a as BufferSource;
}

// Register a platform credential for this account on this device. Must be
// called from a user gesture (e.g. tapping the settings toggle) — the browser
// won't show the biometric prompt otherwise.
export async function enableQuickUnlock(userId: string, userName: string, displayName: string): Promise<QuickUnlockResult> {
  if (!webAvailable()) return { ok: false, reason: 'Not supported on this device' };
  try {
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { name: 'RMJ One', id: window.location.hostname },
        user: {
          id: new Uint8Array(new TextEncoder().encode(userId)) as BufferSource,
          name: userName || userId,
          displayName: displayName || userName || userId,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },   // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60000,
        attestation: 'none',
      },
    })) as PublicKeyCredential | null;
    if (!cred) return { ok: false, reason: 'Setup was cancelled' };
    await storage.setItem(CRED_KEY, b64uFromBuf(cred.rawId));
    await storage.setItem(USER_KEY, userId);
    return { ok: true };
  } catch (e: any) {
    if (e?.name === 'NotAllowedError') return { ok: false, reason: 'Cancelled' };
    return { ok: false, reason: e?.message || 'Could not enable quick unlock' };
  }
}

export async function disableQuickUnlock(): Promise<void> {
  await storage.removeItem(CRED_KEY);
  await storage.removeItem(USER_KEY);
}

// Prompt the biometric and resolve ok:true when the user verifies. A missing
// or removed credential (e.g. the passkey was deleted from the device) clears
// local state so the caller falls back to password without getting stuck.
export async function runQuickUnlock(): Promise<QuickUnlockResult> {
  if (!webAvailable()) return { ok: false, reason: 'Not supported on this device' };
  const credId = await storage.getItem<string>(CRED_KEY, '');
  if (!credId) return { ok: false, reason: 'Not enrolled' };
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [{ type: 'public-key', id: bufFromB64u(credId) }],
        userVerification: 'required',
        timeout: 60000,
        rpId: window.location.hostname,
      },
    });
    return assertion ? { ok: true } : { ok: false, reason: 'Cancelled' };
  } catch (e: any) {
    // InvalidStateError / the credential no longer exists on the device: drop
    // it so quick unlock re-enrolls next time instead of prompting forever.
    if (e?.name === 'InvalidStateError' || e?.name === 'NotAllowedError') {
      // NotAllowedError is also a plain user cancel — don't wipe enrollment for
      // that, only for a genuinely unusable credential.
      if (e?.name === 'InvalidStateError') await disableQuickUnlock();
    }
    return { ok: false, reason: e?.name === 'NotAllowedError' ? 'Cancelled' : (e?.message || 'Unlock failed') };
  }
}
