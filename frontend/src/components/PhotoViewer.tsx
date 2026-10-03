import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Modal, Platform, ScrollView, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';
import { shareFile, useShareableFile } from '@/src/utils/shareFile';
import { usePdfPages } from '@/src/utils/pdfPages';
import { usePdfPassword } from '@/src/utils/pdfUnlock';
import { api } from '@/src/api/client';

/** A photo (or PDF) full-screen, with Close, Share (the phone's share sheet)
 *  and, when `onDelete` is given, Delete. Pass `docId` for a Documents file so
 *  a PDF shows its pages on screen. */
export function PhotoViewer({ url, token, name, title, docId, onClose, onDelete }: {
  url: string; token: string; name: string; title?: string; docId?: string; onClose: () => void; onDelete?: () => void;
}) {
  const { width } = useWindowDimensions();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const src = useMemo(() => ({ uri: url, headers: { Authorization: `Bearer ${token}` } }), [url, token]);
  const [unlocks, setUnlocks] = useState(0);
  const file = useShareableFile(unlocks ? `${url}${url.includes('?') ? '&' : '?'}u=${unlocks}` : url, token, name);
  const isPdf = file?.type === 'application/pdf';
  const { pages, locked, reload } = usePdfPages(isPdf && docId ? docId : null, token);
  // A PDF saved with its password: Unlock replaces it with the unlocked copy.
  const { askPassword, prompt: pdfPrompt } = usePdfPassword();
  const unlock = async () => {
    if (!docId) return;
    const ok = await askPassword(title || name, async (password) => { await api.post(`/documents/${docId}/unlock`, { password }); });
    if (ok) { setUnlocks((n) => n + 1); reload(); toast.success('Unlocked — the password is removed'); }
  };
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isPdf || !file) { setPdfUrl(null); return; }
    const u = URL.createObjectURL(file);
    setPdfUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [isPdf, file]);
  const share = async () => {
    if (!file) { toast.error('Still getting the photo ready — try again in a moment'); return; }
    const r = await shareFile(file, title || name);
    if (r === 'downloaded') toast.success('Saved to your downloads');
    else if (r === 'failed') toast.error('Could not share this photo');
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={[viewer.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]} testID="record-photo-viewer">
        <View style={viewer.bar}>
          <Pressable onPress={onClose} hitSlop={10} style={viewer.btn} accessibilityRole="button" accessibilityLabel="Close" testID="record-photo-close">
            <Ionicons name="close" size={20} color="#fff" /><Text style={viewer.btnText}>Close</Text>
          </Pressable>
          <View style={viewer.right}>
            {onDelete && (
              <Pressable onPress={onDelete} hitSlop={10} style={viewer.btn} accessibilityRole="button" accessibilityLabel="Delete" testID="record-photo-delete">
                <Ionicons name="trash-outline" size={18} color="#fff" />
              </Pressable>
            )}
            <Pressable onPress={share} hitSlop={10} style={viewer.btn} accessibilityRole="button" accessibilityLabel="Share" testID="record-photo-share">
              {file ? <Ionicons name="share-outline" size={19} color="#fff" /> : <ActivityIndicator size="small" color={colors.mutedText} />}
              <Text style={viewer.btnText}>Share</Text>
            </Pressable>
          </View>
        </View>
        {!!title && <Text style={viewer.title} numberOfLines={1}>{title}</Text>}
        {isPdf && pages && pages.length > 0 ? (
          <ScrollView contentContainerStyle={{ padding: 8, gap: 8 }} testID="record-photo-pdf-pages">
            {pages.map((src) => <PdfPage key={src.uri} source={src} width={Math.min(width, 900) - 16} />)}
            <OpenPdf url={pdfUrl} />
          </ScrollView>
        ) : isPdf && docId && pages === undefined ? (
          <ActivityIndicator color="#fff" size="large" style={{ flex: 1 }} />
        ) : isPdf && locked ? (
          <View style={viewer.pdf} testID="record-photo-pdf-locked">
            <Ionicons name="lock-closed-outline" size={52} color="#fff" />
            <Text style={viewer.pdfText}>This PDF has a password</Text>
            <Pressable onPress={unlock} style={[viewer.btn, viewer.pdfBtn]} testID="record-photo-unlock">
              <Ionicons name="lock-open-outline" size={18} color="#fff" />
              <Text style={viewer.btnText}>Unlock</Text>
            </Pressable>
          </View>
        ) : isPdf ? (
          // Phones don't reliably show a PDF inside a page (Android Chrome shows
          // nothing), so hand it to the phone's own PDF viewer.
          <View style={viewer.pdf}>
            <Ionicons name="document-text-outline" size={56} color="#fff" />
            <Text style={viewer.pdfText}>PDF document</Text>
            <OpenPdf url={pdfUrl} />
          </View>
        ) : (
          <Image source={src} style={{ flex: 1 }} contentFit="contain" transition={120} />
        )}
      </View>
      {pdfPrompt}
    </Modal>
  );
}

function OpenPdf({ url }: { url: string | null }) {
  return (
    <Pressable onPress={() => url && Platform.OS === 'web' && window.open(url, '_blank')} style={[viewer.btn, viewer.pdfBtn]} testID="record-photo-open-pdf">
      {url ? <Ionicons name="open-outline" size={18} color="#fff" /> : <ActivityIndicator size="small" color="#fff" />}
      <Text style={viewer.btnText}>Open PDF</Text>
    </Pressable>
  );
}

// One PDF page, at the page's own shape once it has loaded.
function PdfPage({ source, width }: { source: { uri: string; headers: Record<string, string> }; width: number }) {
  const [ratio, setRatio] = useState(0.707);   // A4 portrait until we know
  return (
    <Image source={source} style={{ width, aspectRatio: ratio, alignSelf: 'center', backgroundColor: '#fff' }} contentFit="contain"
      onLoad={(e) => { const { width: w, height: h } = e.source; if (w && h) setRatio(w / h); }} />
  );
}

const viewer = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  bar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingBottom: 8 },
  right: { flexDirection: 'row', gap: 10 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)' },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  pdf: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  pdfText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  pdfBtn: { paddingHorizontal: 20, paddingVertical: 12, alignSelf: 'center' },
  title: { color: '#fff', fontSize: 15, fontWeight: '700', textAlign: 'center', paddingHorizontal: 14, paddingBottom: 8 },
});
