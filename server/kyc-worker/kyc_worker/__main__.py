"""The identity-check worker. Every POLL_SECONDS it takes the pending submissions, downloads their photos from the
private "kyc" bucket (into memory only), runs the checks and writes the decision back:

  passed -> status 'verified'
  failed -> status 'rejected' with a reason the person sees in the app (or, with REVIEW_FAILURES=true, left
            'pending' for a person to look at, with the automatic result in auto_check)

Run it with `python -m kyc_worker`. If PORT is set it also answers GET / with its health, for hosts that expect a web
server (Cloud Run, Render, Fly, Azure Container Apps...).
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import os
import signal
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import cv2
import numpy as np

from kyc_worker.faces import FaceChecks
from kyc_worker.store import Store
from kyc_worker.verify import check

log = logging.getLogger("kyc_worker")

POLL_SECONDS = float(os.environ.get("POLL_SECONDS", "30"))
BATCH = int(os.environ.get("BATCH", "5"))
REVIEW_FAILURES = os.environ.get("REVIEW_FAILURES", "false").lower() == "true"
MAX_TRIES = 3
REVIEWER = "auto-check"

state: dict[str, Any] = {"started": time.time(), "last_poll": None, "last_error": None, "checked": 0}
stopping = threading.Event()


def decode(data: bytes) -> np.ndarray:
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)  # applies the photo's EXIF orientation
    if img is None:
        raise ValueError("not a readable image")
    return img


def process(store: Store, faces: FaceChecks, row: dict[str, Any], tries: dict[str, int]) -> None:
    uid = row["user_id"]
    paths = {"front": row["doc_front_path"], "back": row.get("doc_back_path"), "center": row["selfie_center_path"], "left": row["selfie_left_path"], "right": row["selfie_right_path"]}
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    try:
        images = {k: decode(store.photo(p)) for k, p in paths.items() if p}
        outcome = check(row, images, faces)
    except Exception as e:  # noqa: BLE001 - one bad submission must not stop the others
        key = f"{uid}@{row['submitted_at']}"
        tries[key] = tries.get(key, 0) + 1
        log.warning("check failed for %s (try %d): %s", uid, tries[key], type(e).__name__)
        if tries[key] >= MAX_TRIES:
            # Leave it for a person, and stop picking it up.
            store.record(row, {"checked_at": now, "auto_check": {"error": type(e).__name__, "tries": tries[key]}})
        return
    finally:
        images = None  # noqa: F841 - drop the photos from memory straight away

    patch: dict[str, Any] = {"checked_at": now, "auto_check": outcome.details}
    if outcome.passed:
        patch |= {"status": "verified", "reviewed_at": now, "reviewed_by": REVIEWER}
    elif not REVIEW_FAILURES:
        patch |= {"status": "rejected", "reject_reason": outcome.reason, "reviewed_at": now, "reviewed_by": REVIEWER}
    written = store.record(row, patch)
    state["checked"] += 1
    # No names, numbers or photos in the logs: only who, and the outcome codes.
    log.info("%s: %s %s%s", uid, "verified" if outcome.passed else ("needs review" if REVIEW_FAILURES else "rejected"), ",".join(outcome.failures), "" if written else " (submission changed meanwhile; not written)")


def serve_health(port: int) -> None:
    class Health(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            stale = state["last_poll"] is None and time.time() - state["started"] > 300 or state["last_poll"] is not None and time.time() - state["last_poll"] > max(300, POLL_SECONDS * 5)
            body = json.dumps({"ok": not stale, **state}).encode()
            self.send_response(503 if stale else 200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args: Any) -> None:
            pass

    server = ThreadingHTTPServer(("0.0.0.0", port), Health)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    log.info("health on :%d", port)


def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")
    if os.environ.get("PORT"):
        serve_health(int(os.environ["PORT"]))
    store, faces, tries = Store(url, key), FaceChecks(), {}
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stopping.set())
    log.info("polling every %ss%s", POLL_SECONDS, " (failures left for review)" if REVIEW_FAILURES else "")
    while not stopping.is_set():
        try:
            rows = store.pending(BATCH)
            state["last_poll"] = time.time()
            state["last_error"] = None
            for row in rows:
                if stopping.is_set():
                    break
                process(store, faces, row, tries)
            if len(rows) == BATCH:
                continue  # more waiting: carry straight on
        except Exception as e:  # noqa: BLE001
            state["last_error"] = type(e).__name__
            log.warning("poll failed: %s", e)
        stopping.wait(POLL_SECONDS)


if __name__ == "__main__":
    main()
