# School CBT Server

Vercel-hosted access-code and computer-status APIs for the LIMLO Schools CBT app. The question banks are static JSON files under `data/` and are downloaded and cached by the app for offline use.

## Deploy

1. Make this repository private before pushing the question-bank files.
2. Import `ahmedisiaka/Schoolcbtserver` as a Vercel project and set its root directory to the repository root.
3. Add `FIREBASE_SERVICE_ACCOUNT_JSON` in Vercel, using the Firebase service-account JSON for the same project used by the CBT app.
4. Add `GITHUB_DATA_READ_TOKEN` in Vercel for every environment serving the app (at least Production), using a fine-grained token with read-only Contents access to `ahmedisiaka/Schoolcbtserver`.
5. Redeploy after adding or changing the token. Vercel functions do not receive environment-variable changes until a new deployment. The app calls the API under `https://cbtsoftwareserver.vercel.app/server/api/`. Vercel rewrites these routes to the root API functions.

The service account needs access to Firebase Authentication token verification and the configured Firestore data root. Keep credentials only in Vercel's encrypted environment variables.

If question downloads fail with a server log pointing to the missing-token check in `api/question-data.js`, `GITHUB_DATA_READ_TOKEN` is not present in the deployment environment. Add it under Vercel **Project Settings → Environment Variables**, grant it read-only Contents access to this private repository, select the deployment environment, and redeploy. The token must remain in Vercel and must never be embedded in the app.

Set `CBT_DATA_ROOT` to the Firestore top-level collection used by a school edition (defaults to `GIBBORSHUB`). For an app dedicated to one school, also set `CBT_APP_SCHOOL_ID` to that school's Firestore document ID. The server rejects requests and access codes from another root or school when these values are configured. These settings are tenant enforcement, not a cryptographic client signature.

In the desktop app repository, build a school edition with `npm run build-app -- --school-id=<school-document-id> --data-root=<firestore-root> --app-name="<school-name>"`. The optional `--server-url` parameter sets that edition's API base URL. Configure the deployed server with the matching `CBT_DATA_ROOT` and `CBT_APP_SCHOOL_ID`; never put service-account or GitHub tokens in build arguments.

When generating an access code, select the JAMB and JSCE subjects that the code should enable. The server stores these permissions with each activated computer and checks them before serving a question bank. Downloaded banks are encrypted at rest in the desktop app using Electron `safeStorage`; this protects cached files on the local device but cannot prevent a determined user with control of the running computer from inspecting questions while the app uses them.

## Endpoints

- `GET /api/access`: verifies the signed-in computer, school status, suspension status, and access expiry.
- `POST /api/claim-code`: atomically registers the signed-in computer and redeems a school access code.
- `GET /api/question-data?path=data/<year>/<subject>.json`: reads a practice question bank from the private repository.

The access endpoints require a Firebase ID token in the `Authorization: Bearer <token>` header. Question-bank requests are served by the Vercel function, which uses the private GitHub token. Neither credential is sent to the desktop app.

## Data layout

- JAMB: `data/<year>/<subject>.json`
- JSCE: `data/jsce/<subject>.json`

The question files are stored in the repository's `data/` folder. The Vercel API serves them to the app, which caches each downloaded file locally for offline use.
