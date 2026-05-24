require('dotenv').config();
const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Omise = require('omise')({
  publicKey: process.env.OMISE_PUBLIC_KEY,
  secretKey: process.env.OMISE_SECRET_KEY,
});
const paypal = require('@paypal/checkout-server-sdk');

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());

// ─── PayPal Client Setup ──────────────────────────────────────
function getPayPalClient() {
  const env = process.env.NODE_ENV === 'production'
    ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
    : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET);
  return new paypal.core.PayPalHttpClient(env);
}

// ─── Health Check ─────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'SiamCraft Payment Server is running 🚀' });
});

// ══════════════════════════════════════════════════════════════
// STRIPE — บัตรเครดิต/เดบิต
// ══════════════════════════════════════════════════════════════
app.post('/api/stripe/create-payment-intent', async (req, res) => {
  try {
    const { amount, currency = 'thb', items } = req.body;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Stripe ใช้ satang (smallest unit)
      currency,
      metadata: {
        items: JSON.stringify(items?.map(i => i.name) || []),
      },
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// Stripe Webhook — รับยืนยันการชำระเงิน
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    console.log(`✅ Stripe payment succeeded: ${pi.id} — ฿${pi.amount / 100}`);
    // TODO: อัปเดต order ใน database ว่าชำระเงินแล้ว
  }

  res.json({ received: true });
});

// ══════════════════════════════════════════════════════════════
// OMISE — PromptPay QR Code
// ══════════════════════════════════════════════════════════════
app.post('/api/omise/create-promptpay', async (req, res) => {
  try {
    const { amount } = req.body; // บาท

    // สร้าง Source แบบ PromptPay
    const source = await new Promise((resolve, reject) => {
      Omise.sources.create({
        amount: Math.round(amount * 100), // สตางค์
        currency: 'thb',
        type: 'promptpay',
      }, (err, resp) => {
        if (err) reject(err);
        else resolve(resp);
      });
    });

    // สร้าง Charge
    const charge = await new Promise((resolve, reject) => {
      Omise.charges.create({
        amount: Math.round(amount * 100),
        currency: 'thb',
        source: source.id,
        return_uri: `${process.env.FRONTEND_URL}/payment-success`,
      }, (err, resp) => {
        if (err) reject(err);
        else resolve(resp);
      });
    });

    res.json({
      chargeId: charge.id,
      qrCodeUrl: charge.source?.scannable_code?.image?.download_uri || null,
      amount: charge.amount / 100,
      status: charge.status,
    });
  } catch (err) {
    console.error('Omise error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// เช็คสถานะการชำระ PromptPay
app.get('/api/omise/charge/:chargeId', async (req, res) => {
  try {
    const charge = await new Promise((resolve, reject) => {
      Omise.charges.retrieve(req.params.chargeId, (err, resp) => {
        if (err) reject(err);
        else resolve(resp);
      });
    });
    res.json({ status: charge.status, paid: charge.paid });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Omise Webhook
app.post('/api/omise/webhook', (req, res) => {
  const event = req.body;
  if (event.key === 'charge.complete' && event.data.status === 'successful') {
    console.log(`✅ PromptPay payment succeeded: ${event.data.id}`);
    // TODO: อัปเดต order ใน database
  }
  res.json({ received: true });
});

// ══════════════════════════════════════════════════════════════
// PAYPAL — PayPal Checkout
// ══════════════════════════════════════════════════════════════
app.post('/api/paypal/create-order', async (req, res) => {
  try {
    const { amount, items } = req.body;
    const client = getPayPalClient();

    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer('return=representation');
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: 'THB',
          value: amount.toFixed(2),
        },
        description: 'SiamCraft Order',
      }],
      application_context: {
        return_url: `${process.env.FRONTEND_URL}/payment-success`,
        cancel_url: `${process.env.FRONTEND_URL}/cart`,
      },
    });

    const order = await client.execute(request);
    const approveUrl = order.result.links.find(l => l.rel === 'approve')?.href;

    res.json({
      orderId: order.result.id,
      approveUrl,
    });
  } catch (err) {
    console.error('PayPal error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// Capture PayPal หลัง user approve
app.post('/api/paypal/capture-order', async (req, res) => {
  try {
    const { orderId } = req.body;
    const client = getPayPalClient();

    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});
    const capture = await client.execute(request);

    const status = capture.result.status;
    console.log(`✅ PayPal payment ${status}: ${orderId}`);

    res.json({
      status,
      orderId: capture.result.id,
      paid: status === 'COMPLETED',
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Start Server ─────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
