const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth.middleware');
const trackerController = require('../controllers/tracker.controller');

// GET    /api/tracker      -> list the authenticated user's job applications
// DELETE /api/tracker/:id  -> delete a job application (must be the owner)
router.get('/', requireAuth, trackerController.listJobs);
router.delete('/:id', requireAuth, trackerController.deleteJob);

module.exports = router;
