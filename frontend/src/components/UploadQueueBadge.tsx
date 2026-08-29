import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Modal, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/src/theme/ThemeContext';
import { confirmAction } from '@/src/utils/confirm';
import {
  onOutboxChange, outboxItems, cancelUpload, clearOutbox, retryUploads, type OutboxMeta,
} from '@/src/utils/uploadQueue';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';

// A small pill showing how many photos are still uploading from the on-device
// queue. Tapping opens a sheet where a stuck or failed item can be cancelled or
// retried — so a photo that won't go through can't spin forever.
export function UploadQueueBadge() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<OutboxMeta[]>([]);

  useEffect(() => onOutboxChange(setCount), []);

  const refresh = useCallback(async () => { setItems(await outboxItems()); }, []);
  // Keep items in sync with the count (even when closed) so the badge can flag
  // a failed upload, and refresh again whenever the sheet opens.
  useEffect(() => { refresh(); }, [open, count, refresh]);

  const label = (it: OutboxMeta) => {
    if (it.ref_type) return `${it.ref_type} photo`;
    if (it.category_key) return `${it.category_key} document`;
    return it.filename || 'Upload';
  };

  const cancel = (it: OutboxMeta) => {
    confirmAction('Cancel this upload?', `"${label(it)}" won't be uploaded. This can't be undone.`, 'Cancel upload', async () => {
      await cancelUpload(it.id);
      await refresh();
    });
  };

  const clearAll = () => {
    confirmAction('Clear all uploads?', `Remove all ${items.length} item(s) from the upload queue. None will be uploaded.`, 'Clear all', async () => {
      await clearOutbox();
      await refresh();
    });
  };

  const anyFailed = items.some((i) => i.permanent);

  if (count <= 0) return null;
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={[styles.btn, { backgroundColor: colors.surfaceSecondary, borderColor: anyFailed ? colors.error : colors.brand }]}
        testID="upload-queue-badge"
        hitSlop={8}
      >
        {anyFailed
          ? <Ionicons name="alert-circle" size={18} color={colors.onError} />
          : <ActivityIndicator size="small" color={colors.brandSecondary} />}
        <Text style={[styles.txt, { color: colors.onSurface }]}>{count}</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.headerRow}>
              <Text style={styles.title}>Uploading ({count})</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={10} testID="upload-queue-close"><Ionicons name="close" size={22} color={colors.onSurface} /></Pressable>
            </View>
            <Text style={styles.hint}>These photos are queued on this device and upload in the background. Cancel any that are stuck or no longer needed.</Text>

            <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
              {items.length === 0 ? (
                <Text style={styles.empty}>Queue is empty.</Text>
              ) : items.map((it) => (
                <View key={it.id} style={styles.row} testID={`upload-item-${it.id}`}>
                  <View style={styles.rowIcon}>
                    <Ionicons name={it.ref_type ? 'image-outline' : 'document-outline'} size={18} color={colors.brandSecondary} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.rowLabel} numberOfLines={1}>{label(it)}</Text>
                    {it.permanent
                      ? <Text style={styles.rowErr} numberOfLines={2}>Couldn&apos;t upload — {it.error || 'rejected'}</Text>
                      : <Text style={styles.rowMeta}>{it.tries > 0 ? `Failed ${it.tries}× — retrying` : 'Waiting to upload'}</Text>}
                  </View>
                  <Pressable onPress={() => cancel(it)} hitSlop={8} style={styles.cancelBtn} testID={`upload-cancel-${it.id}`}>
                    <Ionicons name="trash-outline" size={16} color={colors.onError} />
                  </Pressable>
                </View>
              ))}
            </ScrollView>

            <View style={styles.actions}>
              <Pressable onPress={() => retryUploads()} style={[styles.actBtn, styles.retryBtn]} testID="upload-retry-all">
                <Ionicons name="refresh" size={16} color={colors.onBrandPrimary} />
                <Text style={styles.retryText}>Retry now</Text>
              </Pressable>
              <Pressable onPress={clearAll} style={[styles.actBtn, styles.clearBtn]} testID="upload-clear-all">
                <Text style={styles.clearText}>Clear all</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 44, paddingHorizontal: 12, borderRadius: 22, borderWidth: 1 },
  txt: { fontSize: 14, fontWeight: '800' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.onSurface, fontSize: 18, fontWeight: '800', fontFamily: fonts.display },
  hint: { color: colors.mutedText, fontSize: 12, lineHeight: 17, marginTop: 4, marginBottom: spacing.md },
  empty: { color: colors.onSurfaceTertiary, fontSize: 13, textAlign: 'center', paddingVertical: spacing.lg },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.sm, marginBottom: spacing.sm,
  },
  rowIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: colors.brandTertiary, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  rowMeta: { color: colors.mutedText, fontSize: 11.5, marginTop: 2 },
  rowErr: { color: colors.onError, fontSize: 11.5, marginTop: 2, lineHeight: 15 },
  cancelBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.error, borderWidth: 1, borderColor: colors.onError, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  actBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: radius.md },
  retryBtn: { flex: 1, backgroundColor: colors.brandPrimary },
  retryText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 14 },
  clearBtn: { paddingHorizontal: spacing.lg, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.error },
  clearText: { color: colors.onError, fontWeight: '800', fontSize: 14 },
});
