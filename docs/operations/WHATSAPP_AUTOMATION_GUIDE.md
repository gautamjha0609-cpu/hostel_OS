# WhatsApp Automation & Messaging Operating Guide

## 1. Executive Summary & WhatsApp Reality

WhatsApp is the undisputed primary communication medium between Indian PG/hostel owners and residents. However, bulk WhatsApp messaging carries severe operational and legal pitfalls:
- **Robotic Web Scraping & Unofficial Tools (e.g. Selenium/Puppeteer bots)**: Meta aggressively detects unauthorized automated traffic from personal or unverified numbers, resulting in instant permanent phone number bans.
- **Cost Considerations of Meta Cloud API**: The official Meta WhatsApp Business Cloud API charges per conversation (utility, marketing, authentication). For a 200-bed hostel sending weekly reminders, costs can accumulate if mismanaged.

Sarvlekh implements a transparent, dual-mode WhatsApp communication architecture:
1. **Mode 1 (Free / Zero-Cost)**: **Sequential Click-to-Chat Sender Assistant** (via official `wa.me` links).
2. **Mode 2 (Automated Enterprise)**: **Official Meta WhatsApp Cloud API** (via pre-approved HSM templates).

---

## 2. Mode 1: Free Sequential Click-to-Chat Sender Assistant

### 2.1 How It Works
- Designed for 90% of PG owners who want zero per-message costs and want messages to originate from their personal or hostel phone number.
- **The Browser Reality**: Browsers cannot silently send WhatsApp messages in the background without user interaction. Opening 50 WhatsApp browser tabs simultaneously triggers pop-up blockers and crashes mobile browsers.
- **The Sarvlekh Solution**: The **Sequential Click-to-Chat Sender Assistant** modal guides the owner resident-by-resident with a streamlined, one-click interface:

```
┌─────────────────────────────────────────────────────────────┐
│          WhatsApp Monthly Reminder Assistant (2 / 45)       │
├─────────────────────────────────────────────────────────────┤
│ Resident: Suresh Kumar (+91 9876540001)                     │
│ Room: 101-A · Total Overdue: ₹8,200                         │
│ Breakdown: Rent ₹7,500. Electricity ₹700                    │
│                                                             │
│ Message Preview:                                            │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Hello Suresh, your Apr 2026 dues for Sarvlekh Elite PG  │ │
│ │ are ₹8,200. Rent: ₹7,500. Electricity: ₹700.            │ │
│ │ Pay online: https://sarvlekh.in/pay/res-b1              │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ [ 🚀 Open WhatsApp (wa.me) ]     [ Skip → ]     [ Stop ]    │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Advantages & Ban Protection
- **Zero Risk of Meta Ban**: Each message opens genuine WhatsApp Web or the WhatsApp desktop/mobile app. The owner taps the official green "Send" arrow.
- **Truthful Audit Logging**: The ledger accurately logs `Payment reminder (wa.me opened)`. It never falsely claims a message was delivered when it was merely opened.
- **Zero Financial Cost**: 100% free forever without third-party aggregator subscriptions or Meta conversation fees.

---

## 3. Mode 2: Official Meta WhatsApp Cloud API

### 3.1 Architecture & Setup
For enterprise co-living operators and large student hostel networks (500+ beds) that require hands-off, automated background dispatch:
1. The client establishes a verified Meta Business Manager account.
2. A dedicated WhatsApp Business Phone Number is provisioned.
3. Templates are submitted and pre-approved by Meta in the **Utility** category.
4. Sarvlekh stores the credentials securely server-side:
   - `META_WA_PHONE_NUMBER_ID`
   - `META_WA_ACCESS_TOKEN`
   - `META_WA_WABA_ID`
5. Automated background jobs (nightly cron, invoice generation triggers) dispatch templates via Meta Graph API v19.0.

### 3.2 Pre-Approved Utility Templates
Meta strictly requires HSM (High Structured Message) templates for business-initiated conversations outside the 24-hour service window:

#### Template: `rent_invoice_notification_v2`
- **Category**: `UTILITY`
- **Language**: `en`, `hi`
- **Body**:
  > "Hello {{1}}, your {{2}} rent bill of Rs. {{3}} for {{4}} is now available. Due date: {{5}}. Room: {{6}}. Please review and pay using your resident portal: {{7}}"
- **Button**: Quick Pay (`URL: {{8}}`)

#### Template: `payment_receipt_v1`
- **Category**: `UTILITY`
- **Body**:
  > "Dear {{1}}, we have received your payment of Rs. {{2}} on {{3}} towards {{4}}. Balance remaining: Rs. {{5}}. Thank you for choosing {{6}}."

### 3.3 Meta Conversation Pricing (India)
- **Utility Conversations**: ~₹0.30 to ₹0.35 per 24-hour conversation window.
- **Service Conversations (Resident Initiated)**: Free up to 1,000 service conversations per month.
- **Marketing / Promotional**: ~₹0.75 to ₹0.85 per conversation (strictly avoided for routine billing reminders).

---

## 4. Bulk WhatsApp Reminder Center Operations

Under **Payments** → **Monthly Billing & WhatsApp**:
1. **Batch Generation**:
   - The manager selects the target billing month (e.g. `2026-04`).
   - The engine validates active residents, computes rent, electricity, mess, and recurring charges.
   - Generates invoices idempotently (skipping existing ones).
2. **Review & Dispatch**:
   - Displays a complete summary table of all residents, room numbers, dues breakdown, and message previews.
   - If **Official API** is active, a single button triggers parallel server-side dispatch with rate limiting (5 messages/second).
   - If **Click-to-Chat** is active, launches the sequential assistant allowing the warden or manager to dispatch 50 reminders in under 3 minutes.
3. **Audit History**:
   - Every dispatch is permanently timestamped in the activity audit log with the resident ID, phone number, and dispatched text snippet.
