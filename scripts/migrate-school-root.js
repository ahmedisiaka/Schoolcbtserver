const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

function getArgument(name) {
    const prefix = `--${name}=`;
    const argument = process.argv.find(value => value.startsWith(prefix));
    return argument?.slice(prefix.length) || "";
}

function validCollectionName(value) {
    return /^[A-Za-z0-9_-]{1,100}$/.test(value);
}

async function initializeFirestore() {
    const rawCredentials = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!rawCredentials) throw new Error("Set FIREBASE_SERVICE_ACCOUNT_JSON before running the migration.");
    const credentials = JSON.parse(rawCredentials);
    if (typeof credentials.private_key === "string") {
        credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
    }
    if (!getApps().length) initializeApp({ credential: cert(credentials) });
    return getFirestore();
}

async function copySchoolCollection(db, legacyPath, targetPath, schoolId, dryRun) {
    let copied = 0;
    let skipped = 0;
    let lastDocument = null;
    do {
        let query = db.collection(legacyPath).where("schoolId", "==", schoolId).limit(300);
        if (lastDocument) query = query.startAfter(lastDocument);
        const snapshot = await query.get();
        if (!snapshot.docs.length) break;

        const destinations = await Promise.all(snapshot.docs.map(async source => ({
            source,
            destination: db.doc(`${targetPath}/${source.id}`)
        })));
        const existing = await Promise.all(destinations.map(({ destination }) => destination.get()));
        const batch = db.batch();
        let writes = 0;
        for (const [index, item] of destinations.entries()) {
            if (existing[index].exists) {
                skipped++;
                continue;
            }
            if (!dryRun) batch.set(item.destination, item.source.data());
            copied++;
            writes++;
        }
        if (!dryRun && writes) await batch.commit();
        lastDocument = snapshot.docs[snapshot.docs.length - 1];
        if (snapshot.docs.length < 300) break;
    } while (true);

    return { copied, skipped };
}

async function copyExamContent(db, legacyRoot, targetRoot, examId, dryRun) {
    const source = db.collection(legacyRoot).doc("exams").collection("items").doc(examId);
    const target = db.collection(targetRoot).doc("exams").collection("items").doc(examId);
    const sourceContent = await source.collection("content").get();
    const existingContent = await Promise.all(sourceContent.docs.map(item =>
        target.collection("content").doc(item.id).get()
    ));
    const batch = db.batch();
    let copied = 0;
    let skipped = 0;
    sourceContent.docs.forEach((item, index) => {
        if (existingContent[index].exists) {
            skipped++;
            return;
        }
        if (!dryRun) batch.set(target.collection("content").doc(item.id), item.data());
        copied++;
    });
    if (!dryRun && copied) await batch.commit();
    return { copied, skipped };
}

async function main() {
    const legacyRoot = getArgument("legacy-root");
    const schoolId = getArgument("school-id");
    const targetRoot = getArgument("target-root");
    const dryRun = !process.argv.includes("--apply");
    const copyGlobalSetting = process.argv.includes("--copy-global-setting");
    if (![legacyRoot, targetRoot].every(validCollectionName) ||
        !/^[A-Za-z0-9_-]{1,120}$/.test(schoolId) ||
        legacyRoot === targetRoot) {
        throw new Error(
            "Usage: node scripts/migrate-school-root.js --legacy-root=OLD_ROOT --school-id=SCHOOL_ID --target-root=NEW_ROOT [--apply] [--copy-global-setting]"
        );
    }

    const db = await initializeFirestore();
    const sourceSchool = db.doc(`${legacyRoot}/schools/items/${schoolId}`);
    const schoolSnapshot = await sourceSchool.get();
    if (!schoolSnapshot.exists) throw new Error("The legacy school profile was not found.");
    const targetDirectory = db.doc(`schoolDirectory/${schoolId}`);
    const directorySnapshot = await targetDirectory.get();
    if (directorySnapshot.exists && directorySnapshot.data().dataRoot !== targetRoot) {
        throw new Error("A school profile already exists with a different data root.");
    }
    if (directorySnapshot.exists && !process.argv.includes("--apply")) {
        console.log("The target school profile already exists; existing records will be skipped.");
    }

    const collections = [
        "accessCodes/items",
        "computers/active",
        "computers/inactive",
        "results/records",
        "feedback/records",
        "exams/items",
        "appUpdates/items",
        "questionDownloads/records"
    ];
    const summary = {};
    for (const relativePath of collections) {
        const result = await copySchoolCollection(
            db,
            `${legacyRoot}/${relativePath}`,
            `${targetRoot}/${relativePath}`,
            schoolId,
            dryRun
        );
        summary[relativePath] = result;
        if (relativePath === "exams/items") {
            for (const exam of await db.collection(`${legacyRoot}/exams/items`)
                .where("schoolId", "==", schoolId).get().then(result => result.docs)) {
                const contentResult = await copyExamContent(db, legacyRoot, targetRoot, exam.id, dryRun);
                summary[`${relativePath}/${exam.id}/content`] = contentResult;
            }
        }
    }

    const sourceRuntime = db.doc(`${legacyRoot}/schoolRuntime/items/${schoolId}`);
    const targetRuntime = db.doc(`${targetRoot}/schoolRuntime/items/${schoolId}`);
    const [runtimeSnapshot, targetRuntimeSnapshot] = await Promise.all([
        sourceRuntime.get(),
        targetRuntime.get()
    ]);
    if (runtimeSnapshot.exists && !targetRuntimeSnapshot.exists) {
        if (!dryRun) await targetRuntime.set(runtimeSnapshot.data());
        summary.schoolRuntime = { copied: 1, skipped: 0 };
    } else {
        summary.schoolRuntime = { copied: 0, skipped: runtimeSnapshot.exists ? 1 : 0 };
    }

    if (copyGlobalSetting) {
        const source = db.doc(`${legacyRoot}/settings/items/schoolPortal`);
        const target = db.doc("platform/settings/items/schoolPortal");
        const [sourceSetting, targetSetting] = await Promise.all([source.get(), target.get()]);
        if (sourceSetting.exists && !targetSetting.exists) {
            if (!dryRun) await target.set(sourceSetting.data());
            summary.globalSchoolPortalSetting = { copied: 1, skipped: 0 };
        } else {
            summary.globalSchoolPortalSetting = { copied: 0, skipped: sourceSetting.exists ? 1 : 0 };
        }
    }

    if (directorySnapshot.exists) {
        summary.schoolDirectory = { copied: 0, skipped: 1 };
    } else {
        summary.schoolDirectory = { copied: 1, skipped: 0 };
    }

    console.log(JSON.stringify({
        mode: dryRun ? "DRY RUN — no data was written" : "APPLY — copied data; legacy data was preserved",
        schoolId,
        legacyRoot,
        targetRoot,
        summary
    }, null, 2));
    if (!dryRun && !directorySnapshot.exists) {
        await targetDirectory.create({ ...schoolSnapshot.data(), dataRoot: targetRoot });
    }
}

main().catch(error => {
    console.error("School data migration failed:", error.message);
    process.exitCode = 1;
});
