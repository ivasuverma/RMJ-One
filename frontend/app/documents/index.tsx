import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, TextInput, ActivityIndicator, Modal, Platform, PanResponder } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api, TOKEN_KEY } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { storage } from '@/src/utils/storage';
import { istTime, istDisplayDate, istDisplayDateTime } from '@/src/utils/datetime';
import { confirmAction } from '@/src/utils/confirm';
import { haptics } from '@/src/utils/haptics';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Sheet, useToast } from '@/src/components/ui';
import { DocumentCaptureSheet } from '@/src/components/DocumentCaptureSheet';
import { UploadQueueBadge } from '@/src/components/UploadQueueBadge';

type Doc = {
  id: string; category_key: string; status: 'pending' | 'done'; upload_state: string;
  file: { mime: string; orig_name: string; drive_view_link?: string | null };
  note?: string; created_at: string; recorded_at?: string | null; uploaded_by_name?: string;
  linked_ref?: { type: string; id: string; label?: string } | null;
};
type Cat = { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; can_record_roles?: string[]; can_record?: boolean; can_view?: boolean };

// Group documents (already newest-first) into per-day buckets, order preserved.
function groupByDay(docs: Doc[]): { day: string; items: Doc[] }[] {
  const out: { day: string; items: Doc[] }[] = [];
  const idx = new Map<string, Doc[]>();
  for (const d of docs) {
    const day = (d.created_at || '').slice(0, 10);
    let bucket = idx.get(day);
    if (!bucket) { bucket = []; idx.set(day, bucket); out.push({ day, items: bucket }); }
    bucket.push(d);
  }
  return out;
}

// A readable name for a document row/card. The raw upload filename is just a
// timestamp, so never show it — prefer the remark, then what it's linked to,
// then a friendly "<Category> · <date>".
function docTitle(d: Doc, catLabel?: string): string {
  const note = (d.note || '').trim();
  if (note) return note;
  if (d.linked_ref?.label) return d.linked_ref.label;
  return `${catLabel || 'Document'} · ${istDisplayDate(d.created_at)}`;
}
type Summary = { pending_count: number; done_count: number; uploading_count: number; drive_connected?: boolean; can_see_done?: boolean; by_category: Record<string, { pending: number; done: number }> };

export default function DocumentsScreen() {
  const router = useRouter();
  const { capture, tab: tabParam } = useLocalSearchParams<{ capture?: string; tab?: string }>();
  const { colors } = useTheme();
  const { user } = useAuth();
  const role = user?.role || '';
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();

  const [tab, setTab] = useState<'pending' | 'done'>(tabParam === 'done' ? 'done' : 'pending');
  const [doneCat, setDoneCat] = useState<string | null>(null);   // null in Done = folder view
  const [catFilter, setCatFilter] = useState('all');
  const [q, setQ] = useState('');
  const [docs, setDocs] = useState<Doc[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [token, setToken] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [captureOpen, setCaptureOpen] = useState(capture === '1');
  const [recordDoc, setRecordDoc] = useState<Doc | null>(null);
  const [viewer, setViewer] = useState<Doc | null>(null);
  const [recatDoc, setRecatDoc] = useState<Doc | null>(null);
  const [opening, setOpening] = useState(false);
  // Which day sections are expanded in the Done grid. Collapsed days don't
  // render their thumbnails, so only the day you open loads images — keeps a
  // big Done folder fast to open.
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({});

  const base = process.env.EXPO_PUBLIC_BACKEND_URL || '';
  const catMap = useMemo(() => Object.fromEntries(cats.map((c) => [c.key, c])), [cats]);
  // Prefer the per-account flag the server computes for this caller; fall back
  // to the role-based list only if an older payload didn't include it.
  const canRecord = (key: string) => {
    const c = catMap[key];
    if (c && typeof c.can_record === 'boolean') return c.can_record;
    return role === 'owner' || (c?.can_record_roles || []).includes(role);
  };
  const canDelete = role === 'owner' || role === 'admin';
  const fileUri = (id: string) => `${base}/api/documents/${id}/file`;

  // Open the full file (PDF or image) in a new tab. The file route needs a
  // bearer token, which window.open can't send — so fetch the blob first.
  const openFile = async (d: Doc) => {
    setOpening(true);
    try {
      // Ask for the full-size original (served from Drive when only a local
      // thumbnail remains after sync).
      const res = await fetch(`${fileUri(d.id)}?full=1`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error();
      const url = URL.createObjectURL(await res.blob());
      if (Platform.OS === 'web') window.open(url, '_blank');
    } catch { toast.error('Could not open the file'); }
    finally { setOpening(false); }
  };
  const del = (id: string) => confirmAction('Delete document?', 'Permanently removes it from RMJ One and from Google Drive. This cannot be undone.', 'Delete', async () => {
    try { await api.del(`/documents/${id}`); setViewer(null); toast.success('Deleted'); load(); }
    catch (e: any) { toast.error(e?.detail || 'Could not delete'); }
  });

  const load = useCallback(async () => {
    setToken((await storage.secureGet<string>(TOKEN_KEY, '')) || '');
    api.get<Cat[]>('/document-categories').then(setCats).catch(() => {});
    api.get<Summary>('/documents/summary').then(setSummary).catch(() => {});
    // Folder view (Done, no category picked, no search) needs no doc list —
    // folders come from the summary. But a search at the folder level runs a
    // UNIVERSAL search across every category (no category param below).
    if (tab === 'done' && !doneCat && !q.trim()) { setDocs([]); setLoading(false); setRefreshing(false); return; }
    const params = new URLSearchParams({ status: tab });
    const cat = tab === 'done' ? doneCat! : (catFilter !== 'all' ? catFilter : '');
    if (cat) params.set('category', cat);
    if (q.trim()) params.set('q', q.trim());
    try { setDocs(await api.get<Doc[]>(`/documents?${params.toString()}`)); } catch { setDocs([]); }
    finally { setLoading(false); setRefreshing(false); }
  }, [tab, catFilter, q, doneCat]);
  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const switchTab = (t: 'pending' | 'done') => { if (t === tab) return; haptics.selection(); setTab(t); setDoneCat(null); setLoading(true); };

  // If this person can't browse Done (e.g. deep-linked there), snap to Pending.
  useEffect(() => {
    if (summary && summary.can_see_done === false && tab === 'done') { setTab('pending'); setDoneCat(null); }
  }, [summary, tab]);

  const Thumb = ({ d, size }: { d: Doc; size: number }) => {
    const [loaded, setLoaded] = useState(false);
    const isImg = (d.file.mime || '').startsWith('image/') && !!token;
    return (
      <View style={[styles.thumb, { width: size, height: size, borderRadius: size > 60 ? 12 : 10 }]}>
        {isImg ? (
          <>
            <Image source={{ uri: fileUri(d.id), headers: { Authorization: `Bearer ${token}` } }} style={{ width: size, height: size }} contentFit="cover" cachePolicy="memory-disk" recyclingKey={d.id} transition={120} onLoadEnd={() => setLoaded(true)} />
            {!loaded && <View style={styles.thumbLoading}><ActivityIndicator size="small" color={colors.brandSecondary} /></View>}
          </>
        ) : (
          <Ionicons name="document-text-outline" size={size > 60 ? 30 : 22} color={colors.brandSecondary} />
        )}
      </View>
    );
  };

  const foldersView = () => {
    const withDone = cats.filter((c) => (summary?.by_category?.[c.key]?.done || 0) > 0);
    if (withDone.length === 0) {
      return <View style={styles.empty}><Ionicons name="folder-open-outline" size={34} color={colors.mutedText} /><Text style={styles.emptyText}>No recorded documents yet.</Text></View>;
    }
    return (
      <View style={styles.folderGroup}>
        {withDone.map((c, i) => {
          const t = TINTS(colors)[i % TINTS(colors).length];
          return (
            <Pressable key={c.key} onPress={() => { setDoneCat(c.key); setLoading(true); }} style={({ pressed }) => [styles.folderRow, i > 0 && styles.folderBorder, pressed && { opacity: 0.85 }]} testID={`doc-folder-${c.key}`}>
              <View style={[styles.folderIcon, { backgroundColor: t.bg }]}><Ionicons name={c.icon || 'document-outline'} size={18} color={t.fg} /></View>
              <Text style={styles.folderLabel}>{c.label}</Text>
              <Text style={styles.folderCount}>{summary?.by_category?.[c.key]?.done || 0}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.mutedText} />
            </Pressable>
          );
        })}
      </View>
    );
  };

  const gridView = () => (
    <>
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={colors.mutedText} />
        <TextInput value={q} onChangeText={setQ} onSubmitEditing={load} placeholder="Search by name, remark or date" placeholderTextColor={colors.mutedText} style={styles.searchInput} returnKeyType="search" testID="doc-done-search" />
        {q.length > 0 && <Pressable onPress={() => { setQ(''); setTimeout(load, 0); }} hitSlop={8}><Ionicons name="close-circle" size={16} color={colors.mutedText} /></Pressable>}
      </View>
      {docs.length === 0 ? <View style={styles.empty}><Text style={styles.emptyText}>{q ? 'No matches.' : 'Empty folder.'}</Text></View> : (
        groupByDay(docs).map((g, gi) => {
          const open = openDays[g.day] ?? (gi === 0);   // newest day open by default
          return (
          <View key={g.day}>
            <Pressable onPress={() => setOpenDays((m) => ({ ...m, [g.day]: !open }))} style={styles.dayHeaderRow} testID={`doc-day-${g.day}`}>
              <Text style={[styles.dayHeader, { flex: 1 }]}>{istDisplayDate(g.items[0]?.created_at) || g.day}</Text>
              <Text style={styles.dayCount}>{g.items.length}</Text>
              <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.mutedText} />
            </Pressable>
            {open && (
              <View style={styles.grid}>
                {g.items.map((d) => {
                  const cap = (d.note || d.linked_ref?.label || '').trim();
                  return (
                    <Pressable key={d.id} onPress={() => setViewer(d)} style={[styles.gridItem, { width: GRID }]} testID={`doc-grid-${d.id}`}>
                      <View>
                        <Thumb d={d} size={GRID} />
                        {d.upload_state === 'synced' && <View style={styles.syncBadge}><Ionicons name="cloud-done" size={11} color={colors.onSuccess} /></View>}
                      </View>
                      {!!cap && <Text style={styles.gridCaption} numberOfLines={2}>{cap}</Text>}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
          );
        })
      )}
    </>
  );

  // Done landing: one search box that searches EVERY category at once. With a
  // query it shows cross-category results (each row tagged with its category);
  // empty, it shows the category folders.
  const doneRoot = () => (
    <>
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={colors.mutedText} />
        <TextInput value={q} onChangeText={setQ} onSubmitEditing={load} placeholder="Search all recorded documents" placeholderTextColor={colors.mutedText} style={styles.searchInput} returnKeyType="search" testID="doc-done-search-all" />
        {q.length > 0 && <Pressable onPress={() => { setQ(''); setTimeout(load, 0); }} hitSlop={8}><Ionicons name="close-circle" size={16} color={colors.mutedText} /></Pressable>}
      </View>
      {!q.trim() ? foldersView() : (
        docs.length === 0 ? <View style={styles.empty}><Text style={styles.emptyText}>No matches across any category.</Text></View> : (
          groupByDay(docs).map((g) => (
            <View key={g.day}>
              <Text style={styles.dayHeader}>{istDisplayDate(g.items[0]?.created_at) || g.day}</Text>
              {g.items.map((d) => (
                <View key={d.id} style={styles.row} testID={`doc-result-${d.id}`}>
                  <Pressable onPress={() => setViewer(d)} style={styles.rowMain}>
                    <Thumb d={d} size={46} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.docName} numberOfLines={1}>{docTitle(d, catMap[d.category_key]?.label)}</Text>
                      <Text style={styles.docMeta} numberOfLines={1}>{catMap[d.category_key]?.label || d.category_key} · {istTime(d.created_at)}{d.uploaded_by_name ? ` · ${d.uploaded_by_name}` : ''}</Text>
                    </View>
                  </Pressable>
                  {d.upload_state === 'synced' && <Ionicons name="cloud-done" size={15} color={colors.onSuccess} />}
                </View>
              ))}
            </View>
          ))
        )
      )}
    </>
  );

  const pendingView = () => (
    loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 30 }} /> :
      docs.length === 0 ? <View style={styles.empty}><Ionicons name="checkmark-circle-outline" size={34} color={colors.mutedText} /><Text style={styles.emptyText}>Nothing pending — all slips recorded.</Text></View> :
        docs.map((d) => {
          const uploading = d.upload_state === 'queued' || d.upload_state === 'uploading';
          return (
            <View key={d.id} style={styles.row} testID={`doc-${d.id}`}>
              <Pressable onPress={() => setViewer(d)} style={styles.rowMain}>
                <Thumb d={d} size={46} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.docName} numberOfLines={1}>{docTitle(d, catMap[d.category_key]?.label)}</Text>
                  <Text style={styles.docMeta} numberOfLines={1}>{catMap[d.category_key]?.label || d.category_key} · {istTime(d.created_at)}{d.uploaded_by_name ? ` · ${d.uploaded_by_name}` : ''}{uploading ? ' · uploading' : ''}</Text>
                </View>
              </Pressable>
              {canRecord(d.category_key) && (
                <Pressable onPress={() => setRecordDoc(d)} style={styles.recBtn} testID={`doc-record-${d.id}`}><Text style={styles.recBtnText}>Record</Text></Pressable>
              )}
            </View>
          );
        })
  );

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="documents-screen">
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}>
        <Pressable onPress={() => (doneCat ? setDoneCat(null) : router.back())} style={styles.backRow} hitSlop={8} testID="back-btn">
          <Ionicons name="chevron-back" size={18} color={colors.brandPrimary} />
          <Text style={styles.backText}>{doneCat ? 'Folders' : 'Work'}</Text>
        </Pressable>
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.h1}>{doneCat ? (catMap[doneCat]?.label || 'Documents') : 'Documents'}</Text>
            {!doneCat && <Text style={styles.sub}>Snap · record · filed &amp; searchable.</Text>}
          </View>
          <UploadQueueBadge />
          <View style={styles.drivePill}>
            {summary && summary.uploading_count > 0
              ? <><Ionicons name="cloud-upload-outline" size={13} color={colors.onWarning} /><Text style={[styles.drivePillText, { color: colors.onWarning }]}>{summary.uploading_count} uploading</Text></>
              : summary?.drive_connected
                ? <><Ionicons name="cloud-done-outline" size={13} color={colors.onSuccess} /><Text style={[styles.drivePillText, { color: colors.onSuccess }]}>Synced</Text></>
                : <><Ionicons name="phone-portrait-outline" size={13} color={colors.mutedText} /><Text style={[styles.drivePillText, { color: colors.mutedText }]}>Local</Text></>}
          </View>
        </View>

        {/* The Done tab only appears for people allowed to browse the Done
            folder (Settings › People). Pending is always the default. When
            Done is hidden there's nothing to segment, so drop the control. */}
        {!doneCat && summary?.can_see_done !== false && (
          <View style={styles.seg}>
            {(['pending', 'done'] as const).map((t) => (
              <Pressable key={t} onPress={() => switchTab(t)} style={[styles.sg, tab === t && styles.sgOn]} testID={`doc-tab-${t}`}>
                <Text style={[styles.sgText, tab === t && styles.sgTextOn]}>{t === 'pending' ? 'Pending' : 'Done'}{t === 'pending' && summary ? <Text style={styles.sgCount}> {summary.pending_count}</Text> : null}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {tab === 'pending' && (
          <>
            {cats.some((c) => (summary?.by_category?.[c.key]?.pending || 0) > 0) && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                <Pressable onPress={() => setCatFilter('all')} style={[styles.chip, catFilter === 'all' && styles.chipOn]}><Text style={[styles.chipText, catFilter === 'all' && styles.chipTextOn]}>All</Text></Pressable>
                {cats.filter((c) => (summary?.by_category?.[c.key]?.pending || 0) > 0).map((c) => (
                  <Pressable key={c.key} onPress={() => setCatFilter(c.key)} style={[styles.chip, catFilter === c.key && styles.chipOn]} testID={`doc-catchip-${c.key}`}><Text style={[styles.chipText, catFilter === c.key && styles.chipTextOn]}>{c.label}</Text></Pressable>
                ))}
              </ScrollView>
            )}
            <View style={styles.searchWrap}>
              <Ionicons name="search" size={16} color={colors.mutedText} />
              <TextInput value={q} onChangeText={setQ} onSubmitEditing={load} placeholder="Search by name or note" placeholderTextColor={colors.mutedText} style={styles.searchInput} returnKeyType="search" testID="doc-search" />
              {q.length > 0 && <Pressable onPress={() => { setQ(''); setTimeout(load, 0); }} hitSlop={8}><Ionicons name="close-circle" size={16} color={colors.mutedText} /></Pressable>}
            </View>
            {pendingView()}
          </>
        )}

        {tab === 'done' && (loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 30 }} /> : (doneCat ? gridView() : doneRoot()))}

        <View style={{ height: spacing.xxxl }} />
      </ScrollView>

      {!doneCat && (
        <Pressable onPress={() => setCaptureOpen(true)} style={styles.fab} testID="documents-add-btn"><Ionicons name="add" size={26} color={colors.onBrandPrimary} /></Pressable>
      )}

      <DocumentCaptureSheet visible={captureOpen} onClose={() => setCaptureOpen(false)} onSaved={load} />
      <RecordSheet doc={recordDoc} categoryLabel={recordDoc ? (catMap[recordDoc.category_key]?.label || recordDoc.category_key) : ''}
        onClose={() => setRecordDoc(null)} onDone={() => { setRecordDoc(null); setViewer(null); haptics.success(); toast.success('Recorded'); load(); }} />
      <QuickView doc={viewer} categoryLabel={viewer ? (catMap[viewer.category_key]?.label || viewer.category_key) : ''} token={token} fileUri={fileUri}
        onClose={() => setViewer(null)} onRecord={(d) => setRecordDoc(d)} canRecord={viewer ? canRecord(viewer.category_key) : false}
        canDelete={canDelete} onDelete={del} onOpenFile={openFile} opening={opening}
        list={docs} onNavigate={(d) => setViewer(d)} onChangeCategory={(d) => setRecatDoc(d)} />
      <RecatSheet doc={recatDoc} cats={cats.filter((c) => canRecord(c.key))}
        onClose={() => setRecatDoc(null)}
        onDone={() => { setRecatDoc(null); setViewer(null); haptics.success(); toast.success('Category changed'); load(); }} />
    </SafeAreaView>
  );
}

// 4-up condensed grid (was 3-up). Tighter gaps, smaller tiles.
const GRID = Math.floor((360 - spacing.lg * 2 - 6 * 3) / 4);
const TINTS = (c: ThemeColors) => [
  { bg: c.brandTertiary, fg: c.brandSecondary }, { bg: c.success, fg: c.onSuccess }, { bg: c.info, fg: c.onInfo },
  { bg: c.warning, fg: c.onWarning }, { bg: c.error, fg: c.onError },
];

/* ---------------- Quick view (full-screen) ---------------- */
function QuickView({ doc, categoryLabel, token, fileUri, onClose, onRecord, canRecord, canDelete, onDelete, onOpenFile, opening, list, onNavigate, onChangeCategory }: {
  doc: Doc | null; categoryLabel: string; token: string; fileUri: (id: string) => string;
  onClose: () => void; onRecord: (d: Doc) => void; canRecord: boolean; canDelete: boolean;
  onDelete: (id: string) => void; onOpenFile: (d: Doc) => void; opening: boolean;
  list: Doc[]; onNavigate: (d: Doc) => void; onChangeCategory: (d: Doc) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const [imgLoaded, setImgLoaded] = useState(false);
  const idx = doc ? list.findIndex((x) => x.id === doc.id) : -1;
  const go = (dir: number) => {
    const n = idx + dir;
    if (n >= 0 && n < list.length) { setImgLoaded(false); onNavigate(list[n]); }
  };
  // Swipe left → next, swipe right → previous (through the current list).
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 24 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderRelease: (_e, g) => { if (g.dx <= -50) go(1); else if (g.dx >= 50) go(-1); },
  }), [idx, list]);
  if (!doc) return null;
  const isImage = (doc.file.mime || '').startsWith('image/');
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.qvRoot}>
        <View style={[styles.qvBar, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.qvCloseBtn} testID="qv-close">
            <Ionicons name="chevron-back" size={18} color={colors.onSurface} />
            <Text style={styles.qvClose}>Close</Text>
          </Pressable>
          <Text style={styles.qvCat} numberOfLines={1}>{categoryLabel}</Text>
          {canDelete
            ? <Pressable onPress={() => onDelete(doc.id)} hitSlop={10} style={styles.qvIconBtn} testID="qv-delete"><Ionicons name="trash-outline" size={19} color={colors.onError} /></Pressable>
            : <View style={styles.qvIconBtn} />}
        </View>
        <View style={styles.qvImgWrap} {...pan.panHandlers}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !isImage && onOpenFile(doc)} />
          {isImage && token
            ? <Image key={doc.id} source={{ uri: `${fileUri(doc.id)}?full=1`, headers: { Authorization: `Bearer ${token}` } }} style={styles.qvImg} contentFit="contain" onLoadEnd={() => setImgLoaded(true)} />
            : <View style={{ alignItems: 'center', gap: 10 }}>
                {opening
                  ? <><ActivityIndicator color="#fff" size="large" /><Text style={{ color: '#fff', fontWeight: '700' }}>Opening…</Text></>
                  : <><Ionicons name="document-text-outline" size={64} color={colors.mutedText} /><Text style={{ color: '#fff', fontWeight: '700' }}>Tap to open PDF</Text></>}
              </View>}
          {isImage && !imgLoaded && <View style={styles.qvImgLoading} pointerEvents="none"><ActivityIndicator color="#fff" size="large" /></View>}
          {idx > 0 && <Pressable onPress={() => go(-1)} style={[styles.qvNav, { left: 6 }]} testID="qv-prev"><Ionicons name="chevron-back" size={26} color="#fff" /></Pressable>}
          {idx >= 0 && idx < list.length - 1 && <Pressable onPress={() => go(1)} style={[styles.qvNav, { right: 6 }]} testID="qv-next"><Ionicons name="chevron-forward" size={26} color="#fff" /></Pressable>}
          <View style={styles.qvStamp}><Ionicons name={doc.upload_state === 'synced' ? 'cloud-done' : 'phone-portrait-outline'} size={12} color={colors.onSurface} /><Text style={styles.qvStampText}>{doc.upload_state === 'synced' ? 'In Drive' : 'Local'}{list.length > 1 && idx >= 0 ? ` · ${idx + 1}/${list.length}` : ''}</Text></View>
        </View>
        <View style={styles.qvPanel}>
          <Text style={styles.qvName} numberOfLines={2}>{docTitle(doc, categoryLabel)}</Text>
          <Text style={styles.qvMeta}>{doc.uploaded_by_name ? `By ${doc.uploaded_by_name} · ` : ''}{istDisplayDateTime(doc.recorded_at || doc.created_at)}</Text>
          <View style={styles.qvActions}>
            <Pressable onPress={() => onOpenFile(doc)} disabled={opening} style={styles.qvBtn} testID="qv-open">
              {opening ? <ActivityIndicator size="small" color={colors.onSurface} /> : <Ionicons name="expand-outline" size={16} color={colors.onSurface} />}
              <Text style={styles.qvBtnText}>{opening ? 'Opening…' : (isImage ? 'Open full size' : 'Open PDF')}</Text>
            </Pressable>
            {canRecord && (
              doc.status === 'pending'
                ? <Pressable onPress={() => onRecord(doc)} style={[styles.qvBtn, styles.qvBtnPrimary]} testID="qv-record"><Ionicons name="checkmark-done-outline" size={16} color={colors.onBrandPrimary} /><Text style={[styles.qvBtnText, { color: colors.onBrandPrimary }]}>Done</Text></Pressable>
                : <Pressable onPress={() => onRecord(doc)} style={styles.qvBtn} testID="qv-edit-remark"><Ionicons name="create-outline" size={16} color={colors.onSurface} /><Text style={styles.qvBtnText}>Edit remark</Text></Pressable>
            )}
            {canRecord && doc.status === 'done' && (
              <Pressable onPress={() => onChangeCategory(doc)} style={styles.qvBtn} testID="qv-recat"><Ionicons name="swap-horizontal-outline" size={16} color={colors.onSurface} /><Text style={styles.qvBtnText}>Change category</Text></Pressable>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ---------------- Move to Done sheet — a single searchable remark ---------------- */
function RecordSheet({ doc, categoryLabel, onClose, onDone }: { doc: Doc | null; categoryLabel: string; onClose: () => void; onDone: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setNote(doc?.note || ''); }, [doc?.id]);

  const submit = async () => {
    if (!doc || busy) return;
    setBusy(true);
    try {
      // Store the remark as both note and linked label so it's searchable and
      // shows on the Done row (name + phone in one box for easy lookup).
      const n = note.trim();
      await api.patch(`/documents/${doc.id}/record`, { note: n, linked_ref_label: n || undefined });
      setBusy(false); onDone();
    } catch (e: any) { toast.error(e?.detail || 'Could not save'); setBusy(false); }
  };

  const isDone = doc?.status === 'done';
  return (
    <Sheet visible={!!doc} onClose={onClose} title={isDone ? 'Edit remark' : 'Move to Done'} testID="doc-record-sheet">
      <Text style={styles.recHint}>{categoryLabel} · add a remark so it&apos;s easy to find later — name, phone, invoice no.</Text>
      <TextInput value={note} onChangeText={setNote} placeholder="e.g. Anita Sharma · 98xxxxxxxx" placeholderTextColor={colors.mutedText} style={styles.noteInput} autoFocus testID="rec-note" />
      <View style={{ height: spacing.md }} />
      <Pressable onPress={submit} disabled={busy} style={[styles.recPrimary, busy && { opacity: 0.5 }]} testID="rec-confirm">
        {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.recPrimaryText}>{isDone ? 'Save' : 'Done'}</Text>}
      </Pressable>
    </Sheet>
  );
}

/* ---------------- Change category sheet ---------------- */
function RecatSheet({ doc, cats, onClose, onDone }: { doc: Doc | null; cats: Cat[]; onClose: () => void; onDone: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const options = cats.filter((c) => c.key !== doc?.category_key);

  const pick = async (key: string) => {
    if (!doc || busy) return;
    setBusy(key);
    try {
      await api.patch(`/documents/${doc.id}/category`, { category_key: key });
      setBusy(''); onDone();
    } catch (e: any) { toast.error(e?.detail || 'Could not change category'); setBusy(''); }
  };

  return (
    <Sheet visible={!!doc} onClose={onClose} title="Change category" testID="doc-recat-sheet">
      <Text style={styles.recHint}>Move this document to a different category.</Text>
      <View style={{ height: spacing.sm }} />
      {options.map((c) => (
        <Pressable key={c.key} onPress={() => pick(c.key)} disabled={!!busy} style={styles.recatRow} testID={`recat-${c.key}`}>
          <Ionicons name="folder-outline" size={18} color={colors.brandSecondary} />
          <Text style={styles.recatRowText}>{c.label}</Text>
          {busy === c.key ? <ActivityIndicator size="small" color={colors.brandSecondary} /> : <Ionicons name="chevron-forward" size={16} color={colors.mutedText} />}
        </Pressable>
      ))}
      {options.length === 0 && <Text style={styles.recHint}>No other category you can record into.</Text>}
    </Sheet>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  recatRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: colors.border },
  recatRowText: { flex: 1, color: colors.onSurface, fontSize: 16, fontWeight: '600' },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 6 },
  backText: { color: colors.brandPrimary, fontSize: 16, fontWeight: '500' },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  h1: { color: colors.onSurface, fontSize: 32, fontWeight: '800', fontFamily: fonts.display, letterSpacing: -0.6 },
  sub: { color: colors.onSurfaceSecondary, fontSize: 15, marginTop: 6 },
  drivePill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  drivePillText: { fontSize: 12, fontWeight: '700' },

  seg: { flexDirection: 'row', backgroundColor: colors.surfaceTertiary, borderRadius: 12, padding: 4, gap: 3, marginTop: spacing.lg },
  sg: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 9 },
  sgOn: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.borderStrong },
  sgText: { color: colors.mutedText, fontSize: 14, fontWeight: '600' },
  sgTextOn: { color: colors.onSurface },
  sgCount: { color: colors.brandSecondary, fontWeight: '800' },

  chips: { gap: 8, paddingVertical: spacing.md, paddingRight: spacing.lg },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 12.5, fontWeight: '700' },
  chipTextOn: { color: colors.onBrandPrimary },

  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, marginBottom: spacing.md },
  searchInput: { flex: 1, color: colors.onSurface, fontSize: 14, paddingVertical: 11 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, marginBottom: 10 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 13, minWidth: 0 },
  thumb: { backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumbLoading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceTertiary },
  dayHeader: { color: colors.mutedText, fontSize: 12, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase', marginTop: spacing.md, marginBottom: 2 },
  dayHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dayCount: { color: colors.mutedText, fontSize: 12, fontWeight: '700' },
  docName: { color: colors.onSurface, fontSize: 15, fontWeight: '600' },
  docMeta: { color: colors.mutedText, fontSize: 12.5, marginTop: 2 },
  recBtn: { backgroundColor: colors.brandPrimary, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  recBtnText: { color: colors.onBrandPrimary, fontSize: 13, fontWeight: '700' },

  // Done folders
  folderGroup: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginTop: spacing.md },
  folderRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13, paddingHorizontal: spacing.md },
  folderBorder: { borderTopWidth: 1, borderTopColor: colors.divider },
  folderIcon: { width: 40, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  folderLabel: { flex: 1, color: colors.onSurface, fontSize: 17, fontWeight: '600' },
  folderCount: { color: colors.mutedText, fontSize: 16, fontWeight: '600' },

  // Done grid
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.md },
  gridItem: { position: 'relative' },
  gridCaption: { color: colors.onSurfaceSecondary, fontSize: 10, marginTop: 3, lineHeight: 13 },
  syncBadge: { position: 'absolute', right: 5, bottom: 5, width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },

  empty: { alignItems: 'center', paddingVertical: 40, gap: spacing.sm },
  emptyText: { color: colors.onSurfaceTertiary },
  fab: { position: 'absolute', right: spacing.lg, bottom: spacing.lg, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4 },

  // Quick view
  qvRoot: { flex: 1, backgroundColor: '#000' },
  qvBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.md, backgroundColor: 'rgba(20,20,24,0.96)', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.14)' },
  qvCloseBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.12)' },
  qvClose: { color: colors.onSurface, fontSize: 15, fontWeight: '700' },
  qvIconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  qvCat: { flex: 1, textAlign: 'center', color: '#fff', fontSize: 16, fontWeight: '800' },
  qvImgWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  qvImg: { width: '100%', height: '100%' },
  qvImgLoading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  qvNav: { position: 'absolute', top: '50%', marginTop: -22, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
  qvStamp: { position: 'absolute', top: spacing.md, right: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(30,30,34,0.9)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  qvStampText: { color: colors.onSurface, fontSize: 11, fontWeight: '700' },
  qvPanel: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: spacing.xxl, gap: 8 },
  qvName: { color: colors.onSurface, fontSize: 16, fontWeight: '700' },
  qvLink: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10 },
  qvLinkText: { flex: 1, color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  qvMeta: { color: colors.mutedText, fontSize: 12.5 },
  qvActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  qvBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 13, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.borderStrong },
  qvBtnPrimary: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  qvBtnText: { color: colors.onSurface, fontSize: 14, fontWeight: '700' },

  // Record sheet
  recHint: { color: colors.mutedText, fontSize: 13, marginBottom: spacing.md },
  noteInput: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: 13, fontSize: 15 },
  recTypeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  recType: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  recTypeOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  recTypeText: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: '700' },
  recTypeTextOn: { color: colors.onBrandPrimary },
  hitRow: { paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.divider },
  hitName: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  hitSub: { color: colors.mutedText, fontSize: 12, marginTop: 1 },
  pickedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md },
  pickedName: { flex: 1, color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  changeText: { color: colors.brandSecondary, fontSize: 13, fontWeight: '700' },
  recPrimary: { backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center' },
  recPrimaryText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: '700' },
  recGhost: { paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  recGhostText: { color: colors.mutedText, fontSize: 14, fontWeight: '600' },
});
