# School CBT Server

Vercel-hosted access-code, computer-status, and protected question-bank APIs for the LIMLO Schools CBT app.

## Deploy

1. Import `ahmedisiaka/Schoolcbtserver` as a Vercel project and set its root directory to the repository root.
2. Add `FIREBASE_SERVICE_ACCOUNT_JSON` in Vercel for the Firebase project used by the desktop app.
3. Keep the question banks under `api/_question-data/`. They are bundled with the API functions and are not deployed as public static files.
4. Deploy. The app calls `https://cbtsoftwareserver.vercel.app/server/api/`; Vercel rewrites these routes to the API functions.

Keep service-account credentials only in Vercel's encrypted environment variables.

Set `CBT_DATA_ROOT` to the Firestore top-level collection used by a school edition (defaults to `GIBBORSHUB`). For an app dedicated to one school, also set `CBT_APP_SCHOOL_ID` to that school's Firestore document ID. The server rejects requests and access codes from another root or school when these values are configured. These settings are tenant enforcement, not a cryptographic client signature.

In the desktop app repository, build a school edition with `npm run build-app -- --school-id=<school-document-id> --data-root=<firestore-root> --app-name="<school-name>"`. The optional `--server-url` parameter sets that edition's API base URL. Configure the deployed server with the matching `CBT_DATA_ROOT` and `CBT_APP_SCHOOL_ID`; never put service-account credentials in build arguments.

When generating an access code, select JAMB and JSCE subjects and choose specific JAMB years or all years currently available. The catalog is generated from the question files, so newly added years are included after deployment. The API checks the active computer, school, code usage, subject, and year before returning a bank. Successful downloads are recorded in Firestore.

Downloaded banks, practice progress, and new local result files are protected at rest with Electron `safeStorage`. This helps protect files stored on the device; it cannot prevent inspection of questions while an authorized app is actively using them.

## Endpoints

- `GET /api/access`: verifies the signed-in computer, school status, suspension status, entitlements, and access expiry.
- `POST /api/claim-code`: atomically registers the signed-in computer and redeems a school access code.
- `GET /api/question-catalog`: returns question subjects and years allowed for the active computer, or the full catalog for an active developer admin.
- `GET /api/question-data?path=data/<year>/<subject>.json`: verifies permissions and serves a question bank from the API-only data bundle.
- `GET /data/<year>/<subject>.json`: compatibility route rewritten to the same protected question-data endpoint; it does not serve a public JSON file.

The access and question endpoints require a Firebase ID token in the `Authorization` header. Question downloads also require the configured tenant headers used by the desktop app.

## Data layout

- JAMB: `api/_question-data/<year>/<subject>.json`
- JSCE: `api/_question-data/jsce/<subject>.json`

Do not move these files into a public/static directory. The Vercel configuration bundles them only with API functions and rewrites the legacy `/data/...` path to the authenticated handler.
