// Combine several photos into one multi-page PDF — used by Quick Capture so
// photos taken in one stretch become a single document with a single caption.
//
// Hand-written rather than pulling in a PDF library: every page is just one
// JPEG placed full-bleed, and JPEG data can be embedded in a PDF verbatim
// (/DCTDecode), so the whole format needed is a few dozen lines.

export type PdfImage = { jpeg: Uint8Array; width: number; height: number };

const enc = new TextEncoder();
// Longest page side in PDF points (A4 is 842 x 595). The image itself keeps its
// full pixel resolution; this only sets how large the page is when printed.
const MAX_PAGE_SIDE = 842;

/** Pure: JPEG bytes in, PDF bytes out. Kept free of any browser API so it can be tested in Node. */
export function buildPdf(images: PdfImage[]): Uint8Array {
  if (images.length === 0) throw new Error('No images to put in a PDF');

  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];   // byte offset of object n, at index n-1
  let length = 0;
  const push = (b: Uint8Array | string) => {
    const bytes = typeof b === 'string' ? enc.encode(b) : b;
    chunks.push(bytes); length += bytes.length;
  };
  const beginObj = (n: number) => { offsets[n - 1] = length; push(`${n} 0 obj\n`); };

  // Object numbering: 1 = catalog, 2 = page tree, then per page i (0-based):
  //   3 + 3i = page, 4 + 3i = image, 5 + 3i = content stream.
  const pageObj = (i: number) => 3 + 3 * i;
  const total = 2 + 3 * images.length;

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');   // 2nd line: binary marker so tools treat it as binary
  beginObj(1); push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  beginObj(2);
  push(`<< /Type /Pages /Count ${images.length} /Kids [${images.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] >>\nendobj\n`);

  images.forEach((img, i) => {
    const scale = Math.min(1, MAX_PAGE_SIDE / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const page = pageObj(i), image = page + 1, content = page + 2;
    beginObj(page);
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R >>\nendobj\n`);
    beginObj(image);
    push(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`);
    push(img.jpeg);
    push('\nendstream\nendobj\n');
    const draw = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    beginObj(content);
    push(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream\nendobj\n`);
  });

  const xrefAt = length;
  push(`xref\n0 ${total + 1}\n0000000000 65535 f \n`);
  for (let n = 1; n <= total; n++) push(`${String(offsets[n - 1]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/**
 * Browser: photos in, one PDF Blob out. Every photo is redrawn through a canvas
 * and re-encoded as JPEG, whatever it started as — that guarantees the bytes
 * are something a PDF can embed, and gives us the true (EXIF-rotated) size.
 * `maxSide` caps the pixel size so a 12-photo stretch doesn't become a 60 MB PDF.
 */
export async function blobsToPdf(blobs: Blob[], maxSide = 1600, quality = 0.82): Promise<Blob> {
  const pages: PdfImage[] = [];
  for (const blob of blobs) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const im = new (window as any).Image() as HTMLImageElement;
        im.onload = () => res(im); im.onerror = () => rej(new Error('Could not read a photo')); im.src = url;
      });
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('No canvas');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const jpeg = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality));
      if (!jpeg) throw new Error('Could not encode a photo');
      pages.push({ jpeg: new Uint8Array(await jpeg.arrayBuffer()), width: canvas.width, height: canvas.height });
    } finally { URL.revokeObjectURL(url); }
  }
  const pdf = buildPdf(pages);
  return new Blob([pdf as BlobPart], { type: 'application/pdf' });
}

/**
 * Inverse of buildPdf for PDFs made by it: pulls the embedded JPEG of every page
 * back out, so a merged multi-photo document can be shown as a scrolling list of
 * photos instead of needing a PDF viewer. Returns [] for any other PDF.
 */
export function extractPdfJpegs(pdf: Uint8Array): Blob[] {
  // latin1 view keeps byte offsets == string offsets
  let text = '';
  for (let i = 0; i < pdf.length; i += 0x8000) text += String.fromCharCode.apply(null, pdf.subarray(i, i + 0x8000) as any);
  const out: Blob[] = [];
  const re = /\/Subtype \/Image[^>]*?\/Filter \/DCTDecode \/Length (\d+) >>\nstream\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const len = parseInt(m[1], 10);
    if (start + len <= pdf.length) out.push(new Blob([pdf.slice(start, start + len) as BlobPart], { type: 'image/jpeg' }));
  }
  return out;
}
