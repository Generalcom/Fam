# Identity-check server (kyc-worker)

The app no longer reads the ID or checks the selfie on the phone. It photographs the ID and takes three selfies
(straight ahead, head turned left and right), uploads them to the private `kyc` bucket in Supabase and records a
`pending` submission. The person carries on straight away and is told it can take up to 15 minutes.

This worker picks up each pending submission (it looks every 30 seconds), downloads the photos into memory and:

| Check | How |
| --- | --- |
| ID number (SA ID card / book) | Tesseract OCR; a 13-digit number only counts if its date and check digit are valid. It must equal the number the person typed. The back of a smart ID card is read too if the front gives nothing. |
| Passport number | Tesseract reads the two machine-readable lines; the ICAO check digits must hold, the number must equal the one typed, and the passport must not be expired. |
| Name | The surname (and a first name, if read) must appear in the name typed, allowing a letter or two of OCR slip. Skipped if the name could not be read. |
| Photo on the ID | YuNet (OpenCV Zoo) must find a face on the document. |
| Selfie matches ID | SFace (OpenCV Zoo) cosine similarity of at least 0.363 between the straight-ahead selfie and the ID photo. |
| Head turns | The nose moves at least 0.15 eye-widths from the straight-ahead photo each way, in opposite directions, 0.35 apart in total. |
| Same person in all selfies | SFace similarity of at least 0.30 between the straight selfie and each turned one. |
| Live face | Minivision's MiniFASNet models (in `models/`) score the straight selfie. A live-face probability under 0.6 means a printed photo or a screen. |

If everything passes, the status becomes `verified`. Otherwise it becomes `rejected`, and `reject_reason` holds a
short message the app shows the person, e.g. "We couldn't read the number on your ID. Photograph it again lying flat,
in good light, without glare." The app notices within seconds (realtime) and asks for new photos. Scores and
yes/no results go into `auto_check`. The text read off the ID is not stored, and the logs only hold user ids and
outcome codes.

Set `REVIEW_FAILURES=true` to leave failed submissions `pending` for a person to look at instead of rejecting them.
A submission whose photos cannot be downloaded or decoded 3 times in a row is also left `pending` for a person, with
the error in `auto_check`.

## Security

- The phone uploads over HTTPS straight to Supabase storage, into a private bucket. The app can only upload into the
  person's own folder and cannot read anything back (see `supabase/enrolment.sql`). The worker exposes no endpoint for
  photos, so there is nothing new to attack.
- The worker uses the **service role key**, which bypasses row level security. Keep it only in the host's secret
  settings, never in the app or in git.
- Photos are only ever held in memory while being checked. The container runs as an unprivileged user.

## Setup

1. Run `supabase/enrolment.sql` again in the Supabase SQL editor (safe to repeat). It adds `auto_check` and
   `checked_at`, and makes sure a resubmission starts with a clean result.
2. Build and run the container on any Docker host:

   ```sh
   cd server/kyc-worker
   docker build -t kyc-worker .
   docker run -d --restart unless-stopped \
     -e SUPABASE_URL=https://your-project-ref.supabase.co \
     -e SUPABASE_SERVICE_ROLE_KEY=... \
     kyc-worker
   ```

   Settings are in `.env.example`. The image downloads the two OpenCV Zoo models while it builds and checks their
   hashes.
3. On hosts that expect a web server (Cloud Run, Render, Fly.io, Azure Container Apps), set `PORT`. `GET /` then
   answers with the worker's health (HTTP 503 if it has stopped polling). Keep at least one instance always running
   (for example Cloud Run with `--min-instances=1 --no-cpu-throttling`), because the worker polls in the background.
   Half a CPU and 1 GB of memory is enough for a few submissions a minute.

## Tests

```sh
pip install -r requirements-dev.txt   # and Tesseract: apt install tesseract-ocr
pytest
```

The OCR tests render an ID card and the ICAO specimen passport and read them with the real Tesseract. The face models
were checked against Minivision's sample photos (a real face scores 1.0 live, their two spoof samples 0.2 and 0.0).
**The thresholds have not been tuned on real IDs and real phone selfies yet.** Start with `REVIEW_FAILURES=true`,
look at `auto_check` for the first few dozen people, then adjust the constants at the top of `kyc_worker/verify.py`
and `kyc_worker/faces.py`.

## Limits

This proves that the photos are consistent: a valid number that matches the document, a face that matches the ID
photo, and someone who could turn their head in front of the camera. It does not check the ID against Home Affairs.
A determined attacker with a good screen or a mask may get past the live-face model. For stronger assurance, add a
verification provider behind the same `pending` → `verified` flow.
