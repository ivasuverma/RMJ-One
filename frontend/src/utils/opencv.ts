// Lazily load OpenCV.js (compiled to WASM, ~13MB) from a CDN, only when the
// document scanner actually needs it — it never touches normal app load. The
// browser caches it after the first use. Every caller must handle rejection
// (no network, blocked, etc.) by falling back to the un-cropped photo, so a
// failure here can never block saving a document.
//
// Uses the @techstark build, which INLINES the WASM into the single JS file.
// The stock docs.opencv.org build fetches a separate opencv_js.wasm relative to
// the host page, which 404s on our domain — that was the "couldn't start"
// error. This build resolves `window.cv` as a promise to the ready module.
const CDN_URL = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@5.0.0-release.1/dist/opencv.js';

let loader: Promise<any> | null = null;

export function loadOpenCV(): Promise<any> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('OpenCV needs a browser'));
  }
  const w = window as any;
  if (w.cv && w.cv.Mat) return Promise.resolve(w.cv);
  if (loader) return loader;

  loader = new Promise((resolve, reject) => {
    const settle = (cv: any) => {
      if (cv && cv.Mat) { resolve(cv); return; }
      if (cv && typeof cv.then === 'function') { cv.then((real: any) => resolve(real)).catch(reject); return; }
      if (cv) { cv.onRuntimeInitialized = () => resolve(cv); return; }
      reject(new Error('OpenCV failed to initialise'));
    };
    const timeout = setTimeout(() => { loader = null; reject(new Error('OpenCV load timed out')); }, 30000);
    const done = (fn: () => void) => { clearTimeout(timeout); fn(); };

    const existing = document.getElementById('opencv-js-script');
    if (existing) { settle(w.cv); return; }

    const s = document.createElement('script');
    s.id = 'opencv-js-script';
    s.src = CDN_URL;
    s.async = true;
    s.onload = () => done(() => settle(w.cv));
    s.onerror = () => done(() => { loader = null; try { s.remove(); } catch { /* ignore */ } reject(new Error('OpenCV failed to load')); });
    document.body.appendChild(s);
  });
  return loader;
}
