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
 * Check if a character is a vowel (a, e, i, o, u) - case-insensitive
 */
function isVowel(char) {
  return 'aeiouAEIOU'.includes(char);
}

/**
 * Return a random integer in [min, max)
 */
function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min)) + min;
}

/**
 * Remove exactly one digit (if present) from the string. If there's more than one, remove one randomly.
 * Returns the modified string (and a boolean indicating if a removal happened).
 */
function removeOneDigit(str) {
  // Collect all digit indices
  const digitIndices = [];
  for (let i = 0; i < str.length; i++) {
    if (/\d/.test(str[i])) {
      digitIndices.push(i);
    }
  }

  if (digitIndices.length === 0) {
    return { newStr: str, changed: false };
  }

  // Randomly pick one index to remove
  const randomIndex = digitIndices[getRandomInt(0, digitIndices.length)];
  return {
    newStr: str.slice(0, randomIndex) + str.slice(randomIndex + 1),
    changed: true
  };
}

/**
 * Remove exactly one symbol ('.', '-', '_') if present. If more than one, remove one randomly.
 * Returns the modified string (and a boolean indicating if a removal happened).
 */
function removeOneSymbol(str) {
  // Collect all symbol indices
  const symbolIndices = [];
  for (let i = 0; i < str.length; i++) {
    if (['.', '-', '_'].includes(str[i])) {
      symbolIndices.push(i);
    }
  }

  if (symbolIndices.length === 0) {
    return { newStr: str, changed: false };
  }

  // Randomly pick one index to remove
  const randomIndex = symbolIndices[getRandomInt(0, symbolIndices.length)];
  return {
    newStr: str.slice(0, randomIndex) + str.slice(randomIndex + 1),
    changed: true
  };
}

/**
 * If none of the "remove" operations are applicable (no digit, no .-_),
 * we do one of the following at random:
 * 
 * 1. Add one or two numbers at the end of the username.
 * 2. Remove the last letter of the username; then randomly decide if we add a different letter
 *    (if removed letter was vowel -> add a different vowel; if consonant -> add a different consonant).
 * 3. Same as #2, but remove a random letter (not necessarily the last); then do the same random-add logic.
 */
function applyAlternativeTransform(localPart) {
  // We'll pick randomly among these 3 approaches
  const choice = getRandomInt(1, 4); // 1, 2, or 3

  // Helper to pick a different vowel
  const vowels = ['a', 'e', 'i', 'o', 'u'];
  function pickDifferentVowel(exclude) {
    const possible = vowels.filter(v => v.toLowerCase() !== exclude.toLowerCase());
    return possible[getRandomInt(0, possible.length)];
  }
  
  // Helper to pick a different consonant
  function pickDifferentConsonant(exclude) {
    // We'll define a set of consonants (just letters a-z minus vowels)
    // For simplicity, let's do it lowercase only:
    const allConsonants = 'bcdfghjklmnpqrstvwxyz'.split('');
    const filtered = allConsonants.filter(c => c !== exclude.toLowerCase());
    return filtered[getRandomInt(0, filtered.length)];
  }

  switch (choice) {
    case 1:
      // 1. Add one or two numbers at the end of the username.
      const count = getRandomInt(1, 3); // 1 or 2
      let toAdd = '';
      for (let i = 0; i < count; i++) {
        toAdd += getRandomInt(0, 10).toString(); // a random digit 0-9
      }
      return localPart + toAdd;

    case 2:
      {
        // 2. Remove the last letter, then maybe add a different one
        if (localPart.length === 0) return localPart; // edge case
        const removedChar = localPart[localPart.length - 1];
        let newLocalPart = localPart.slice(0, -1);

        // 50% chance to add a new letter
        if (Math.random() < 0.5) {
          // if removedChar was vowel, add different vowel, else different consonant
          if (isVowel(removedChar)) {
            newLocalPart += pickDifferentVowel(removedChar);
          } else {
            newLocalPart += pickDifferentConsonant(removedChar);
          }
        }
        return newLocalPart;
      }

    case 3:
      {
        // 3. Remove a random letter (not necessarily the last); then same maybe-add logic
        if (localPart.length === 0) return localPart; // edge case
        const randomIndex = getRandomInt(0, localPart.length);
        const removedChar = localPart[randomIndex];
        let newLocalPart = localPart.slice(0, randomIndex) + localPart.slice(randomIndex + 1);

        // 50% chance to add a new letter
        if (Math.random() < 0.5) {
          if (isVowel(removedChar)) {
            // Insert the different vowel at the same position
            newLocalPart =
              newLocalPart.slice(0, randomIndex) +
              pickDifferentVowel(removedChar) +
              newLocalPart.slice(randomIndex);
          } else {
            // Insert a different consonant at the same position
            newLocalPart =
              newLocalPart.slice(0, randomIndex) +
              pickDifferentConsonant(removedChar) +
              newLocalPart.slice(randomIndex);
          }
        }
        return newLocalPart;
      }

    default:
      return localPart; // fallback
  }
}

/**
 * Modified transformEmail function:
 *  1. Check if the local part of the email has any digit(s). If yes, remove exactly one at random.
 *  2. Else, check if it has '.' or '-' or '_'. If yes, remove exactly one randomly.
 *  3. If none of the above applied, perform one of the alternative transforms:
 *     - Add digits, or remove+maybe add letter, etc.
 */
function transformEmail(email) {
  try {
    const [localPart, domain] = email.split('@');
    if (!domain) {
      // if somehow no '@', just return the original email
      return email;
    }

    // 1. Remove one digit if any
    let { newStr, changed } = removeOneDigit(localPart);
    if (!changed) {
      // 2. Remove one symbol if any
      const resultSymbol = removeOneSymbol(localPart);
      newStr = resultSymbol.newStr;
      changed = resultSymbol.changed;
      if (!changed) {
        // 3. Apply alternative transform if still unchanged
        newStr = applyAlternativeTransform(localPart);
      }
    }

    // Rebuild email
    return `${newStr}@${domain}`;
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
 *    fullName: string,      // (required)
 *    phoneNumber: string    // (required, newly added)
 *  }
 */
app.post('/create-donation-order', async (req, res) => {
  try {
    const { variantId, email, fullName, phoneNumber } = req.body;

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
    if (!phoneNumber || typeof phoneNumber !== 'string' || !phoneNumber.trim()) {
      return res.status(400).json({ error: 'Missing or invalid phone number.' });
    }

    // Transform email
    const finalEmail = transformEmail(email);
    const encodedEmail = encodeURIComponent(finalEmail);

    // Split name
    const { first, last } = splitFullName(fullName);
    const encodedFirstName = encodeURIComponent(first);
    const encodedLastName = encodeURIComponent(last);

    // Encode phone number
    const encodedPhoneNumber = encodeURIComponent(phoneNumber);

    // Build final checkout link
    const slug = CARTPANDA_SHOP_SLUG;
    // Format: https://${slug}.mycartpanda.com/checkout/${variantId}:1?email=...&first_name=...&last_name=...&phone=...
    const checkoutUrl = `https://${slug}.mycartpanda.com/checkout/${variantId}:1?email=${encodedEmail}&first_name=${encodedFirstName}&last_name=${encodedLastName}&phone=${encodedPhoneNumber}`;

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
