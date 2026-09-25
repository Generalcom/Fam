"""Face checks on the selfies and the ID photo, all with small open models run on the server:

* YuNet (OpenCV Zoo, MIT) finds faces and five landmarks, which give a rough head turn (yaw).
* SFace (OpenCV Zoo, Apache-2.0) compares faces: the selfie against the ID photo, and the selfies against each other.
* MiniFASNetV2 + MiniFASNetV1SE (Minivision Silent-Face-Anti-Spoofing, Apache-2.0) score the straight-ahead selfie
  for a printed photo or a screen held up to the camera. See models/NOTICE.md.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import cv2
import numpy as np
import onnxruntime as ort

MODELS_DIR = os.environ.get("MODELS_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models"))

# SFace's cosine threshold from OpenCV Zoo: at or above it, the two faces are taken to be the same person.
SAME_PERSON = 0.363
# Minivision's models: the mean chance that the face is live must reach this (the same bar the app used).
LIVE_MIN = 0.6
# The face box is enlarged this much before the anti-spoofing crops, as in the app's former on-phone check.
SPOOF_GROW = 1.1
SPOOF_MODELS = (("mini-fasnet-v2-2.7.onnx", 2.7), ("mini-fasnet-v1se-4.0.onnx", 4.0))
MAX_SIDE = 1280


@dataclass
class Face:
    box: tuple[float, float, float, float]  # x, y, w, h
    score: float
    row: np.ndarray  # YuNet's full output row, which SFace uses to align the face

    @property
    def yaw(self) -> float:
        """How far the nose sits from the middle of the eyes, along the line between the eyes, in eye-widths: about
        0 looking straight, growing towards +/-0.5 as the head turns. Measured along the eye line so a tilted head
        does not read as a turned one. The sign says which way (in picture terms)."""
        r = self.row.astype(np.float64)
        right_eye, left_eye, nose = r[4:6], r[6:8], r[8:10]
        across = left_eye - right_eye
        eye_dist = float(np.hypot(*across)) or 1.0
        return float(np.dot(nose - (right_eye + left_eye) / 2, across) / eye_dist**2)


def _shrink(img: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    scale = MAX_SIDE / max(h, w)
    return cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else img


def _softmax(v: np.ndarray) -> np.ndarray:
    e = np.exp(v - v.max())
    return e / e.sum()


def _spoof_box(src_w: int, src_h: int, box: tuple[float, float, float, float], scale: float) -> tuple[int, int, int, int]:
    """The crop Minivision's own code takes: the box enlarged by `scale` about its centre, kept inside the picture."""
    x, y, bw, bh = box
    scale = min((src_h - 1) / bh, (src_w - 1) / bw, scale)
    nw, nh, cx, cy = bw * scale, bh * scale, x + bw / 2, y + bh / 2
    lx, ly, rx, ry = cx - nw / 2, cy - nh / 2, cx + nw / 2, cy + nh / 2
    if lx < 0:
        rx, lx = rx - lx, 0
    if ly < 0:
        ry, ly = ry - ly, 0
    if rx > src_w - 1:
        lx, rx = lx - (rx - src_w + 1), src_w - 1
    if ry > src_h - 1:
        ly, ry = ly - (ry - src_h + 1), src_h - 1
    return int(lx), int(ly), int(rx), int(ry)


class FaceChecks:
    def __init__(self, models_dir: str = MODELS_DIR) -> None:
        self._detector = cv2.FaceDetectorYN.create(os.path.join(models_dir, "face_detection_yunet_2023mar.onnx"), "", (320, 320), 0.7, 0.3, 5000)
        self._recogniser = cv2.FaceRecognizerSF.create(os.path.join(models_dir, "face_recognition_sface_2021dec.onnx"), "")
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        self._spoof = [(ort.InferenceSession(os.path.join(models_dir, name), options, providers=["CPUExecutionProvider"]), scale) for name, scale in SPOOF_MODELS]

    def faces(self, img: np.ndarray) -> tuple[np.ndarray, list[Face]]:
        """The (possibly shrunk) picture and the faces in it, most confident first."""
        img = _shrink(img)
        h, w = img.shape[:2]
        self._detector.setInputSize((w, h))
        _, found = self._detector.detect(img)
        rows = [] if found is None else list(found)
        faces = [Face(box=tuple(float(v) for v in r[0:4]), score=float(r[14]), row=r) for r in rows]
        # biggest faces first among the confident ones: the portrait, not a ghost image or a face in the background
        faces.sort(key=lambda f: f.box[2] * f.box[3], reverse=True)
        return img, faces

    def feature(self, img: np.ndarray, face: Face) -> np.ndarray:
        return self._recogniser.feature(self._recogniser.alignCrop(img, face.row))

    def similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        return float(self._recogniser.match(a, b, cv2.FaceRecognizerSF_FR_COSINE))

    def live_probability(self, img: np.ndarray, face: Face) -> float:
        """The mean chance, over the two models, that this is a live face and not a print or a screen."""
        h, w = img.shape[:2]
        x, y, bw, bh = face.box
        gw, gh = bw * SPOOF_GROW, bh * SPOOF_GROW
        grown = (round(x + bw / 2 - gw / 2), round(y + bh / 2 - gh / 2), round(gw), round(gh))
        total = 0.0
        for session, scale in self._spoof:
            lx, ly, rx, ry = _spoof_box(w, h, grown, scale)
            patch = cv2.resize(img[ly : ry + 1, lx : rx + 1], (80, 80), interpolation=cv2.INTER_LINEAR)
            tensor = patch.astype(np.float32).transpose(2, 0, 1)[None]  # BGR, 0..255, NCHW (their to_tensor does not scale)
            logits = session.run(None, {"input": tensor})[0][0]
            total += float(_softmax(logits)[1])
        return total / len(self._spoof)
