"""Reading the ID document: Tesseract OCR, then the South African ID number or the passport's machine-readable zone.

A number only counts when its own check digits hold, so a misread digit fails rather than slipping through.
Ported from the app's former on-phone reader (src/lib/id-parse.ts and src/lib/id-number.ts).
"""

from __future__ import annotations

import datetime as dt
import difflib
import re
import unicodedata
from dataclasses import dataclass, field

import cv2
import numpy as np
import pytesseract

# ---------- South African ID numbers ----------


def _days_in(year: int, month: int) -> int:
    if month == 2:
        return 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28
    return 30 if month in (4, 6, 9, 11) else 31


def _luhn_valid(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def sa_id_date_of_birth(value: str, today: dt.date | None = None) -> str | None:
    """The date of birth (YYYY-MM-DD) in a well-formed 13-digit SA ID number, or None if the number is not valid."""
    today = today or dt.date.today()
    s = re.sub(r"\s+", "", value or "")
    if not re.fullmatch(r"\d{13}", s):
        return None
    yy, month, day = int(s[0:2]), int(s[2:4]), int(s[4:6])
    # Two-digit years are ambiguous; take the century that does not put the birth date in the future.
    year = (today.year // 100) * 100 + yy
    if (year, month, day) > (today.year, today.month, today.day):
        year -= 100
    if month < 1 or month > 12 or day < 1 or day > _days_in(year, month):
        return None
    if s[10] not in "01" or not _luhn_valid(s):
        return None
    return f"{year:04d}-{month:02d}-{day:02d}"


_DIGIT_LOOKALIKES = {"O": "0", "Q": "0", "D": "0", "I": "1", "L": "1", "|": "1", "S": "5", "B": "8", "Z": "2"}


def _digit_like(c: str) -> bool:
    return c.isdigit() or c in _DIGIT_LOOKALIKES


def _thirteen_digit_runs(text: str) -> list[str]:
    """Every run of consecutive digit-like tokens on a line that joins to exactly 13 digits, e.g. "800101 5009 087"."""
    out: list[str] = []
    for line in text.upper().splitlines():
        tokens = line.split()
        for start in range(len(tokens)):
            joined = ""
            for token in tokens[start:]:
                if not all(_digit_like(c) for c in token):
                    break
                joined += "".join(_DIGIT_LOOKALIKES.get(c, c) for c in token)
                if len(joined) >= 13:
                    if len(joined) == 13:
                        out.append(joined)
                    break
    return out


def find_sa_id(text: str, today: dt.date | None = None) -> str | None:
    for run in _thirteen_digit_runs(text):
        if sa_id_date_of_birth(run, today):
            return run
    return None


def _proper(s: str) -> str:
    return re.sub(r"(^|[\s'’-])(\w)", lambda m: m.group(1) + m.group(2).upper(), s.lower()).strip()


def _value_after(lines: list[str], label: re.Pattern[str]) -> str | None:
    """The value printed under a label such as "Surname / Van": the next line made only of letters."""
    for i, line in enumerate(lines):
        if not label.search(line):
            continue
        for candidate in lines[i + 1 : i + 4]:
            candidate = candidate.strip()
            if not candidate:
                continue
            if "/" in candidate or re.search(r"identity|birth|sex|nationality|status|country|surname|names", candidate, re.I):
                return None
            if re.fullmatch(r"[^\W\d_][^\W\d_ '’.-]*(?:[ '’.-]+[^\W\d_]+)*", candidate):
                return re.sub(r"\s+", " ", candidate)
            return None
    return None


# ---------- Passports (ICAO 9303, TD3: two lines of 44) ----------

_MRZ_VALUES = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
_NUMBER_FIX = {"O": "0", "Q": "0", "D": "0", "I": "1", "L": "1", "S": "5", "B": "8", "Z": "2"}
_LETTER_FIX = {"0": "O", "1": "I", "5": "S", "8": "B", "2": "Z"}


def mrz_check_digit(field_value: str) -> int:
    weights = (7, 3, 1)
    total = 0
    for i, c in enumerate(field_value):
        v = 0 if c == "<" else _MRZ_VALUES.find(c)
        if v < 0:
            return -1
        total += v * weights[i % 3]
    return total % 10


def _as_digits(s: str) -> str:
    return "".join(_NUMBER_FIX.get(c, c) for c in s)


def _as_letters(s: str) -> str:
    return "".join(_LETTER_FIX.get(c, c) for c in s)


def _mrz_date(yymmdd: str, kind: str, today: dt.date) -> str | None:
    if not re.fullmatch(r"\d{6}", yymmdd):
        return None
    yy, month, day = int(yymmdd[:2]), int(yymmdd[2:4]), int(yymmdd[4:6])
    year = (today.year // 100) * 100 + yy
    if kind == "birth" and year > today.year:
        year -= 100
    if not (1 <= month <= 12 and 1 <= day <= 31):
        return None
    return f"{year:04d}-{month:02d}-{day:02d}"


def _mrz_candidates(text: str) -> list[str]:
    out = []
    for line in text.upper().splitlines():
        line = re.sub(r"\s+", "", line)
        line = re.sub(r"([KCLESX])\1{3,}", lambda m: "<" * len(m.group(0)), line)  # misread `<` filler
        if 36 <= len(line) <= 48 and "<" in line and re.fullmatch(r"[A-Z0-9<]+", line):
            out.append(line.ljust(44, "<")[:44])
    return out


@dataclass
class Mrz:
    document_number: str
    surname: str
    given_names: str
    nationality: str
    date_of_birth: str | None
    expiry: str | None
    checks: dict[str, bool]

    @property
    def valid(self) -> bool:
        return self.checks["number"] and self.checks["date_of_birth"] and self.checks["expiry"]


def parse_mrz_td3(text: str, today: dt.date | None = None) -> Mrz | None:
    today = today or dt.date.today()
    lines = _mrz_candidates(text)
    first = next((l for l in lines if l[0] == "P"), None)
    second = next((l for l in lines if l is not first and re.fullmatch(r"[A-Z0-9<]{9}[0-9O][A-Z0-9<]{3}", l[:13])), None)
    if not first or not second:
        return None
    number_field = second[0:9]
    dob = _as_digits(second[13:19])
    expiry = _as_digits(second[21:27])
    checks = {
        "number": str(mrz_check_digit(number_field)) == _as_digits(second[9]),
        "date_of_birth": str(mrz_check_digit(dob)) == _as_digits(second[19]),
        "expiry": str(mrz_check_digit(expiry)) == _as_digits(second[27]),
        "composite": str(mrz_check_digit(second[0:10] + second[13:20] + second[21:43])) == _as_digits(second[43]),
    }
    parts = _as_letters(first[5:]).split("<<", 1)
    clean = lambda s: re.sub(r"\s+", " ", s.replace("<", " ")).strip()  # noqa: E731
    return Mrz(
        document_number=number_field.replace("<", ""),
        surname=clean(parts[0]),
        given_names=clean(parts[1] if len(parts) > 1 else ""),
        nationality=_as_letters(second[10:13]),
        date_of_birth=_mrz_date(dob, "birth", today),
        expiry=_mrz_date(expiry, "expiry", today),
        checks=checks,
    )


# ---------- Names ----------


def _name_tokens(s: str | None) -> list[str]:
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).upper()
    return [t for t in re.split(r"[^A-Z]+", s) if len(t) >= 2]


def name_matches(typed: str, surname: str | None, given_names: str | None) -> bool | None:
    """Whether the typed name agrees with the one read: the surname must be there and, when read, a first name.
    Small OCR slips (one or two letters) are allowed. None when nothing was read to compare against."""
    read_surname = _name_tokens(surname)
    if not read_surname:
        return None
    typed_tokens = _name_tokens(typed)
    close = lambda a, b: a == b or difflib.SequenceMatcher(None, a, b).ratio() >= 0.8  # noqa: E731
    has = lambda token: any(close(token, t) for t in typed_tokens)  # noqa: E731
    if not all(has(t) for t in read_surname):
        return False
    given = _name_tokens(given_names)
    return not given or any(has(t) for t in given)


# ---------- OCR ----------


def _prepare(img: np.ndarray, y_from: float, y_to: float, want_w: int) -> np.ndarray:
    """Grey, upscaled to about want_w wide, tones stretched so faint print is not lost."""
    h, w = img.shape[:2]
    crop = img[int(h * y_from) : max(int(h * y_to), int(h * y_from) + 1), :]
    grey = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop
    scale = max(1.0, want_w / grey.shape[1])
    if scale > 1.0:
        grey = cv2.resize(grey, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    lo, hi = np.percentile(grey, (2, 98))
    span = max(40.0, float(hi - lo))
    return np.clip((grey.astype(np.float32) - lo) * 255.0 / span, 0, 255).astype(np.uint8)


def _tess(img: np.ndarray, psm: int, whitelist: str | None = None) -> str:
    config = f"--psm {psm}"
    if whitelist:
        config += f" -c tessedit_char_whitelist={whitelist}"
    return pytesseract.image_to_string(img, lang="eng", config=config, timeout=60)


@dataclass
class DocumentRead:
    id_number: str | None = None
    surname: str | None = None
    given_names: str | None = None
    source: str | None = None  # 'text' | 'digits' | 'mrz'
    mrz: Mrz | None = None
    rotation: int = 0
    notes: list[str] = field(default_factory=list)


_ROTATIONS = {0: None, 180: cv2.ROTATE_180, 90: cv2.ROTATE_90_CLOCKWISE, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}


def read_sa_document(images: list[np.ndarray], today: dt.date | None = None) -> DocumentRead:
    """Looks for a valid SA ID number (and the printed names) on each photo, trying it upright and then turned."""
    result = DocumentRead()
    for img in images:
        for rotation, code in _ROTATIONS.items():
            turned = img if code is None else cv2.rotate(img, code)
            text = _tess(_prepare(turned, 0, 1, 1600), 11)
            number, source = find_sa_id(text, today), "text"
            if not number:
                number, source = find_sa_id(_tess(_prepare(turned, 0, 1, 1600), 11, "0123456789 "), today), "digits"
            lines = text.splitlines()
            if not result.surname:
                surname = _value_after(lines, re.compile(r"surname|\bvan\b", re.I))
                given = _value_after(lines, re.compile(r"\bnames?\b|voorname", re.I))
                if surname:
                    result.surname, result.given_names = _proper(surname), _proper(given) if given else None
            if number:
                result.id_number, result.source, result.rotation = number, source, rotation
                return result
    return result


def read_passport(image: np.ndarray, today: dt.date | None = None) -> DocumentRead:
    result = DocumentRead()
    for rotation, code in _ROTATIONS.items():
        turned = image if code is None else cv2.rotate(image, code)
        mrz_text = _tess(_prepare(turned, 0.62, 1, 1800), 6, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<")
        mrz = parse_mrz_td3(mrz_text, today) or parse_mrz_td3(_tess(_prepare(turned, 0, 1, 1800), 6, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<"), today)
        if mrz:
            result.mrz, result.source, result.rotation = mrz, "mrz", rotation
            result.id_number = mrz.document_number if mrz.checks["number"] else None
            result.surname = _proper(mrz.surname) or None
            result.given_names = _proper(mrz.given_names) or None
            return result
    return result
