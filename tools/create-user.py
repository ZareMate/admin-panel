#!/usr/bin/env python3
"""Print a config entry; the password is read privately and never stored."""
import getpass
import hashlib
import secrets
import re
import uuid

name = input('Staff login (3–32 letters, digits, _ or -): ').strip()
if not re.fullmatch(r'[a-zA-Z0-9_-]{3,32}', name):
    raise SystemExit('Invalid login')
role = input('Role [viewer/moderator/admin]: ').strip()
if role not in ('viewer', 'moderator', 'admin'):
    raise SystemExit('Invalid role')
player_uuid = uuid.UUID(input('Staff Minecraft UUID (for note ownership): ').strip())
password = getpass.getpass('Password (at least 14 characters): ')
if not 8 <= len(password) <= 256 or password != getpass.getpass('Confirm password: '):
    raise SystemExit('Passwords do not match or are too short')
salt = secrets.token_bytes(16)
key = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 600000).hex()
print(f'\nuser.{name}={role},{player_uuid},{salt.hex()}:{key}')
