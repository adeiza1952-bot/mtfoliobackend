// ════════════════════════════════════════════════════════════
// controllers/portfolio.controller.js — server-side operations on
// the `portfolios` Firestore collection. The frontend's builder.js
// still talks to Firestore directly for the normal create/edit/save
// flow (unchanged, per the project brief); these endpoints exist
// for server-side/administrative access patterns, e.g. fetching a
// public portfolio by id for link previews, or listing a user's
// portfolios from a trusted server context.
// ════════════════════════════════════════════════════════════
const { admin, db } = require('../config/firebase-admin');

// One calendar day in ms — see recordView() below.
const VIEW_NOTIFY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Lightweight in-memory rate limit for the one public/unauthenticated
// write endpoint in this file. This is a single-process Node server
// (see server.js), so an in-memory Map is sufficient at this
// project's scale — no external store or new dependency needed. It
// only throttles repeat calls for the SAME portfolio id in quick
// succession (a scripted refresh loop inflating one portfolio's view
// count), not overall request volume; that's the specific abuse case
// that matters here, since notification spam is already
// independently capped by the 24-hour cooldown below.
const recentViewCalls = new Map(); // portfolioId -> last-call timestamp (ms)
const VIEW_RATE_LIMIT_MS = 5000;

async function listPortfolios(req, res) {
  try {
    if (!db) return res.status(503).json({ error: 'Firestore not configured' });
    const uid = req.user.uid;
    const snap = await db.collection('portfolios').where('uid', '==', uid).get();
    const portfolios = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ portfolios });
  } catch (err) {
    console.error('[portfolio.controller] listPortfolios error:', err);
    res.status(500).json({ error: 'Failed to list portfolios' });
  }
}

async function getPortfolio(req, res) {
  try {
    if (!db) return res.status(503).json({ error: 'Firestore not configured' });
    const snap = await db.collection('portfolios').doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ error: 'Portfolio not found' });
    res.json({ id: snap.id, ...snap.data() });
  } catch (err) {
    console.error('[portfolio.controller] getPortfolio error:', err);
    res.status(500).json({ error: 'Failed to fetch portfolio' });
  }
}

async function deletePortfolio(req, res) {
  try {
    if (!db) return res.status(503).json({ error: 'Firestore not configured' });
    const ref = db.collection('portfolios').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Portfolio not found' });
    if (snap.data().uid !== req.user.uid) {
      return res.status(403).json({ error: 'Not your portfolio' });
    }
    await ref.delete();
    res.json({ success: true });
  } catch (err) {
    console.error('[portfolio.controller] deletePortfolio error:', err);
    res.status(500).json({ error: 'Failed to delete portfolio' });
  }
}

// POST /api/portfolios/:id/view — called by the public portfolio
// view page (public-view.js) whenever someone opens a share link.
// Intentionally public/unauthenticated, same as GET /:id: a visitor
// looking at someone's published portfolio was never signed in to
// begin with. This has to go through the backend rather than a
// direct client Firestore write, because the viewer's browser has no
// permission to write to a DIFFERENT user's data — only the backend,
// via the Admin SDK, can do that safely.
//
// Increments a simple view counter, and — at most once per portfolio
// per 24 hours, so a page refreshed repeatedly doesn't spam the
// owner — creates a notification for the owner if they have
// `preferences.notifyPortfolioViews` enabled. That preference is the
// exact one already exposed in Settings > Portfolio (see profile.js);
// no new preference was invented for this.
async function recordView(req, res) {
  try {
    if (!db) return res.status(503).json({ error: 'Firestore not configured' });
    const { id } = req.params;

    const now = Date.now();
    const lastCall = recentViewCalls.get(id) || 0;
    if (now - lastCall < VIEW_RATE_LIMIT_MS) {
      // Too soon since the last recorded view for this portfolio —
      // treat it as a no-op success rather than an error, since this
      // is normal/expected for a legitimate fast page reload, not
      // something a real visitor should see as a failure.
      return res.json({ success: true, throttled: true });
    }
    recentViewCalls.set(id, now);
    // Bound the map's size so it can't grow unboundedly over a long
    // server uptime — occasional opportunistic cleanup is enough for
    // a lightweight, single-process limiter like this one.
    if (recentViewCalls.size > 5000) {
      const cutoff = now - VIEW_RATE_LIMIT_MS;
      for (const [key, ts] of recentViewCalls) if (ts < cutoff) recentViewCalls.delete(key);
    }

    const ref = db.collection('portfolios').doc(id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Portfolio not found' });
    const data = snap.data();

    await ref.update({ viewCount: admin.firestore.FieldValue.increment(1) });

    const lastNotifiedMs = data.lastViewNotifiedAt
      ? (typeof data.lastViewNotifiedAt.toMillis === 'function' ? data.lastViewNotifiedAt.toMillis() : new Date(data.lastViewNotifiedAt).getTime())
      : 0;
    const dueForNotification = Date.now() - lastNotifiedMs > VIEW_NOTIFY_COOLDOWN_MS;

    if (data.uid && dueForNotification) {
      const ownerSnap = await db.collection('users').doc(data.uid).get();
      const prefs = ownerSnap.exists ? (ownerSnap.data().preferences || {}) : {};
      if (prefs.notifyPortfolioViews === true) { // default false, matches profile.js's DEFAULT_PREFS
        await db.collection('notifications').add({
          uid: data.uid,
          type: 'portfolio_view',
          title: 'Your portfolio was viewed',
          message: `Someone viewed your portfolio${data.name ? ` "${data.name}"` : ''}.`,
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await ref.update({ lastViewNotifiedAt: admin.firestore.FieldValue.serverTimestamp() });
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[portfolio.controller] recordView error:', err);
    // A view-tracking failure should never surface as an error to a
    // public visitor just looking at a portfolio.
    res.json({ success: false });
  }
}

module.exports = { listPortfolios, getPortfolio, deletePortfolio, recordView };
