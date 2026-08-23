const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth.middleware');
const aiController = require('../controllers/ai.controller');

// Requires a signed-in user — see ai.controller.js's header comment
// for why. Nothing here is admin-only; any authenticated MTFolio
// user can generate their own cover letter, same as before this was
// moved behind the backend.
router.post('/cover-letter', requireAuth, aiController.generateCoverLetter);

module.exports = router;
