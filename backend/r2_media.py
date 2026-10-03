"""Cloudflare R2: where rmj.co.in's photos are served from.

The website photos (Fresh at the counter, and the photos on the page editor's
sections) are copied to an R2 bucket that's published at R2_PUBLIC_URL (e.g.
https://media.rmj.co.in), so customers get them from Cloudflare's network
instead of from the shop computer - faster, and still there when the shop
computer is off. The database keeps its own copy (it's in every backup); R2 is
only where the website reads them from. See routers/website.py (sync loop).

Turned on by five lines in backend/.env (ops/R2-SETUP.md has the dashboard steps):
    R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL
Without them nothing changes: the website keeps loading photos from the API.

R2 speaks the S3 API; requests are signed with AWS Signature V4 here (region
"auto"), so no SDK is needed.
"""
import hashlib
import hmac
import os
from datetime import datetime, timezone
from urllib.parse import quote

import httpx

ACCOUNT_ID = os.environ.get('R2_ACCOUNT_ID', '').strip()
ACCESS_KEY_ID = os.environ.get('R2_ACCESS_KEY_ID', '').strip()
SECRET_ACCESS_KEY = os.environ.get('R2_SECRET_ACCESS_KEY', '').strip()
BUCKET = os.environ.get('R2_BUCKET', '').strip()
PUBLIC_URL = os.environ.get('R2_PUBLIC_URL', '').strip().rstrip('/')
REGION = 'auto'


def enabled() -> bool:
    return bool(ACCOUNT_ID and ACCESS_KEY_ID and SECRET_ACCESS_KEY and BUCKET and PUBLIC_URL)


def public_url(key: str) -> str:
    return f'{PUBLIC_URL}/{key}'


def _hmac(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode('utf-8'), hashlib.sha256).digest()


def signed_headers(method: str, key: str, body: bytes = b'', headers: dict = None, now: datetime = None,
                   host: str = None, access_key: str = None, secret_key: str = None, bucket: str = None) -> tuple:
    """(url, headers) for one signed S3 request to the bucket. The keyword
    overrides exist for the test that checks the signature against botocore."""
    host = host or f'{ACCOUNT_ID}.r2.cloudflarestorage.com'
    bucket = bucket or BUCKET
    now = now or datetime.now(timezone.utc)
    amz_date = now.strftime('%Y%m%dT%H%M%SZ')
    day = now.strftime('%Y%m%d')
    path = '/' + quote(f'{bucket}/{key}', safe='/-_.~')
    payload_hash = hashlib.sha256(body).hexdigest()
    hdrs = {k.lower(): str(v).strip() for k, v in (headers or {}).items()}
    hdrs.update({'host': host, 'x-amz-content-sha256': payload_hash, 'x-amz-date': amz_date})
    names = sorted(hdrs)
    signed = ';'.join(names)
    canonical = '\n'.join([method, path, '', ''.join(f'{n}:{hdrs[n]}\n' for n in names), signed, payload_hash])
    scope = f'{day}/{REGION}/s3/aws4_request'
    to_sign = '\n'.join(['AWS4-HMAC-SHA256', amz_date, scope, hashlib.sha256(canonical.encode('utf-8')).hexdigest()])
    k = _hmac(_hmac(_hmac(_hmac(('AWS4' + (secret_key or SECRET_ACCESS_KEY)).encode('utf-8'), day), REGION), 's3'), 'aws4_request')
    signature = hmac.new(k, to_sign.encode('utf-8'), hashlib.sha256).hexdigest()
    hdrs['authorization'] = (f'AWS4-HMAC-SHA256 Credential={access_key or ACCESS_KEY_ID}/{scope}, '
                             f'SignedHeaders={signed}, Signature={signature}')
    hdrs.pop('host')   # httpx sets it from the URL
    return f'https://{host}{path}', hdrs


async def put(key: str, body: bytes, content_type: str, cache_control: str) -> None:
    url, hdrs = signed_headers('PUT', key, body, {'content-type': content_type, 'cache-control': cache_control})
    async with httpx.AsyncClient(timeout=60) as h:
        r = await h.put(url, content=body, headers=hdrs)
    if r.status_code >= 300:
        raise RuntimeError(f'R2 upload failed ({r.status_code}): {r.text[:200]}')


async def delete(key: str) -> None:
    url, hdrs = signed_headers('DELETE', key)
    async with httpx.AsyncClient(timeout=30) as h:
        r = await h.delete(url, headers=hdrs)
    if r.status_code >= 300 and r.status_code != 404:
        raise RuntimeError(f'R2 delete failed ({r.status_code}): {r.text[:200]}')
