# School CBT Server

Vercel-hosted access-code and computer-status APIs for the LIMLO Schools CBT app. The question banks are static JSON files under `data/` and are downloaded and cached by the app for offline use.

## Deploy

1. Make this repository private before pushing the question-bank files.
2. Import `ahmedisiaka/Schoolcbtserver` as a Vercel project and set its root directory to the repository root.
3. Add `FIREBASE_SERVICE_ACCOUNT_JSON` in Vercel, using the Firebase service-account JSON for the same project used by the CBT app.
4. Add `GITHUB_DATA_READ_TOKEN` in Vercel, using a fine-grained token with read-only Contents access to this repository.
5. Deploy. The app calls the API under `https://cbtsoftwareserver.vercel.app/server/api/`. Vercel rewrites these routes to the root API functions.

The service account needs access to Firebase Authentication token verification and the `GIBBORSHUB` Firestore data used by the app. Keep both credentials only in Vercel's encrypted environment variables.

## Endpoints

- `GET /api/access`: verifies the signed-in computer, school status, suspension status, and access expiry.
- `POST /api/claim-code`: atomically registers the signed-in computer and redeems a school access code.
- `GET /api/question-data?path=data/<year>/<subject>.json`: reads a practice question bank from the private repository.

The access endpoints require a Firebase ID token in the `Authorization: Bearer <token>` header. Question-bank requests are served by the Vercel function, which uses the private GitHub token. Neither credential is sent to the desktop app.

## Data layout

- JAMB: `data/<year>/<subject>.json`
- JSCE: `data/jsce/<subject>.json`

The question files are stored in the repository's `data/` folder. The Vercel API serves them to the app, which caches each downloaded file locally for offline use.
