"""Runs every check on one submission and turns the results into a decision: verified, or rejected with a reason
the person can act on. Only scores and yes/no answers are kept (auto_check); the text read off the ID is not stored.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from kyc_worker import documents
from kyc_worker.faces import LIVE_MIN, SAME_PERSON, FaceChecks

VERSION = 1

# Head turns are judged against the person's own straight-ahead photo: each turn must move the nose at least TURNED
# eye-widths from where it was, the two turns the opposite way from each other and SPREAD apart in all. The landmarks
# wander by about 0.15 from one picture to the next, so these sit well clear of that. Tune on real phones.
TURNED = 0.15
SPREAD = 0.35
# The selfies are compared with each other with a little slack, since two of them are turned.
SAME_SELFIE = 0.30

# In the order they are reported: the first failure found is the one the person is told about.
REASONS: dict[str, str] = {
    "selfie_no_face": "We couldn't see your face clearly in the selfie. Face a light and keep your whole face in the oval.",
    "selfie_not_live": "Your selfie looked like a photo or a screen. Please take it again yourself, in good light.",
    "selfie_turns": "We couldn't see you turn your head to the left and right. Please take the selfie again.",
    "selfie_different_people": "The selfie photos don't all show the same person. Please take the selfie again.",
    "doc_no_face": "We couldn't find the photo on your ID. Make sure the whole document is in the picture.",
    "doc_unreadable": "We couldn't read the number on your ID. Photograph it again lying flat, in good light, without glare.",
    "number_invalid": "The ID number you entered is not valid. Check each digit and try again.",
    "number_mismatch": "The number you entered doesn't match the one on your ID. Check it and try again.",
    "name_mismatch": "The name you entered doesn't match the one on your ID. Enter it exactly as printed.",
    "passport_expired": "Your passport has expired. Please use a valid document.",
    "face_mismatch": "Your selfie doesn't match the photo on your ID. Please try again with your own ID.",
}


@dataclass
class Outcome:
    failures: list[str] = field(default_factory=list)
    details: dict[str, Any] = field(default_factory=dict)

    @property
    def passed(self) -> bool:
        return not self.failures

    @property
    def reason(self) -> str | None:
        for code in REASONS:
            if code in self.failures:
                return REASONS[code]
        return None


def _r(x: float) -> float:
    return round(float(x), 3)


def check(row: dict[str, Any], images: dict[str, np.ndarray], faces: FaceChecks, today: dt.date | None = None) -> Outcome:
    """`images` holds 'front', 'center', 'left', 'right' and, for smart ID cards, 'back'."""
    today = today or dt.date.today()
    out = Outcome()
    fail = out.failures.append
    doc_type = row["document_type"]
    typed_number = "".join(str(row["id_number"]).split()).upper()

    # ---- the selfie: a face in each, head turned both ways, the same person, and live
    selfie: dict[str, Any] = {}
    shots: dict[str, tuple[np.ndarray, Any]] = {}
    for key in ("center", "left", "right"):
        img, found = faces.faces(images[key])
        selfie[f"{key}Faces"] = len(found)
        if found:
            shots[key] = (img, found[0])
            selfie[f"{key}Yaw"] = _r(found[0].yaw)
    if len(shots) < 3:
        fail("selfie_no_face")
    else:
        yc, yl, yr = (shots[k][1].yaw for k in ("center", "left", "right"))
        dl, dr = yl - yc, yr - yc
        turns_ok = abs(dl) >= TURNED and abs(dr) >= TURNED and (dl > 0) != (dr > 0) and abs(yl - yr) >= SPREAD
        selfie["turnsOk"] = turns_ok
        if not turns_ok:
            fail("selfie_turns")
        center_feature = faces.feature(*shots["center"])
        same = [faces.similarity(center_feature, faces.feature(*shots[k])) for k in ("left", "right")]
        selfie["samePerson"] = [_r(s) for s in same]
        if min(same) < SAME_SELFIE:
            fail("selfie_different_people")
        live = faces.live_probability(*shots["center"])
        selfie["live"] = _r(live)
        if live < LIVE_MIN:
            fail("selfie_not_live")
    out.details["selfie"] = selfie

    # ---- the document: its portrait, and the number (and name) read off it
    doc: dict[str, Any] = {"type": doc_type}
    doc_img, doc_faces = faces.faces(images["front"])
    doc["faceFound"] = bool(doc_faces)
    if not doc_faces:
        fail("doc_no_face")

    if doc_type == "passport":
        read = documents.read_passport(images["front"], today)
        doc["mrzFound"] = read.mrz is not None
        if read.mrz:
            doc["mrzValid"] = read.mrz.valid
            doc["expired"] = bool(read.mrz.expiry and read.mrz.expiry < today.isoformat())
            if doc["expired"]:
                fail("passport_expired")
    else:
        if not documents.sa_id_date_of_birth(typed_number, today):
            fail("number_invalid")
        pages = [images["front"]] + ([images["back"]] if images.get("back") is not None else [])
        read = documents.read_sa_document(pages, today)
    doc["numberRead"] = read.id_number is not None
    doc["source"] = read.source
    if read.id_number is None:
        fail("doc_unreadable")
    else:
        doc["numberMatches"] = read.id_number.upper() == typed_number
        if not doc["numberMatches"]:
            fail("number_mismatch")
    name_ok = documents.name_matches(str(row["full_name"]), read.surname, read.given_names)
    doc["nameMatches"] = name_ok
    if name_ok is False:
        fail("name_mismatch")
    out.details["document"] = doc

    # ---- the selfie against the ID photo
    if doc_faces and "center" in shots:
        score = faces.similarity(faces.feature(*shots["center"]), faces.feature(doc_img, doc_faces[0]))
        out.details["faceMatch"] = {"score": _r(score), "threshold": SAME_PERSON}
        if score < SAME_PERSON:
            fail("face_mismatch")

    out.details["failures"] = out.failures
    out.details["version"] = VERSION
    return out
