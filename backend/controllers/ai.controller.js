// ════════════════════════════════════════════════════════════
// controllers/ai.controller.js — server-side proxy for the Cover
// Letter feature's Gemini call.
//
// SECURITY CONTEXT: this exists specifically to fix a real exposure
// found during the full-application security audit. Previously,
// frontend/js/builder.js called
// https://generativelanguage.googleapis.com/...?key=<hardcoded key>
// directly from the browser — meaning the Gemini API key was visible
// to anyone who opened dev tools or viewed the page's JS source, and
// could be scraped and reused by anyone, at the project owner's cost.
//
// The fix: the frontend still builds the exact same prompt text it
// always did (all of builder.js's template/tone prompt-engineering is
// unchanged — this endpoint is a thin proxy, not a rewrite of that
// logic), but now sends it here instead of calling Gemini directly.
// This route requires a valid Firebase ID token (requireAuth), so an
// anonymous visitor can't use it to run up the project owner's Gemini
// bill — only a signed-in MTFolio user, generating their own cover
// letter, the same trust boundary the feature already had.
//
// GEMINI_API_KEY lives only in backend/.env (see .env.example),
// never in frontend code, index.html, or any Firestore document.
// ════════════════════════════════════════════════════════════

const MAX_PROMPT_LENGTH = 6000; // generous for a CV-based prompt; guards against abuse

async function generateCoverLetter(req, res) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error: 'Cover letter generation is not configured on this server',
        message: 'GEMINI_API_KEY is missing. See backend/.env.example.',
      });
    }

    const { prompt } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'A prompt string is required' });
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      return res.status(400).json({ error: `Prompt too long (max ${MAX_PROMPT_LENGTH} characters)` });
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 1024 },
        }),
      }
    );

    if (!geminiRes.ok) {
      // Log the real status for debugging, but never forward Gemini's
      // raw response body (which could include the request echoed
      // back, or other details) to the client.
      console.error('[ai.controller] Gemini API error:', geminiRes.status);
      return res.status(502).json({ error: 'Cover letter generation failed. Please try again.' });
    }

    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return res.status(502).json({ error: 'Cover letter generation returned no content. Please try again.' });
    }

    res.json({ text });
  } catch (err) {
    console.error('[ai.controller] generateCoverLetter error:', err);
    res.status(500).json({ error: 'Cover letter generation failed. Please try again.' });
  }
}

module.exports = { generateCoverLetter };
