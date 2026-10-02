import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

// Share a document or photo through the phone's share sheet (WhatsApp, Mail,
// Save to Photos…). iPhone only opens the sheet straight from a tap, so the
// file is fetched as soon as it's shown (useShareableFile) and shareFile() is
// called from the tap with it already in hand. Where sharing files isn't
// supported (most desktop browsers) it downloads the file instead.

export function useShareableFile(url: string | null, token: string | null, name: string): File | null {
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => {
    setFile(null);
    if (!url || !token || Platform.OS !== 'web') return;
    let dead = false;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((b) => { if (!dead) setFile(new File([b], withExt(name, b.type), { type: b.type || 'application/octet-stream' })); })
      .catch(() => {});
    return () => { dead = true; };
  }, [url, token, name]);
  return file;
}

function withExt(name: string, mime: string): string {
  if (/\.[a-z0-9]{2,4}$/i.test(name)) return name;
  const ext = mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : mime.startsWith('image/') ? 'jpg' : 'bin';
  return `${name}.${ext}`;
}

/** 'shared' | 'downloaded' | 'cancelled' | 'failed' */
export async function shareFile(file: File, title: string): Promise<'shared' | 'downloaded' | 'cancelled' | 'failed'> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  try {
    if (nav.share && nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], title });
      return 'shared';
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    return 'downloaded';
  } catch (e: any) {
    return e?.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}
