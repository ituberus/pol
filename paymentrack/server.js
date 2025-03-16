require('dotenv').config();
const express = require('express');
const cors = require('cors'); // Open CORS for all domains (required)
const axios = require('axios');
const path = require('path');

// Verify required environment variables
const {
  CARTPANDA_SHOP_SLUG,
  PORT,
  CURRENCY
} = process.env;

if (!CARTPANDA_SHOP_SLUG) {
  console.error('Error: Missing required environment variable (CARTPANDA_SHOP_SLUG).');
  process.exit(1);
}

// Use default currency "usd" if not provided.
const DEFAULT_CURRENCY = (CURRENCY || 'usd').toLowerCase();

// Create Express app
const app = express();

/**
 * Set up CORS so all origins are allowed.
 * This also handles the preflight OPTIONS request.
 */
app.use(cors({
  origin: '*',           // Allow all origins
  methods: ['GET','POST','OPTIONS','PUT','PATCH','DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Type', 'Authorization'],
  credentials: false     // Set to true if you need cookies
}));

// Explicitly handle all OPTIONS requests (again, typically cors() does this, but being explicit helps).
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
    return tomorrow.toISOString().split("T")[0];
  } catch (error) {
    console.error('Error generating tomorrow\'s date:', error);
    // Fallback to current date if any error occurs (should not happen)
    return new Date().toISOString().split("T")[0];
  }
}

// For mock mode, use the Stoplight mock API URL
const MOCK_API_BASE = 'https://stoplight.io/mocks/cartx/api-v3/725155112';

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

/**
 * Create order endpoint (mock mode)
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
    if (!fullName || fullName.trim() === "") {
      return res.status(400).json({ error: 'Full name is required' });
    }
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Split fullName into firstName and lastName
    const nameParts = fullName.trim().split(/\s+/);
    const firstName = nameParts[0];
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : '';

    // Build line items array (required: at least one item)
    const lineItems = [
      {
        variant_id: Number(variantId),
        quantity: 1
      }
    ];

    // Build the order data according to the mock API requirements
    const orderData = {
      cart_token: "dummy_cart_token",
      currency: DEFAULT_CURRENCY,
      email,
      phone: '0000000000', // Dummy phone if required
      presentment_currency: DEFAULT_CURRENCY,
      subtotal_amount: donationAmount,
      products_total_amount: donationAmount,
      total_amount: donationAmount,
      payment_status: "1", // Pending payment
      line_items: lineItems,
      billing_address: {
        first_name: firstName,
        last_name: lastName,
        name: fullName,
        address1: 'N/A',
        address2: 'N/A',
        address: 'N/A',
        house_no: 'N/A',
        compartment: 'N/A',
        neighborhood: 'N/A',
        city: 'N/A',
        province: 'N/A',
        province_code: 'N/A',
        zip: 0,
        company: 'N/A',
        phone: 'N/A'
      },
      shipping_address: {
        first_name: firstName,
        last_name: lastName,
        name: fullName,
        address1: 'N/A',
        address2: 'N/A',
        address: 'N/A',
        house_no: 'N/A',
        compartment: 'N/A',
        neighborhood: 'N/A',
        city: 'N/A',
        province: 'N/A',
        province_code: 'N/A',
        zip: 0,
        company: 'N/A',
        phone: 'N/A'
      },
      // Include a dummy shipping object as required by the mock API
      shipping: {
        price: 0,
        source: "N/A",
        title: "N/A"
      },
      payment: {
        payment_gateway_id: 'cartpanda_pay', // Use your payment gateway id (or a dummy value)
        amount: donationAmount,
        gateway: 'other', // Allowed values: mercadopago, ebanx, appmax, pagseguro, other
        type: 'cc',     // Allowed values: cc, boleto, admin
        boleto_link: 'N/A', // Dummy data; required only for boleto type
        boleto_code: 'N/A', // Dummy data; required only for boleto type
        boleto_limit_date: getTomorrowDate() // Dummy date
      },
      // Adjust customer object with additional required fields for the mock API
      customer: {
        id: 1,
        email,
        first_name: firstName,
        last_name: lastName,
        cpf: "N/A",
        tags: []
      },
      thank_you_page: `https://your-domain.com/cartpanda_return`
    };

    const url = `${MOCK_API_BASE}/${CARTPANDA_SHOP_SLUG}/order`;

    // Call the mock API to create an order
    const apiResponse = await axios.post(url, orderData, {
      headers: {
        'Authorization': `Bearer Zdj50Deuj4TSQO5huguW8MRuL7NXGU4nnUyJyZ9YEscqONw1FMFPpohKABjV`,
        'Content-Type': 'application/json'
      },
      timeout: 10000 // Set timeout to avoid hanging requests
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
        error: 'No checkout URL returned from mock API. Cannot redirect to payment.'
      });
    }

    console.log('Created CartPanda order (Mock):', createdOrder);
    return res.json({ checkoutUrl });
  } catch (error) {
    console.error('Error creating CartPanda order (Mock):', error.response?.data || error.message);
    return res.status(500).json({ error: 'Could not create order, please try again.' });
  }
});

// Return endpoint for final verification remains unchanged (if applicable)
app.get('/cartpanda_return', async (req, res) => {
  try {
    const orderId = req.query.order_id;
    if (!orderId) {
      return res.redirect('/error.html');
    }

    // This part may need adjustments if verifying with the mock server.
    // For now, we'll assume the same URL structure:
    const orderUrl = `${MOCK_API_BASE}/${CARTPANDA_SHOP_SLUG}/order/${orderId}`;
    const orderResp = await axios.get(orderUrl, {
      headers: {
        'Authorization': `Bearer Zdj50Deuj4TSQO5huguW8MRuL7NXGU4nnUyJyZ9YEscqONw1FMFPpohKABjV`
      },
      timeout: 10000 // Set timeout for the API request
    });

    const orderData = orderResp.data;
    // Check for payment status (3 indicates paid; adjust if needed)
    const paid = (orderData?.payment_status === 3 || orderData?.status_id === '3');

    return paid ? res.redirect('/thanks.html') : res.redirect('/error.html');
  } catch (error) {
    console.error('Error verifying order status (Mock):', error.response?.data || error.message);
    return res.redirect('/error.html');
  }
});

// Webhook endpoint (optional)
app.post('/cartpanda-webhook', (req, res) => {
  try {
    const eventName = req.body.event;
    const order = req.body.order;
    console.log('Received CartPanda Webhook (Mock):', eventName, order?.id);
    res.sendStatus(200);
  } catch (err) {
    console.error('Error in webhook handler (Mock):', err);
    res.sendStatus(500);
  }
});

// Catch-all route for undefined endpoints (404)
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
