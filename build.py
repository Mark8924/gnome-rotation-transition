#!/usr/bin/env python3
"""Build a reproducible GNOME extension ZIP from an explicit file allowlist."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parent
FILES = {
    'extension.js': ROOT / 'extension.js',
    'transition-v12.js': ROOT / 'transition-v12.js',
    'metadata.json': ROOT / 'metadata.json',
    'LICENSE': ROOT / 'LICENSE',
    'NOTICE': ROOT / 'NOTICE',
    'LICENSE.apache-2.0': ROOT / 'LICENSE.apache-2.0',
}
metadata = json.loads(FILES['metadata.json'].read_text())
assert metadata['shell-version'] == ['51']
assert metadata['uuid'] == 'nabu-rotation-transition@mipad5.local'
dist = ROOT / 'dist'
dist.mkdir(exist_ok=True)
archive = dist / f"{metadata['uuid']}.shell-extension.zip"
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as out:
    for name, path in sorted(FILES.items()):
        info = zipfile.ZipInfo(name, (2026, 10, 18, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        info.create_system = 3
        out.writestr(info, path.read_bytes())
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(dist / 'SHA256SUMS').write_text(f'{digest}  {archive.name}\n')
print(f'{archive}\nSHA256 {digest}')
