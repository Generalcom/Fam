"""The decision logic, with the face models and the OCR replaced by stand-ins."""

import datetime as dt
from types import SimpleNamespace

import numpy as np
import pytest

from kyc_worker import documents, verify

TODAY = dt.date(2026, 9, 25)
IMG = np.zeros((10, 10, 3), np.uint8)


class FakeFaces:
    """Each picture is tagged by its key; `yaw`, `live` and `sim` say what the models would report."""

    def __init__(self, yaw=None, live=0.95, sim=0.7, doc_face=True, selfie_faces=True):
        self.yaw = yaw or {"center": 0.02, "left": 0.35, "right": -0.33}
        self.live, self.sim, self.doc_face, self.selfie_faces = live, sim, doc_face, selfie_faces

    def faces(self, img):
        key = img.tag
        if key == "front":
            return img, [SimpleNamespace(key=key, yaw=0.0)] if self.doc_face else []
        return img, [SimpleNamespace(key=key, yaw=self.yaw[key])] if self.selfie_faces else []

    def feature(self, img, face):
        return face.key

    def similarity(self, a, b):
        return self.sim

    def live_probability(self, img, face):
        return self.live


class Tagged(np.ndarray):
    pass


def images(*keys):
    out = {}
    for k in keys:
        a = IMG.view(Tagged)
        a.tag = k
        out[k] = a
    return out


ROW = {"user_id": "u1", "document_type": "sa_id_book", "full_name": "Thandi Grace Dlamini", "id_number": "8001015009087"}


@pytest.fixture
def ocr(monkeypatch):
    read = documents.DocumentRead(id_number="8001015009087", surname="Dlamini", given_names="Thandi Grace", source="text")
    monkeypatch.setattr(documents, "read_sa_document", lambda pages, today=None: read)
    return read


def run(faces, row=ROW, keys=("front", "center", "left", "right")):
    return verify.check(row, images(*keys), faces, TODAY)


def test_all_good_passes(ocr):
    out = run(FakeFaces())
    assert out.passed, out.failures
    assert out.details["selfie"]["turnsOk"] and out.details["document"]["numberMatches"]


def test_number_typed_differently(ocr):
    out = run(FakeFaces(), {**ROW, "id_number": "8501015009082"})
    assert "number_mismatch" in out.failures and not out.passed


def test_unreadable_document(ocr):
    ocr.id_number = None
    out = run(FakeFaces())
    assert out.failures == ["doc_unreadable"]
    assert "couldn't read" in out.reason


def test_name_typed_differently(ocr):
    out = run(FakeFaces(), {**ROW, "full_name": "Sipho Nkosi"})
    assert out.failures == ["name_mismatch"]


def test_no_head_turn(ocr):
    out = run(FakeFaces(yaw={"center": 0.0, "left": 0.05, "right": -0.04}))
    assert out.failures == ["selfie_turns"]


def test_turns_the_same_way_twice(ocr):
    out = run(FakeFaces(yaw={"center": 0.0, "left": 0.4, "right": 0.35}))
    assert out.failures == ["selfie_turns"]


def test_turns_are_judged_against_the_person_own_centre(ocr):
    # someone whose "straight" reads a little off still passes when both turns clearly move away from it
    assert run(FakeFaces(yaw={"center": 0.14, "left": 0.45, "right": -0.2})).passed


def test_print_or_screen(ocr):
    out = run(FakeFaces(live=0.2))
    assert out.failures == ["selfie_not_live"]


def test_selfie_does_not_match_id(ocr):
    out = run(FakeFaces(sim=0.33))
    assert "face_mismatch" in out.failures
    assert out.reason == verify.REASONS["face_mismatch"]


def test_no_face_in_selfie_is_reported_first(ocr):
    out = run(FakeFaces(selfie_faces=False, doc_face=False))
    assert out.failures[0] == "selfie_no_face" or "selfie_no_face" in out.failures
    assert out.reason == verify.REASONS["selfie_no_face"]


def test_expired_passport(monkeypatch):
    mrz = documents.parse_mrz_td3("P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10", TODAY)
    read = documents.DocumentRead(id_number="L898902C3", surname="Eriksson", given_names="Anna Maria", source="mrz", mrz=mrz)
    monkeypatch.setattr(documents, "read_passport", lambda img, today=None: read)
    row = {**ROW, "document_type": "passport", "id_number": "L898902C3", "full_name": "Anna Maria Eriksson"}
    out = run(FakeFaces(), row)
    assert out.failures == ["passport_expired"]


def test_details_fit_the_database_limit(ocr):
    import json

    assert len(json.dumps(run(FakeFaces()).details)) < 4000
