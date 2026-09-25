import datetime as dt
import shutil

import numpy as np
import pytest

from kyc_worker import documents as d

TODAY = dt.date(2026, 9, 25)
# The ICAO 9303 specimen passport (Anna Maria Eriksson, Utopia).
SPECIMEN_MRZ = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10"


def test_sa_id_numbers():
    assert d.sa_id_date_of_birth("8001015009087", TODAY) == "1980-01-01"
    assert d.sa_id_date_of_birth("800101 5009 087", TODAY) == "1980-01-01"
    assert d.sa_id_date_of_birth("8001015009088", TODAY) is None  # check digit
    assert d.sa_id_date_of_birth("8013015009087", TODAY) is None  # month 13
    assert d.sa_id_date_of_birth("800101500908", TODAY) is None  # 12 digits
    # a birth date that would be in the future belongs to the previous century
    assert d.sa_id_date_of_birth("2701015009083", TODAY) in (None, "1927-01-01")


def test_finds_the_number_among_ocr_noise():
    text = "REPUBLIC OF SOUTH AFRICA\nIdentity Number\n80O101 5009 O87\nSex M"
    assert d.find_sa_id(text, TODAY) == "8001015009087"
    assert d.find_sa_id("8001015009088 and nothing else", TODAY) is None


def test_mrz_specimen():
    mrz = d.parse_mrz_td3(SPECIMEN_MRZ, TODAY)
    assert mrz is not None
    assert mrz.document_number == "L898902C3"
    assert mrz.surname == "ERIKSSON" and mrz.given_names == "ANNA MARIA"
    assert mrz.date_of_birth == "1974-08-12" and mrz.expiry == "2012-04-15"
    assert mrz.valid and mrz.checks["composite"]


def test_mrz_catches_a_misread_digit():
    mrz = d.parse_mrz_td3(SPECIMEN_MRZ.replace("L898902C36", "L898902C46"), TODAY)
    assert mrz is not None and not mrz.checks["number"] and not mrz.valid


def test_names():
    assert d.name_matches("Anna Maria Eriksson", "Eriksson", "Anna Maria") is True
    assert d.name_matches("anna eriksen", "Eriksson", "Anna") is True  # a small slip is allowed
    assert d.name_matches("Thandi Dlamini", "Eriksson", "Anna") is False
    assert d.name_matches("Anna Eriksson", None, None) is None
    assert d.name_matches("Zoë Müller", "Muller", "Zoe") is True


def _render(lines, font, size, width=1100, line_h=None):
    from PIL import Image, ImageDraw, ImageFont

    f = ImageFont.truetype(font, size)
    line_h = line_h or int(size * 1.5)
    img = Image.new("RGB", (width, 60 + line_h * len(lines)), (236, 240, 232))
    draw = ImageDraw.Draw(img)
    for i, line in enumerate(lines):
        draw.text((40, 30 + i * line_h), line, fill=(20, 20, 30), font=f)
    return np.array(img)[:, :, ::-1].copy()


needs_tesseract = pytest.mark.skipif(shutil.which("tesseract") is None, reason="tesseract is not installed")


@needs_tesseract
def test_reads_a_rendered_sa_id_card_even_upside_down():
    pytest.importorskip("PIL")
    import cv2

    card = _render(
        ["REPUBLIC OF SOUTH AFRICA", "Surname / Van", "DLAMINI", "Names / Voorname", "THANDI GRACE", "Identity Number / Identiteitsnommer", "800101 5009 087"],
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        38,
    )
    read = d.read_sa_document([card], TODAY)
    assert read.id_number == "8001015009087"
    assert read.surname == "Dlamini" and read.given_names == "Thandi Grace"
    assert d.read_sa_document([cv2.rotate(card, cv2.ROTATE_180)], TODAY).id_number == "8001015009087"


@needs_tesseract
def test_reads_a_rendered_passport_mrz():
    pytest.importorskip("PIL")
    page = _render(["PASSPORT  UTOPIA", "", "", ""] + SPECIMEN_MRZ.split("\n"), "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 34, width=1000)
    read = d.read_passport(page, TODAY)
    assert read.mrz is not None and read.mrz.valid
    assert read.id_number == "L898902C3"
