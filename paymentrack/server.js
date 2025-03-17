require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const geoip = require('geoip-lite');
const { faker } = require('@faker-js/faker');

// Verify required environment variables
const {
  CARTPANDA_API_KEY,
  CARTPANDA_SHOP_SLUG,
  PORT,
  CURRENCY,
  // Add these for test-mode functionality
  TEST_MODE,            // "true" or "false"
  DONATION_VARIANT_ID   // The env variant ID used if TEST_MODE === "true"
} = process.env;

if (!CARTPANDA_API_KEY || !CARTPANDA_SHOP_SLUG) {
  console.error('Error: Missing required environment variables (CARTPANDA_API_KEY or CARTPANDA_SHOP_SLUG).');
  process.exit(1);
}

/**
 * Use default currency "USD" if not provided,
 * ensuring uppercase (CartPanda requires ISO 4217 codes).
 */
const DEFAULT_CURRENCY = (CURRENCY || 'USD').toUpperCase();

// Create Express app
const app = express();

// Set up CORS so all origins are allowed.
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));

// Explicitly handle all OPTIONS requests.
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS,PUT,PATCH,DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  return res.sendStatus(200);
});

// Parse JSON and URL-encoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Helper: Return tomorrow’s date as "YYYY-MM-DD"
 */
function getTomorrowDate() {
  try {
    const tomorrow = new Date(Date.now() + 86400000);
    return tomorrow.toISOString().split('T')[0];
  } catch (error) {
    console.error('Error generating tomorrow\'s date:', error);
    return new Date().toISOString().split('T')[0];
  }
}

/**
 * Map an ISO country code (e.g., "US", "BR") to the
 * full country name CartPanda expects in "country" fields.
 */
function mapISOToCountry(isoCode) {
  const map = {
    US: 'United States',
    BR: 'Brazil',
    CA: 'Canada',
    GB: 'United Kingdom',
    AU: 'Australia'
    // Add more mappings as needed
  };
  return map[isoCode.toUpperCase()] || 'United States';
}

// Base URL for CartPanda API (v3)
const CARTPANDA_API_BASE = 'https://accounts.cartpanda.com/api/v3';

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

/**
 * POST /create-donation-order
 * Expected Body:
 *  {
 *    donationAmount: number,
 *    variantId: number,
 *    fullName: string,
 *    email: string
 *  }
 */
app.post('/create-donation-order', async (req, res) => {
  try {
    let { donationAmount, variantId, fullName, email } = req.body;

    // If TEST_MODE === "true", override donationAmount & variantId for testing
    if (TEST_MODE === 'true') {
      donationAmount = 1; // Hardcode $1 for test
      variantId = DONATION_VARIANT_ID; // Use the environment test variant ID
      console.log('TEST_MODE is active. Overriding donationAmount and variantId with env test values.');
    }

    // Convert to number after potential override
    const finalDonationAmount = Number(donationAmount);
    const finalVariantId = Number(variantId);

    // Validate inputs
    if (!finalDonationAmount || isNaN(finalDonationAmount) || finalDonationAmount <= 0) {
      return res.status(400).json({ error: 'Invalid donation amount' });
    }
    if (!finalVariantId || isNaN(finalVariantId)) {
      return res.status(400).json({ error: 'Missing or invalid variant ID' });
    }
    if (!fullName || fullName.trim() === '') {
      return res.status(400).json({ error: 'Full name is required' });
    }
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Split fullName into firstName & lastName
    const nameParts = fullName.trim().split(/\s+/);
    const firstName = nameParts[0];
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

    // === 1) Get user IP (try multiple headers; fallback to socket address)
    const userIP =
      (req.headers['x-forwarded-for']?.split(',')[0]?.trim()) ||
      req.socket.remoteAddress ||
      '';
    console.log('Detected user IP:', userIP);

    // === 2) Geo lookup
    const geo = geoip.lookup(userIP);
    const isoCode = (geo && geo.country) ? geo.country : 'US';
    const finalCountry = mapISOToCountry(isoCode);

    // Use region code from geo for province_code or fallback "XX"
    let finalProvCode = 'XX';
    if (geo && typeof geo.region === 'string' && geo.region.trim()) {
      finalProvCode = geo.region.trim().toUpperCase();
    }

    // Use geo if available; otherwise, generate random details
    const finalCity = (geo && geo.city && geo.city.trim())
      ? geo.city.trim()
      : faker.location.city();
    const finalProv = faker.location.state();
    const finalZip = faker.location.zipCode();
    const finalStreet = faker.location.streetAddress();

    console.log('Geo-based address =>', {
      ip: userIP,
      country: finalCountry,
      city: finalCity,
      province: finalProv,
      province_code: finalProvCode,
      zip: finalZip,
      street: finalStreet
    });

    // === 3) Build line items
    const lineItems = [
      {
        variant_id: finalVariantId,
        quantity: 1
      }
    ];

    // === 4) Build unique tokens and random phone
    const uniqueCartToken = faker.string.uuid();
    const uniqueCustomerToken = faker.string.uuid();
    const randomPhone = faker.phone.number('+###########'); // e.g. +17205550123

    // === 5) Build the order data with additional uniqueness
    const orderData = {
      email,
      phone: randomPhone,
      currency: DEFAULT_CURRENCY,
      presentment_currency: DEFAULT_CURRENCY,
      subtotal_amount: finalDonationAmount,
      products_total_amount: finalDonationAmount,
      total_amount: finalDonationAmount,

      // Unique tokens to avoid duplicate order detection
      cart_token: uniqueCartToken,
      customer_token: uniqueCustomerToken,

      line_items: lineItems,

      billing_address: {
        address1: finalStreet,
        address2: '',
        house_no: finalStreet, // Just duplicating address1 as house_no
        city: finalCity,
        province: finalProv,
        province_code: finalProvCode,
        zip: finalZip,
        first_name: firstName,
        last_name: lastName,
        name: fullName,
        country: finalCountry
      },
      shipping_address: {
        address1: finalStreet,
        address2: '',
        house_no: finalStreet,
        city: finalCity,
        province: finalProv,
        province_code: finalProvCode,
        zip: finalZip,
        first_name: firstName,
        last_name: lastName,
        name: fullName,
        country: finalCountry
      },

      // Payment details (using dummy fields for "other" gateway or "cartpanda_pay")
      payment: {
        payment_gateway_id: 'cartpanda_pay',  // or "other" if you'd prefer
        amount: finalDonationAmount,
        gateway: 'other',  // 'other', 'mercadopago', 'ebanx', etc.
        type: 'cc',
        boleto_link: 'N/A',
        boleto_code: 'N/A',
        boleto_limit_date: getTomorrowDate()
      },

      customer: {
        email,
        first_name: firstName,
        last_name: lastName
      },

      // Pass client_details as a string (not an object)
      client_details: `IP: ${userIP} | UA: ${req.headers['user-agent'] || 'N/A'}`,

      // Add an order note with a unique timestamp and random UUID to further break duplicates
      order_note: `${Date.now()}-${faker.string.uuid()}`,

      // Optional "thank you" page override
      thank_you_page: `https://${CARTPANDA_SHOP_SLUG}.mycartpanda.com/cartpanda_return`
    };

    // === 6) Send the Create-Order request to CartPanda
    const url = `${CARTPANDA_API_BASE}/${CARTPANDA_SHOP_SLUG}/order`;
    const apiResponse = await axios.post(url, orderData, {
      headers: {
        Authorization: `Bearer ${CARTPANDA_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    const createdOrder = apiResponse.data;
    console.log('Created CartPanda order:', createdOrder);

    // === 7) Determine the checkout URL from the response
    let checkoutUrl = '';
    if (createdOrder?.order?.checkout_link) {
      checkoutUrl = createdOrder.order.checkout_link;
    } else if (createdOrder.checkout_link) {
      checkoutUrl = createdOrder.checkout_link;
    } else if (createdOrder?.order?.id) {
      checkoutUrl = `https://${CARTPANDA_SHOP_SLUG}.mycartpanda.com/checkout?order_id=${createdOrder.order.id}`;
    } else {
      return res.status(500).json({
        error: 'No checkout URL returned from CartPanda. Cannot redirect to payment.'
      });
    }

    // === 8) Return the checkout URL to your frontend
    return res.json({ checkoutUrl });

  } catch (error) {
    console.error('Error creating CartPanda order:', error.response?.data || error.message);
    return res.status(500).json({ error: 'Could not create order, please try again.' });
  }
});

/**
 * GET /cartpanda_return
 * Final verification after checkout
 */
app.get('/cartpanda_return', async (req, res) => {
  try {
    const orderId = req.query.order_id;
    if (!orderId) {
      return res.redirect('/error.html');
    }

    const orderUrl = `${CARTPANDA_API_BASE}/${CARTPANDA_SHOP_SLUG}/order/${orderId}`;
    const orderResp = await axios.get(orderUrl, {
      headers: {
        Authorization: `Bearer ${CARTPANDA_API_KEY}`
      },
      timeout: 10000
    });

    const orderData = orderResp.data;
    // Payment status: 3 => Paid
    const paid = (orderData?.payment_status === 3 || orderData?.status_id === '3');

    if (paid) {
      return res.redirect('/thanks.html');
    } else {
      return res.redirect('/error.html');
    }
  } catch (error) {
    console.error('Error verifying order status:', error.response?.data || error.message);
    return res.redirect('/error.html');
  }
});

/**
 * Webhook endpoint (optional)
 */
app.post('/cartpanda-webhook', (req, res) => {
  try {
    const eventName = req.body.event;
    const order = req.body.order;
    console.log('Received CartPanda Webhook:', eventName, order?.id);
    res.sendStatus(200);
  } catch (err) {
    console.error('Error in webhook handler:', err);
    res.sendStatus(500);
  }
});

/**
 * Catch-all route for undefined endpoints
 */
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

/**
 * Global error handling middleware
 */
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

/**
 * Process-level error handlers
 */
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception thrown:', err);
});

// Start the server
const port = PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
