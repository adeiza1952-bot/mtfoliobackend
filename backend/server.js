// ════════════════════════════════════════════════════════════
// server.js — MTFolio backend entry point.
// ════════════════════════════════════════════════════════════
require('dotenv').config();

const express = require('express');
const cors = require('cors');

const portfolioRoutes = require('./routes/portfolio.routes');
const trackerRoutes = require('./routes/tracker.routes');
const adminRoutes = require('./routes/admin.routes');
const authRoutes = require('./routes/auth.routes');
const aiRoutes = require('./routes/ai.routes');

const app = express();
const PORT = process.env.PORT || 3001;

// ── CORS ──
// ALLOWED_ORIGINS: a comma-separated list of exact origins allowed to
// call this API (e.g. "https://mtfolio.com,https://www.mtfolio.com").
// Left unset, this falls back to allowing any origin — fine for local
// development, but a production deployment should set this explicitly
// to its real frontend domain(s) once known. This project's frontend
// calls the API with an explicit `Authorization: Bearer <token>`
// header rather than cookies (see admin.js/builder.js/public-view.js's
// adminFetch-style helpers), so an open CORS policy here isn't a
// credential-theft risk the way it would be for a cookie-authenticated
// API — but restricting it in production is still good practice and
// costs nothing once the real domain is known.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors(allowedOrigins.length ? {
  origin(origin, callback) {
    // Allow no-Origin requests (curl, server-to-server, same-origin
    // navigation) and any explicitly listed origin.
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  }
} : undefined));
app.use(express.json());

// ── Security headers ──
// A minimal, safe-by-default set that applies cleanly to this API's
// JSON responses without needing to know the final frontend domain.
// This backend never serves HTML, so a Content-Security-Policy header
// here would have little effect either way; the CSP that actually
// matters is on the page serving index.html, which is a static-hosting
// concern documented in DEPLOYMENT.md rather than something this Node
// process can set (see that file for the recommended CSP and how to
// apply it on Vercel/Netlify/your static host of choice).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// ── Health check ──
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'mtfolio-backend',
    time: new Date().toISOString(),
  });
});

// ── API routes ──
app.use('/api/portfolios', portfolioRoutes);
app.use('/api/tracker', trackerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/ai', aiRoutes);

// ── 404 handler ──
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Error handler ──
app.use((err, req, res, next) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`MTFolio backend listening on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

module.exports = app;
