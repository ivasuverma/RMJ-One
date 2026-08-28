import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { api, TOKEN_KEY } from '@/src/api/client';
import { storage } from '@/src/utils/storage';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || '';
import { enqueueRecordPhoto, onOutboxChange } from '@/src/utils/uploadQueue';
import { confirmAction } from '@/src/utils/confirm';
import { useAuth } from '@/src/auth/AuthContext';
import { PhotoCaptureModal } from '@/src/components/PhotoCaptureModal';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Photo = { id: string; upload_state: string; file: { mime: string }; _local?: string };

// Drop-in gallery for high-res reference photos attached to any record. Photos
// are captured, saved to the background queue (uploads full-res to Drive,
// keeps a thumbnail), and shown here. Reusable across repairs/samples/employees.
export function RecordPhotos({ refType, refId, label = 'Photos' }: { refType: string; refId: string; label?: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const canDelete = user?.role === 'owner' || user?.role === 'admin';
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [pending, setPending] = useState<{ id: string; uri: string }[]>([]);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setToken((await storage.secureGet<string>(TOKEN_KEY, '')) || '');
    try { setPhotos(await api.get<Photo[]>(`/record-photos?ref_type=${encodeURIComponent(refType)}&ref_id=${encodeURIComponent(refId)}`)); }
    catch { /* ignore */ }
    finally { setLoading(false); }
  }, [refType, refId]);
  useEffect(() => { load(); }, [load]);

  // When the outbox drains, refresh so the server copies replace the optimistic
  // pending thumbnails.
  useEffect(() => onOutboxChange((n) => { if (n === 0) { load(); setPending([]); } }), [load]);

  const fileUri = (id: string, full = false) => `${BASE}/api/record-photos/${id}/file${full ? '?full=1' : ''}`;

  const onCapture = async (dataUri: string) => {
    setCaptureOpen(false);
    try {
      const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      const full = await (await fetch(dataUri)).blob();
      const thumb = await makeThumb(dataUri);
      setPending((p) => [...p, { id, uri: thumb ? `data:image/jpeg;base64,${thumb}` : dataUri }]);
      await enqueueRecordPhoto({ id, blob: full, filename: `${refType}-${Date.now()}.jpg`, thumb, ref_type: refType, ref_id: refId });
    } catch { /* ignore */ }
  };

  const openFull = async (id: string) => {
    try {
      const res = await fetch(fileUri(id, true), { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error();
      if (Platform.OS === 'web') window.open(URL.createObjectURL(await res.blob()), '_blank');
    } catch { /* ignore */ }
  };

  const del = (id: string) => confirmAction('Delete photo?', 'The copy in Google Drive is kept.', 'Delete', async () => {
    try { await api.del(`/record-photos/${id}`); load(); } catch { /* ignore */ }
  });

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.label}>{label}</Text>
        <Pressable onPress={() => setCaptureOpen(true)} style={styles.addBtn} testID="record-photo-add" hitSlop={8}>
          <Ionicons name="camera" size={16} color={colors.onBrandPrimary} />
          <Text style={styles.addText}>Add</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginVertical: spacing.md }} />
      ) : (photos.length + pending.length) === 0 ? (
        <Text style={styles.empty}>No photos yet.</Text>
      ) : (
        <View style={styles.grid}>
          {pending.map((p) => (
            <View key={p.id} style={styles.tile}>
              <Image source={{ uri: p.uri }} style={styles.img} contentFit="cover" />
              <View style={styles.uploadingBadge}><ActivityIndicator size="small" color="#fff" /></View>
            </View>
          ))}
          {photos.map((ph) => (
            <Pressable key={ph.id} style={styles.tile} onPress={() => openFull(ph.id)}>
              {token ? <Image source={{ uri: fileUri(ph.id), headers: { Authorization: `Bearer ${token}` } }} style={styles.img} contentFit="cover" cachePolicy="memory-disk" /> : null}
              {ph.upload_state !== 'synced' && (ph.upload_state === 'queued' || ph.upload_state === 'uploading' || ph.upload_state === 'local') && (
                <View style={styles.stateBadge}><Ionicons name="cloud-upload-outline" size={11} color="#fff" /></View>
              )}
              {canDelete && (
                <Pressable onPress={() => del(ph.id)} style={styles.delBtn} hitSlop={6} testID={`record-photo-del-${ph.id}`}>
                  <Ionicons name="close" size={13} color="#fff" />
                </Pressable>
              )}
            </Pressable>
          ))}
        </View>
      )}

      <PhotoCaptureModal visible={captureOpen} title={label} highRes onClose={() => setCaptureOpen(false)} onCapture={onCapture} />
    </View>
  );
}

async function makeThumb(dataUri: string): Promise<string> {
  if (typeof document === 'undefined') return '';
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const im = new (window as any).Image(); im.onload = () => res(im); im.onerror = rej; im.src = dataUri;
    });
    const scale = Math.min(1, 420 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7).split(',', 2)[1] || '';
  } catch { return ''; }
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  wrap: { marginTop: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.brandPrimary, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill },
  addText: { color: colors.onBrandPrimary, fontSize: 12.5, fontWeight: '800' },
  empty: { color: colors.mutedText, fontSize: 13 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: { width: 92, height: 92, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surfaceTertiary },
  img: { width: '100%', height: '100%' },
  uploadingBadge: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  stateBadge: { position: 'absolute', bottom: 4, left: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, padding: 3 },
  delBtn: { position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
});
