import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, TextInput, ActivityIndicator, Modal, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api, TOKEN_KEY } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { storage } from '@/src/utils/storage';
import { istTime, istDisplayDateTime } from '@/src/utils/datetime';
import { haptics } from '@/src/utils/haptics';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Sheet, useToast } from '@/src/components/ui';
import { DocumentCaptureSheet } from '@/src/components/DocumentCaptureSheet';

type Doc = {
  id: string; category_key: string; status: 'pending' | 'done'; upload_state: string;
  file: { mime: string; orig_name: string; drive_view_link?: string | null };
  note?: string; created_at: string; recorded_at?: string | null; uploaded_by_name?: string;
  linked_ref?: { type: string; id: string; label?: string } | null;
};
type Cat = { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; can_record_roles?: string[] };
type Summary = { pending_count: number; done_count: number; uploading_count: number; by_category: Record<string, { pending: number; done: number }> };

const LINK_TYPES: { key: string; label: string; endpoint: string }[] = [
  { key: 'customer', label: 'Customer', endpoint: '/customers' },
  { key: 'karigar', label: 'Karigar', endpoint: '/karigars' },
  { key: 'employee', label: 'Employee', endpoint: '/employees' },
  { key: 'repair', label: 'Repair', endpoint: '/repair-items' },
];
const LINK_ROUTE: Record<string, (id: string) => string> = {
  customer: (id) => `/customers/${id}`, karigar: (id) => `/karigars/${id}`,
  employee: (id) => `/ledger/${id}`, repair: (id) => `/repairs/item/${id}`,
};

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

  const base = process.env.EXPO_PUBLIC_BACKEND_URL || '';
  const catMap = useMemo(() => Object.fromEntries(cats.map((c) => [c.key, c])), [cats]);
  const canRecord = (key: string) => role === 'owner' || (catMap[key]?.can_record_roles || []).includes(role);
  const fileUri = (id: string) => `${base}/api/documents/${id}/file`;

  const load = useCallback(async () => {
    setToken((await storage.secureGet<string>(TOKEN_KEY, '')) || '');
    api.get<Cat[]>('/document-categories').then(setCats).catch(() => {});
    api.get<Summary>('/documents/summary').then(setSummary).catch(() => {});
    // Folder view (Done, no category picked) needs no doc list — folders come from the summary.
    if (tab === 'done' && !doneCat) { setDocs([]); setLoading(false); setRefreshing(false); return; }
    const params = new URLSearchParams({ status: tab });
    const cat = tab === 'done' ? doneCat! : (catFilter !== 'all' ? catFilter : '');
    if (cat) params.set('category', cat);
    if (tab === 'pending' && q.trim()) params.set('q', q.trim());
    try { setDocs(await api.get<Doc[]>(`/documents?${params.toString()}`)); } catch { setDocs([]); }
    finally { setLoading(false); setRefreshing(false); }
  }, [tab, catFilter, q, doneCat]);
  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const switchTab = (t: 'pending' | 'done') => { if (t === tab) return; haptics.selection(); setTab(t); setDoneCat(null); setLoading(true); };

  const Thumb = ({ d, size }: { d: Doc; size: number }) => (
    <View style={[styles.thumb, { width: size, height: size, borderRadius: size > 60 ? 12 : 10 }]}>
      {(d.file.mime || '').startsWith('image/') && token ? (
        <Image source={{ uri: fileUri(d.id), headers: { Authorization: `Bearer ${token}` } }} style={{ width: size, height: size }} contentFit="cover" />
      ) : (
        <Ionicons name="document-text-outline" size={size > 60 ? 30 : 22} color={colors.brandSecondary} />
      )}
    </View>
  );

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
    docs.length === 0 ? <View style={styles.empty}><Text style={styles.emptyText}>Empty folder.</Text></View> : (
      <View style={styles.grid}>
        {docs.map((d) => (
          <Pressable key={d.id} onPress={() => setViewer(d)} style={styles.gridItem} testID={`doc-grid-${d.id}`}>
            <Thumb d={d} size={GRID} />
            {d.upload_state === 'synced' && <View style={styles.syncBadge}><Ionicons name="cloud-done" size={11} color={colors.onSuccess} /></View>}
          </Pressable>
        ))}
      </View>
    )
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
                  <Text style={styles.docName} numberOfLines={1}>{d.note || d.file.orig_name}</Text>
                  <Text style={styles.docMeta} numberOfLines={1}>{catMap[d.category_key]?.label || d.category_key} · {istTime(d.created_at)}{uploading ? ' · uploading' : ''}</Text>
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
          <View style={styles.drivePill}>
            {summary && summary.uploading_count > 0
              ? <><Ionicons name="cloud-upload-outline" size={13} color={colors.onWarning} /><Text style={[styles.drivePillText, { color: colors.onWarning }]}>{summary.uploading_count} uploading</Text></>
              : <><Ionicons name="cloud-done-outline" size={13} color={colors.onSuccess} /><Text style={[styles.drivePillText, { color: colors.onSuccess }]}>Local</Text></>}
          </View>
        </View>

        {!doneCat && (
          <View style={styles.seg}>
            {(['pending', 'done'] as const).map((t) => (
              <Pressable key={t} onPress={() => switchTab(t)} style={[styles.sg, tab === t && styles.sgOn]} testID={`doc-tab-${t}`}>
                <Text style={[styles.sgText, tab === t && styles.sgTextOn]}>{t === 'pending' ? 'Pending' : 'Done'} {summary ? <Text style={styles.sgCount}>{t === 'pending' ? summary.pending_count : summary.done_count}</Text> : null}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {tab === 'pending' && (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              <Pressable onPress={() => setCatFilter('all')} style={[styles.chip, catFilter === 'all' && styles.chipOn]}><Text style={[styles.chipText, catFilter === 'all' && styles.chipTextOn]}>All</Text></Pressable>
              {cats.map((c) => (
                <Pressable key={c.key} onPress={() => setCatFilter(c.key)} style={[styles.chip, catFilter === c.key && styles.chipOn]} testID={`doc-catchip-${c.key}`}><Text style={[styles.chipText, catFilter === c.key && styles.chipTextOn]}>{c.label}</Text></Pressable>
              ))}
            </ScrollView>
            <View style={styles.searchWrap}>
              <Ionicons name="search" size={16} color={colors.mutedText} />
              <TextInput value={q} onChangeText={setQ} onSubmitEditing={load} placeholder="Search by name or note" placeholderTextColor={colors.mutedText} style={styles.searchInput} returnKeyType="search" testID="doc-search" />
              {q.length > 0 && <Pressable onPress={() => { setQ(''); setTimeout(load, 0); }} hitSlop={8}><Ionicons name="close-circle" size={16} color={colors.mutedText} /></Pressable>}
            </View>
            {pendingView()}
          </>
        )}

        {tab === 'done' && (loading ? <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: 30 }} /> : (doneCat ? gridView() : foldersView()))}

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
        onOpenLink={(lr) => { const r = LINK_ROUTE[lr.type]; if (r) { setViewer(null); router.push(r(lr.id) as any); } }} />
    </SafeAreaView>
  );
}

const GRID = Math.floor((360 - spacing.lg * 2 - 16) / 3);
const TINTS = (c: ThemeColors) => [
  { bg: c.brandTertiary, fg: c.brandSecondary }, { bg: c.success, fg: c.onSuccess }, { bg: c.info, fg: c.onInfo },
  { bg: c.warning, fg: c.onWarning }, { bg: c.error, fg: c.onError },
];

/* ---------------- Quick view (full-screen) ---------------- */
function QuickView({ doc, categoryLabel, token, fileUri, onClose, onRecord, canRecord, onOpenLink }: {
  doc: Doc | null; categoryLabel: string; token: string; fileUri: (id: string) => string;
  onClose: () => void; onRecord: (d: Doc) => void; canRecord: boolean; onOpenLink: (lr: { type: string; id: string }) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (!doc) return null;
  const isImage = (doc.file.mime || '').startsWith('image/');
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.qvRoot}>
        <View style={styles.qvBar}>
          <Pressable onPress={onClose} hitSlop={10} testID="qv-close"><Text style={styles.qvClose}>Done</Text></Pressable>
          <Text style={styles.qvCat} numberOfLines={1}>{categoryLabel}</Text>
          <View style={{ width: 44 }} />
        </View>
        <View style={styles.qvImgWrap}>
          {isImage && token
            ? <Image source={{ uri: fileUri(doc.id), headers: { Authorization: `Bearer ${token}` } }} style={styles.qvImg} contentFit="contain" />
            : <Ionicons name="document-text-outline" size={64} color={colors.mutedText} />}
          <View style={styles.qvStamp}><Ionicons name={doc.upload_state === 'synced' ? 'cloud-done' : 'cloud-upload-outline'} size={12} color={colors.onSurface} /><Text style={styles.qvStampText}>{doc.upload_state === 'synced' ? 'In Drive' : 'Local'}</Text></View>
        </View>
        <View style={styles.qvPanel}>
          <Text style={styles.qvName} numberOfLines={2}>{doc.note || doc.file.orig_name}</Text>
          {doc.linked_ref?.label ? (
            <Pressable onPress={() => onOpenLink(doc.linked_ref!)} style={styles.qvLink} testID="qv-link">
              <Ionicons name="link-outline" size={15} color={colors.brandSecondary} />
              <Text style={styles.qvLinkText}>{doc.linked_ref.label}</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.mutedText} />
            </Pressable>
          ) : null}
          <Text style={styles.qvMeta}>{doc.uploaded_by_name ? `By ${doc.uploaded_by_name} · ` : ''}{istDisplayDateTime(doc.recorded_at || doc.created_at)}</Text>
          <View style={styles.qvActions}>
            {doc.file.drive_view_link ? (
              <Pressable onPress={() => { if (Platform.OS === 'web') window.open(doc.file.drive_view_link!, '_blank'); }} style={styles.qvBtn} testID="qv-drive"><Ionicons name="open-outline" size={16} color={colors.onSurface} /><Text style={styles.qvBtnText}>Open in Drive</Text></Pressable>
            ) : null}
            {doc.status === 'pending' && canRecord && (
              <Pressable onPress={() => onRecord(doc)} style={[styles.qvBtn, styles.qvBtnPrimary]} testID="qv-record"><Ionicons name="checkmark-done-outline" size={16} color={colors.onBrandPrimary} /><Text style={[styles.qvBtnText, { color: colors.onBrandPrimary }]}>Record in books</Text></Pressable>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ---------------- Record → Done sheet ---------------- */
function RecordSheet({ doc, categoryLabel, onClose, onDone }: { doc: Doc | null; categoryLabel: string; onClose: () => void; onDone: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const [type, setType] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ id: string; label: string; sub?: string }[]>([]);
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const reset = () => { setType(null); setQ(''); setHits([]); setPicked(null); setBusy(false); };

  const search = async (t: string, query: string) => {
    const def = LINK_TYPES.find((l) => l.key === t);
    if (!def || !query.trim()) { setHits([]); return; }
    try {
      const res = await api.get<any[]>(`${def.endpoint}?q=${encodeURIComponent(query.trim())}`);
      setHits(res.slice(0, 12).map((r) => (t === 'repair'
        ? { id: r.id, label: `${r.item_code} — ${r.customer_name}`, sub: r.description }
        : { id: r.id, label: r.name, sub: r.mobile || r.employee_code })));
    } catch { setHits([]); }
  };
  const submit = async (withLink: boolean) => {
    if (!doc || busy) return;
    setBusy(true);
    try {
      await api.patch(`/documents/${doc.id}/record`, withLink && picked && type ? { linked_ref_type: type, linked_ref_id: picked.id, linked_ref_label: picked.label } : {});
      reset(); onDone();
    } catch (e: any) { toast.error(e?.detail || 'Could not record'); setBusy(false); }
  };

  return (
    <Sheet visible={!!doc} onClose={() => { reset(); onClose(); }} title="Record in books" testID="doc-record-sheet">
      <Text style={styles.recHint}>{categoryLabel} · link this document to the record it belongs to.</Text>
      <View style={styles.recTypeRow}>
        {LINK_TYPES.map((l) => (
          <Pressable key={l.key} onPress={() => { setType(l.key); setPicked(null); setHits([]); setQ(''); }} style={[styles.recType, type === l.key && styles.recTypeOn]} testID={`rec-type-${l.key}`}><Text style={[styles.recTypeText, type === l.key && styles.recTypeTextOn]}>{l.label}</Text></Pressable>
        ))}
      </View>
      {type && !picked && (
        <>
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={16} color={colors.mutedText} />
            <TextInput value={q} onChangeText={(v) => { setQ(v); search(type, v); }} placeholder={`Search ${type}…`} placeholderTextColor={colors.mutedText} style={styles.searchInput} autoFocus testID="rec-search" />
          </View>
          {hits.map((h) => (
            <Pressable key={h.id} onPress={() => setPicked({ id: h.id, label: h.label })} style={styles.hitRow} testID={`rec-hit-${h.id}`}>
              <Text style={styles.hitName} numberOfLines={1}>{h.label}</Text>{!!h.sub && <Text style={styles.hitSub} numberOfLines={1}>{h.sub}</Text>}
            </Pressable>
          ))}
        </>
      )}
      {picked && (
        <View style={styles.pickedRow}><Ionicons name="checkmark-circle" size={18} color={colors.onSuccess} /><Text style={styles.pickedName} numberOfLines={1}>{picked.label}</Text><Pressable onPress={() => setPicked(null)} hitSlop={8}><Text style={styles.changeText}>Change</Text></Pressable></View>
      )}
      <View style={{ height: spacing.md }} />
      <Pressable onPress={() => submit(true)} disabled={busy || !picked} style={[styles.recPrimary, (busy || !picked) && { opacity: 0.5 }]} testID="rec-confirm">
        {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.recPrimaryText}>Record &amp; mark done</Text>}
      </Pressable>
      <Pressable onPress={() => submit(false)} disabled={busy} style={styles.recGhost} testID="rec-nolink"><Text style={styles.recGhostText}>Mark done without linking</Text></Pressable>
    </Sheet>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: spacing.md },
  gridItem: { position: 'relative' },
  syncBadge: { position: 'absolute', right: 5, bottom: 5, width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },

  empty: { alignItems: 'center', paddingVertical: 40, gap: spacing.sm },
  emptyText: { color: colors.onSurfaceTertiary },
  fab: { position: 'absolute', right: spacing.lg, bottom: spacing.lg, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4 },

  // Quick view
  qvRoot: { flex: 1, backgroundColor: '#000' },
  qvBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 52, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  qvClose: { color: colors.brandPrimary, fontSize: 16, fontWeight: '600', width: 44 },
  qvCat: { flex: 1, textAlign: 'center', color: '#fff', fontSize: 15, fontWeight: '700' },
  qvImgWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  qvImg: { width: '100%', height: '100%' },
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
