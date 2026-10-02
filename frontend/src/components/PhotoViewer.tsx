import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Modal, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/src/theme/ThemeContext';
import { useToast } from '@/src/components/ui';
import { shareFile, useShareableFile } from '@/src/utils/shareFile';

/** A photo (or PDF) full-screen, with Close, Share (the phone's share sheet)
 *  and, when `onDelete` is given, Delete. */
export function PhotoViewer({ url, token, name, title, onClose, onDelete }: {
  url: string; token: string; name: string; title?: string; onClose: () => void; onDelete?: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const src = useMemo(() => ({ uri: url, headers: { Authorization: `Bearer ${token}` } }), [url, token]);
  const file = useShareableFile(url, token, name);
  const isPdf = file?.type === 'application/pdf';
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
        {isPdf ? (
          // Phones don't reliably show a PDF inside a page (Android Chrome shows
          // nothing), so hand it to the phone's own PDF viewer.
          <View style={viewer.pdf}>
            <Ionicons name="document-text-outline" size={56} color="#fff" />
            <Text style={viewer.pdfText}>PDF document</Text>
            <Pressable onPress={() => pdfUrl && Platform.OS === 'web' && window.open(pdfUrl, '_blank')} style={[viewer.btn, viewer.pdfBtn]} testID="record-photo-open-pdf">
              {pdfUrl ? <Ionicons name="open-outline" size={18} color="#fff" /> : <ActivityIndicator size="small" color="#fff" />}
              <Text style={viewer.btnText}>Open PDF</Text>
            </Pressable>
          </View>
        ) : (
          <Image source={src} style={{ flex: 1 }} contentFit="contain" transition={120} />
        )}
      </View>
    </Modal>
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
  pdfBtn: { paddingHorizontal: 20, paddingVertical: 12 },
  title: { color: '#fff', fontSize: 15, fontWeight: '700', textAlign: 'center', paddingHorizontal: 14, paddingBottom: 8 },
});
