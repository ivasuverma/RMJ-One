import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api/client';
import { haptics } from '@/src/utils/haptics';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Sheet, useToast } from '@/src/components/ui';

export type DocCategory = { id: string; key: string; label: string; icon: keyof typeof Ionicons.glyphMap };

// The app ships as a web export, so capture uses a native file input — which
// gives us camera (capture=environment), photo library, and Files/PDF for free
// with no extra native module. Picking a category auto-saves as Pending and
// kicks off the background upload — no extra confirm tap (per the brief).
function pickWebFile(accept: string, capture?: boolean): Promise<File | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') { resolve(null); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    if (capture) input.setAttribute('capture', 'environment');
    input.onchange = () => resolve(input.files && input.files[0] ? input.files[0] : null);
    input.click();
  });
}

export function DocumentCaptureSheet({ visible, onClose, onSaved }: {
  visible: boolean; onClose: () => void; onSaved?: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const [cats, setCats] = useState<DocCategory[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) api.get<DocCategory[]>('/document-categories').then(setCats).catch(() => {});
    else { setFile(null); setBusy(false); }
  }, [visible]);

  const pick = async (accept: string, capture?: boolean) => {
    const f = await pickWebFile(accept, capture);
    if (f) setFile(f);
  };

  const save = async (cat: DocCategory) => {
    if (!file || busy) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('category_key', cat.key);
      await api.upload('/documents', form);
      haptics.impact();
      toast.success('Saved to Pending · uploading');
      onSaved?.();
      onClose();
    } catch (e: any) {
      haptics.error();
      toast.error(e?.detail || 'Could not save the document');
    } finally { setBusy(false); }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Add document" testID="doc-capture-sheet">
      {Platform.OS !== 'web' ? (
        <Text style={styles.hint}>Open the RMJ One web app to capture documents.</Text>
      ) : !file ? (
        <>
          <Text style={styles.hint}>Snap a receipt, KYC, cash sheet or bill — it files to Pending instantly.</Text>
          <Pressable onPress={() => pick('image/*', true)} style={[styles.opt, styles.optPrimary]} testID="doc-take-photo">
            <Ionicons name="camera" size={20} color={colors.onBrandPrimary} />
            <Text style={styles.optPrimaryText}>Take photo</Text>
          </Pressable>
          <View style={styles.altRow}>
            <Pressable onPress={() => pick('image/*')} style={styles.alt} testID="doc-library">
              <Ionicons name="images-outline" size={18} color={colors.brandSecondary} />
              <Text style={styles.altText}>Library</Text>
            </Pressable>
            <Pressable onPress={() => pick('image/*,application/pdf')} style={styles.alt} testID="doc-files">
              <Ionicons name="document-attach-outline" size={18} color={colors.brandSecondary} />
              <Text style={styles.altText}>Files / PDF</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <View style={styles.fileRow}>
            <Ionicons name="checkmark-circle" size={18} color={colors.onSuccess} />
            <Text style={styles.fileName} numberOfLines={1}>{file.name}</Text>
            <Pressable onPress={() => setFile(null)} hitSlop={8} testID="doc-change-file"><Text style={styles.changeText}>Change</Text></Pressable>
          </View>
          <Text style={styles.hint}>Pick a category — it saves to Pending right away.</Text>
          {busy ? (
            <ActivityIndicator color={colors.brandPrimary} style={{ marginVertical: spacing.lg }} />
          ) : (
            <View style={styles.catGrid}>
              {cats.map((c) => (
                <Pressable key={c.id} onPress={() => save(c)} style={styles.cat} testID={`doc-cat-${c.key}`}>
                  <View style={styles.catIcon}><Ionicons name={c.icon || 'document-outline'} size={20} color={colors.brandSecondary} /></View>
                  <Text style={styles.catLabel} numberOfLines={2}>{c.label}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </>
      )}
    </Sheet>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  hint: { color: colors.mutedText, fontSize: 13, marginBottom: spacing.md },
  opt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 15, borderRadius: radius.md },
  optPrimary: { backgroundColor: colors.brandPrimary },
  optPrimaryText: { color: colors.onBrandPrimary, fontSize: 16, fontWeight: '700' },
  altRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  alt: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13,
    borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  altText: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.md },
  fileName: { flex: 1, color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  changeText: { color: colors.brandSecondary, fontSize: 13, fontWeight: '700' },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cat: {
    flexBasis: '31%', flexGrow: 1, minWidth: 96, alignItems: 'center', gap: 8, paddingVertical: spacing.md,
    borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  catIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  catLabel: { color: colors.onSurface, fontSize: 12, fontWeight: '600', textAlign: 'center' },
});
