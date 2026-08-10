"""
One-time helper: generates a VAPID key pair for browser push notifications.

Run:
    python generate_vapid_keys.py

Then copy the two printed lines into backend/.env (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).
Requires: pip install pywebpush cryptography
"""
import base64

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('ascii')


def main():
    private_key = ec.generate_private_key(ec.SECP256R1())
    public_key = private_key.public_key()

    # Public key: uncompressed point (0x04 + X + Y), base64url — what browsers expect
    # as the applicationServerKey for pushManager.subscribe().
    numbers = public_key.public_numbers()
    x = numbers.x.to_bytes(32, 'big')
    y = numbers.y.to_bytes(32, 'big')
    public_raw = b'\x04' + x + y

    # Private key: raw 32-byte scalar, base64url — what pywebpush expects.
    private_raw = private_key.private_numbers().private_value.to_bytes(32, 'big')

    print('Add these to backend/.env:\n')
    print(f'VAPID_PUBLIC_KEY={b64url(public_raw)}')
    print(f'VAPID_PRIVATE_KEY={b64url(private_raw)}')


if __name__ == '__main__':
    main()
