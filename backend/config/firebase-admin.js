// ════════════════════════════════════════════════════════════
// config/firebase-admin.js — Firebase Admin SDK initialization.
//
// This is the ONLY place in the backend that should call
// admin.initializeApp(). Every route/controller/middleware that
// needs Firestore or Auth-token verification imports { admin, db }
// from this file.
//
// Two supported ways to provide credentials:
//   1. A Secret File (e.g. on Render: Environment tab → Secret
//      Files), uploaded as the raw downloaded service-account JSON.
//      Mounted path is read from GOOGLE_APPLICATION_CREDENTIALS_FILE,
//      defaulting to Render's own mount location. Preferred — avoids
//      manually reconstructing a multi-line private key inside a
//      single-line env var field, which is fragile to paste/copy.
//   2. Three separate environment variables (FIREBASE_PROJECT_ID,
//      FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY) — kept for local
//      development via a .env file (see ../.env.example).
//
// No real credentials are committed in this project either way.
// ════════════════════════════════════════════════════════════
const fs = require('fs');
const admin = require('firebase-admin');

let initialized = false;

function initFirebaseAdmin() {
  if (initialized) return admin;

  const secretFilePath = process.env.GOOGLE_APPLICATION_CREDENTIALS_FILE
    || '/etc/secrets/firebase-service-account.json';

  if (fs.existsSync(secretFilePath)) {
    try {
      const serviceAccount = JSON.parse(fs.readFileSync(secretFilePath, 'utf8'));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      initialized = true;
      return admin;
    } catch (err) {
      console.error(`[firebase-admin] Failed to read/parse secret file at ${secretFilePath}:`, err.message);
      // Fall through to env-var path below rather than crashing outright.
    }
  }

  const {
    FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY,
  } = process.env;

  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    console.warn(
      '[firebase-admin] No usable credentials found (no secret file at ' +
      `${secretFilePath}, and FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / ` +
      'FIREBASE_PRIVATE_KEY env vars are not all set). Firebase Admin will ' +
      'NOT be initialized. See backend/.env.example.'
    );
    return null;
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });

  initialized = true;
  return admin;
}

const app = initFirebaseAdmin();
const db = app ? app.firestore() : null;

module.exports = { admin: app, db };
