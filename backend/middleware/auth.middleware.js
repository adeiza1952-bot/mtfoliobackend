// ════════════════════════════════════════════════════════════
// middleware/auth.middleware.js — verifies Firebase ID tokens
// before allowing access to protected routes.
//
// The frontend must send the Firebase ID token (from
// `await firebase.auth().currentUser.getIdToken()`) as:
//   Authorization: Bearer <idToken>
// ════════════════════════════════════════════════════════════
const { admin } = require('../config/firebase-admin');

// Same admin UID used on the frontend (see frontend/js/firebase.js).
// Kept here too so admin checks are enforced server-side, not just
// in the UI.
const ADMIN_UID = 'ZTSuTVAZdphkD85qGPMxagsHPtJ3';

/**
 * requireAuth — verifies the Bearer token and attaches the decoded
 * Firebase user to req.user. Responds 401 if missing/invalid.
 */
async function requireAuth(req, res, next) {
  try {
    if (!admin) {
      return res.status(503).json({
        error: 'Server not configured',
        message: 'Firebase Admin credentials are missing. See backend/.env.example.',
      });
    }

    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer (.+)$/);
    if (!match) {
      return res.status(401).json({ error: 'Missing or malformed Authorization header' });
    }

    const idToken = match[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.user = decoded; // { uid, email, ... }
    next();
  } catch (err) {
    console.error('[auth.middleware] token verification failed:', err.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * requireAdmin — must run AFTER requireAuth. Grants access if either:
 *   (a) the token's uid matches the hardcoded bootstrap ADMIN_UID, or
 *   (b) the token carries the `admin: true` custom claim.
 *
 * Custom claims are set via admin.auth().setCustomUserClaims() (see
 * updateUserRole in admin.controller.js) and are embedded directly in
 * the signed Firebase ID token — verifyIdToken() cryptographically
 * validates them, so a client cannot forge or elevate this claim by
 * editing frontend code, localStorage, or request bodies. This is the
 * server-side enforcement; the frontend's admin UI is only a
 * convenience layer on top of it, never the source of truth.
 *
 * Note: a newly-granted admin's existing session won't see the new
 * claim until their ID token refreshes (Firebase does this
 * automatically roughly hourly, or immediately if the client calls
 * getIdToken(true)).
 */
function requireAdmin(req, res, next) {
  const isBootstrapAdmin = req.user && req.user.uid === ADMIN_UID;
  const isClaimedAdmin = req.user && req.user.admin === true;
  if (!isBootstrapAdmin && !isClaimedAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, ADMIN_UID };
