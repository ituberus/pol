/***********************
 * server.js
 ***********************/
require('dotenv').config();
const express = require('express');
const cors = require('cors'); // Added CORS
const axios = require('axios');
const path = require('path');

const app = express();

// Enable CORS for all routes so that any domain can use these endpoints.
app.use(cors());

const {
  CARTPANDA_API_KEY,
  CARTPANDA_SHOP_SLUG,
  PORT
} = process.env;

// We'll allow any currency, but default to "usd" if not set.
const CURRENCY = (process.env.CURRENCY || 'usd').toLowerCase();

// Helper: get tomorrow's date in YYYY-MM-DD format
function getTomorrowDate() {
  const tomorrow = new Date(Date.now() + 86400000);
  return tomorrow.toISOString().split("T")[0];
}

// Base URL for CartPanda API
const CARTPANDA_API_BASE = 'https://accounts.cartpanda.com/api/v3';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Create order endpoint
 * Expects JSON like:
 * {
 *   donationAmount: number,
 *   variantId: number,
 *   fullName: string,
 *   email: string
 * }
 */
app.post('/create-donation-order', async (req, res) => {
  try {
    const { donationAmount, variantId, fullName, email } = req.body;

    if (!donationAmount || isNaN(donationAmount) || donationAmount <= 0) {
      return res.status(400).json({ error: 'Invalid donation amount' });
    }
    if (!variantId) {
      return res.status(400).json({ error: 'Missing or invalid variant ID' });
    }
    if (!fullName || fullName.trim() === "") {
      return res.status(400).json({ error: 'Full name is required' });
    }
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Split fullName into firstName and lastName.
    const nameParts = fullName.trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : '';

    // The line_items must reference the correct variant_id
    const lineItems = [
      {
        variant_id: Number(variantId),
        quantity: 1
      }
    ];

    // Build the order data with your currency
    const orderData = {
      email,
      phone: '0000000000',  // or any dummy phone if required by CartPanda
      currency: CURRENCY,
      presentment_currency: CURRENCY,
      subtotal_amount: donationAmount,
      products_total_amount: donationAmount,
      total_amount: donationAmount,
      line_items: lineItems,
      billing_address: {
        first_name: firstName,
        last_name: lastName,
        name: fullName,
        house_no: 'N/A',
        city: 'N/A',
        province: 'N/A',
        province_code: 'N/A',
        zip: 0
      },
      shipping_address: {
        first_name: firstName,
        last_name: lastName,
        name: fullName,
        house_no: 'N/A',
        city: 'N/A',
        province: 'N/A',
        province_code: 'N/A',
        zip: 0
      },
      payment: {
        payment_gateway_id: 'cartpanda_pay', // update if you have a specific gateway
        amount: donationAmount,
        gateway: 'other',      // or specify your gateway
        type: 'cc',
        boleto_link: 'N/A',    // dummy
        boleto_code: 'N/A',    // dummy
        boleto_limit_date: getTomorrowDate() // valid dummy date
      },
      customer: {
        email,
        first_name: firstName,
        last_name: lastName
      },
      // Replace this with your actual domain return URL
      thank_you_page: `https://your-domain.com/cartpanda_return`
    };

    const url = `${CARTPANDA_API_BASE}/${CARTPANDA_SHOP_SLUG}/order`;
    const apiResponse = await axios.post(url, orderData, {
      headers: {
        'Authorization': `Bearer ${CARTPANDA_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const createdOrder = apiResponse.data;

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
      }
    });
    const orderData = orderResp.data;
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

const port = PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
