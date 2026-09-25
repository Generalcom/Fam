import { File } from 'expo-file-system';

import { base64ToBytes } from '@/lib/id-number';
import { supabase } from '@/lib/supabase';

/** Set EXPO_PUBLIC_REQUIRE_KYC=false to let people use the app without the identity check (development only). */
export const REQUIRE_KYC = process.env.EXPO_PUBLIC_REQUIRE_KYC !== 'false';

/** Bump when the wording of the consent screen changes, so each record says which text was agreed to. */
export const CONSENT_VERSION = 'v1-draft-2026-09-24';

export type DocumentType = 'sa_id_card' | 'sa_id_book' | 'passport';

export type DocumentOption = {
  id: DocumentType;
  title: string;
  hint: string;
  frontTitle: string;
  backTitle: string | null;
  /** Width over height of the document, used to draw the guide frame on the camera. */
  ratio: number;
  numberLabel: string;
};

export const DOCUMENTS: DocumentOption[] = [
  {
    id: 'sa_id_card',
    title: 'Smart ID card',
    hint: 'The credit-card sized South African ID',
    frontTitle: 'Front of your ID card',
    backTitle: 'Back of your ID card',
    ratio: 1.586,
    numberLabel: 'ID number',
  },
  {
    id: 'sa_id_book',
    title: 'Green ID book',
    hint: 'The page with your photo',
    frontTitle: 'The page with your photo',
    backTitle: null,
    ratio: 1.42,
    numberLabel: 'ID number',
  },
  {
    id: 'passport',
    title: 'Passport',
    hint: 'The page with your photo',
    frontTitle: 'The photo page of your passport',
    backTitle: null,
    ratio: 1.42,
    numberLabel: 'Passport number',
  },
];

/** The three selfie photos (JPEG, base64) and the order the head turns were asked for. */
export type SelfieResult = {
  center: string;
  left: string;
  right: string;
  order: ('left' | 'right')[];
  durationMs: number;
};

/** A captured photo: a file on the phone (the basic camera) or JPEG data straight from the document scanner. */
export type Photo = { uri: string } | { base64: string };

export const photoSource = (photo: Photo): string => ('uri' in photo ? photo.uri : 'data:image/jpeg;base64,' + photo.base64);

/** How a photo was taken, for the reviewer. */
export type ScanNote = { via: 'auto' | 'manual' | 'basic'; sharp?: number; light?: number; glare?: number; tilt?: number };

export type KycInput = {
  userId: string;
  documentType: DocumentType;
  fullName: string;
  idNumber: string;
  dateOfBirth: string | null;
  front: Photo;
  back: Photo | null;
  frontNote: ScanNote;
  backNote: ScanNote | null;
  selfie: SelfieResult;
};

async function readPhoto(photo: Photo): Promise<Uint8Array> {
  return 'uri' in photo ? new Uint8Array(await new File(photo.uri).arrayBuffer()) : base64ToBytes(photo.base64);
}

function friendly(message: string): string {
  if (/bucket not found/i.test(message)) return 'Identity storage is not set up yet. Run supabase/enrolment.sql in Supabase.';
  if (/row-level security|not authorized|unauthorized/i.test(message)) return 'Your account is not allowed to upload here. Sign out and back in, then try again.';
  if (/network|fetch failed|timed? ?out/i.test(message)) return 'The connection dropped while uploading. Check your internet and try again.';
  return message;
}

/**
 * Uploads the photos to the private "kyc" bucket, then records the submission. Nothing is readable back by the
 * app afterwards. The phone's copies of the ID photos are deleted once they are safely uploaded. The identity-check
 * server (server/kyc-worker) then reads the ID and checks the selfie, and sets the status, usually within minutes.
 */
export async function submitKyc(input: KycInput, onProgress?: (done: number, total: number) => void): Promise<void> {
  const folder = `${input.userId}/${Date.now()}`;
  const files: { key: 'front' | 'back' | 'center' | 'left' | 'right'; bytes: () => Promise<Uint8Array> }[] = [
    { key: 'front', bytes: () => readPhoto(input.front) },
    ...(input.back ? [{ key: 'back' as const, bytes: () => readPhoto(input.back as Photo) }] : []),
    { key: 'center', bytes: async () => base64ToBytes(input.selfie.center) },
    { key: 'left', bytes: async () => base64ToBytes(input.selfie.left) },
    { key: 'right', bytes: async () => base64ToBytes(input.selfie.right) },
  ];

  const paths: Record<string, string> = {};
  let done = 0;
  onProgress?.(done, files.length);
  for (const file of files) {
    const path = `${folder}/${file.key}.jpg`;
    const { error } = await supabase.storage.from('kyc').upload(path, await file.bytes(), {
      contentType: 'image/jpeg',
      upsert: false,
    });
    if (error) throw new Error(friendly(error.message));
    paths[file.key] = path;
    onProgress?.(++done, files.length);
  }

  const { error } = await supabase.from('kyc_submissions').upsert(
    {
      user_id: input.userId,
      status: 'pending',
      document_type: input.documentType,
      full_name: input.fullName,
      id_number: input.idNumber.replace(/\s+/g, ''),
      date_of_birth: input.dateOfBirth,
      doc_front_path: paths.front,
      doc_back_path: paths.back ?? null,
      selfie_center_path: paths.center,
      selfie_left_path: paths.left,
      selfie_right_path: paths.right,
      liveness: { version: 2, source: 'server', order: input.selfie.order, durationMs: input.selfie.durationMs },
      scan: { front: input.frontNote, back: input.backNote },
      consent_version: CONSENT_VERSION,
      consented_at: new Date().toISOString(),
      reviewed_at: null,
      reviewed_by: null,
      reject_reason: null,
    },
    { onConflict: 'user_id' },
  );
  if (error) throw new Error(friendly(error.message));

  for (const photo of [input.front, input.back]) {
    if (!photo || !('uri' in photo)) continue;
    try {
      new File(photo.uri).delete();
    } catch {
      // the cache is cleared by the system anyway
    }
  }
}
