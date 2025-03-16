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

// Validate required environment variables
if (!CARTPANDA_API_KEY || !CARTPANDA_SHOP_SLUG) {
  console.error('Error: Missing CARTPANDA_API_KEY or CARTPANDA_SHOP_SLUG in .env');
  process.exit(1);
}

// Set fallbacks if not provided
const DEFAULT_CURRENCY_CODE = CURRENCY || 'USD';
const FALLBACK_COUNTRY = DEFAULT_COUNTRY || 'US';

// Create Express server
const app = express();

// CORS configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));

// Explicitly allow OPTIONS requests
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS,PUT,PATCH,DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  return res.sendStatus(200);
});

// Parse request bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (if needed)
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Helper: Get tomorrow's date in YYYY-MM-DD format.
 * This is used as a dummy boleto limit date.
 */
function getTomorrowDate() {
  try {
    const tomorrow = new Date(Date.now() + 86400000);
    return tomorrow.toISOString().split('T')[0];
  } catch (error) {
    console.error("Error generating tomorrow's date:", error);
    return new Date().toISOString().split('T')[0];
  }
}

// Base URL for CartPanda API
const CARTPANDA_API_BASE = 'https://accounts.cartpanda.com/api/v3';

// Health-check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

/**
 * Create order endpoint
 * Expected JSON body:
 * {
 *   donationAmount: number,
 *   variantId: number,
 *   fullName: string,
 *   email: string,
 *   country?: string  // Optional; fallback used if missing
 * }
 */
app.post('/create-donation-order', async (req, res) => {
  try {
    const { donationAmount, variantId, fullName, email, country } = req.body;

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

    // Use provided country or fallback if not provided
    const userCountry = (country && country.trim() !== '') ? country.trim() : FALLBACK_COUNTRY;

    // Split fullName into first and last names
    const nameParts = fullName.trim().split(/\s+/);
    const firstName = nameParts[0];
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

    // Build line items array
    const lineItems = [
      {
        variant_id: Number(variantId),
        quantity: 1
      }
    ];

    // Build order data with all required fields.
    // Dummy address fields are provided as required by CartPanda.
    // The payment object includes dummy boleto values to satisfy validation.
    const orderData = {
      email,
      phone: '0000000000', // Dummy phone number
      currency: DEFAULT_CURRENCY_CODE,           // e.g., "USD"
      presentment_currency: DEFAULT_CURRENCY_CODE, // e.g., "USD"
      subtotal_amount: donationAmount,
      products_total_amount: donationAmount,
      total_amount: donationAmount,
      line_items: lineItems,
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
      payment: {
        payment_gateway_id: 'cartpanda_pay', // Update if you have a specific gateway
        amount: donationAmount,
        gateway: 'other', // Allowed values: mercadopago, ebanx, appmax, pagseguro, other
        type: 'cc',       // Payment type is credit card
        // Dummy boleto fields to satisfy API requirements:
        boleto_link: 'N/A',
        boleto_code: 'N/A',
        boleto_limit_date: getTomorrowDate()
      },
      customer: {
        email,
        first_name: firstName,
        last_name: lastName
      },
      // Replace with your actual return URL domain
      thank_you_page: 'https://your-domain.com/cartpanda_return'
    };

    const url = `${CARTPANDA_API_BASE}/${CARTPANDA_SHOP_SLUG}/order`;
    const apiResponse = await axios.post(url, orderData, {
      headers: {
        'Authorization': `Bearer ${CARTPANDA_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    const createdOrder = apiResponse.data;
    let checkoutUrl = '';

    // Determine checkout URL from API response
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

    console.log('Created CartPanda order:', createdOrder);
    return res.json({ checkoutUrl });
  } catch (error) {
    console.error('Error creating CartPanda order:', error.response?.data || error.message);
    return res.status(500).json({ error: 'Could not create order, please try again.' });
  }
});

/**
 * Return endpoint for final verification
 * CartPanda redirects here with ?order_id= after payment.
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
        'Authorization': `Bearer ${CARTPANDA_API_KEY}`
      },
      timeout: 10000
    });

    const orderData = orderResp.data;
    // Payment status 3 indicates PAID (adjust if needed)
    const paid = (orderData?.payment_status === 3 || orderData?.status_id === '3');
    return paid ? res.redirect('/thanks.html') : res.redirect('/error.html');
  } catch (error) {
    console.error('Error verifying order status:', error.response?.data || error.message);
    return res.redirect('/error.html');
  }
});

// Optional: Webhook endpoint to receive notifications from CartPanda
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

// Catch-all route for undefined endpoints
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

// Start the server
const port = PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
