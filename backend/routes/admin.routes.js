const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth.middleware');
const adminController = require('../controllers/admin.controller');

// Every route below requires a valid Firebase ID token AND that the
// caller is an administrator — either the hardcoded bootstrap
// ADMIN_UID or a user with the `admin: true` custom claim (see
// middleware/auth.middleware.js). This cannot be bypassed by editing
// frontend code, localStorage, or request bodies.
router.use(requireAuth, requireAdmin);

// Overview
router.get('/overview', adminController.getOverview);

// Users
router.get('/users', adminController.listUsers);
router.get('/users/:uid', adminController.getUserDetail);
router.patch('/users/:uid/role', adminController.updateUserRole);
router.post('/users/:uid/disable', adminController.disableUser);
router.post('/users/:uid/enable', adminController.enableUser);
router.post('/users/:uid/grant-premium', adminController.grantPremium);
router.post('/users/:uid/revoke-premium', adminController.revokePremium);
router.delete('/users/:uid', adminController.deleteUser);

// Portfolios
router.get('/portfolios', adminController.listAllPortfolios);
router.get('/portfolios/:id', adminController.getPortfolioDetail);
router.delete('/portfolios/:id', adminController.deletePortfolio);

// Job application analytics (aggregate counts only)
router.get('/tracker-stats', adminController.getTrackerStats);

// Audit log
router.get('/audit-log', adminController.getAuditLog);

module.exports = router;
