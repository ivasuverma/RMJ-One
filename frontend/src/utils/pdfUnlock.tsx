import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getToken } from '@/src/api/client';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || '';

// Password-protected PDFs (bank statements, mostly). Saved as they are, nothing
// can open them without the password: no preview, no thumbnail, and every phone
// asks for it on Open. So the app asks once, the server removes the password,
// and the unlocked copy is what gets saved.

/** True for a PDF with a password. Every encrypted PDF names an /Encrypt
 *  dictionary in its trailer; a normal PDF doesn't. */
export async function isLockedPdf(file: Blob): Promise<boolean> {
  if (file.type !== 'application/pdf' && !(file as File).name?.toLowerCase().endsWith('.pdf')) return false;
  try {
    const text = new TextDecoder('latin1').decode(await file.arrayBuffer());
    return text.slice(0, 1024).includes('%PDF') && text.includes('/Encrypt');
  } catch { return false; }
}

async function fail(res: Response): Promise<never> {
  let detail = 'Could not unlock this PDF';
  try { detail = (await res.json())?.detail || detail; } catch { /* not JSON */ }
  throw { status: res.status, detail };
}

/** The picked PDF with its password removed (done on the server; nothing is stored). */
export async function unlockPdfFile(file: File, password: string): Promise<File> {
  const form = new FormData();
  form.append('file', file, file.name || 'statement.pdf');
  form.append('password', password);
  const res = await fetch(`${BASE}/api/documents/unlock-pdf`, {
    method: 'POST', body: form, headers: { Authorization: `Bearer ${(await getToken()) || ''}` },
  });
  if (!res.ok) await fail(res);
  return new File([await res.blob()], file.name || 'statement.pdf', { type: 'application/pdf' });
}

type Ask = { name: string; submit: (password: string) => Promise<void>; resolve: (ok: boolean) => void };

/** `askPassword(name, submit)` shows the password box; `submit` is tried with
 *  what was typed (throw `{detail}` to show an error and let them retry).
 *  Resolves true once it succeeds, false if they cancel. `unlockIfNeeded(file)`
 *  wraps it for a picked file: the same file if it has no password, the
 *  unlocked copy, or null if they cancel. Render `prompt` once. */
export function usePdfPassword() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const askPassword = useCallback((name: string, submit: (password: string) => Promise<void>) =>
    new Promise<boolean>((resolve) => setAsk({ name, submit, resolve })), []);
  const unlockIfNeeded = useCallback(async (file: File): Promise<File | null> => {
    if (!(await isLockedPdf(file))) return file;
    let unlocked: File | null = null;
    const ok = await askPassword(file.name || 'PDF', async (pw) => { unlocked = await unlockPdfFile(file, pw); });
    return ok ? unlocked : null;
  }, [askPassword]);
  const prompt = ask ? (
    <PasswordPrompt key={ask.name} name={ask.name} submit={ask.submit}
      onDone={(ok) => { ask.resolve(ok); setAsk(null); }} />
  ) : null;
  return { askPassword, unlockIfNeeded, prompt };
}

function PasswordPrompt({ name, submit, onDone }: { name: string; submit: (pw: string) => Promise<void>; onDone: (ok: boolean) => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const go = async () => {
    if (!pw || sending.current) return;
    sending.current = true; setBusy(true); setError('');
    try { await submit(pw); onDone(true); }
    catch (e: any) { setError(e?.detail || 'Could not unlock this PDF'); }
    finally { sending.current = false; setBusy(false); }
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => onDone(false)}>
      <View style={styles.backdrop}>
        <View style={styles.card} testID="pdf-password-prompt">
          <View style={styles.icon}><Ionicons name="lock-closed" size={22} color={colors.brandSecondary} /></View>
          <Text style={styles.title}>This PDF has a password</Text>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          <Text style={styles.sub}>Enter it once. The password is removed and an unlocked copy is saved, so it opens and previews without one.</Text>
          <View style={styles.inputRow}>
            <TextInput
              value={pw} onChangeText={(t) => { setPw(t); setError(''); }} onSubmitEditing={go}
              placeholder="PDF password" placeholderTextColor={colors.mutedText} secureTextEntry={!show}
              autoFocus autoCapitalize="none" autoCorrect={false} style={styles.input} testID="pdf-password-input"
            />
            <Pressable onPress={() => setShow((v) => !v)} hitSlop={8} style={styles.eye} accessibilityLabel={show ? 'Hide password' : 'Show password'}>
              <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.mutedText} />
            </Pressable>
          </View>
          {!!error && <Text style={styles.error} testID="pdf-password-error">{error}</Text>}
          <View style={styles.actions}>
            <Pressable onPress={() => onDone(false)} disabled={busy} style={styles.cancel} testID="pdf-password-cancel">
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={go} disabled={busy || !pw} style={[styles.ok, (busy || !pw) && { opacity: 0.6 }]} testID="pdf-password-unlock">
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.okText}>Unlock</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, gap: 8, maxWidth: 420, width: '100%', alignSelf: 'center' },
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.onSurface, fontSize: 18, fontWeight: '700', marginTop: 4 },
  name: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: '600' },
  sub: { color: colors.mutedText, fontSize: 13, lineHeight: 18 },
  inputRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  input: { flex: 1, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 16 },
  eye: { paddingHorizontal: 12 },
  error: { color: colors.onError, fontSize: 13 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  cancel: { flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  cancelText: { color: colors.onSurfaceSecondary, fontWeight: '700', fontSize: 15 },
  ok: { flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: radius.md, backgroundColor: colors.brandPrimary },
  okText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 15 },
});
