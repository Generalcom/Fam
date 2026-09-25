"""The worker's round trip against a stand-in for Supabase: fetch, download, decide, write back."""

import json

import cv2
import httpx
import numpy as np
import pytest

import kyc_worker.__main__ as worker
from kyc_worker.store import Store
from kyc_worker.verify import Outcome

ROW = {
    "user_id": "u1",
    "submitted_at": "2026-09-25T10:00:00.123456+00:00",
    "document_type": "sa_id_card",
    "full_name": "Thandi Dlamini",
    "id_number": "8001015009087",
    "doc_front_path": "u1/1/front.jpg",
    "doc_back_path": "u1/1/back.jpg",
    "selfie_center_path": "u1/1/center.jpg",
    "selfie_left_path": "u1/1/left.jpg",
    "selfie_right_path": "u1/1/right.jpg",
}
JPEG = cv2.imencode(".jpg", np.full((40, 60, 3), 200, np.uint8))[1].tobytes()


class FakeSupabase:
    def __init__(self, photo_status=200):
        self.patches, self.downloads, self.photo_status = [], [], photo_status

    def __call__(self, request: httpx.Request) -> httpx.Response:
        assert request.headers["apikey"] == "service-key"
        assert request.headers["authorization"] == "Bearer service-key"
        path = request.url.path
        if request.method == "GET" and path == "/rest/v1/kyc_submissions":
            assert request.url.params["status"] == "eq.pending" and request.url.params["checked_at"] == "is.null"
            return httpx.Response(200, json=[ROW])
        if request.method == "GET" and path.startswith("/storage/v1/object/authenticated/kyc/"):
            self.downloads.append(path.rsplit("/kyc/", 1)[1])
            return httpx.Response(self.photo_status, content=JPEG if self.photo_status == 200 else b"")
        if request.method == "PATCH" and path == "/rest/v1/kyc_submissions":
            self.patches.append((dict(request.url.params), json.loads(request.content)))
            return httpx.Response(200, json=[{"user_id": "u1"}])
        return httpx.Response(404)


def store(fake):
    return Store("https://example.supabase.co", "service-key", transport=httpx.MockTransport(fake))


def run(monkeypatch, fake, outcome, review=False):
    monkeypatch.setattr(worker, "check", lambda row, images, faces: outcome)
    monkeypatch.setattr(worker, "REVIEW_FAILURES", review)
    s = store(fake)
    tries = {}
    for row in s.pending(5):
        worker.process(s, None, row, tries)
    return tries


def test_passed_submission_is_verified(monkeypatch):
    fake = FakeSupabase()
    run(monkeypatch, fake, Outcome(details={"version": 1}))
    assert sorted(fake.downloads) == sorted(p for k, p in ROW.items() if k.endswith("_path"))
    (params, body), = fake.patches
    # only the submission that was checked, and only while it is still pending
    assert params == {"user_id": "eq.u1", "submitted_at": "eq.2026-09-25T10:00:00.123456+00:00", "status": "eq.pending"}
    assert body["status"] == "verified" and body["reviewed_by"] == "auto-check" and body["checked_at"]


def test_failed_submission_is_rejected_with_the_reason(monkeypatch):
    fake = FakeSupabase()
    run(monkeypatch, fake, Outcome(failures=["doc_unreadable"], details={}))
    (_, body), = fake.patches
    assert body["status"] == "rejected" and "couldn't read" in body["reject_reason"]


def test_review_mode_leaves_failures_pending(monkeypatch):
    fake = FakeSupabase()
    run(monkeypatch, fake, Outcome(failures=["face_mismatch"], details={"failures": ["face_mismatch"]}), review=True)
    (_, body), = fake.patches
    assert "status" not in body and body["auto_check"] == {"failures": ["face_mismatch"]} and body["checked_at"]


def test_download_errors_are_retried_then_left_for_a_person(monkeypatch):
    fake = FakeSupabase(photo_status=500)
    monkeypatch.setattr(worker, "check", lambda *a: pytest.fail("should not be checked"))
    s, tries = store(fake), {}
    for _ in range(worker.MAX_TRIES - 1):
        worker.process(s, None, ROW, tries)
    assert fake.patches == []
    worker.process(s, None, ROW, tries)
    (_, body), = fake.patches
    assert "status" not in body and body["auto_check"]["error"] == "HTTPStatusError" and body["checked_at"]
