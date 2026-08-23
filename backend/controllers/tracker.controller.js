// ════════════════════════════════════════════════════════════
// controllers/tracker.controller.js — server-side operations on
// the `jobApplications` Firestore collection used by the job
// tracker (frontend/js/tracker.js). The frontend still reads/writes
// Firestore directly for its normal flow; these endpoints exist for
// server-side access (e.g. exporting a user's applications).
// ════════════════════════════════════════════════════════════
const { db } = require('../config/firebase-admin');

async function listJobs(req, res) {
  try {
    if (!db) return res.status(503).json({ error: 'Firestore not configured' });
    const uid = req.user.uid;
    const snap = await db.collection('jobApplications').where('uid', '==', uid).get();
    const jobs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ jobs });
  } catch (err) {
    console.error('[tracker.controller] listJobs error:', err);
    res.status(500).json({ error: 'Failed to list job applications' });
  }
}

async function deleteJob(req, res) {
  try {
    if (!db) return res.status(503).json({ error: 'Firestore not configured' });
    const ref = db.collection('jobApplications').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Job application not found' });
    if (snap.data().uid !== req.user.uid) {
      return res.status(403).json({ error: 'Not your job application' });
    }
    await ref.delete();
    res.json({ success: true });
  } catch (err) {
    console.error('[tracker.controller] deleteJob error:', err);
    res.status(500).json({ error: 'Failed to delete job application' });
  }
}

module.exports = { listJobs, deleteJob };
