# Meta template for the monthly bill

On the official WhatsApp Cloud API a business can only start a chat with a template Meta has approved.

1. In Meta Business Manager > WhatsApp > Message templates, create a template:
   - Category: **Utility** (not Marketing - it costs about 2.5x more)
   - Name: `sarvlekh_monthly_bill`, Language: English
   - Body (the four variables must be in this order):

     `Hello {{1}}, your monthly bill at {{2}} is {{3}}. View the details and pay here: {{4}}`

2. Wait for "Approved".
3. Super Admin sets the hostel's `settings.wa.monthly.template` to `sarvlekh_monthly_bill`
   (and `language` if it is not `en`).
4. With no template name the app sends plain text, which Meta accepts only inside the 24-hour window.
   Any message that fails is handed back to the owner in Approvals for one-tap sending.

Not tested against Meta (no keys yet): only the payload shape is covered by tests/automation_super_only.test.js.
