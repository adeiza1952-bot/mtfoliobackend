// ════════════════════════════════════════════════════════════
// config/firebase-admin.js — Firebase Admin SDK initialization.
//
// This is the ONLY place in the backend that should call
// admin.initializeApp(). Every route/controller/middleware that
// needs Firestore or Auth-token verification imports { admin, db }
// from this file.
//
// SECURITY: this file expects credentials to come from environment
// variables (see ../.env.example). It never reads a committed
// service-account JSON file, and no real credentials are included
// in this project — you must supply your own via a local .env file
// (see README.md for setup instructions).
// ════════════════════════════════════════════════════════════
const admin = require('firebase-admin');

let initialized = false;

function initFirebaseAdmin() {
  if (initialized) return admin;

  const {
    FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY,
  } = process.env;

  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    console.warn(
      '[firebase-admin] Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / ' +
      'FIREBASE_PRIVATE_KEY environment variables. Firebase Admin will NOT be ' +
      'initialized, and any route that requires authentication or Firestore ' +
      'access will fail until these are set. See backend/.env.example.'
    );
    return null;
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      // Private keys in .env files usually have literal "\n" sequences
      // instead of real newlines — convert them back.
      privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });

  initialized = true;
  return admin;
}

const app = initFirebaseAdmin();
const db = app ? app.firestore() : null;

module.exports = { admin: app, db };
