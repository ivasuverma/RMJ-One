"""Google Drive integration for the Documents module — done with the Drive REST
API over httpx, so there are NO new/heavy client-library dependencies to pip
install on the shop's server (httpx is already a dependency).

Flow: the owner connects the shop's Google account once (3-legged OAuth, see the
routes in routers/documents.py). We store only the long-lived **refresh token**
in db.settings (id='google_drive') — never a password. A background worker
(started in server.py) then uploads any 'queued' documents into a per-category
folder under a root "RMJ One Documents" folder and flips them to 'synced',
filling drive_file_id / view / thumbnail links.

Requires three env vars (owner sets these from their Google Cloud OAuth client):
    GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
Scope is drive.file (only files this app creates — least privilege).
"""
import base64
import os
from typing import Optional

import httpx

from server import db

TOKEN_URL = 'https://oauth2.googleapis.com/token'
AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
FILES_URL = 'https://www.googleapis.com/drive/v3/files'
UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'
USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'
SCOPE = 'https://www.googleapis.com/auth/drive.file'
ROOT_FOLDER = 'RMJ One Documents'


def client_creds():
    return (os.environ.get('GOOGLE_CLIENT_ID'), os.environ.get('GOOGLE_CLIENT_SECRET'), os.environ.get('GOOGLE_REDIRECT_URI'))


def env_ready() -> bool:
    cid, csec, redirect = client_creds()
    return bool(cid and csec and redirect)


async def get_config() -> dict:
    return await db.settings.find_one({'id': 'google_drive'}, {'_id': 0}) or {}


async def is_connected() -> bool:
    return bool((await get_config()).get('refresh_token'))


def auth_url(state: str) -> str:
    cid, _, redirect = client_creds()
    from urllib.parse import urlencode
    params = {
        'client_id': cid, 'redirect_uri': redirect, 'response_type': 'code', 'scope': SCOPE,
        'access_type': 'offline', 'prompt': 'consent', 'state': state,
    }
    return f'{AUTH_URL}?{urlencode(params)}'


async def exchange_code(code: str):
    cid, csec, redirect = client_creds()
    async with httpx.AsyncClient(timeout=30) as h:
        r = await h.post(TOKEN_URL, data={'code': code, 'client_id': cid, 'client_secret': csec, 'redirect_uri': redirect, 'grant_type': 'authorization_code'})
        r.raise_for_status()
        tok = r.json()
        email = None
        try:
            ui = await h.get(USERINFO_URL, headers={'Authorization': f"Bearer {tok.get('access_token')}"})
            if ui.status_code == 200:
                email = ui.json().get('email')
        except Exception:
            pass
    return tok.get('refresh_token'), email


async def _access_token(config: dict) -> str:
    cid, csec, _ = client_creds()
    async with httpx.AsyncClient(timeout=30) as h:
        r = await h.post(TOKEN_URL, data={'client_id': cid, 'client_secret': csec, 'refresh_token': config['refresh_token'], 'grant_type': 'refresh_token'})
        r.raise_for_status()
        return r.json()['access_token']


async def _ensure_folder(h: httpx.AsyncClient, access: str, name: str, parent: Optional[str]) -> str:
    safe = name.replace("'", "\\'")
    q = f"name='{safe}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    if parent:
        q += f" and '{parent}' in parents"
    r = await h.get(FILES_URL, params={'q': q, 'fields': 'files(id)', 'spaces': 'drive'}, headers={'Authorization': f'Bearer {access}'})
    r.raise_for_status()
    files = r.json().get('files', [])
    if files:
        return files[0]['id']
    meta = {'name': name, 'mimeType': 'application/vnd.google-apps.folder'}
    if parent:
        meta['parents'] = [parent]
    r2 = await h.post(FILES_URL, json=meta, headers={'Authorization': f'Bearer {access}'})
    r2.raise_for_status()
    return r2.json()['id']


async def upload_raw(config: dict, category_label: str, filename: str, raw: bytes, mime: str) -> dict:
    """Upload raw bytes straight to Drive (no base64 round-trip) — used for large
    files (e.g. multi-page PDFs) that are too big to inline in MongoDB, so they
    stream to Drive on capture instead of being stored in the database at all.
    Returns the same drive_* fields as upload()."""
    access = await _access_token(config)
    async with httpx.AsyncClient(timeout=300) as h:
        root = await _ensure_folder(h, access, ROOT_FOLDER, None)
        folder = await _ensure_folder(h, access, category_label, root)
        rc = await h.post(FILES_URL, json={'name': filename, 'parents': [folder]}, headers={'Authorization': f'Bearer {access}'})
        rc.raise_for_status()
        fid = rc.json()['id']
        ru = await h.patch(
            f'{UPLOAD_URL}/{fid}?uploadType=media&fields=id,webViewLink,thumbnailLink',
            content=raw, headers={'Authorization': f'Bearer {access}', 'Content-Type': mime or 'application/octet-stream'},
        )
        ru.raise_for_status()
        j = ru.json()
    return {'drive_file_id': j['id'], 'drive_view_link': j.get('webViewLink'), 'drive_thumbnail_link': j.get('thumbnailLink')}


async def upload(config: dict, category_label: str, filename: str, data_b64: str, mime: str) -> dict:
    """Two-step upload (metadata create, then media patch) — avoids hand-rolling
    a multipart/related body. Returns the drive_* fields to store on the doc."""
    access = await _access_token(config)
    raw = base64.b64decode(data_b64)
    async with httpx.AsyncClient(timeout=120) as h:
        root = await _ensure_folder(h, access, ROOT_FOLDER, None)
        folder = await _ensure_folder(h, access, category_label, root)
        rc = await h.post(FILES_URL, json={'name': filename, 'parents': [folder]}, headers={'Authorization': f'Bearer {access}'})
        rc.raise_for_status()
        fid = rc.json()['id']
        ru = await h.patch(
            f'{UPLOAD_URL}/{fid}?uploadType=media&fields=id,webViewLink,thumbnailLink',
            content=raw, headers={'Authorization': f'Bearer {access}', 'Content-Type': mime or 'application/octet-stream'},
        )
        ru.raise_for_status()
        j = ru.json()
    return {'drive_file_id': j['id'], 'drive_view_link': j.get('webViewLink'), 'drive_thumbnail_link': j.get('thumbnailLink')}


BACKUP_FOLDER = 'RMJ One Backups'


async def upload_backup(config: dict, filename: str, raw: bytes, mime: str = 'application/gzip') -> dict:
    """Upload a raw database backup blob into a dedicated 'RMJ One Backups'
    folder (kept separate from documents). Returns the created file id + name."""
    access = await _access_token(config)
    async with httpx.AsyncClient(timeout=300) as h:
        folder = await _ensure_folder(h, access, BACKUP_FOLDER, None)
        rc = await h.post(FILES_URL, json={'name': filename, 'parents': [folder]}, headers={'Authorization': f'Bearer {access}'})
        rc.raise_for_status()
        fid = rc.json()['id']
        ru = await h.patch(
            f'{UPLOAD_URL}/{fid}?uploadType=media&fields=id,name,size,createdTime',
            content=raw, headers={'Authorization': f'Bearer {access}', 'Content-Type': mime},
        )
        ru.raise_for_status()
        return ru.json()


async def list_backups(config: dict) -> list:
    """List backup files (newest first) so we can show status + prune old ones."""
    access = await _access_token(config)
    async with httpx.AsyncClient(timeout=60) as h:
        folder_q = f"name='{BACKUP_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
        fr = await h.get(FILES_URL, params={'q': folder_q, 'fields': 'files(id)', 'spaces': 'drive'}, headers={'Authorization': f'Bearer {access}'})
        fr.raise_for_status()
        folders = fr.json().get('files', [])
        if not folders:
            return []
        fid = folders[0]['id']
        r = await h.get(FILES_URL, params={
            'q': f"'{fid}' in parents and trashed=false",
            'fields': 'files(id,name,size,createdTime)',
            'orderBy': 'createdTime desc', 'spaces': 'drive', 'pageSize': 100,
        }, headers={'Authorization': f'Bearer {access}'})
        r.raise_for_status()
        return r.json().get('files', [])


async def delete_file(config: dict, file_id: str) -> None:
    access = await _access_token(config)
    async with httpx.AsyncClient(timeout=30) as h:
        r = await h.delete(f'{FILES_URL}/{file_id}', headers={'Authorization': f'Bearer {access}'})
        if r.status_code not in (200, 204, 404):
            r.raise_for_status()


async def download(config: dict, file_id: str) -> bytes:
    """Fetch the raw bytes of a Drive file we uploaded. Used to serve the
    full-size original on demand once the heavy local copy has been dropped
    (only a small thumbnail is kept locally after a successful sync)."""
    access = await _access_token(config)
    async with httpx.AsyncClient(timeout=120) as h:
        r = await h.get(
            f'{FILES_URL}/{file_id}?alt=media',
            headers={'Authorization': f'Bearer {access}'},
        )
        r.raise_for_status()
        return r.content
