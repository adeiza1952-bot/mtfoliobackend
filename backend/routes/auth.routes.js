const express = require('express');
const router = express.Router();
const { requireAuth, ADMIN_UID } = require('../middleware/auth.middleware');

// Login/signup/logout/password-reset/Google sign-in all continue to
// happen on the frontend via the Firebase Auth SDK (frontend/js/auth.js),
// exactly as in the original app — Firebase Authentication is the
// source of truth for credentials, so the backend doesn't duplicate it.
//
// GET /api/auth/verify — lets the frontend (or any client) confirm a
// Firebase ID token is valid and see whether it belongs to an
// administrator, without exposing any other user's data.
//
// isAdmin mirrors the exact same check requireAdmin() uses (bootstrap
// ADMIN_UID OR the `admin: true` custom claim) so this endpoint can
// never disagree with what the admin API routes actually enforce.
router.get('/verify', requireAuth, (req, res) => {
  res.json({
    uid: req.user.uid,
    email: req.user.email,
    isAdmin: req.user.uid === ADMIN_UID || req.user.admin === true,
  });
});

module.exports = router;
