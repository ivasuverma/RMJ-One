import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, StyleSheet, Pressable, ActivityIndicator, Image, PanResponder, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

// Plain, reliable rectangle crop — drag the box or its corners, then it crops
// on-device with a canvas. No auto-detect, no heavy vision library.
type Rect = { left: number; top: number; right: number; bottom: number };

export function SimpleCropper({ file, onCancel, onResult }: {
  file: File; onCancel: () => void; onResult: (f: File) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'working'>('loading');
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [rect, setRect] = useState<Rect>({ left: 0, top: 0, right: 0, bottom: 0 });
  const imgRef = useRef<HTMLImageElement | null>(null);
  const scaleRef = useRef(1);

  const win = Dimensions.get('window');
  const maxW = Math.min(win.width - spacing.lg * 2, 520);
  const maxH = win.height * 0.62;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (typeof document === 'undefined') throw new Error('no dom');
        const url = URL.createObjectURL(file);
        const img = await new Promise<HTMLImageElement>((res, rej) => {
          const im = new (window as any).Image(); im.onload = () => res(im); im.onerror = rej; im.src = url;
        });
        if (cancelled) return;
        imgRef.current = img;
        const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
        scaleRef.current = scale;
        const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
        setBox({ w, h });
        // Start with a small inset so the handles are obviously grabbable.
        setRect({ left: w * 0.08, top: h * 0.08, right: w * 0.92, bottom: h * 0.92 });
        setStatus('ready');
        URL.revokeObjectURL(url);
      } catch { if (!cancelled) onCancel(); }
    })();
    return () => { cancelled = true; };
  }, [file, maxW, maxH]);

  const rectRef = useRef(rect); rectRef.current = rect;
  const boxRef = useRef(box); boxRef.current = box;
  const base = useRef<Rect | null>(null);
  const MIN = 40;

  // corner: 0=TL 1=TR 2=BR 3=BL ; -1 = move whole box
  const makeResponder = (corner: number) => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderGrant: () => { base.current = { ...rectRef.current }; },
    onPanResponderMove: (_e, g) => {
      const b = base.current; const bx = boxRef.current;
      if (!b) return;
      let { left, top, right, bottom } = b;
      if (corner === -1) {
        const w = right - left, h = bottom - top;
        left = Math.max(0, Math.min(bx.w - w, b.left + g.dx));
        top = Math.max(0, Math.min(bx.h - h, b.top + g.dy));
        right = left + w; bottom = top + h;
      } else {
        if (corner === 0 || corner === 3) left = Math.max(0, Math.min(b.right - MIN, b.left + g.dx));
        if (corner === 1 || corner === 2) right = Math.min(bx.w, Math.max(b.left + MIN, b.right + g.dx));
        if (corner === 0 || corner === 1) top = Math.max(0, Math.min(b.bottom - MIN, b.top + g.dy));
        if (corner === 2 || corner === 3) bottom = Math.min(bx.h, Math.max(b.top + MIN, b.bottom + g.dy));
      }
      setRect({ left, top, right, bottom });
    },
    onPanResponderRelease: () => { base.current = null; },
    onPanResponderTerminate: () => { base.current = null; },
  });
  const corners = useMemo(() => [0, 1, 2, 3].map(makeResponder), []);
  const mover = useMemo(() => makeResponder(-1), []);

  const useCrop = async () => {
    const img = imgRef.current; const s = scaleRef.current;
    if (!img) { onCancel(); return; }
    setStatus('working');
    try {
      const sx = Math.round(rect.left / s), sy = Math.round(rect.top / s);
      const sw = Math.max(1, Math.round((rect.right - rect.left) / s));
      const sh = Math.max(1, Math.round((rect.bottom - rect.top) / s));
      const canvas = document.createElement('canvas');
      canvas.width = sw; canvas.height = sh;
      canvas.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
      if (!blob) throw new Error('crop failed');
      onResult(new File([blob], (file.name.replace(/\.[^.]+$/, '') || 'crop') + '-cropped.jpg', { type: 'image/jpeg' }));
    } catch { setStatus('ready'); }
  };

  const w = rect.right - rect.left, h = rect.bottom - rect.top;
  const handlePos = [
    { left: rect.left, top: rect.top }, { left: rect.right, top: rect.top },
    { left: rect.right, top: rect.bottom }, { left: rect.left, top: rect.bottom },
  ];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.root}>
        <Text style={styles.title}>Crop</Text>
        <Text style={styles.sub}>Drag the box or its corners to frame the document.</Text>

        <View style={[styles.stage, { width: box.w || maxW, height: box.h || maxH }]}>
          {status === 'loading' ? (
            <ActivityIndicator color="#fff" size="large" />
          ) : (
            <>
              {imgRef.current && <Image source={{ uri: (() => { try { const c = document.createElement('canvas'); c.width = imgRef.current!.naturalWidth; c.height = imgRef.current!.naturalHeight; c.getContext('2d')!.drawImage(imgRef.current!, 0, 0); return c.toDataURL('image/jpeg', 0.9); } catch { return ''; } })() }} style={{ width: box.w, height: box.h, borderRadius: radius.md }} resizeMode="stretch" />}
              {/* dim outside the crop box (four bands) */}
              <View pointerEvents="none" style={[styles.dim, { left: 0, top: 0, width: box.w, height: rect.top }]} />
              <View pointerEvents="none" style={[styles.dim, { left: 0, top: rect.bottom, width: box.w, height: box.h - rect.bottom }]} />
              <View pointerEvents="none" style={[styles.dim, { left: 0, top: rect.top, width: rect.left, height: h }]} />
              <View pointerEvents="none" style={[styles.dim, { left: rect.right, top: rect.top, width: box.w - rect.right, height: h }]} />
              {/* crop frame (movable) */}
              <View {...mover.panHandlers} style={[styles.frame, { left: rect.left, top: rect.top, width: w, height: h, borderColor: colors.brandPrimary }]} />
              {/* corner handles */}
              {handlePos.map((p, i) => (
                <View key={i} {...corners[i].panHandlers} style={[styles.handle, { left: p.left - 18, top: p.top - 18 }]}>
                  <View style={styles.handleDot} />
                </View>
              ))}
            </>
          )}
          {status === 'working' && <View style={styles.overlay}><ActivityIndicator color="#fff" size="large" /></View>}
        </View>

        <View style={styles.actions}>
          <Pressable onPress={onCancel} style={styles.btnGhost} testID="crop-cancel"><Text style={styles.btnGhostText}>Back</Text></Pressable>
          <Pressable onPress={() => onResult(file)} style={styles.btnGhost} testID="crop-skip"><Text style={styles.btnGhostText}>Use original</Text></Pressable>
          <Pressable onPress={useCrop} disabled={status !== 'ready'} style={[styles.btnPrimary, status !== 'ready' && { opacity: 0.5 }]} testID="crop-use">
            <Ionicons name="crop" size={17} color={colors.onBrandPrimary} /><Text style={styles.btnPrimaryText}>Use crop</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  title: { color: '#fff', fontSize: 20, fontWeight: '800' },
  sub: { color: 'rgba(255,255,255,0.7)', fontSize: 13, textAlign: 'center', marginBottom: spacing.sm },
  stage: { position: 'relative', alignItems: 'center', justifyContent: 'center', backgroundColor: '#111', borderRadius: radius.md },
  dim: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.5)' },
  frame: { position: 'absolute', borderWidth: 2 },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  handle: { position: 'absolute', width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  handleDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.brandPrimary, borderWidth: 2, borderColor: '#fff' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  btnGhost: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: radius.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  btnGhostText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  btnPrimary: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 18, borderRadius: radius.md, backgroundColor: colors.brandPrimary },
  btnPrimaryText: { color: colors.onBrandPrimary, fontSize: 14, fontWeight: '800' },
});
