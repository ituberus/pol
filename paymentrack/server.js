require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const geoip = require('geoip-lite');
const { faker } = require('@faker-js/faker');

// ============= Environment & defaults =============
const {
  CARTPANDA_API_KEY,
  CARTPANDA_SHOP_SLUG,
  PORT,
  CURRENCY,
  TEST_MODE,
  TEST_VARIANT_ID
} = process.env;

if (!CARTPANDA_API_KEY || !CARTPANDA_SHOP_SLUG) {
  console.error('Error: Missing required environment variables (CARTPANDA_API_KEY or CARTPANDA_SHOP_SLUG).');
  process.exit(1);
}

const DEFAULT_CURRENCY = (CURRENCY || 'USD').toUpperCase();

// ============= Express app setup =============
const app = express();

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

// Serve static files from the 'public' directory if you have any
app.use(express.static(path.join(__dirname, 'public')));

// ============= Helpers =============

/** Helper: Return tomorrow’s date as "YYYY-MM-DD" */
function getTomorrowDate() {
  try {
    const tomorrow = new Date(Date.now() + 86400000);
    return tomorrow.toISOString().split('T')[0];
  } catch (error) {
    console.error('Error generating tomorrow\'s date:', error);
    return new Date().toISOString().split('T')[0];
  }
}

/** Helper: unique string generator (like second snippet) */
function uniqueString() {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
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
    // Add more as needed
  };
  return map[isoCode.toUpperCase()] || 'United States';
}

// Base URL for CartPanda API (v3)
const CARTPANDA_API_BASE = 'https://accounts.cartpanda.com/api/v3';

// ============= Health check =============
app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

/**
 * POST /create-donation-order
 * Body shape:
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

    // Check if we are in "test mode"; if so, override
    if (TEST_MODE === 'true') {
      console.log('TEST_MODE is active. Overriding amount and variant ID.');
      donationAmount = 1; // $1
      variantId = TEST_VARIANT_ID;
    }

    // Validate inputs
    if (!donationAmount || isNaN(donationAmount) || Number(donationAmount) <= 0) {
      return res.status(400).json({ error: 'Invalid donation amount' });
    }
    if (!variantId || isNaN(Number(variantId))) {
      return res.status(400).json({ error: 'Missing or invalid variant ID' });
    }
    if (!fullName || fullName.trim() === '') {
      return res.status(400).json({ error: 'Full name is required' });
    }
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Split fullName into first & last
    const nameParts = fullName.trim().split(/\s+/);
    const firstName = nameParts[0];
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

    // === 1) Get user IP
    const userIP =
      (req.headers['x-forwarded-for']?.split(',')[0]?.trim()) ||
      req.socket.remoteAddress ||
      '';
    console.log('Detected user IP:', userIP);

    // === 2) Geo lookup
    const geo = geoip.lookup(userIP);
    const isoCode = geo?.country ? geo.country : 'US';
    const finalCountry = mapISOToCountry(isoCode);

    // Use region code from geo or fallback "XX"
    let finalProvCode = 'XX';
    if (geo && typeof geo.region === 'string' && geo.region.trim()) {
      finalProvCode = geo.region.trim().toUpperCase();
    }

    // If geo data missing, fallback to random
    const finalCity = (geo?.city && geo.city.trim())
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
      zip: "10001",
      street: finalStreet
    });

    // === 3) Build line items
    const finalAmount = Number(donationAmount);
    const lineItems = [
      {
        variant_id: Number(variantId),
        quantity: 1
      }
    ];

    // === 4) Build unique tokens
    const uniqueCartToken = faker.string.uuid();
    const uniqueCustomerToken = faker.string.uuid();
    const randomPhone = faker.phone.number('+###########'); // e.g. +17205550123

    // === 5) Build the order data
    //    Below, we incorporate the "second snippet" style fields:
    //      - shipping_address / billing_address with address1, address2, house_no, province_code
    //      - `payment_status` if you want to set it (optional)
    //      - random strings for any needed fields
    const orderData = {
      // Basic info
      email,
      phone: "3083023720",
      currency: DEFAULT_CURRENCY,
      presentment_currency: DEFAULT_CURRENCY,

      // Totals
      subtotal_amount: finalAmount,
      products_total_amount: finalAmount,
      total_amount: finalAmount,
      // Optionally set pending payment_status
      payment_status: 1, // 1 = PENDING

      // Unique tokens to avoid duplicate detection
      cart_token: uniqueCartToken,
      customer_token: uniqueCustomerToken,

      // Cart items
      line_items: lineItems,

      // Address info (using same data for shipping & billing)
      shipping_address: {
        address1: '',
        address2: '',              // not compulsory
        house_no: 'no 01',     // or any random fallback
        city: 'new york',
        province: 'New York,
        zip: '10001',
        province_code: 'NY',
        country: 'US',
        first_name: firstName,     // Added first name
        last_name: lastName        // Added last name
      },
      billing_address: {
        address1: '',
        address2: '',
        house_no: 'no 01,
        city: 'new york',
        province: 'new york',
        zip: finalZip,
        province_code: ''NY',
        country: ''US',
        first_name: firstName,
        last_name: lastName,
        name: fullName
      },

      payment: {
        payment_gateway_id: 'other',
        amount: finalAmount,
        gateway: 'other',      // allowed: mercadopago, ebanx, appmax, pagseguro, other
        type: 'cc',            // credit card
        boleto_link: 'N/A',
        boleto_code: 'N/A',
        boleto_limit_date: getTomorrowDate()
      },

      customer: {
        email,
        first_name: firstName,
        last_name: lastName
      },

      // Additional details
      client_details: `IP: ${userIP} | UA: ${req.headers['user-agent'] || 'N/A'} | Unique: ${uniqueString()}`,
      order_note: `${Date.now()}-${faker.string.uuid()}`,  // or "note" field if you prefer

      // Optional "thank you" page override
      thank_you_page: `https://${CARTPANDA_SHOP_SLUG}.mycartpanda.com/cartpanda_return`
    };

    // === 6) Send request to CartPanda
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

    // === 7) Determine checkout URL
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

    // === 8) Return the checkout URL
    return res.json({ checkoutUrl });
  } catch (error) {
    console.error('Error creating CartPanda order:', error.response?.data || error.message);
    return res.status(500).json({ error: 'Could not create order, please try again.' });
  }
});

/**
 * GET /cartpanda_return
 * - Verifies payment status by fetching the order from CartPanda
 * - If paid => redirect to /thanks.html
 * - Else => redirect to /error.html
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
 * Optional webhook endpoint
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

// Process-level error handlers
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
