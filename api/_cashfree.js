// Cashfree Payments & Easy Split Multi-Owner Gateway Client
// Zero external dependencies. Uses Node 18+ native fetch and crypto.
// Follows Cashfree Payments API specification (API Version 2023-08-01 / 2022-09-01)
// Documentation: https://www.cashfree.com/docs/

const crypto = require('crypto');

function getEnvConfig() {
  const clientId = process.env.CASHFREE_CLIENT_ID || process.env.CASHFREE_APP_ID || '';
  const clientSecret = process.env.CASHFREE_CLIENT_SECRET || process.env.CASHFREE_SECRET_KEY || '';
  const env = (process.env.CASHFREE_ENVIRONMENT || 'sandbox').toLowerCase().trim();
  const apiVersion = process.env.CASHFREE_API_VERSION || '2023-08-01';
  const webhookSecret = process.env.CASHFREE_WEBHOOK_SECRET || process.env.PAYMENT_WEBHOOK_SECRET || clientSecret;
  const returnUrl = process.env.CASHFREE_RETURN_URL || '';

  const isProduction = env === 'production';
  const baseUrl = isProduction ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';

  return {
    clientId,
    clientSecret,
    environment: isProduction ? 'production' : 'sandbox',
    apiVersion,
    webhookSecret,
    returnUrl,
    baseUrl,
    isConfigured: Boolean(clientId && clientSecret)
  };
}

class CashfreeError extends Error {
  constructor(status, message, code = '', details = null) {
    super(message);
    this.name = 'CashfreeError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// In-memory test store for sandbox/mock test simulations
const mockStore = {
  orders: new Map(),
  payments: new Map(),
  vendors: new Map(),
  refunds: new Map(),
  settlements: new Map()
};

function isMockMode(config) {
  if (process.env.CASHFREE_MOCK_MODE === 'false') return false;
  return (process.env.CASHFREE_MOCK_MODE === 'true') ||
         (!config.isConfigured && process.env.NODE_ENV === 'test') ||
         config.clientId.startsWith('cf_test_mock_');
}

async function cfRequest(endpoint, { method = 'GET', body, config = getEnvConfig(), timeout = 8000, backoffBaseMs = 300 } = {}) {
  // If mock mode is active, simulate Cashfree API behavior
  if (isMockMode(config)) {
    return simulateCashfreeApi(endpoint, { method, body, config });
  }

  if (!config.isConfigured) {
    throw new CashfreeError(503, 'Cashfree credentials are not configured', 'CONFIG_MISSING');
  }

  const url = `${config.baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
  const maxAttempts = method === 'GET' ? 3 : 1; // Safely retry idempotent reads with exponential backoff
  let attempt = 0;
  let lastError = null;

  while (attempt < maxAttempts) {
    attempt++;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);

    try {
      const headers = {
        'Content-Type': 'application/json',
        'x-client-id': config.clientId,
        'x-client-secret': config.clientSecret,
        'x-api-version': config.apiVersion
      };

      const res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctl.signal
      });

      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (_) { /* edge response */ }

      if (!res.ok) {
        const isRetryable = (res.status >= 500 || res.status === 429) && attempt < maxAttempts;
        if (isRetryable) {
          await new Promise(r => setTimeout(r, Math.min(2000, backoffBaseMs * Math.pow(2, attempt - 1))));
          continue;
        }
        const msg = (data && (data.message || data.error_description || data.error)) || `Cashfree API returned ${res.status}`;
        const code = (data && data.code) || 'GATEWAY_ERROR';
        throw new CashfreeError(res.status >= 500 ? 502 : res.status, msg, code, data);
      }

      return data;
    } catch (err) {
      lastError = err;
      if (err instanceof CashfreeError) throw err;
      const isAbort = err.name === 'AbortError';
      const isRetryable = attempt < maxAttempts;
      if (isRetryable) {
        await new Promise(r => setTimeout(r, Math.min(2000, backoffBaseMs * Math.pow(2, attempt - 1))));
        continue;
      }
      if (isAbort) {
        throw new CashfreeError(504, 'Cashfree API request timed out', 'GATEWAY_TIMEOUT');
      }
      throw new CashfreeError(502, `Failed to communicate with Cashfree: ${err.message}`, 'NETWORK_ERROR');
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new CashfreeError(502, 'Cashfree request failed after retries', 'NETWORK_ERROR');
}

// ------------------------------------------------------------------------------
// Cashfree Core Payment Functions
// ------------------------------------------------------------------------------

/**
 * Creates a unique payment order at Cashfree with optional Easy Split vendor allocations.
 */
async function createOrder({
  orderId,
  orderAmount,
  orderCurrency = 'INR',
  customerDetails = {},
  orderMeta = {},
  orderTags = {},
  orderSplits = [],
  orderNote = '',
  config = getEnvConfig()
}) {
  if (!orderId || !/^[a-zA-Z0-9_\-]{3,45}$/.test(orderId)) {
    throw new CashfreeError(400, 'Invalid order_id format (3-45 alphanumeric, dash or underscore characters)', 'BAD_ORDER_ID');
  }
  const amt = Number(orderAmount);
  if (!amt || amt <= 0 || isNaN(amt) || Math.round(amt * 100) / 100 !== amt) {
    throw new CashfreeError(400, 'Order amount must be a positive number with at most 2 decimal places', 'INVALID_AMOUNT');
  }
  if (orderCurrency !== 'INR') {
    throw new CashfreeError(400, 'Only INR currency is supported for domestic UPI payments', 'INVALID_CURRENCY');
  }

  const payload = {
    order_id: orderId,
    order_amount: amt,
    order_currency: 'INR',
    customer_details: {
      customer_id: String(customerDetails.customer_id || 'cust_anonymous').slice(0, 50),
      customer_name: String(customerDetails.customer_name || 'Resident').slice(0, 80),
      customer_email: String(customerDetails.customer_email || 'resident@hostelos.app').slice(0, 80),
      customer_phone: String(customerDetails.customer_phone || '9999999999').replace(/\D/g, '').slice(-10)
    },
    order_meta: {
      return_url: orderMeta.return_url || config.returnUrl || undefined,
      notify_url: orderMeta.notify_url || undefined,
      payment_methods: 'upi'
    },
    order_note: String(orderNote || '').slice(0, 200) || undefined
  };

  if (orderTags && Object.keys(orderTags).length > 0) {
    payload.order_tags = orderTags;
  }

  // Easy Split multi-owner routing
  if (Array.isArray(orderSplits) && orderSplits.length > 0) {
    payload.order_splits = orderSplits.map(s => ({
      vendor_id: String(s.vendor_id),
      amount: s.amount != null ? Number(s.amount) : undefined,
      percentage: s.percentage != null ? Number(s.percentage) : undefined
    }));
  }

  return cfRequest('/orders', { method: 'POST', body: payload, config });
}

/**
 * Retrieves Cashfree order details and current status.
 */
async function getOrder(orderId, config = getEnvConfig()) {
  if (!orderId) throw new CashfreeError(400, 'Order ID is required', 'MISSING_ORDER_ID');
  return cfRequest(`/orders/${encodeURIComponent(orderId)}`, { method: 'GET', config });
}

/**
 * Fetches all payment attempts and transactions associated with an order.
 */
async function getOrderPayments(orderId, config = getEnvConfig()) {
  if (!orderId) throw new CashfreeError(400, 'Order ID is required', 'MISSING_ORDER_ID');
  return cfRequest(`/orders/${encodeURIComponent(orderId)}/payments`, { method: 'GET', config });
}

/**
 * Requests official UPI payment channel execution (intent, qrcode, or collect).
 */
async function payOrderSession({
  paymentSessionId,
  channel = 'intent',
  upiId = '',
  config = getEnvConfig()
}) {
  if (!paymentSessionId) {
    throw new CashfreeError(400, 'payment_session_id is required', 'MISSING_SESSION_ID');
  }

  const payload = {
    payment_session_id: paymentSessionId,
    payment_method: {
      upi: {
        channel: channel || 'intent'
      }
    }
  };

  if (channel === 'collect') {
    if (!upiId) throw new CashfreeError(400, 'UPI ID is required for collect request', 'MISSING_UPI_ID');
    payload.payment_method.upi.upi_id = upiId;
  }

  return cfRequest('/orders/sessions', { method: 'POST', body: payload, config });
}

// ------------------------------------------------------------------------------
// Webhook Signature Verification
// ------------------------------------------------------------------------------

/**
 * Authenticates Cashfree Webhook HMAC-SHA256 signatures safely.
 * Cashfree official specification: Base64(HMAC-SHA256(timestamp + rawBody, secret))
 * Also supports hex digest fallback for testing / legacy compatibility.
 */
function verifyWebhookSignature({ rawBody, timestamp = '', signature = '', secret = '', checkTimestampDrift = (process.env.NODE_ENV !== 'test') }) {
  if (!signature) return false;
  const signingSecret = secret || getEnvConfig().webhookSecret;
  if (!signingSecret) return false;

  // Validate timestamp freshness (within 5 minutes) to protect against replay attacks
  if (timestamp && checkTimestampDrift) {
    const tsNum = Number(timestamp);
    const tsMs = tsNum > 1e11 ? tsNum : tsNum * 1000;
    if (isNaN(tsMs) || Math.abs(Date.now() - tsMs) > 300000) {
      return false;
    }
  }

  const payloadString = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody);

  const cleanSig = String(signature).trim();
  const cleanSigLower = cleanSig.toLowerCase();

  const candidates = [];
  if (timestamp) {
    const hmacWithTs = crypto.createHmac('sha256', signingSecret).update(String(timestamp) + payloadString);
    candidates.push(hmacWithTs.digest('base64')); // Official Cashfree format
    const hexWithTs = crypto.createHmac('sha256', signingSecret).update(String(timestamp) + payloadString).digest('hex');
    candidates.push(hexWithTs);
  }

  const hmacDirect = crypto.createHmac('sha256', signingSecret).update(payloadString);
  candidates.push(hmacDirect.digest('base64'));
  const hexDirect = crypto.createHmac('sha256', signingSecret).update(payloadString).digest('hex');
  candidates.push(hexDirect);

  for (const exp of candidates) {
    // Check exact match (for Base64 or exact hex)
    if (cleanSig.length === exp.length) {
      if (crypto.timingSafeEqual(Buffer.from(cleanSig, 'utf8'), Buffer.from(exp, 'utf8'))) {
        return true;
      }
    }
    // Check case-insensitive match for hex signatures
    if (cleanSigLower.length === exp.length && exp === exp.toLowerCase()) {
      if (crypto.timingSafeEqual(Buffer.from(cleanSigLower, 'utf8'), Buffer.from(exp, 'utf8'))) {
        return true;
      }
    }
  }

  return false;
}

// ------------------------------------------------------------------------------
// Easy Split / Multi-Vendor Settlement Management
// ------------------------------------------------------------------------------

/**
 * Registers or updates a PG Owner as an approved Cashfree Easy Split vendor.
 */
async function createOrUpdateVendor({
  vendorId,
  name,
  email,
  phone,
  bankAccount = null,
  upi = null,
  verifyAccount = false,
  config = getEnvConfig()
}) {
  if (!vendorId) throw new CashfreeError(400, 'Vendor ID is required', 'MISSING_VENDOR_ID');
  if (!name) throw new CashfreeError(400, 'Owner / Vendor name is required', 'MISSING_NAME');
  if (!phone) throw new CashfreeError(400, 'Phone number is required', 'MISSING_PHONE');

  const cleanPhone = String(phone).replace(/\D/g, '').slice(-10);
  const payload = {
    vendor_id: String(vendorId).slice(0, 45),
    name: String(name).slice(0, 80),
    email: String(email || 'owner@hostelos.app').slice(0, 80),
    phone: cleanPhone,
    verify_account: Boolean(verifyAccount),
    status: 'ACTIVE'
  };

  if (bankAccount && bankAccount.account_number && bankAccount.ifsc) {
    payload.bank_account = {
      account_number: String(bankAccount.account_number).trim(),
      ifsc: String(bankAccount.ifsc).toUpperCase().trim(),
      account_holder: String(bankAccount.account_holder || name).slice(0, 80)
    };
  }

  if (upi && upi.vpa) {
    payload.upi = {
      vpa: String(upi.vpa).trim()
    };
  }

  return cfRequest('/easy-split/vendors', { method: 'POST', body: payload, config });
}

/**
 * Retrieves Easy Split vendor KYC and onboarding details.
 */
async function getVendor(vendorId, config = getEnvConfig()) {
  if (!vendorId) throw new CashfreeError(400, 'Vendor ID is required', 'MISSING_VENDOR_ID');
  return cfRequest(`/easy-split/vendors/${encodeURIComponent(vendorId)}`, { method: 'GET', config });
}

/**
 * Fetches vendor settlement records and payout history.
 */
async function getVendorSettlements(vendorId, config = getEnvConfig()) {
  if (!vendorId) throw new CashfreeError(400, 'Vendor ID is required', 'MISSING_VENDOR_ID');
  return cfRequest(`/easy-split/settlements?vendor_id=${encodeURIComponent(vendorId)}`, { method: 'GET', config });
}

// ------------------------------------------------------------------------------
// Refund Management
// ------------------------------------------------------------------------------

/**
 * Initiates an authorized refund via Cashfree Payments API.
 */
async function createRefund({
  orderId,
  refundId,
  refundAmount,
  refundNote = '',
  refundSplits = [],
  refundSpeed = 'STANDARD',
  config = getEnvConfig()
}) {
  if (!orderId) throw new CashfreeError(400, 'Order ID is required', 'MISSING_ORDER_ID');
  if (!refundId) throw new CashfreeError(400, 'Refund ID is required', 'MISSING_REFUND_ID');
  const amt = Number(refundAmount);
  if (!amt || amt <= 0) throw new CashfreeError(400, 'Refund amount must be positive', 'INVALID_REFUND_AMOUNT');

  const payload = {
    refund_id: refundId,
    refund_amount: amt,
    refund_note: String(refundNote || 'Refund requested').slice(0, 150),
    refund_speed: refundSpeed || 'STANDARD'
  };

  if (Array.isArray(refundSplits) && refundSplits.length > 0) {
    payload.refund_splits = refundSplits;
  }

  return cfRequest(`/orders/${encodeURIComponent(orderId)}/refunds`, { method: 'POST', body: payload, config });
}

/**
 * Fetches refund status from Cashfree.
 */
async function getRefund(orderId, refundId, config = getEnvConfig()) {
  return cfRequest(`/orders/${encodeURIComponent(orderId)}/refunds/${encodeURIComponent(refundId)}`, { method: 'GET', config });
}

// ------------------------------------------------------------------------------
// Deterministic High-Fidelity Mock Simulator (for Tests & Offline Sandbox)
// ------------------------------------------------------------------------------

function simulateCashfreeApi(endpoint, { method, body }) {
  const norm = endpoint.startsWith('/') ? endpoint : '/' + endpoint;

  // 1. POST /orders
  if (norm === '/orders' && method === 'POST') {
    const oId = body.order_id;
    const session = `session_${crypto.randomBytes(16).toString('hex')}`;
    const orderDoc = {
      cf_order_id: `cf_ord_${crypto.randomBytes(12).toString('hex')}`,
      order_id: oId,
      entity: 'order',
      order_currency: body.order_currency || 'INR',
      order_amount: body.order_amount,
      order_status: 'ACTIVE',
      payment_session_id: session,
      order_expiry_time: new Date(Date.now() + 30 * 60e3).toISOString(),
      order_note: body.order_note,
      order_splits: body.order_splits || [],
      customer_details: body.customer_details,
      order_meta: body.order_meta,
      created_at: new Date().toISOString()
    };
    mockStore.orders.set(oId, orderDoc);
    return Promise.resolve(orderDoc);
  }

  // 2. GET /orders/:id
  const getOrderMatch = norm.match(/^\/orders\/([^\/]+)$/);
  if (getOrderMatch && method === 'GET') {
    const oId = decodeURIComponent(getOrderMatch[1]);
    const hit = mockStore.orders.get(oId);
    if (!hit) throw new CashfreeError(404, `Order ${oId} not found`, 'ORDER_NOT_FOUND');
    return Promise.resolve(hit);
  }

  // 3. GET /orders/:id/payments
  const getPayMatch = norm.match(/^\/orders\/([^\/]+)\/payments$/);
  if (getPayMatch && method === 'GET') {
    const oId = decodeURIComponent(getPayMatch[1]);
    const pays = Array.from(mockStore.payments.values()).filter(p => p.order_id === oId);
    return Promise.resolve(pays);
  }

  // 4. POST /orders/sessions (UPI payment execution)
  if (norm === '/orders/sessions' && method === 'POST') {
    const sid = body.payment_session_id;
    let targetOrder = null;
    for (const ord of mockStore.orders.values()) {
      if (ord.payment_session_id === sid) { targetOrder = ord; break; }
    }
    const upiChannel = body.payment_method?.upi?.channel || 'intent';
    const cfPayId = `cf_pay_${crypto.randomBytes(12).toString('hex')}`;

    const intentPayload = {
      channel: upiChannel,
      data: {
        payload: {
          gpay: `upi://pay?pa=sarvlekh@okhdfcbank&pn=HostelOS&am=${targetOrder?.order_amount || 100}&cu=INR&tr=${cfPayId}`,
          phonepe: `upi://pay?pa=sarvlekh@ybl&pn=HostelOS&am=${targetOrder?.order_amount || 100}&cu=INR&tr=${cfPayId}`,
          paytm: `upi://pay?pa=sarvlekh@paytm&pn=HostelOS&am=${targetOrder?.order_amount || 100}&cu=INR&tr=${cfPayId}`,
          bhim: `upi://pay?pa=sarvlekh@upi&pn=HostelOS&am=${targetOrder?.order_amount || 100}&cu=INR&tr=${cfPayId}`,
          default: `upi://pay?pa=sarvlekh@okhdfcbank&pn=HostelOS&am=${targetOrder?.order_amount || 100}&cu=INR&tr=${cfPayId}`,
          qrcode: `upi://pay?pa=sarvlekh@okhdfcbank&pn=HostelOS&am=${targetOrder?.order_amount || 100}&cu=INR&tr=${cfPayId}`
        }
      }
    };

    if (targetOrder) {
      const payRecord = {
        cf_payment_id: cfPayId,
        order_id: targetOrder.order_id,
        entity: 'payment',
        payment_currency: 'INR',
        payment_amount: targetOrder.order_amount,
        payment_time: new Date().toISOString(),
        payment_status: 'SUCCESS',
        payment_message: 'Simulated payment succeeded',
        bank_reference: 'UTR' + Math.floor(100000000000 + Math.random() * 900000000000),
        payment_method: { upi: { channel: upiChannel } }
      };
      mockStore.payments.set(cfPayId, payRecord);
      targetOrder.order_status = 'PAID';
    }

    return Promise.resolve(intentPayload);
  }

  // 5. POST /easy-split/vendors
  if (norm === '/easy-split/vendors' && method === 'POST') {
    const vId = body.vendor_id;
    const vendorDoc = {
      vendor_id: vId,
      name: body.name,
      email: body.email,
      phone: body.phone,
      status: 'ACTIVE',
      bank_account: body.bank_account || null,
      upi: body.upi || null,
      created_at: new Date().toISOString()
    };
    mockStore.vendors.set(vId, vendorDoc);
    return Promise.resolve(vendorDoc);
  }

  // 6. GET /easy-split/vendors/:id
  const getVendorMatch = norm.match(/^\/easy-split\/vendors\/([^\/]+)$/);
  if (getVendorMatch && method === 'GET') {
    const vId = decodeURIComponent(getVendorMatch[1]);
    const hit = mockStore.vendors.get(vId);
    if (!hit) throw new CashfreeError(404, `Vendor ${vId} not found`, 'VENDOR_NOT_FOUND');
    return Promise.resolve(hit);
  }

  // 7. POST /orders/:id/refunds
  const postRefundMatch = norm.match(/^\/orders\/([^\/]+)\/refunds$/);
  if (postRefundMatch && method === 'POST') {
    const oId = decodeURIComponent(postRefundMatch[1]);
    const rId = body.refund_id;
    const refundDoc = {
      cf_refund_id: `cf_rfnd_${crypto.randomBytes(8).toString('hex')}`,
      refund_id: rId,
      order_id: oId,
      refund_amount: body.refund_amount,
      refund_currency: 'INR',
      refund_status: 'SUCCESS',
      refund_note: body.refund_note,
      refund_splits: body.refund_splits || [],
      created_at: new Date().toISOString()
    };
    mockStore.refunds.set(rId, refundDoc);
    return Promise.resolve(refundDoc);
  }

  // 8. GET /orders/:id/refunds/:rid
  const getRefundMatch = norm.match(/^\/orders\/([^\/]+)\/refunds\/([^\/]+)$/);
  if (getRefundMatch && method === 'GET') {
    const rId = decodeURIComponent(getRefundMatch[2]);
    const hit = mockStore.refunds.get(rId);
    if (!hit) throw new CashfreeError(404, `Refund ${rId} not found`, 'REFUND_NOT_FOUND');
    return Promise.resolve(hit);
  }

  return Promise.resolve({ ok: true, simulated: true });
}

module.exports = {
  CashfreeError,
  getEnvConfig,
  createOrder,
  getOrder,
  getOrderPayments,
  payOrderSession,
  verifyWebhookSignature,
  createOrUpdateVendor,
  getVendor,
  getVendorSettlements,
  createRefund,
  getRefund,
  cfRequest,
  _mockStore: mockStore
};
