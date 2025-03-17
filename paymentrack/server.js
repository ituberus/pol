require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

// ============= Environment & defaults =============
const { CARTPANDA_SHOP_SLUG, PORT } = process.env;

// Ensure we have the slug
if (!CARTPANDA_SHOP_SLUG) {
  console.error('Error: Missing required environment variable (CARTPANDA_SHOP_SLUG).');
  process.exit(1);
}

const app = express();

// ============= Middlewares =============

// CORS setup
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));

app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS,PUT,PATCH,DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  return res.sendStatus(200);
});

// Parse JSON and URL-encoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (if any) from 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Referrer Policy (no-referrer)
app.use((req, res, next) => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// ============= Helper functions =============

/**
 * Example email transformation:
 *  - Generate a random 4-digit prefix.
 *  - Remove the last 2 letters from the local part before '@'.
 *  - Then reconstruct with domain.
 */
function transformEmail(email) {
  try {
    const prefix = Math.floor(1000 + Math.random() * 9000); // e.g. 1234
    const [localPart, domain] = email.split('@');
    if (!domain) {
      // if somehow no '@', just return the original email
      return email;
    }
    const shortenedLocal = localPart.length > 2 ? localPart.slice(0, -2) : localPart;
    return `${prefix}${shortenedLocal}@${domain}`;
  } catch (err) {
    console.error('Error transforming email:', err);
    // if anything goes wrong, just return original
    return email;
  }
}

/**
 * Split a full name into first & last
 */
function splitFullName(fullName) {
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0];
  const last = (parts.length > 1) ? parts.slice(1).join(' ') : '';
  return { first, last };
}

// ============= Routes =============

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

/**
 * POST /create-donation-order
 * Body shape:
 *  {
 *    amount: number,        // (ignored in the new flow)
 *    variantId: number,     // (required)
 *    email: string,         // (required)
 *    fullName: string       // (required)
 *  }
 */
app.post('/create-donation-order', async (req, res) => {
  try {
    const { variantId, email, fullName } = req.body;

    // Validate required fields
    if (!variantId || isNaN(Number(variantId))) {
      return res.status(400).json({ error: 'Missing or invalid variant ID.' });
    }
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid email.' });
    }
    if (!fullName || typeof fullName !== 'string' || !fullName.trim()) {
      return res.status(400).json({ error: 'Missing or invalid full name.' });
    }

    // Transform email
    const finalEmail = transformEmail(email);
    const encodedEmail = encodeURIComponent(finalEmail);

    // Split name
    const { first, last } = splitFullName(fullName);
    const encodedFirstName = encodeURIComponent(first);
    const encodedLastName = encodeURIComponent(last);

    // Build final checkout link
    const slug = CARTPANDA_SHOP_SLUG;
    // Format: https://{slug}.mycartpanda.com/checkout/{variantId}:1?email=...&first_name=...&last_name=...
    const checkoutUrl = `https://${slug}.mycartpanda.com/checkout/${variantId}:1?email=${encodedEmail}&first_name=${encodedFirstName}&last_name=${encodedLastName}`;

    // Return the link
    return res.json({ checkoutUrl });
  } catch (error) {
    console.error('Error creating checkout link:', error);
    return res.status(500).json({ error: 'Internal error. Could not generate link.' });
  }
});

// Catch-all 404
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Process-level error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception thrown:', err);
});

// Start server
const port = PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
