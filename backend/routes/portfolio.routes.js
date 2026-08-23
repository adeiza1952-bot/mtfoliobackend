const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth.middleware');
const portfolioController = require('../controllers/portfolio.controller');

// GET  /api/portfolios       -> list the authenticated user's portfolios
// GET  /api/portfolios/:id   -> fetch a single portfolio by id (public data)
// POST /api/portfolios/:id/view -> record a public view (public, unauthenticated)
// DELETE /api/portfolios/:id -> delete a portfolio (must be the owner)
router.get('/', requireAuth, portfolioController.listPortfolios);
router.get('/:id', portfolioController.getPortfolio);
router.post('/:id/view', portfolioController.recordView);
router.delete('/:id', requireAuth, portfolioController.deletePortfolio);

module.exports = router;
