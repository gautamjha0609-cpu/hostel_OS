# Payment Provider & Automated Reconciliation Evaluation

## 1. Executive Summary

Hostel owners prioritize three payment requirements:
1. **Zero or Minimal Transaction Costs**: Traditional payment gateway MDR fees (1.5% - 2%) are prohibitive for high-ticket monthly rent payments (e.g. ₹200 fee on ₹10,000 rent).
2. **Instant Settlement to Bank Account**: Owners need cash flow to cover daily operational costs (groceries, utilities, cook salaries). Funds cannot remain locked in escrow for multiple days.
3. **Automated Reconciliation**: Eliminating manual screenshots, UTR chasing, and spreadsheet verification.

This document evaluates the leading Indian payment provider options: **Cashfree**, **Razorpay**, **Setu (Pine Labs)**, and **Direct Static UPI QR**.

---

## 2. Comparative Matrix

| Feature | Cashfree (Recommended) | Razorpay | Setu (Pine Labs) | Direct UPI QR (Static) |
| :--- | :--- | :--- | :--- | :--- |
| **UPI Collection MDR** | **0% for verified UPI QR** | 0% - 1.8% (depends on contract) | 0% + fixed per-API fee | **0% (100% Free)** |
| **Credit Card / NetBanking MDR**| 1.90% - 1.95% | 2.0% + GST | 1.85% - 2.0% | N/A |
| **Sub-Merchant / Split Settlement** | **Easy Split / Multi-Vendor** | Route / Sub-accounts | Co-lending / Escrow APIs | N/A (Direct to 1 VPA) |
| **Direct Settlement to Owner Bank** | **Yes (T+1 or Instant via IMPS)** | Yes (T+1 or T+2) | Yes (T+1) | **Instant (Direct)** |
| **Settlement Intermediary Risk** | Direct nodal account compliant | Direct nodal account compliant | RBI-regulated BBPS / TSP | None (P2P / P2M directly) |
| **Dynamic UPI QR Generation** | Supported via API / Webhook | Supported via Payment Links API | Supported via UPI DeepLinks | N/A (Static QR only) |
| **Real-time Webhook Notification** | **Yes (HMAC-SHA256)** | **Yes (HMAC-SHA256)** | Yes (HMAC-SHA256) | No (Manual UTR check) |
| **Onboarding & KYC Complexity** | Low-Medium (Digital KYC) | Medium-High | High (Enterprise focus) | **Zero (Existing UPI ID)** |
| **Integration Complexity** | Simple REST API + Webhooks | Simple REST API + Webhooks | SDK / API Suite | Trivial |

---

## 3. Deep Dive: Cashfree Zero-Cost UPI QR & Easy Split Architecture

### 3.1 Commercial Terms & MDR Reality
- **UPI Collections**: Cashfree provides **0% MDR** on standard UPI peer-to-merchant collections when processed via UPI Dynamic QR or intent links.
- **Auto-Debit (UPI Mandate / eNACH)**: Supported for recurring monthly rent with a flat fee (typically ₹5 to ₹10 per successful debit).
- **Payment Link Generation**: Included without monthly subscription fees.

### 3.2 Easy Split (Sub-Merchant Architecture)
In a multi-hostel SaaS platform, collecting all rent into Sarvlekh's central company account and then disbursing to hostel owners introduces significant regulatory, legal, and operational overhead:
1. **RBI Payment Aggregator (PA) Guidelines**: Holding funds in a platform account without a formal RBI Payment Aggregator license violates RBI directions on payment intermediaries.
2. **GST & Accounting Liabilities**: Rent flowing through platform bank accounts appears on Sarvlekh's balance sheet as gross turnover, creating severe tax audits and reconciliation complexity.

**Cashfree Easy Split Solution**:
- Each hostel owner completes an automated digital sub-merchant onboarding process within Sarvlekh.
- Rent payments made by residents via Cashfree Dynamic QR flow into an RBI-regulated settlement escrow.
- Cashfree automatically routes **100% of the rent directly to the hostel owner's registered bank account** on a T+1 schedule (or instant payout via Cashfree Payouts API).
- Sarvlekh's optional software SaaS fee (e.g. ₹50/bed/month) can be split and deducted automatically at source, completely eliminating manual billing between Sarvlekh and hostel owners.

### 3.3 Dynamic QR & Webhook Ledger Reconciliation
When an invoice is issued or viewed in the Resident Portal:
1. Sarvlekh requests a Dynamic UPI QR via Cashfree Orders API, tagged with:
   - `order_id`: `ord-${invoiceId}`
   - `order_amount`: Invoice outstanding balance
   - `customer_details`: Resident phone and name
2. Resident scans and pays using Google Pay, PhonePe, Paytm, or BHIM.
3. Cashfree sends an instant server-to-server webhook:
   ```json
   {
     "data": {
       "order": { "order_id": "ord-inv-rent-res1-2026-04" },
       "payment": {
         "cf_payment_id": "109823471",
         "payment_amount": 8000.00,
         "payment_status": "SUCCESS",
         "payment_time": "2026-04-01T10:15:30+05:30",
         "payment_method": { "upi": { "upi_id": "resident@okhdfcbank" } }
       }
     },
     "type": "PAYMENT_SUCCESS_WEBHOOK"
   }
   ```
4. **Signature Verification**: Sarvlekh verifies the `x-webhook-signature` using HMAC-SHA256 with the hostel's secret key.
5. **Idempotent Ledger Entry**: `processVerifiedPaymentWebhook` executes:
   - Verifies invoice existence.
   - Prevents duplicate ledger entries if webhook is replayed.
   - Marks invoice as paid.
   - Credits excess amounts to resident advance balance.
   - Logs an immutable audit event (`payment_webhook_received`).

---

## 4. Razorpay Evaluation

- **Pros**: Market leader, robust documentation, high uptime, ubiquitous brand familiarity among residents.
- **Cons**: Standard onboarding defaults to payment gateway charges (up to 2% MDR); securing true 0% UPI MDR requires customized commercial negotiation and sales approval.
- **Role in Sarvlekh**: Supported as a first-class secondary gateway adapter via `PaymentGateway` interface for owners with existing active Razorpay merchant accounts.

---

## 5. Direct Static UPI QR (Zero-Cost Baseline)

For small or budget PGs (under 20 beds) that do not wish to complete digital KYC with an aggregator:
- The owner simply enters their existing personal or business UPI VPA (e.g. `hostelowner@okaxis` or `9876543210@paytm`).
- Sarvlekh generates an on-the-fly standard NPCI-compliant UPI URI:
  ```
  upi://pay?pa=hostelowner@okaxis&pn=SarvlekhPG&am=8000.00&cu=INR&tn=Rent-Apr2026
  ```
- **Advantages**: 100% free, zero MDR, funds land instantly in the owner's bank account.
- **Reconciliation**: Resident clicks "I Have Paid" or submits UTR; owner approves in one click in Sarvlekh Inbox.

---

## 6. Implementation Architecture

The `PaymentGateway` adapter pattern implemented in `js/domain.js` and `api/public.js` allows switching or co-existing across providers seamlessly:

```javascript
const PaymentGateway = {
  PROVIDERS: ['direct_upi', 'cashfree', 'razorpay', 'setu'],
  createPaymentLink({ invoiceId, amount, resId, hostelId, provider = 'direct_upi' }) { ... },
  verifyWebhookSignature({ payload, signature, secret, provider = 'razorpay' }) { ... }
};
```

This multi-provider architecture ensures Sarvlekh remains vendor-independent, regulatory-compliant, and fully cost-optimized.
