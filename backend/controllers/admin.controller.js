// ════════════════════════════════════════════════════════════
// controllers/admin.controller.js — privileged operations for the
// Admin Dashboard. Every export here is mounted behind
// requireAuth + requireAdmin (see routes/admin.routes.js), so by
// the time a request reaches these functions it has already been
// verified server-side to belong to an authenticated administrator.
//
// DATA MODEL
// -----------
// No new user/profile collection was introduced. Role and status
// live alongside the existing `users/{uid}` document and Firebase
// Auth user record:
//
//   users/{uid}
//     ...existing fields (name, email, isPremium, createdAt, ...)
//     accountRole:  'admin' | 'user'   (mirror of the custom claim,
//                                       for display/listing only —
//                                       see note below)
//     lastLoginAt:  Firestore Timestamp (written by the frontend on
//                                        successful sign-in)
//
//   Firebase Auth custom claims (the AUTHORITATIVE role source):
//     { admin: true }  — set/cleared only by updateUserRole() below,
//     via the Admin SDK. This is what requireAdmin() actually checks
//     (see auth.middleware.js). accountRole in Firestore is a
//     convenience mirror for the Users table; it is never read for
//     authorization decisions, only for display.
//
//   Firebase Auth `disabled` flag — used for account disable/enable
//   (admin.auth().updateUser), Firebase's own built-in mechanism.
//   A disabled user cannot sign in at all, enforced by Firebase Auth
//   itself, not by application code.
//
//   admin_audit_log/{autoId}  (new collection)
//     { action, actorUid, actorEmail, targetUid, targetEmail,
//       details, timestamp }
//     Written only from this file via the Admin SDK. No frontend
//     code ever writes to this collection. See firestore.rules at
//     the project root for the corresponding "deny all client
//     access" rule this collection needs.
//
//   notifications/{autoId}
//     { uid, type, title, message, read, createdAt }
//     User-facing notifications, created here (via notifyUser())
//     whenever an admin action affects a specific user's account —
//     role changed, account disabled/enabled, premium granted/revoked.
//     Gated by that user's own `preferences.notifyProductUpdates`
//     (the same field Settings > Notifications already writes — see
//     profile.js), checked at write time so a disabled preference
//     means no notification is created at all, not one that's
//     created and then hidden. Portfolio-view notifications are
//     created separately, in portfolio.controller.js, gated by
//     `preferences.notifyPortfolioViews`. Read/update(mark-read)/
//     delete are the owner's own via Firestore rules; creation is
//     backend-only (Admin SDK bypasses rules, so no client-side
//     create path exists for this collection at all).
//
// No secrets, passwords, or tokens are ever written to the audit
// log — only action names, actor/target identifiers, and a short
// human-readable description.
// ════════════════════════════════════════════════════════════
const { admin, db } = require('../config/firebase-admin');

const VALID_ROLES = ['user', 'admin'];
const VALID_STATUSES = ['applied', 'interview', 'offer', 'rejected', 'withdrawn', 'saved'];
const ACTIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function tsToMillis(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts.seconds) return ts.seconds * 1000;
  return new Date(ts).getTime() || 0;
}

async function logAdminAction(req, action, target = {}, details = '') {
  if (!db) return;
  try {
    await db.collection('admin_audit_log').add({
      action,
      actorUid: req.user.uid,
      actorEmail: req.user.email || null,
      targetUid: target.uid || null,
      targetEmail: target.email || null,
      details,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // Audit logging failures should never block the admin action itself.
    console.error('[admin.controller] logAdminAction failed:', err.message);
  }
}

// Creates an in-app notification for a user, reusing the same
// `users/{uid}.preferences` object the Settings > Notifications tab
// already reads and writes (see profile.js) — no separate
// preferences system. "Product updates" is the closest existing
// category to "something happened to your account," which is what
// every caller below actually is; there's no separate "account
// activity" preference to invent one for. If the user has that
// preference turned off, no notification document is created at all
// (not created-then-hidden), which is the simplest way to make sure
// the preference actually controls the notification rather than just
// cosmetically filtering it after the fact.
async function notifyUser(uid, type, title, message) {
  if (!db || !uid) return;
  try {
    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) return;
    const prefs = userSnap.data().preferences || {};
    const wantsIt = prefs.notifyProductUpdates !== false; // default true, matches profile.js's DEFAULT_PREFS
    if (!wantsIt) return;
    await db.collection('notifications').add({
      uid, type, title, message,
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('[admin.controller] notifyUser failed:', err.message);
  }
}

// ── OVERVIEW ──
async function getOverview(req, res) {
  try {
    if (!db) return res.status(503).json({ error: 'Firestore not configured' });

    const [usersSnap, portsCountSnap, jobsSnap] = await Promise.all([
      db.collection('users').orderBy('createdAt', 'desc').get(),
      db.collection('portfolios').count().get(),
      db.collection('jobApplications').select('status').get(),
    ]);

    const users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const now = Date.now();
    const activeUsers = users.filter(u => now - tsToMillis(u.lastLoginAt) < ACTIVE_WINDOW_MS).length;

    const statusCounts = { applied: 0, interview: 0, offer: 0, rejected: 0, withdrawn: 0, saved: 0 };
    jobsSnap.docs.forEach(d => {
      const s = d.data().status;
      if (statusCounts[s] !== undefined) statusCounts[s]++;
    });

    const recentPortsSnap = await db.collection('portfolios').orderBy('createdAt', 'desc').limit(5).get();
    const recentPortfolios = recentPortsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    res.json({
      totalUsers: users.length,
      activeUsers,
      totalPortfolios: portsCountSnap.data().count,
      totalJobApplications: jobsSnap.size,
      applicationsByStatus: statusCounts,
      recentUsers: users.slice(0, 5),
      recentPortfolios,
    });
  } catch (err) {
    console.error('[admin.controller] getOverview error:', err);
    res.status(500).json({ error: 'Failed to load overview' });
  }
}

// ── USERS ──
async function listUsers(req, res) {
  try {
    if (!db) return res.status(503).json({ error: 'Firestore not configured' });
    const snap = await db.collection('users').orderBy('createdAt', 'desc').get();
    const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Merge in Firebase Auth's `disabled` flag, which is not stored in
    // Firestore (it lives on the Auth user record itself).
    const authStates = await Promise.all(users.map(async (u) => {
      try {
        const authUser = await admin.auth().getUser(u.id);
        return { id: u.id, disabled: authUser.disabled };
      } catch {
        return { id: u.id, disabled: false };
      }
    }));
    const disabledMap = Object.fromEntries(authStates.map(a => [a.id, a.disabled]));
    const merged = users.map(u => ({ ...u, disabled: !!disabledMap[u.id] }));

    res.json({ users: merged });
  } catch (err) {
    console.error('[admin.controller] listUsers error:', err);
    res.status(500).json({ error: 'Failed to list users' });
  }
}

async function getUserDetail(req, res) {
  try {
    if (!db) return res.status(503).json({ error: 'Firestore not configured' });
    const { uid } = req.params;
    const snap = await db.collection('users').doc(uid).get();
    if (!snap.exists) return res.status(404).json({ error: 'User not found' });

    const [portsSnap, jobsSnap, authUser] = await Promise.all([
      db.collection('portfolios').where('uid', '==', uid).get(),
      db.collection('jobApplications').where('uid', '==', uid).select('status').get(),
      admin.auth().getUser(uid).catch(() => null),
    ]);

    const jobStatusCounts = {};
    jobsSnap.docs.forEach(d => {
      const s = d.data().status || 'unknown';
      jobStatusCounts[s] = (jobStatusCounts[s] || 0) + 1;
    });

    res.json({
      id: snap.id,
      ...snap.data(),
      disabled: authUser ? authUser.disabled : false,
      portfolioCount: portsSnap.size,
      jobApplicationCount: jobsSnap.size,
      jobApplicationsByStatus: jobStatusCounts,
    });
  } catch (err) {
    console.error('[admin.controller] getUserDetail error:', err);
    res.status(500).json({ error: 'Failed to load user' });
  }
}

async function updateUserRole(req, res) {
  try {
    if (!db) return res.status(503).json({ error: 'Firestore not configured' });
    const { uid } = req.params;
    const { role } = req.body;

    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
    }
    if (uid === req.user.uid && role !== 'admin') {
      return res.status(400).json({ error: 'You cannot remove your own admin access' });
    }

    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
    const targetEmail = userSnap.data().email;

    // Authoritative: Firebase Auth custom claim, checked server-side by
    // requireAdmin on every future request. Cannot be forged by the client.
    await admin.auth().setCustomUserClaims(uid, role === 'admin' ? { admin: true } : {});
    // Mirror for display/listing convenience only (never used for auth checks).
    await db.collection('users').doc(uid).update({ accountRole: role });

    await logAdminAction(req, 'role_changed', { uid, email: targetEmail }, `Role set to "${role}"`);
    await notifyUser(uid, 'role_changed', 'Account role updated', `Your account role was changed to ${role === 'admin' ? 'Administrator' : 'User'}.`);
    res.json({ success: true, role });
  } catch (err) {
    console.error('[admin.controller] updateUserRole error:', err);
    res.status(500).json({ error: 'Failed to update role' });
  }
}

async function setUserDisabled(req, res, disabled) {
  try {
    const { uid } = req.params;
    if (uid === req.user.uid) {
      return res.status(400).json({ error: 'You cannot disable your own account' });
    }
    const userSnap = db ? await db.collection('users').doc(uid).get() : null;
    const targetEmail = userSnap && userSnap.exists ? userSnap.data().email : null;

    await admin.auth().updateUser(uid, { disabled });
    await logAdminAction(req, disabled ? 'user_disabled' : 'user_enabled', { uid, email: targetEmail });
    await notifyUser(uid, disabled ? 'account_disabled' : 'account_enabled',
      disabled ? 'Account disabled' : 'Account re-enabled',
      disabled ? 'Your account has been disabled. Contact support if you believe this is a mistake.' : 'Your account has been re-enabled. You can sign in normally.');
    res.json({ success: true, disabled });
  } catch (err) {
    console.error('[admin.controller] setUserDisabled error:', err);
    res.status(500).json({ error: 'Failed to update account status' });
  }
}
const disableUser = (req, res) => setUserDisabled(req, res, true);
const enableUser = (req, res) => setUserDisabled(req, res, false);

async function grantPremium(req, res) {
  try {
    if (!db) return res.status(503).json({ error: 'Firestore not configured' });
    const { uid } = req.params;
    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
    await db.collection('users').doc(uid).update({ isPremium: true });
    await logAdminAction(req, 'premium_granted', { uid, email: userSnap.data().email });
    await notifyUser(uid, 'premium_granted', 'Premium unlocked', 'Your account now has Premium access — enjoy the extra templates and ATS features.');
    res.json({ success: true });
  } catch (err) {
    console.error('[admin.controller] grantPremium error:', err);
    res.status(500).json({ error: 'Failed to grant premium' });
  }
}

async function revokePremium(req, res) {
  try {
    if (!db) return res.status(503).json({ error: 'Firestore not configured' });
    const { uid } = req.params;
    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
    await db.collection('users').doc(uid).update({ isPremium: false });
    await logAdminAction(req, 'premium_revoked', { uid, email: userSnap.data().email });
    await notifyUser(uid, 'premium_revoked', 'Premium access ended', 'Your Premium access has ended. You can still use all of MTFolio\'s free features.');
    res.json({ success: true });
  } catch (err) {
    console.error('[admin.controller] revokePremium error:', err);
    res.status(500).json({ error: 'Failed to revoke premium' });
  }
}

async function deleteUser(req, res) {
  try {
    if (!db) return res.status(503).json({ error: 'Firestore not configured' });
    const { uid } = req.params;
    if (uid === req.user.uid) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }
    const userSnap = await db.collection('users').doc(uid).get();
    const targetEmail = userSnap.exists ? userSnap.data().email : null;

    await db.collection('users').doc(uid).delete();
    // Best-effort: also remove the Firebase Auth account so the user
    // record is fully gone, not just their Firestore profile.
    await admin.auth().deleteUser(uid).catch(() => {});

    await logAdminAction(req, 'user_deleted', { uid, email: targetEmail });
    res.json({ success: true });
  } catch (err) {
    console.error('[admin.controller] deleteUser error:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
}

// ── PORTFOLIOS ──
async function listAllPortfolios(req, res) {
  try {
    if (!db) return res.status(503).json({ error: 'Firestore not configured' });
    const snap = await db.collection('portfolios').orderBy('createdAt', 'desc').get();
    const portfolios = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ portfolios });
  } catch (err) {
    console.error('[admin.controller] listAllPortfolios error:', err);
    res.status(500).json({ error: 'Failed to list portfolios' });
  }
}

async function getPortfolioDetail(req, res) {
  try {
    if (!db) return res.status(503).json({ error: 'Firestore not configured' });
    const { id } = req.params;
    const snap = await db.collection('portfolios').doc(id).get();
    if (!snap.exists) return res.status(404).json({ error: 'Portfolio not found' });
    const data = snap.data();

    let owner = null;
    if (data.uid) {
      const ownerSnap = await db.collection('users').doc(data.uid).get();
      if (ownerSnap.exists) {
        const o = ownerSnap.data();
        owner = { id: ownerSnap.id, name: o.name, email: o.email };
      }
    }
    res.json({ id: snap.id, ...data, owner });
  } catch (err) {
    console.error('[admin.controller] getPortfolioDetail error:', err);
    res.status(500).json({ error: 'Failed to fetch portfolio' });
  }
}

async function deletePortfolio(req, res) {
  try {
    if (!db) return res.status(503).json({ error: 'Firestore not configured' });
    const { id } = req.params;
    const snap = await db.collection('portfolios').doc(id).get();
    if (!snap.exists) return res.status(404).json({ error: 'Portfolio not found' });
    await db.collection('portfolios').doc(id).delete();
    await logAdminAction(req, 'portfolio_deleted', {}, `Portfolio "${snap.data().name || id}" deleted`);
    res.json({ success: true });
  } catch (err) {
    console.error('[admin.controller] deletePortfolio error:', err);
    res.status(500).json({ error: 'Failed to delete portfolio' });
  }
}

// ── JOB APPLICATION ANALYTICS (aggregate only — never exposes one
//    user's individual applications to anyone but that user) ──
async function getTrackerStats(req, res) {
  try {
    if (!db) return res.status(503).json({ error: 'Firestore not configured' });
    const snap = await db.collection('jobApplications').select('status').get();
    const counts = { applied: 0, interview: 0, offer: 0, rejected: 0, withdrawn: 0, saved: 0 };
    snap.docs.forEach(d => {
      const s = d.data().status;
      if (counts[s] !== undefined) counts[s]++;
    });
    res.json({ total: snap.size, byStatus: counts });
  } catch (err) {
    console.error('[admin.controller] getTrackerStats error:', err);
    res.status(500).json({ error: 'Failed to load job application analytics' });
  }
}

// ── AUDIT LOG ──
async function getAuditLog(req, res) {
  try {
    if (!db) return res.status(503).json({ error: 'Firestore not configured' });
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const snap = await db.collection('admin_audit_log').orderBy('timestamp', 'desc').limit(limit).get();
    const entries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ entries });
  } catch (err) {
    console.error('[admin.controller] getAuditLog error:', err);
    res.status(500).json({ error: 'Failed to load audit log' });
  }
}

module.exports = {
  getOverview,
  listUsers,
  getUserDetail,
  updateUserRole,
  disableUser,
  enableUser,
  grantPremium,
  revokePremium,
  deleteUser,
  listAllPortfolios,
  getPortfolioDetail,
  deletePortfolio,
  getTrackerStats,
  getAuditLog,
};
