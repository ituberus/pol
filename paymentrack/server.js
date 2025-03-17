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
 * full country name CartPanda might expect. (v1 expects "Brasil" for BR, etc.)
 * Adjust as you see fit if you need more coverage or different naming.
 */
function mapISOToCountry(isoCode) {
  const map = {
    US: 'United States',
    BR: 'Brasil',
    CA: 'Canada',
    GB: 'United Kingdom',
    AU: 'Australia'
  };
  return map[isoCode.toUpperCase()] || 'United States';
}

// Base URL for CartPanda API v1
const CARTPANDA_API_BASE = 'https://accounts.cartpanda.com/api';

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

    // === 3) Build line items (required by v1)
    const lineItems = [
      {
        variant_id: Number(variantId),
        quantity: 1
      }
    ];

    // === 4) Build random tokens and phone
    const uniqueCartToken = faker.string.uuid();
    const uniqueCustomerToken = faker.string.uuid();
    const randomPhone = faker.phone.number('+###########'); // e.g. +17205550123

    /**
     * v1 requires certain root-level fields, shipping_address, billing_address, etc.
     * Payment status in the example is "paid". No discount is used, so we set discount = 0.
     */
    const orderData = {
      cart_token: uniqueCartToken,
      currency: DEFAULT_CURRENCY,
      discount_code: '',
      email,
      phone: randomPhone,
      presentment_currency: DEFAULT_CURRENCY,
      subtotal_amount: donationAmount,
      card_token: 'random-card-token',
      customer_token: uniqueCustomerToken,
      order_discount: 0, // no discount
      products_total_amount: donationAmount,
      total_amount: donationAmount,

      // can be "paid" or "3" for 'paid' – the example uses the string "paid"
      payment_status: 'paid',

      line_items: lineItems,

      shipping_address: {
        // all these fields are "required" by v1; fill with random or relevant data
        address1: finalStreet,
        address2: 'N/A',
        address: finalStreet,
        house_no: '123',
        compartment: 'N/A',
        neighborhood: 'N/A',
        city: finalCity,
        company: 'N/A',
        first_name: firstName,
        last_name: lastName,
        phone: randomPhone,
        province: finalProv,
        zip: Number(finalZip.replace(/\D/g, '') || '99999'),
        name: fullName,
        province_code: finalProvCode,
      },

      billing_address: {
        address1: finalStreet,
        address2: 'N/A',
        address: finalStreet,
        house_no: '123',
        compartment: 'N/A',
        neighborhood: 'N/A',
        city: finalCity,
        company: 'N/A',
        first_name: firstName,
        last_name: lastName,
        phone: randomPhone,
        province: finalProv,
        zip: Number(finalZip.replace(/\D/g, '') || '99999'),
        name: fullName,
        province_code: finalProvCode,
      },

      // shipping info block: required by v1
      shipping: {
        price: 0,          // zero shipping cost for a donation
        source: 'Donation',
        title: 'No Shipping Needed'
      },

      // Payment object (v1 requires all these fields)
      payment: {
        payment_gateway_id: 'random-payment-gateway-id',
        amount: donationAmount,
        gateway: 'other',   // e.g. "appmax", "mercadopago", "ebanx", "pagseguro", or "other"
        type: 'cc',         // "cc", "boleto", or "admin"
        boleto_link: 'N/A',
        boleto_code: 'N/A',
        boleto_limit_date: getTomorrowDate() // required even if type != boleto
      },

      // discount object is required, so set it to zero
      discount: {
        value: 0,
        amount: 0,
        value_type: 'fixed_amount',
        note: 'No discount used'
      },

      // Customer object is required; we can just use placeholders
      customer: {
        id: 0, // or random
        email,
        first_name: firstName,
        last_name: lastName,
        cpf: 123456789 // or any random number
      },

      // Additional tags if desired
      tags: [
        'Donation',
        'Auto-created',
      ]
    };

    // === 5) Send the Create-Order request to CartPanda v1
    const url = `${CARTPANDA_API_BASE}/${CARTPANDA_SHOP_SLUG}/order`;
    const apiResponse = await axios.post(url, orderData, {
      headers: {
        Authorization: `Bearer ${CARTPANDA_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    // If successful, the response should have "order" property.
    const createdOrder = apiResponse.data;
    console.log('Created CartPanda order:', createdOrder);

    // v1 returns a "thank_you_page" in createdOrder.order.thank_you_page
    let checkoutUrl = '';
    if (createdOrder?.order?.thank_you_page) {
      checkoutUrl = createdOrder.order.thank_you_page;
    } else {
      return res.status(500).json({
        error: 'No thank_you_page returned from CartPanda. Cannot redirect to payment.'
      });
    }

    // === 6) Return the "thank_you_page" to your frontend as a redirect URL
    return res.json({ checkoutUrl });

  } catch (error) {
    console.error('Error creating CartPanda order:', error.response?.data || error.message);
    return res.status(500).json({ error: 'Could not create order, please try again.' });
  }
});

/**
 * GET /cartpanda_return
 * Final verification after checkout
 * (Keeping the same logic as before, though v1 typically returns order data in a similar format.)
 */
app.get('/cartpanda_return', async (req, res) => {
  try {
    const orderId = req.query.order_id;
    if (!orderId) {
      return res.redirect('/error.html');
    }

    // Retrieve the order from v1
    const orderUrl = `${CARTPANDA_API_BASE}/${CARTPANDA_SHOP_SLUG}/order/${orderId}`;
    const orderResp = await axios.get(orderUrl, {
      headers: {
        Authorization: `Bearer ${CARTPANDA_API_KEY}`
      },
      timeout: 10000
    });

    const orderData = orderResp.data;
    // For v1, "payment_status" might be "paid" if fully paid.
    // In many CartPanda setups, status_id "3" or "PAID" means success.
    // Adjust logic as needed based on your actual order data structure.
    const isPaid =
      orderData?.order?.payment_status === 'paid' ||
 
