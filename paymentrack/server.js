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
  CURRENCY
} = process.env;

if (!CARTPANDA_API_KEY || !CARTPANDA_SHOP_SLUG) {
  console.error('Error: Missing required environment variables (CARTPANDA_API_KEY or CARTPANDA_SHOP_SLUG).');
  process.exit(1);
}

// Use default currency "usd" if not provided
const DEFAULT_CURRENCY = (CURRENCY || 'usd').toLowerCase();

const app = express();

/**
 * Set up CORS so all origins are allowed.
 * This also handles the preflight OPTIONS request.
 */
app.use(cors({
  origin: '*',
  methods: ['GET','POST','OPTIONS','PUT','PATCH','DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));

// Explicitly handle all OPTIONS requests
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

// Helper: Get tomorrow's date in YYYY-MM-DD format
function getTomorrowDate() {
  try {
    const tomorrow = new Date(Date.now() + 86400000);
    return tomorrow.toISOString().split('T')[0];
  } catch (error) {
    console.error('Error generating tomorrow\'s date:', error);
    // Fallback to current date if any error occurs
    return new Date().toISOString().split('T')[0];
  }
}

// Base URL for CartPanda API
const CARTPANDA_API_BASE = 'https://accounts.cartpanda.com/api/v3';

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

/**
 * Create donation order endpoint
 * Expects JSON:
 * {
 *   donationAmount: number,
 *   variantId: number,
 *   fullName: string,
 *   email: string
 * }
 */
app.post('/create-donation-order', async (req, res, next) => {
  try {
    const { donationAmount, variantId, fullName, email } = req.body;

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

    // Split fullName into firstName and lastName
    const nameParts = fullName.trim().split(/\s+/);
    const firstName = nameParts[0];
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

    /**
     * ------------------------------
     *  Get IP and Generate Address
     * ------------------------------
     */
    let userIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    if (Array.isArray(userIP)) {
      // In some rare cases x-forwarded-for can be an array, pick the first
      userIP = userIP[0];
    }

    // Look up geographic info using geoip-lite
    let geo;
    try {
      geo = geoip.lookup(userIP);
    } catch (err) {
      console.error('Error looking up IP:', err);
    }

    // Generate fallback if missing
    const city = (geo && geo.city) ? geo.city : faker.string.numeric(4);
    const region = (geo && geo.region) ? geo.region : faker.string.numeric(4);
    const streetAddress = faker.location.streetAddress();
    const postalCode = faker.location.zipCode();

    // Log the address data
    console.log(`IP: ${userIP}`);
    console.log(`Resolved Geo:`, geo);
    console.log(`Using Address Data => Street: ${streetAddress}, City: ${city}, Province: ${region}, Province Code (Zip): ${postalCode}`);

    /**
     * Build CartPanda order object
     */
    const lineItems = [
      {
        variant_id: Number(variantId),
        quantity: 1
      }
    ];

    const orderData = {
      email,
      phone: '0000000000', // Dummy phone
      currency: DEFAULT_CURRENCY,
      presentment_currency: DEFAULT_CURRENCY,
      subtotal_amount: donationAmount,
      products_total_amount: donationAmount,
      total_amount: donationAmount,
      line_items: lineItems,
      billing_address: {
        first_name: firstName,
        last_name: lastName,
        name: fullName,
        // Requested mappings
        house_no: streetAddress,  // house no => Street Address
        city: city,               // city => city
        province: region,         // province => region
        province_code: postalCode,// province_code => Postal/Zip code
        zip: 0                    // keep actual zip code as 0
      },
      shipping_address: {
        first_name: firstName,
        last_name: lastName,
        name: fullName,
        // Requested mappings
        house_no: streetAddress,  
        city: city,
        province: region,
        province_code: postalCode,
        zip: 0
      },
      payment: {
        payment_gateway_id: 'cartpanda_pay',
        amount: donationAmount,
        gateway: 'other', // or the specific gateway if you have one
        type: 'cc',
        boleto_link: 'N/A',    // dummy data
        boleto_code: 'N/A',    // dummy data
        boleto_limit_date: getTomorrowDate()
      },
      customer: {
        email,
        first_name: firstName,
        last_name: lastName
      },
      // Replace with your actual domain return URL
      thank_you_page: `https://your-domain.com/cartpanda_return`
    };

    /**
     * Submit order creation to CartPanda
     */
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

    // Determine the checkout URL based on the response
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

// Return endpoint for final verification
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
    // Check for payment status (3 indicates paid; adjust if needed)
    const paid = (orderData?.payment_status === 3 || orderData?.status_id === '3');

    return paid ? res.redirect('/thanks.html') : res.redirect('/error.html');
  } catch (error) {
    console.error('Error verifying order status:', error.response?.data || error.message);
    return res.redirect('/error.html');
  }
});

// Webhook endpoint (optional)
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

// Catch-all route (404)
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handling middleware
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
