# Post-launch tracker

Features decided (2026-10-05) to come **after** launch. Nothing here blocks the first release.
Launch work lives in `pre-launch-audit.md`; hosting, releases and billing in
`remaining-work-plan.md`. Tick an item off here when it ships, and add a line to the log at
the end.

---

## Deferred by decision

### [ ] 1. E-invoicing (IRN) and e-way bills

- **Why:** GST e-invoicing is mandatory for B2B invoices once a business's aggregate turnover
  passes ₹5 crore. E-way bills are needed when goods worth over ₹50,000 move. Small shops need
  neither.
- **What:**
  - Generate the IRN and signed QR through an IRP (directly or via a GSP), print them on B2B
    invoices, and cancel within 24 hours.
  - Generate an e-way bill from an invoice or a stock transfer (Part A, with vehicle details
    for Part B).
- **Until then:** the sign-up page and website should say the product is for businesses below
  the e-invoicing limit.

### [ ] 2. Loyalty points

- **Why:** regular customers expect points or rewards.
- **What:**
  - Earn points per rupee spent (a business setting) and redeem them at checkout as a payment
    or discount.
  - Points expire after a set time, show on the bill, and are reversed on returns.
- **Note:** customers already have a prepaid wallet, which may be reused for redemption.

### [ ] 3. Offers and promotions

- **Why:** many shops run schemes, and their absence will be noticed.
- **What:**
  - Buy X get Y, combo prices, quantity breaks (e.g. 3 for ₹100) and customer-group prices.
  - Each offer has dates and branches. Offers apply at the counter automatically, with the
    saving shown on the bill.
- **Note:** discounts already exist (line and bill discounts, with a cashier limit). Offers
  must work with GST on the discounted value (A5) and with MRP checks (A6).

---

## Fine to add after launch

### [ ] 4. Stock count (stocktake) screen

- **Why:** today stock is corrected one item at a time with adjustments.
- **What:**
  - Start a count for a branch (all items, or a category), enter or scan the counted
    quantities, and review the differences with their value.
  - Posting the count makes one adjustment per item, with batches where items track them.

### [ ] 5. Purchase orders

- **Why:** to order from suppliers and check deliveries against the order.
- **What:**
  - Purchase orders to a supplier, which can be sent (PDF or email).
  - Turn a received order into a purchase, in parts if needed, and list what's still pending.
  - Can start from the low-stock list.

### [ ] 6. Quotations and delivery challans

- **Why:** B2B and wholesale customers ask for estimates, and goods sometimes leave before
  they are billed.
- **What:**
  - Quotations, with their own numbering, that can be printed and turned into a bill.
  - Delivery challans (goods sent without a sale; GST rules for challans), turned into a bill
    later.

### [ ] 7. Sending receipts by SMS or WhatsApp

- **Why:** today the receipt is downloaded and shared by hand. Email already works.
- **What:** send a link to the bill, or a PDF, through an SMS or WhatsApp Business provider.
  Needs DLT-registered templates for SMS in India, and costs per message.

### [ ] 8. Two-step sign-in for admins and owners

- **Why:** admin and owner accounts can see and change everything.
- **What:** authenticator-app codes (TOTP) with recovery codes, optional at first, then
  required for owners. Deleting a business already asks for an emailed code.

### [ ] 9. Customer-facing display

- **Why:** customers like to see the items and the total as they are rung up.
- **What:** a second window or screen in the desktop app showing the cart, the total and a UPI
  QR code. Pole displays can come later.

---

## Log

- 2026-10-05: Tracker started. E-invoicing, loyalty, offers and promotions were deferred, as
  were the six "fine to add after launch" items.
