require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

// Pull environment variables
const {
  CARTPANDA_API_KEY,
  CARTPANDA_SHOP_SLUG,
  PORT,
  CURRENCY,
  DEFAULT_COUNTRY
} = process.env;

// Basic validation of required env variables
if (!CARTPANDA_API_KEY || !CARTPANDA_SHOP_SLUG) {
  console.error('Error: Missing CARTPANDA_API_KEY or CARTPANDA_SHOP_SLUG in .env');
  process.exit(1);
}

// Fallbacks if not set in env
const DEFAULT_CURRENCY_CODE = CURRENCY || 'USD';
const FALLBACK_COUNTRY = DEFAULT_COUNTRY || 'US';

// Create Express server
const app = express();

// CORS setup
app.use(cors({
  origin: '*',
  methods: ['GET','POST','OPTIONS','PUT','PATCH','DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));

// Explicitly allow OPTIONS
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS,PUT,PATCH,DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  return res.sendStatus(200);
});

// Parse request bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (if you have a public folder)
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Helper: Returns tomorrow's date in YYYY-MM-DD (if you ever need it for "boleto" type).
 * Currently not used for CC payments, but you can leave it if you ever switch to a boleto flow.
 */
function getTomorrowDate() {
  try {
    const tomorrow = new Date(Date.now() + 86400000);
    return tomorrow.toISOString().split('T')[0];
  } catch (error) {
    console.error('Error generating tomorrow\'s date:', error);
    return new Date().toISOString().split('T')[0]; // fallback
  }
}

// Base URL for CartPanda v3 API
const CARTPANDA_API_BASE = 'https://accounts.cartpanda.com/api/v3';

// Health-check route
app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

/**
 * POST /create-donation-order
 * Body expected:
 * {
 *   donationAmount: number,
 *   variantId: number,
 *   fullName: string,
 *   email: string,
 *   country?: string   (optional; fallback used if not provided)
 * }
 */
app.post('/create-donation-order', async (req, res) => {
  try {
    const { donationAmount, variantId, fullName, email, country } = req.body;

    // Basic validations
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

    // Decide on the country (use fallback if none is passed)
    const userCountry = (country && country.trim() !== '') ? country.trim() : FALLBACK_COUNTRY;

    // Split full name into first/last
    const nameParts = fullName.trim().split(/\s+/);
    const firstName = nameParts[0];
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

    // Prepare line items
    const lineItems = [
      {
        variant_id: Number(variantId),
        quantity: 1
      }
    ];

    // Build request body to create order in CartPanda
    const orderData = {
      email,
      phone: '0000000000', // Dummy phone for simplicity
      currency: DEFAULT_CURRENCY_CODE,           // e.g. "USD"
      presentment_currency: DEFAULT_CURRENCY_CODE, // e.g. "USD"
      subtotal_amount: donationAmount,
      products_total_amount: donationAmount,
      total_amount: donationAmount,
      line_items: lineItems,

      // Minimal required fields for addresses:
      billing_address: {
        address1: 'N/A',
        address2: 'N/A',
        house_no: 'N/A',
        city: 'N/A',
        province: 'N/A',
        province_code: 'N/A',
        zip: 0,
        first_name: firstName,
        last_name: lastName,
        name: fullName,
        country: userCountry
      },
      shipping_address: {
        address1: 'N/A',
        address2: 'N/A',
        house_no: 'N/A',
        city: 'N/A',
        province: 'N/A',
        province_code: 'N/A',
        zip: 0,
        first_name: firstName,
        last_name: lastName,
        name: fullName,
        country: userCountry
      },

      // Payment data
      payment: {
        payment_gateway_id: 'cartpanda_pay', // Adjust if you have a real gateway ID
        amount: donationAmount,
        gateway: 'other',  // or 'mercadopago', 'ebanx', etc. if you integrate them
        type: 'cc'         // "cc" for credit card. If you do "boleto" you'd need boleto fields
      },

      // Customer data
      customer: {
        email,
        first_name: firstName,
        last_name: lastName
      },

      // The URL CartPanda will redirect to after checkout is completed
      thank_you_page: 'https://your-domain.com/cartpanda_return'
    };

    // Hit the CartPanda Create Order endpoint
    const url = `${CARTPANDA_API_BASE}/${CARTPANDA_SHOP_SLUG}/order`;
    const apiResponse = await axios.post(url, orderData, {
      headers: {
        'Authorization': `Bearer ${CARTPANDA_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    // Check response for checkout link
    const createdOrder = apiResponse.data;
    let checkoutUrl = '';

    if (createdOrder?.order?.checkout_link) {
      checkoutUrl = createdOrder.order.checkout_link;
    } else if (createdOrder.checkout_link) {
      checkoutUrl = createdOrder.checkout_link;
    } else if (createdOrder?.order?.id) {
      // Fallback: build direct checkout link
      checkoutUrl = `https://${CARTPANDA_SHOP_SLUG}.mycartpanda.com/checkout?order_id=${createdOrder.order.id}`;
    } else {
      return res.status(500).json({
        error: 'No checkout URL returned from CartPanda. Cannot redirect to payment.'
      });
    }

    console.log('Created CartPanda order:', createdOrder);
    return res.json({ checkoutUrl });
  } catch (error) {
    console.error('Error creating CartPanda order:', error.response?.data || error.message);
    return res.status(500).json({ error: 'Could not create order, please try again.' });
  }
});

/**
 * GET /cartpanda_return
 * After payment, CartPanda will redirect here with ?order_id=
 * We can verify final payment status.
 */
app.get('/cartpanda_return', async (req, res) => {
  try {
    const orderId = req.query.order_id;
    if (!orderId) {
      return res.redirect('/error.html');
    }

    // Grab the order details from CartPanda
    const orderUrl = `${CARTPANDA_API_BASE}/${CARTPANDA_SHOP_SLUG}/order/${orderId}`;
    const orderResp = await axios.get(orderUrl, {
      headers: {
        'Authorization': `Bearer ${CARTPANDA_API_KEY}`
      },
      timeout: 10000
    });

    const orderData = orderResp.data;
    // According to docs: payment_status = 3 means PAID
    const paid = (orderData?.payment_status === 3 || orderData?.status_id === '3');

    // Redirect user based on final payment status
    return paid ? res.redirect('/thanks.html') : res.redirect('/error.html');
  } catch (error) {
    console.error('Error verifying order status:', error.response?.data || error.message);
    return res.redirect('/error.html');
  }
});

// Optional: Webhook endpoint
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

// Catch-all route for unknown endpoints
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
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
