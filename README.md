# School CBT Server

Vercel-hosted access-code, computer-status, and protected question-bank APIs for the LIMLO Schools CBT app.

## Deploy

1. Import `ahmedisiaka/Schoolcbtserver` as a Vercel project and set its root directory to the repository root.
2. Add `FIREBASE_SERVICE_ACCOUNT_JSON` in Vercel for the Firebase project used by the desktop app.
3. Add `CBT_SECRET_ENCRYPTION_KEY` as a Vercel environment variable. Use a randomly generated secret with at least 32 characters. It encrypts school AI API keys before they are stored in Firestore; keep it private and do not change it unless you are prepared to replace the stored school keys.
4. Keep the question banks under `api/_question-data/`. They are bundled with the API functions and are not deployed as public static files.
5. Deploy. The app calls `https://cbtsoftwareserver.vercel.app/server/api/`; Vercel rewrites these routes to the API functions.

Keep service-account credentials only in Vercel's encrypted environment variables.

Configure `CBT_TENANTS_JSON` in Vercel with the server-side allowlist for all school editions. It must be a JSON object keyed by the exact `softwareName` embedded in each app. Every value must provide `dataRoot`, `schoolId`, and `schoolName`, for example:

```json
{
  "Gibbors Hub Schools": {
    "dataRoot": "GIBBORSHUB",
    "schoolId": "gibbors-school-document-id",
    "schoolName": "Gibbors Hub Schools"
  },
  "Saint Academy CBT": {
    "dataRoot": "SAINTACADEMY",
    "schoolId": "saint-academy-document-id",
    "schoolName": "Saint Academy"
  }
}
```

For a single-tenant deployment, the equivalent legacy variables are `CBT_DATA_ROOT`, `CBT_APP_SCHOOL_ID`, `CBT_SOFTWARE_NAME`, and `CBT_SCHOOL_NAME`. The default software name is `Gibbors Hub Schools`. Each API rejects unknown software names, mismatching roots/school IDs, missing school records, and school-name mismatches. Configure the Firestore school's `name` (or `softwareName`) to match the allowlisted `schoolName`.

Build each school edition with `npm run build-app -- --school-id=<school-document-id> --data-root=<firestore-root> --software-name="<allowlisted-software-name>" --app-name="<display-name>"`. The optional `--server-url` parameter sets that edition's API base URL. Never put service-account credentials or server allowlists in build arguments. Do not commit generated school builds or copy one school's config into another school's release.

The tenant headers are identifiers, not credentials or cryptographic signatures. The server validates the authenticated computer record, code's school ID, Firestore school record and active status on each protected API request. `CBT_TENANTS_JSON` is server-only and must never be embedded in the desktop app.

Firestore client rules use a tenant-root wildcard for school data paths. Direct client activation and access-code redemption are denied; only the authenticated server API using Firebase Admin can claim a code and create an active-computer record. Deploy the updated `developer-admin/firestore.rules` to the Firebase project before rollout.

When generating an access code, select JAMB and JSCE subjects and choose specific JAMB years or all years currently available. The catalog is generated from the question files, so newly added years are included after deployment. The API checks the active computer, school, code usage, subject, and year before returning a bank. Successful downloads are recorded in Firestore.

Downloaded banks, practice progress, and new local result files are protected at rest with Electron `safeStorage`. This helps protect files stored on the device; it cannot prevent inspection of questions while an authorized app is actively using them.

## Endpoints

- `GET /api/access`: verifies the signed-in computer, school status, suspension status, entitlements, and access expiry.
- `POST /api/claim-code`: atomically registers the signed-in computer and redeems a school access code.
- `GET /api/question-catalog`: returns question subjects and years allowed for the active computer, or the full catalog for an active developer admin.
- `GET /api/question-data?path=data/<year>/<subject>.json`: verifies permissions and serves a question bank from the API-only data bundle.
- `POST /api/school-settings`: lets active developer admins publish question, exam, and API-key revisions to selected schools. New AI keys are encrypted with `CBT_SECRET_ENCRYPTION_KEY`.
- `GET /api/school-updates`: returns non-secret update revisions for an authenticated active computer.
- `POST /api/school-ai`: proxies question generation for an active computer using its school's server-held AI key; the key is never sent to or stored in the desktop app.
- `GET /data/<year>/<subject>.json`: compatibility route rewritten to the same protected question-data endpoint; it does not serve a public JSON file.

The access and question endpoints require a Firebase ID token in the `Authorization` header. Every protected request also requires `X-CBT-Software-Name` and `X-CBT-Data-Root`; school-bound builds also send `X-CBT-School-Id`. These headers must match the server-side allowlist, but they are identifiers rather than secrets.

Access responses include server time. The desktop stores the resulting lease encrypted through Electron `safeStorage` and checks the adjusted time against the last persisted server-time value to detect clock rollback. This helps detect casual clock changes, but a fully offline computer cannot know elapsed real time while powered off if its operating-system clock is under the user's control.

## Data layout

- JAMB: `api/_question-data/<year>/<subject>.json`
- JSCE: `api/_question-data/jsce/<subject>.json`

Do not move these files into a public/static directory. The Vercel configuration bundles them only with API functions and rewrites the legacy `/data/...` path to the authenticated handler.
