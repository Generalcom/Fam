export type IdCheck =
  | { ok: true; dateOfBirth: string; age: number; gender: 'female' | 'male'; citizen: boolean }
  | { ok: false; reason: string };

const daysIn = (year: number, month: number) =>
  month === 2 ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;

/** The Luhn check the last digit of a South African ID number satisfies. */
function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * Checks a 13-digit South African ID number: YYMMDD SSSS C A Z (birth date, gender, citizenship, a legacy digit,
 * and a check digit). This only proves the number is well formed and matches the date of birth; whether it belongs
 * to a real person is for the Home Affairs check a verification provider does.
 */
export function checkSaId(input: string, today: Date = new Date()): IdCheck {
  const id = input.replace(/\s+/g, '');
  if (!/^\d{13}$/.test(id)) return { ok: false, reason: 'A South African ID number has 13 digits.' };

  const yy = Number(id.slice(0, 2));
  const month = Number(id.slice(2, 4));
  const day = Number(id.slice(4, 6));
  const thisYear = today.getUTCFullYear();
  // Two-digit years are ambiguous; take the century that does not put the birth date in the future.
  let year = Math.floor(thisYear / 100) * 100 + yy;
  if (Date.UTC(year, month - 1, day) > today.getTime()) year -= 100;
  if (month < 1 || month > 12 || day < 1 || day > daysIn(year, month)) {
    return { ok: false, reason: 'The date of birth in this number is not a real date.' };
  }

  const citizenship = Number(id[10]);
  if (citizenship !== 0 && citizenship !== 1) return { ok: false, reason: 'This ID number is not valid. Check each digit.' };
  if (!luhnValid(id)) return { ok: false, reason: 'This ID number is not valid. Check each digit.' };

  let age = today.getUTCFullYear() - year;
  if (today.getUTCMonth() + 1 < month || (today.getUTCMonth() + 1 === month && today.getUTCDate() < day)) age -= 1;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { ok: true, dateOfBirth: iso, age, gender: Number(id.slice(6, 10)) >= 5000 ? 'male' : 'female', citizen: citizenship === 0 };
}

export function checkPassportNumber(input: string): { ok: true } | { ok: false; reason: string } {
  const value = input.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9]{6,12}$/.test(value)) {
    return { ok: false, reason: 'A passport number is 6 to 12 letters and digits.' };
  }
  return { ok: true };
}

/** The name as it is printed on the document: letters, spaces, apostrophes and hyphens, at least two characters. */
export function cleanFullName(input: string): string | null {
  const name = input.replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 120) return null;
  return /^[\p{L}][\p{L}\p{M} '’.-]*$/u.test(name) ? name : null;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Bytes to base64 without relying on a global `btoa`. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[c & 63] : '=';
  }
  return out;
}

/** Base64 to bytes without relying on a global `atob`, which older JS engines on phones may lack. */
export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/^data:[^,]*,/, '').replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64.indexOf(clean[i]);
    const b = B64.indexOf(clean[i + 1]);
    const c = i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : -1;
    const d = i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : -1;
    out[o++] = (a << 2) | (b >> 4);
    if (c >= 0) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (d >= 0) out[o++] = ((c & 3) << 6) | d;
  }
  return out.slice(0, o);
}
