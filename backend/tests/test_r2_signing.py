"""R2 uploads are signed with AWS Signature V4 by hand (r2_media.py, no SDK).
The expected value below was checked to equal botocore's S3SigV4Auth for the
same request; this keeps a later edit from silently breaking uploads."""
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import r2_media  # noqa: E402


def test_put_signature_matches_reference():
    now = datetime(2026, 10, 3, 10, 30, 0, tzinfo=timezone.utc)
    url, h = r2_media.signed_headers(
        'PUT', 'pieces/abc-v1.jpg', b'\xff\xd8hello',
        {'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable'},
        now=now, host='acct.r2.cloudflarestorage.com', access_key='AKID', secret_key='SECRET', bucket='rmj-media')
    assert url == 'https://acct.r2.cloudflarestorage.com/rmj-media/pieces/abc-v1.jpg'
    assert h['authorization'] == (
        'AWS4-HMAC-SHA256 Credential=AKID/20261003/auto/s3/aws4_request, '
        'SignedHeaders=cache-control;content-type;host;x-amz-content-sha256;x-amz-date, '
        'Signature=9722656c22e699be2b7cb2dd63b1207ac9162b29be8295b112ff63bf5094dbfb')
    assert h['x-amz-date'] == '20261003T103000Z'


def test_off_without_keys():
    assert r2_media.enabled() is bool(r2_media.ACCOUNT_ID and r2_media.ACCESS_KEY_ID and r2_media.SECRET_ACCESS_KEY
                                      and r2_media.BUCKET and r2_media.PUBLIC_URL)
