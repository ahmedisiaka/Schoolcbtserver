# School CBT Server

Vercel-hosted access-code and computer-status APIs for the LIMLO Schools CBT app. The question banks are static JSON files under `data/` and are downloaded and cached by the app for offline use.

## Deploy

1. Import `ahmedisiaka/Schoolcbtserver` as a Vercel project and set its root directory to the repository root.
2. Add `FIREBASE_SERVICE_ACCOUNT_JSON` in Vercel, using the Firebase service-account JSON for the same project used by the CBT app.
3. Keep the question banks in the repository's `data/` directory. Vercel serves these files at `https://cbtsoftwareserver.vercel.app/data/...`.
4. Deploy. The app calls the API under `https://cbtsoftwareserver.vercel.app/server/api/`. Vercel rewrites these routes to the root API functions.

The service account needs access to Firebase Authentication token verification and the configured Firestore data root. Keep credentials only in Vercel's encrypted environment variables.

Question downloads are read from the Vercel-hosted `data/` files, so `GITHUB_DATA_READ_TOKEN` is not required. If the static files are hosted at a different origin, set `CBT_QUESTION_DATA_BASE_URL` to that HTTPS origin in Vercel and redeploy.

Set `CBT_DATA_ROOT` to the Firestore top-level collection used by a school edition (defaults to `GIBBORSHUB`). For an app dedicated to one school, also set `CBT_APP_SCHOOL_ID` to that school's Firestore document ID. The server rejects requests and access codes from another root or school when these values are configured. These settings are tenant enforcement, not a cryptographic client signature.

In the desktop app repository, build a school edition with `npm run build-app -- --school-id=<school-document-id> --data-root=<firestore-root> --app-name="<school-name>"`. The optional `--server-url` parameter sets that edition's API base URL. Configure the deployed server with the matching `CBT_DATA_ROOT` and `CBT_APP_SCHOOL_ID`; never put service-account credentials in build arguments.

When generating an access code, select the JAMB and JSCE subjects that the code should enable. The server stores these permissions with each activated computer and checks them before serving a question bank. Downloaded banks are encrypted at rest in the desktop app using Electron `safeStorage`; this protects cached files on the local device but cannot prevent a determined user with control of the running computer from inspecting questions while the app uses them.

## Endpoints

- `GET /api/access`: verifies the signed-in computer, school status, suspension status, and access expiry.
- `POST /api/claim-code`: atomically registers the signed-in computer and redeems a school access code.
- `GET /api/question-data?path=data/<year>/<subject>.json`: verifies permissions and reads a practice question bank from the configured Vercel static-data origin.

The access endpoints require a Firebase ID token in the `Authorization: Bearer <token>` header. Question-bank requests are served by the Vercel function, which uses the private GitHub token. Neither credential is sent to the desktop app.

## Data layout

- JAMB: `data/<year>/<subject>.json`
- JSCE: `data/jsce/<subject>.json`

The question files are stored in the repository's `data/` folder. These static files are publicly addressable at `/data/...`; the API enforces access for app downloads, but cannot prevent direct downloads from those public URLs. To keep question banks private, store them outside Vercel's public static directory and configure a private data origin that independently enforces access. The app caches API downloads locally for offline use.
