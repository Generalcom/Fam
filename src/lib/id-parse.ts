import { checkSaId } from '@/lib/id-number';

/** What the text reader found on a document. Nothing here is trusted: the person confirms every field. */
export type IdRead = {
  idNumber: string | null;
  fullName: string | null;
  surname: string | null;
  givenNames: string | null;
  /** Where the number came from: the ordinary text pass, the digits-only pass, or the passport's machine-readable zone. */
  source: 'text' | 'digits' | 'mrz' | null;
  mrz: Mrz | null;
};

export type Mrz = {
  documentNumber: string;
  surname: string;
  givenNames: string;
  nationality: string;
  dateOfBirth: string;
  sex: string;
  expiry: string;
  /** Each check digit against the value it protects. */
  checks: { number: boolean; dateOfBirth: boolean; expiry: boolean; composite: boolean };
  /** The number, date of birth and expiry all check out. */
  valid: boolean;
};

export const EMPTY_READ: IdRead = { idNumber: null, fullName: null, surname: null, givenNames: null, source: null, mrz: null };

// ---------- South African ID cards and books ----------

const DIGIT_LOOKALIKES: Record<string, string> = { O: '0', Q: '0', D: '0', I: '1', L: '1', '|': '1', S: '5', B: '8', Z: '2' };
const digitLike = (c: string) => /[0-9]/.test(c) || c in DIGIT_LOOKALIKES;
const toDigit = (c: string) => DIGIT_LOOKALIKES[c] ?? c;

/** Every group of consecutive digit-like tokens on a line that adds up to exactly 13 digits, e.g. "800101 5009 087". */
function thirteenDigitRuns(text: string): string[] {
  const out: string[] = [];
  for (const line of text.toUpperCase().split(/\r?\n/)) {
    const tokens = line.split(/\s+/).filter(Boolean);
    for (let start = 0; start < tokens.length; start++) {
      let joined = '';
      for (let end = start; end < tokens.length; end++) {
        const token = tokens[end];
        if (![...token].every(digitLike)) break;
        joined += [...token].map(toDigit).join('');
        if (joined.length === 13) {
          out.push(joined);
          break;
        }
        if (joined.length > 13) break;
      }
    }
  }
  return out;
}

const properCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|[\s'’-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase())
    .trim();

/** The value printed under a label such as "Surname / Van": the next line made of letters. */
function valueAfter(lines: string[], label: RegExp): string | null {
  for (let i = 0; i < lines.length; i++) {
    if (!label.test(lines[i])) continue;
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const candidate = lines[j].trim();
      if (!candidate) continue;
      if (/[/]/.test(candidate) || /identity|birth|sex|nationality|status|country|surname|names/i.test(candidate)) return null;
      if (/^[\p{L}][\p{L}\p{M} '’.-]{1,}$/u.test(candidate)) return candidate.replace(/\s+/g, ' ');
      return null;
    }
  }
  return null;
}

/**
 * Reads a South African smart ID card front (or ID book page) from what the text reader returned. The ID number
 * only counts if its date and check digit are valid; a misread digit fails the check rather than slipping through.
 */
export function readSaDocument(ocr: { text?: string; digits?: string } | null, today: Date = new Date()): IdRead {
  if (!ocr) return EMPTY_READ;
  const text = ocr.text ?? '';
  const result: IdRead = { ...EMPTY_READ };

  const tryNumbers = (source: string, label: 'text' | 'digits') => {
    for (const run of thirteenDigitRuns(source)) {
      if (checkSaId(run, today).ok) {
        result.idNumber = run;
        result.source = label;
        return true;
      }
    }
    return false;
  };
  if (!tryNumbers(text, 'text')) tryNumbers(ocr.digits ?? '', 'digits');

  const lines = text.split(/\r?\n/);
  const surname = valueAfter(lines, /surname|\bvan\b/i);
  const names = valueAfter(lines, /\bnames?\b|voorname/i);
  result.surname = surname ? properCase(surname) : null;
  result.givenNames = names ? properCase(names) : null;
  if (result.surname && result.givenNames) result.fullName = `${result.givenNames} ${result.surname}`;
  return result;
}

// ---------- Passports: the two machine-readable lines at the bottom of the photo page ----------

const MRZ_VALUES = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The ICAO 9303 check digit: values weighted 7, 3, 1 in turn, summed, modulo 10. `<` counts as 0. */
export function mrzCheckDigit(field: string): number {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < field.length; i++) {
    const c = field[i];
    const value = c === '<' ? 0 : MRZ_VALUES.indexOf(c);
    if (value < 0) return -1;
    sum += value * weights[i % 3];
  }
  return sum % 10;
}

const NUMBER_FIX: Record<string, string> = { O: '0', Q: '0', D: '0', I: '1', L: '1', S: '5', B: '8', Z: '2' };
const LETTER_FIX: Record<string, string> = { '0': 'O', '1': 'I', '5': 'S', '8': 'B', '2': 'Z' };
const asDigits = (s: string) => [...s].map((c) => NUMBER_FIX[c] ?? c).join('');
const asLetters = (s: string) => [...s].map((c) => LETTER_FIX[c] ?? c).join('');

function mrzDate(yymmdd: string, kind: 'birth' | 'expiry', today: Date): string | null {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const yy = Number(yymmdd.slice(0, 2));
  const thisYear = today.getUTCFullYear();
  let year = Math.floor(thisYear / 100) * 100 + yy;
  if (kind === 'birth' && year > thisYear) year -= 100;
  const month = Number(yymmdd.slice(2, 4));
  const day = Number(yymmdd.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Glyphs the reader tends to see instead of the `<` filler, when they come in a long run. */
const fillerFix = (line: string) => line.replace(/([KCLESX])\1{3,}/g, (m) => '<'.repeat(m.length));

function mrzCandidates(text: string): string[] {
  return text
    .toUpperCase()
    .split(/\r?\n/)
    .map((l) => fillerFix(l.replace(/\s+/g, '')))
    .filter((l) => l.length >= 36 && l.length <= 48 && /[<]/.test(l) && /^[A-Z0-9<]+$/.test(l))
    .map((l) => (l.length < 44 ? l.padEnd(44, '<') : l.slice(0, 44)));
}

/** Parses a passport's two-line machine-readable zone (TD3). Returns null when no such pair is in the text. */
export function parseMrzTd3(text: string, today: Date = new Date()): Mrz | null {
  const lines = mrzCandidates(text);
  const first = lines.find((l) => l[0] === 'P');
  const second = lines.find((l) => l !== first && /^[A-Z0-9<]{9}[0-9O][A-Z<]{3}/.test(l.slice(0, 14)));
  if (!first || !second) return null;

  const numberField = second.slice(0, 9);
  const numberCheck = asDigits(second[9]);
  const nationality = asLetters(second.slice(10, 13));
  const dob = asDigits(second.slice(13, 19));
  const dobCheck = asDigits(second[19]);
  const sex = second[20] === 'M' || second[20] === 'F' ? second[20] : '<';
  const expiry = asDigits(second.slice(21, 27));
  const expiryCheck = asDigits(second[27]);
  const composite = asDigits(second[43]);

  const checks = {
    number: String(mrzCheckDigit(numberField)) === numberCheck,
    dateOfBirth: String(mrzCheckDigit(dob)) === dobCheck,
    expiry: String(mrzCheckDigit(expiry)) === expiryCheck,
    composite: String(mrzCheckDigit(second.slice(0, 10) + second.slice(13, 20) + second.slice(21, 43))) === composite,
  };

  const [surnamePart, givenPart = ''] = asLetters(first.slice(5)).split('<<');
  const clean = (s: string) => s.replace(/</g, ' ').replace(/\s+/g, ' ').trim();
  return {
    documentNumber: numberField.replace(/</g, ''),
    surname: clean(surnamePart),
    givenNames: clean(givenPart),
    nationality,
    dateOfBirth: mrzDate(dob, 'birth', today) ?? '',
    sex,
    expiry: mrzDate(expiry, 'expiry', today) ?? '',
    checks,
    valid: checks.number && checks.dateOfBirth && checks.expiry,
  };
}

export function readPassport(ocr: { text?: string; mrz?: string } | null, today: Date = new Date()): IdRead {
  if (!ocr) return EMPTY_READ;
  const mrz = parseMrzTd3(ocr.mrz ?? '', today) ?? parseMrzTd3(ocr.text ?? '', today);
  if (!mrz) return EMPTY_READ;
  const surname = properCase(mrz.surname);
  const givenNames = properCase(mrz.givenNames);
  return {
    // A number that fails its check digit is worse than none: leave it for the person to type.
    idNumber: mrz.checks.number ? mrz.documentNumber : null,
    surname: surname || null,
    givenNames: givenNames || null,
    fullName: surname && givenNames ? `${givenNames} ${surname}` : null,
    source: 'mrz',
    mrz,
  };
}

/** Ignoring case, spaces and punctuation: did the person type what the reader saw? */
export function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return norm(a).length > 0 && norm(a) === norm(b);
}
