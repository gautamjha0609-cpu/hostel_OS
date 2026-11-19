# Sarvlekh Configurable Business Rules Engine Architecture

## 1. Architectural Philosophy & Mission

Hostels and PG accommodations across India operate on radically diverse business policies:
- Property A bills strictly on the 1st of every calendar month with 5 days grace.
- Property B bills on each resident's individual joining date anniversary (e.g. 15th to 14th).
- Property C shares a room electricity meter pro-rata among occupants by actual occupancy days.
- Property D maintains individual sub-meters per bed.
- Property E includes compulsory mess catering with fixed monthly fees and leave rebates.
- Property F offers optional meal plans or a per-meal consumption model.

Sarvlekh solves this problem through a declarative **Configurable Business Rules Engine** without requiring bespoke code changes or hardcoded conditionals per customer.

---

## 2. Progressive Configuration UX Architecture

To prevent owners and managers from feeling overwhelmed, the configuration surface is organized into **9 structured domains** with a progressive disclosure model (**Simple Defaults → Advanced Options**):

```
┌─────────────────────────────────────────────────────────────┐
│                 Sarvlekh Business Settings                  │
├──────────────────────────────┬──────────────────────────────┤
│ 1. Property & General Rules  │ 6. Check-in & Checkout       │
│ 2. Rent & Billing            │ 7. Staff & Permissions       │
│ 3. Deposits & Late Fees      │ 8. Agreements & Comms        │
│ 4. Electricity & Utilities   │ 9. Other Charges & Services  │
│ 5. Mess & Food Operations    │                              │
└──────────────────────────────┴──────────────────────────────┘
```

Each category provides:
1. **Plain-English Explanations** free from technical jargon.
2. **Contextual Live Previews** showing real-time calculations before saving.
3. **Audit Tracking & Policy Versioning** (`policyVersion`, `effectiveDate`).
4. **Preset Business Templates** for 1-click property initialization.

### Built-in Business Templates
- `standard_pg`: Calendar monthly (1st of month), pro-rata check-in, shared electricity meter, compulsory mess.
- `student_hostel`: Calendar monthly, 2-month deposit, room free units, compulsory mess, strict roll-call attendance.
- `working_pg`: Joining-date anniversary billing, 1-month deposit, optional mess, 15-day notice period.
- `coliving`: Calendar monthly, slab-based electricity pricing, per-meal/optional mess, amenities fees, digital check-in.
- `custom`: Bespoke property policies.

---

## 3. Four-Tier Configuration Hierarchy

Configuration settings resolve dynamically through a deterministic 4-level inheritance model:

```
Platform System Defaults (DEFAULT_SETTINGS)
                 ↓
Organization Defaults (org.settings)
                 ↓
Individual Hostel Overrides (hostel.settings)
                 ↓
Resident-Specific Exceptions (resident.billingPolicy)
```

### Resolution Rules:
- **Fallback Guarantee**: If a setting key is omitted at lower tiers, it gracefully inherits from the parent tier down to `DEFAULT_SETTINGS`. Existing customer data without new schema fields continues functioning with zero breaking changes.
- **Auditable & Immutable Financial History**: Setting changes do not rewrite previously generated invoices or payments. Historical invoices record a `policySnapshot` containing the billing model and formula active at invoice creation.
- **Targeted Override**: Individual resident exceptions (`r.billingPolicy`) allow special accommodations (e.g. customized rent due date or negotiated deposit structure) without altering property-wide rules.

---

## 4. Rent & Billing Engine

### 4.1 Billing Models Supported

1. **Calendar Monthly (`calendar_monthly`)**:
   - Cycle begins on a configured day of the month (default: 1st).
   - Invoices generated with cycle ID `inv-rent-${resId}-${ym}`.
   - Configurable due dates and grace periods.

2. **Joining-Date Anniversary (`joining_date`)**:
   - Each resident's billing cycle is anchored to their check-in day.
   - Example: Resident joins on 15 November; billing cycle runs 15 November to 14 December.
   - **Deterministic End-of-Month Clamping**:
     - Handles 28, 29, 30, and 31-day months deterministically.
     - A resident joining on January 31 will have their February cycle start on February 28 (or February 29 in leap years).
     - Cycle end is always clamped to the day immediately preceding the next anniversary.
   - Invoices generated with cycle ID `inv-rent-${resId}-${cycleStart}`.

### 4.2 Mid-Month Check-In Calculation Engine (`calcCheckInRent`)
When a resident checks in mid-cycle, the system calculates the initial rent according to the configured policy:
- **Actual Calendar Days Pro-Rata (`actual_days`)**:
  $$\text{Amount} = \frac{\text{Monthly Rent} \times \text{Occupied Days}}{\text{Days in Month}}$$
  *Example*: Check-in on 15 Nov (30-day month), Rent ₹8,000 → Occupied: 16 days → Rent = ₹4,266.67.
- **Commercial 30-Day Divisor (`fixed_30`)**:
  $$\text{Amount} = \frac{\text{Monthly Rent} \times \text{Occupied Days}}{30}$$
  *Example*: Check-in on 15 Jan (31-day month), Rent ₹8,000 → Occupied: 17 days → Rent = ₹4,533.33.
- **Full Monthly Rent (`full`)**: Charges full monthly rent regardless of check-in day.
- **Start Next Cycle (`next_cycle`)**: Sets initial rent to ₹0 and initiates billing on the next cycle.
- **Custom Adjustment**: Manual agreed first-cycle amount.

### 4.3 Checkout & Mid-Cycle Settlement Engine (`calcSettlement`)
Checkout generates an itemized settlement statement and closes the resident record without destroying financial history:
- **Deposit Paid Calculation**: Sum of paid deposit invoices plus active advance credits.
- **Outstanding Dues Calculation**: Unpaid rent, electricity, mess, and laundry invoices.
- **Notice Period Shortfall Penalty**:
  $$\text{Shortfall Days} = \max(0, \text{Required Notice Days} - \text{Notice Days Served})$$
  $$\text{Shortfall Fee} = \left(\frac{\text{Monthly Rent}}{\text{Days in Month}}\right) \times \text{Shortfall Days}$$
- **Deduction Safety Cap**: Prevents property managers from entering arbitrary deductions that exceed available deposit and credit:
  $$\text{Deductions} \le \text{Deposit Paid} + \text{Credit}$$
- **Final Net Refund / Payable**:
  $$\text{Net Refund} = \max(0, (\text{Deposit Paid} + \text{Credit}) - (\text{Dues} + \text{Deductions} + \text{Shortfall Fee}))$$

---

## 5. Electricity & Utility Configuration Engine

### 5.1 Sharing Architectures
1. **Shared Room Meter (`shared_room`)**:
   - Single meter per room. Units split across active residents weighted by their actual days lived during the meter reading cycle.
2. **Individual Meter (`individual`)**:
   - Bed-specific registered meter billing directly to the individual resident.
3. **Property-Level Meter (`property_level`)**:
   - Central building meter allocated across rooms and residents.

### 5.2 Pricing Engines (`calcElectricityCost`)
- **Fixed Per-Unit Rate**: $\text{Cost} = (\text{Units} \times \text{Rate}) + \text{Fixed Charge}$.
- **Tiered Slab Pricing**:
  Supports multi-tier utility tariffs (e.g. 0-50 units @ ₹7, 51-150 units @ ₹9, 151+ units @ ₹12):
  $$\text{Cost} = \sum (\text{Billed Units in Slab}_i \times \text{Rate}_i) + \text{Fixed Monthly Charge}$$
- **Free Units Pooling**:
  Supports free units allocated **per resident** (multiplied by occupancy factor) or **per room**.

### 5.3 Audit Integrity (Manual vs OCR Readings)
- **OCR Evidence Preservation**: Browser camera captures physical meter image; 7-segment digit pattern analyzer extracts reading; original image URL and OCR confidence are logged.
- **Manual Reading Audit Trail**: When entered manually, records are permanently stamped with `isManual: true` and `capturedBy: "Staff Name"`.
- **Downward Reading Fraud Protection**: Lower readings than the prior recorded cycle are rejected unless accompanied by an authorized correction reason and manager-level permission.

---

## 6. Mess & Food Operations Engine

- **Billing Modes**:
  - `included`: Factored into base rent.
  - `compulsory`: Dedicated monthly mess invoice generated during billing cycle.
  - `optional`: Subscribed per resident (`r.food !== false`).
  - `per_meal`: Variable consumption billing based on meal rates.
- **Cutoff Enforcement (`canSkipMeal`)**:
  - Evaluates real-time cut-off thresholds (e.g. Breakfast skip cutoff: 22:00 previous evening). Prevents food waste while respecting resident flexibility.
- **Leave Rebate Engine (`calcMessRebate`)**:
  - Automatically calculates mess rebate credits for residents on verified leave exceeding `minLeaveDays` (e.g. ₹100/day for leave $\ge$ 3 days).

---

## 7. Security Deposits & Late Fees

- **Deposit Modes (`calcDepositAmount`)**:
  - `fixed`: Static configured rupee amount.
  - `rent_multiple`: Multiplier of resident monthly rent (e.g. 1x or 2x rent).
  - `per_bed`: Room-bed specific baseline.
  - `nonRefundable`: Explicit separation between refundable deposit and non-refundable maintenance/admission fees.
- **Late Fee Rules (`calcLateFee`)**:
  - `graceDays`: Days after due date before penalty triggers.
  - Modes: `fixed` (flat fine), `daily` (fine per day overdue), `percentage` (percentage of overdue principal).
  - `maxCap`: Mandatory ceiling preventing runaway, compounding, or usurious penalty accumulation.

---

## 8. Role-Based Staff Permission Matrix (`canAction`)

Sensitive hostel operations enforce granular role-based authorization without privilege escalation:

| Operation | Owner | Manager | Warden | Accountant | Cook | Housekeeping | Guard |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **View Dashboards & Invoices** | ✅ | ✅ | ✅ | ✅ | ✅ (Mess) | ✅ (Rooms) | ✅ (Gate) |
| **Create Records (Gate/Readings)** | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ (Gate) |
| **Edit Non-Financial Records** | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Correct Meter Readings** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Approve Check-ins / Payments** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Issue Refunds / Settlements** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Delete Invoices / Records** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Modify Business Settings** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## 9. Safe Billing Automation & Idempotency (`runMonthlyBillingBatch`)

Monthly billing execution is fully idempotent and resilient to partial failures:
1. **Deterministic Unique Invoice IDs**:
   - Rent: `inv-rent-${resId}-${periodKey}`
   - Mess: `inv-mess-${resId}-${ym}`
   - Additional Charges: `inv-chg-${chargeId}-${resId}-${ym}`
2. **Double-Invoicing Guard**:
   - `Store.get(cycleId)` verifies prior existence. Re-running the batch produces `invoicesCreated: 0` and `invoicesSkipped: N`.
3. **Audit History & WhatsApp Summaries**:
   - Returns a structured batch report containing billed amounts, breakdown per resident, and pre-formatted WhatsApp payment links.
