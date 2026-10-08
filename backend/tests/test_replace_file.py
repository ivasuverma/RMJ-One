"""replace_file: a cache write that Windows refuses (old file still being read)
keeps the existing copy instead of failing the request."""
import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))


def test_replace_file_keeps_existing_copy_when_refused(tmp_path, monkeypatch):
    os.environ.setdefault('MONGO_URL', 'mongodb://localhost:27017')
    os.environ.setdefault('DB_NAME', 'test_db')
    import server  # noqa: F401  (loads the app first, the way it runs)
    from routers import documents
    path = tmp_path / 'x.view'
    path.write_bytes(b'old')
    tmp = tmp_path / 'x.view.tmp'
    tmp.write_bytes(b'new')

    def refuse(a, b):
        raise PermissionError('[WinError 5] Access is denied')
    monkeypatch.setattr(documents.os, 'replace', refuse)
    documents.replace_file(tmp, path)            # no error
    assert path.read_bytes() == b'old' and not tmp.exists()

    path.unlink()
    tmp.write_bytes(b'new')
    try:
        documents.replace_file(tmp, path)        # nothing there to fall back on: still an error
        raise AssertionError('expected PermissionError')
    except PermissionError:
        pass
