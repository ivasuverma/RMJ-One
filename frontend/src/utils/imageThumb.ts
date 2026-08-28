// Make a small (~420px) base64 JPEG thumbnail from an image data URI — kept for
// fast display after the full-res original is uploaded to Drive. Returns the
// base64 payload only (no data-url prefix), or '' if it can't be made.
export async function makeThumbFromDataUri(dataUri: string): Promise<string> {
  if (typeof document === 'undefined') return '';
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const im = new (window as any).Image();
      im.onload = () => res(im); im.onerror = rej; im.src = dataUri;
    });
    const scale = Math.min(1, 420 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7).split(',', 2)[1] || '';
  } catch { return ''; }
}
