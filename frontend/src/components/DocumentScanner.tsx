import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, StyleSheet, Pressable, ActivityIndicator, Image, PanResponder, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { loadOpenCV } from '@/src/utils/opencv';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Pt = { x: number; y: number };

// Auto-detect a document's four corners and let the user nudge them, then
// straighten + crop (perspective warp). Everything is optional and fails soft:
// if OpenCV can't load or nothing is detected, the user still gets a usable
// rectangle (or can Skip to keep the original photo).

function orderCorners(pts: Pt[]): Pt[] {
  // TL has smallest x+y, BR largest x+y; TR smallest (x−y)… no, largest x−y.
  const bySum = [...pts].sort((a, b) => (a.x + a.y) - (b.x + b.y));
  const byDiff = [...pts].sort((a, b) => (a.x - a.y) - (b.x - b.y));
  const tl = bySum[0], br = bySum[3];
  const bl = byDiff[0], tr = byDiff[3];
  return [tl, tr, br, bl];
}

// 4 corners of a rotated rectangle (opencv.js has no boxPoints binding).
function rotatedRectPoints(rr: any): Pt[] {
  const cx = rr.center.x, cy = rr.center.y;
  const w = rr.size.width / 2, h = rr.size.height / 2;
  const a = (rr.angle * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  return [
    { x: cx - w * cos + h * sin, y: cy - w * sin - h * cos },
    { x: cx + w * cos + h * sin, y: cy + w * sin - h * cos },
    { x: cx + w * cos - h * sin, y: cy + w * sin + h * cos },
    { x: cx - w * cos - h * sin, y: cy - w * sin + h * cos },
  ];
}

function detectQuad(cv: any, srcMat: any): Pt[] | null {
  // Detect on a downscaled copy: faster, and the dominant document edges
  // survive while fine texture/noise drops out. Points are scaled back up.
  const detMax = 900;
  const s = Math.min(1, detMax / Math.max(srcMat.rows, srcMat.cols));
  const small = new cv.Mat();
  const gray = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  let bestContour: any = null;
  let bestArea = 0;
  try {
    cv.resize(srcMat, small, new cv.Size(Math.round(srcMat.cols * s), Math.round(srcMat.rows * s)));
    cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
    // Local contrast boost (CLAHE) so faint paper edges on a pale surface (a
    // white slip on a cream counter) actually register — this is what makes
    // low-contrast documents detectable. Paired with low Canny thresholds.
    try {
      const clahe = (cv.createCLAHE ? cv.createCLAHE(3.0, new cv.Size(8, 8)) : new cv.CLAHE(3.0, new cv.Size(8, 8)));
      clahe.apply(gray, gray);
      if (clahe.delete) clahe.delete();
    } catch { /* CLAHE unavailable in this build — carry on without it */ }
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    cv.Canny(gray, edges, 20, 60);
    const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7));
    cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, k);
    k.delete();
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    const minArea = small.rows * small.cols * 0.06;
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const area = cv.contourArea(c);
      if (area > bestArea && area > minArea) { if (bestContour) bestContour.delete(); bestContour = c; bestArea = area; }
      else c.delete();
    }
    if (!bestContour) return null;

    // Prefer a clean 4-point polygon; widen epsilon before giving up, then fall
    // back to the tightest rotated rectangle so we (almost) always snap.
    let quad: Pt[] | null = null;
    const peri = cv.arcLength(bestContour, true);
    for (const eps of [0.02, 0.04, 0.06, 0.09]) {
      const approx = new cv.Mat();
      cv.approxPolyDP(bestContour, approx, eps * peri, true);
      if (approx.rows === 4) {
        quad = [];
        for (let i = 0; i < 4; i++) quad.push({ x: approx.data32S[i * 2], y: approx.data32S[i * 2 + 1] });
      }
      approx.delete();
      if (quad) break;
    }
    if (!quad) {
      const rr = cv.minAreaRect(bestContour);
      quad = rotatedRectPoints(rr);
    }
    // Scale detection-space points back to the full image.
    return orderCorners(quad.map((p) => ({ x: p.x / s, y: p.y / s })));
  } catch { return null; }
  finally {
    small.delete(); gray.delete(); edges.delete(); contours.delete(); hierarchy.delete();
    if (bestContour) bestContour.delete();
  }
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

async function warpToBlob(cv: any, srcCanvas: HTMLCanvasElement, quad: Pt[]): Promise<Blob | null> {
  const srcMat = cv.imread(srcCanvas);
  const [tl, tr, br, bl] = quad;
  const maxW = Math.max(dist(br, bl), dist(tr, tl));
  const maxH = Math.max(dist(tr, br), dist(tl, bl));
  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, maxW, 0, maxW, maxH, 0, maxH]);
  const M = cv.getPerspectiveTransform(srcTri, dstTri);
  const dst = new cv.Mat();
  try {
    cv.warpPerspective(srcMat, dst, M, new cv.Size(Math.round(maxW), Math.round(maxH)));
    const out = document.createElement('canvas');
    cv.imshow(out, dst);
    return await new Promise<Blob | null>((res) => out.toBlob(res, 'image/jpeg', 0.85));
  } finally {
    srcMat.delete(); srcTri.delete(); dstTri.delete(); M.delete(); dst.delete();
  }
}

export function DocumentScanner({ file, onCancel, onResult }: {
  file: File; onCancel: () => void; onResult: (f: File) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'working'>('loading');
  const [corners, setCorners] = useState<Pt[]>([]);      // in DISPLAY coords
  const scaleRef = useRef(1);
  const natRef = useRef({ w: 0, h: 0 });
  const srcCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cvRef = useRef<any>(null);
  const [box, setBox] = useState({ w: 0, h: 0, top: 0, left: 0 });

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
        const nat = { w: img.naturalWidth, h: img.naturalHeight };
        natRef.current = nat;
        const canvas = document.createElement('canvas');
        canvas.width = nat.w; canvas.height = nat.h;
        canvas.getContext('2d')!.drawImage(img, 0, 0);
        srcCanvasRef.current = canvas;
        URL.revokeObjectURL(url);

        const scale = Math.min(maxW / nat.w, maxH / nat.h);
        scaleRef.current = scale;
        const dispW = nat.w * scale, dispH = nat.h * scale;
        setBox({ w: dispW, h: dispH, top: 0, left: 0 });

        const cv = await loadOpenCV();
        if (cancelled) return;
        cvRef.current = cv;
        const srcMat = cv.imread(canvas);
        const detected = detectQuad(cv, srcMat);
        srcMat.delete();

        const quad = detected || [
          { x: nat.w * 0.12, y: nat.h * 0.12 }, { x: nat.w * 0.88, y: nat.h * 0.12 },
          { x: nat.w * 0.88, y: nat.h * 0.88 }, { x: nat.w * 0.12, y: nat.h * 0.88 },
        ];
        setCorners(quad.map((p) => ({ x: p.x * scale, y: p.y * scale })));
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [file, maxW, maxH]);

  // One PanResponder per corner. We snapshot the corners on grant and apply the
  // gesture delta to that base each move, so dragging doesn't drift.
  const baseRef = useRef<Pt[] | null>(null);
  const responders2 = useMemo(() => [0, 1, 2, 3].map((i) => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { baseRef.current = corners; },
    onPanResponderMove: (_e, g) => {
      const base = baseRef.current;
      if (!base || base.length !== 4) return;
      setCorners((prev) => {
        const next = [...prev];
        next[i] = {
          x: Math.max(0, Math.min(box.w, base[i].x + g.dx)),
          y: Math.max(0, Math.min(box.h, base[i].y + g.dy)),
        };
        return next;
      });
    },
    onPanResponderRelease: () => { baseRef.current = null; },
  })), [box.w, box.h, corners]);

  const useCrop = async () => {
    const cv = cvRef.current, canvas = srcCanvasRef.current;
    if (!cv || !canvas || corners.length !== 4) { onCancel(); return; }
    setStatus('working');
    try {
      const scale = scaleRef.current;
      const quadNat = corners.map((p) => ({ x: p.x / scale, y: p.y / scale }));
      const blob = await warpToBlob(cv, canvas, orderCorners(quadNat));
      if (!blob) throw new Error('warp failed');
      const cropped = new File([blob], (file.name.replace(/\.[^.]+$/, '') || 'scan') + '-cropped.jpg', { type: 'image/jpeg' });
      onResult(cropped);
    } catch {
      setStatus('ready');
    }
  };

  // Edge lines between consecutive corners (thin rotated views).
  const edges = corners.length === 4 ? [0, 1, 2, 3].map((i) => {
    const a = corners[i], b = corners[(i + 1) % 4];
    const len = dist(a, b);
    const angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    return { key: i, left: a.x, top: a.y, len, angle };
  }) : [];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.root}>
        <Text style={styles.title}>Adjust the corners</Text>
        <Text style={styles.sub}>Drag the dots to the document edges. It&apos;ll be straightened and cropped.</Text>

        <View style={[styles.stage, { width: box.w || maxW, height: box.h || maxH }]}>
          {srcCanvasRef.current && box.w > 0 && (
            <Image source={{ uri: (() => { try { return srcCanvasRef.current!.toDataURL('image/jpeg', 0.9); } catch { return ''; } })() }} style={{ width: box.w, height: box.h, borderRadius: radius.md }} resizeMode="stretch" />
          )}
          {(status === 'loading' || status === 'working') && (
            <View style={styles.overlayCenter}><ActivityIndicator color="#fff" size="large" /><Text style={styles.overlayText}>{status === 'working' ? 'Cropping…' : 'Detecting edges…'}</Text></View>
          )}
          {status === 'ready' && edges.map((e) => (
            <View key={`e${e.key}`} pointerEvents="none" style={{ position: 'absolute', left: e.left, top: e.top, width: e.len, height: 2, backgroundColor: colors.brandPrimary, transform: [{ translateY: -1 }, { rotateZ: `${e.angle}deg` }], transformOrigin: 'left center' as any }} />
          ))}
          {status === 'ready' && corners.map((p, i) => (
            <View key={`c${i}`} {...responders2[i].panHandlers} style={[styles.handle, { left: p.x - 16, top: p.y - 16 }]}>
              <View style={styles.handleDot} />
            </View>
          ))}
        </View>

        {status === 'error' ? (
          <Text style={styles.err}>Couldn&apos;t start the scanner (offline or blocked). You can skip cropping.</Text>
        ) : null}

        <View style={styles.actions}>
          <Pressable onPress={onCancel} style={styles.btnGhost} testID="scan-cancel"><Text style={styles.btnGhostText}>Back</Text></Pressable>
          <Pressable onPress={() => onResult(file)} style={styles.btnGhost} testID="scan-skip"><Text style={styles.btnGhostText}>Use original</Text></Pressable>
          <Pressable onPress={useCrop} disabled={status !== 'ready'} style={[styles.btnPrimary, status !== 'ready' && { opacity: 0.5 }]} testID="scan-use">
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
  overlayCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 10 },
  overlayText: { color: '#fff', fontWeight: '700' },
  handle: { position: 'absolute', width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  handleDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.brandPrimary, borderWidth: 2, borderColor: '#fff' },
  err: { color: colors.onWarning, fontSize: 13, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  btnGhost: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: radius.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  btnGhostText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  btnPrimary: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 18, borderRadius: radius.md, backgroundColor: colors.brandPrimary },
  btnPrimaryText: { color: colors.onBrandPrimary, fontSize: 14, fontWeight: '800' },
});
