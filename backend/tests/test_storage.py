import uuid

import pytest

from app.config import settings
from app.services import storage


@pytest.fixture(autouse=True)
def upload_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path))
    return tmp_path


def test_save_and_delete_pdf(upload_dir):
    user_id, document_id = uuid.uuid4(), uuid.uuid4()
    rel = storage.save_pdf(user_id, document_id, b"%PDF-1.7 data")

    assert rel == f"{user_id}/{document_id}.pdf"
    assert (upload_dir / rel).read_bytes() == b"%PDF-1.7 data"
    storage.delete_file(rel)
    assert not (upload_dir / rel).exists()


@pytest.mark.parametrize("path", ["../outside.pdf", "a/../../outside.pdf"])
def test_paths_cannot_escape_upload_dir(path):
    with pytest.raises(ValueError):
        storage.absolute(path)


def test_absolute_path_input_cannot_escape(upload_dir):
    outside = upload_dir.parent / "elsewhere.pdf"
    with pytest.raises(ValueError):
        storage.absolute(str(outside))


def test_delete_missing_or_bad_path_is_silent():
    storage.delete_file("nope/missing.pdf")
    storage.delete_file("../escape.pdf")
