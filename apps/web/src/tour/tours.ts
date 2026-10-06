/**
 * The guided tour of each screen: what to look at, in order. A step points at an element marked
 * `data-tour="…"` on that screen; steps whose element isn't on screen (a button this user may not
 * use, an empty list, a narrow window) are left out when the tour starts. `gif` names a short
 * recording in ./gifs (made by `pnpm --filter @pos/web tour:gifs`) that plays in the step.
 */
export type TourStep = {
  /** The `data-tour` value of the element to point at; none for a step in the middle of the screen. */
  target?: string;
  title: string;
  body: string;
  gif?: string;
  placement?: "top" | "bottom" | "left" | "right" | "auto" | "center";
};

export type PageTour = { title: string; steps: TourStep[] };

/** Shown at the end of someone's first tour: where to find the tours again. */
export const HELP_BUTTON_STEP: TourStep = {
  target: "help-button",
  title: "Help is always here",
  body: "Press ? on any screen to see its tour again.",
  placement: "left",
};

const NAV_STEP: TourStep = {
  target: "nav",
  title: "Every screen, one click away",
  body: "Selling, sales and returns are under Operations; items, stock and suppliers under Catalog. A lock means the screen needs an open register first.",
  placement: "right",
};

export const PAGE_TOURS: Record<string, PageTour> = {
  "/open-register": {
    title: "Open Register",
    steps: [
      {
        title: "Welcome! Let's open the till",
        body: "Before you can sell, open a register: pick a counter and count the cash in its drawer. It takes a few seconds.",
        gif: "open-register",
        placement: "center",
      },
      { target: "register-branches", title: "Choose the branch", body: "With more than one branch, pick the one you are working at." },
      {
        target: "register-counters",
        title: "Pick a free counter",
        body: "Each counter is one till. Green ones are free; one in use shows who has it open.",
      },
      {
        target: "register-float",
        title: "Count the opening cash",
        body: "Enter the cash already in the drawer. When you close the register, the app tells you if the drawer is short or over.",
      },
      {
        target: "register-open",
        title: "Open it and start selling",
        body: "Press Open and you go straight to the Point of Sale screen.",
        placement: "right",
      },
      NAV_STEP,
    ],
  },

  "/pos": {
    title: "Point of Sale",
    steps: [
      {
        target: "pos-new-order",
        title: "Start a new order",
        body: "Every sale starts here: add the products, pick the customer if you need to, and take the payment.",
        gif: "pos-checkout",
        placement: "right",
      },
      {
        target: "pos-scan",
        title: "Scan or type a code",
        body: "Scan a barcode, or type an item's code and press Enter. Scan it again to add one more.",
        gif: "pos-add-items",
      },
      { target: "pos-search", title: "Search by name", body: "Type part of a product's name to find it in the grid below." },
      { target: "pos-categories", title: "Browse by category", body: "Tap a category to see only its products." },
      {
        target: "pos-products",
        title: "Tap a product to add it",
        body: "Each tile shows the price and how many are left in stock. Tap it to put one in the cart.",
        placement: "left",
      },
      {
        target: "pos-cart",
        title: "The cart",
        body: "Use + and − to change the quantity. Tap a line to change its price, unit or discount.",
        placement: "right",
      },
      { target: "pos-totals", title: "Totals and discount", body: "Taxes and the total update as you go. Edit gives a discount on the whole bill.", placement: "right" },
      {
        target: "pos-customer",
        title: "Who is buying?",
        body: "Bills go to a walk-in customer unless you pick one. Pick a customer to sell on credit, use their wallet or put their GSTIN on the bill.",
        placement: "right",
      },
      {
        target: "pos-pay",
        title: "Take the payment",
        body: "Proceed to Payment, enter what the customer gives (cash, card, UPI or a mix) and Validate. The change to give back is shown. Hold keeps the cart for later.",
        gif: "pos-checkout",
        placement: "right",
      },
      { target: "pos-held", title: "Held orders", body: "Carts you held or left are kept here on this computer. Resume one to finish it.", placement: "right" },
      {
        target: "nav-register",
        title: "End of the day",
        body: "Close Register counts the cash and ends your shift. Cash In / Out, when you have it, records money taken from or put in the drawer.",
        placement: "right",
      },
    ],
  },

  "/sales": {
    title: "Sales",
    steps: [
      { target: "sales-counts", title: "Bills at a glance", body: "Pending counts bills with money still to collect.", placement: "right" },
      {
        target: "sales-filters",
        title: "Find any bill",
        body: "Search by invoice number, customer or staff, or show only pending or settled bills.",
        gif: "sales-find-bill",
        placement: "right",
      },
      { target: "sales-list", title: "Pick a bill", body: "The newest bills come first. Pick one to see it on the right.", placement: "right" },
      { target: "sales-details", title: "What was sold", body: "The items, taxes and payments of the bill, with a preview of its receipt.", placement: "left" },
      {
        target: "sales-actions",
        title: "Reprint or collect",
        body: "Print the receipt again, show it as a full-page A4 invoice, or Settle to take money still owed on a bill.",
        placement: "bottom",
      },
    ],
  },

  "/returns": {
    title: "Returns",
    steps: [
      {
        target: "returns-new",
        title: "Take a return",
        body: "Find the bill, enter how many of each item came back and why. The goods go back into stock and you choose how to refund.",
        gif: "returns-new",
      },
      { target: "returns-list", title: "Returns made", body: "Every return at this branch, newest first.", placement: "right" },
      { target: "returns-details", title: "Return details", body: "Pick a return to see what came back and to print its receipt.", placement: "left" },
    ],
  },

  "/items": {
    title: "Items",
    steps: [
      {
        target: "items-new",
        title: "Add an item",
        body: "Give it a code, a name, a price and its GST rate. It shows on the Point of Sale screen straight away.",
        gif: "items-new",
      },
      { target: "items-variants", title: "Sizes and colours", body: "A product sold in sizes or colours: add every variant in one go." },
      { target: "items-import", title: "Many items at once", body: "Import your item list from a CSV or Excel file.", placement: "right" },
      { target: "items-search", title: "Find an item", body: "Search by name, code, category or unit.", placement: "right" },
      { target: "items-list", title: "Your items", body: "Pick an item to see its details on the right.", placement: "right" },
      {
        target: "items-actions",
        title: "Change an item",
        body: "Edit its price or details, print barcode labels for it, or delete it if it was never sold.",
        placement: "bottom",
      },
    ],
  },

  "/items/import": {
    title: "Import Items",
    steps: [
      {
        target: "import-template",
        title: "1. Fill in the template",
        body: "Download the template and fill it in, one item a row. A row with a code you already have updates that item.",
      },
      {
        target: "import-file",
        title: "2. Choose the file",
        body: "Pick your CSV or Excel file. You see every row and any problem before anything is saved.",
      },
      { target: "import-columns", title: "What each column means", body: "Open this for what to put in each column.", placement: "top" },
    ],
  },

  "/customers": {
    title: "Customers",
    steps: [
      {
        target: "customers-new",
        title: "Add a customer",
        body: "A name and phone is enough. Add a GSTIN for business buyers, and a credit limit to let them pay later.",
        gif: "customers-new",
      },
      { target: "customers-owed", title: "Who owes you", body: "Everything customers owe, by how long it has been due." },
      { target: "customers-search", title: "Find a customer", body: "Search by name, phone or customer code.", placement: "right" },
      {
        target: "customers-details",
        title: "Their account",
        body: "Pending bills, what they owe and their wallet balance, all in one place.",
        placement: "left",
      },
      { target: "customers-statement", title: "Statement", body: "Every bill and payment with the balance after each, ready to print or email.", placement: "left" },
      {
        target: "customers-wallet",
        title: "Wallet credit",
        body: "Money a customer leaves with you. They can pay with it at the counter.",
        placement: "right",
      },
    ],
  },

  "/expenses": {
    title: "Expenses",
    steps: [
      {
        target: "expenses-add",
        title: "Record an expense",
        body: "Rent, electricity, tea for the staff: note what was paid, how and when. Cash from the drawer lowers the cash expected at close.",
        gif: "expenses-add",
      },
      { target: "expenses-period", title: "Choose the dates", body: "See the expenses paid between two dates." },
      { target: "expenses-total", title: "Totals by category", body: "What was spent in the period, and on what.", placement: "right" },
      { target: "expenses-list", title: "Each expense", body: "Every expense in the period. Remove one entered by mistake.", placement: "top" },
    ],
  },

  "/stock": {
    title: "Inventory",
    steps: [
      { target: "stock-search", title: "Find an item", body: "Search, and sort by how much is in stock.", placement: "right" },
      { target: "stock-list", title: "What's on hand", body: "How many of each item this branch has. Pick one to manage it.", placement: "right" },
      { target: "stock-item", title: "The item's stock", body: "On hand, its reorder level and what it costs.", placement: "bottom" },
      {
        target: "stock-actions",
        title: "Correct the count",
        body: "Set the opening stock once. After that, use Stock Adjustment for damage, losses or a recount, with a reason.",
        gif: "stock-adjust",
      },
      { target: "stock-low", title: "Running low", body: "Items at or below their reorder level, to order again.", placement: "top" },
      { target: "stock-expiry", title: "Expiring soon", body: "Batches close to their expiry date.", placement: "top" },
    ],
  },

  "/purchases": {
    title: "Purchases",
    steps: [
      {
        target: "purchases-supplier",
        title: "Who supplied the goods",
        body: "Pick the supplier (or add a new one) and note their invoice number and date.",
        gif: "purchases-new",
      },
      {
        target: "purchases-lines",
        title: "What came in",
        body: "Add each item with the quantity received and its cost. Stock goes up when you save.",
        placement: "top",
      },
      { target: "purchases-save", title: "Save the purchase", body: "It adds the stock and what you owe the supplier.", placement: "top" },
      { target: "purchases-recent", title: "Recent purchases", body: "Open one to see it, or to send goods back to the supplier.", placement: "top" },
    ],
  },

  "/suppliers": {
    title: "Suppliers",
    steps: [
      { target: "suppliers-new", title: "Add a supplier", body: "Their name, GSTIN and payment terms. Suppliers are also added when you record a purchase." },
      { target: "suppliers-search", title: "Find a supplier", body: "Search by name or GSTIN.", placement: "right" },
      { target: "suppliers-list", title: "What you owe", body: "Each supplier with the amount you owe them and anything overdue.", placement: "right" },
      {
        target: "suppliers-account",
        title: "Pay a supplier",
        body: "Pick a supplier to see their purchases and payments, and record what you pay them.",
        gif: "suppliers-pay",
        placement: "left",
      },
    ],
  },

  "/labels": {
    title: "Barcode Labels",
    steps: [
      {
        target: "labels-add",
        title: "Choose the items",
        body: "Search for each item to label. Items without a barcode get their item code, which the counter scans too.",
        gif: "labels-print",
      },
      { target: "labels-lines", title: "How many of each", body: "Set the number of labels for each item." },
      { target: "labels-options", title: "Label size and contents", body: "Pick your label roll or sheet and what to print on it.", placement: "left" },
      { target: "labels-print", title: "Print", body: "In the print dialog pick the label printer, set margins to none and scale to 100%.", placement: "left" },
    ],
  },

  "/transfers": {
    title: "Transfers",
    steps: [
      { target: "online-only", title: "Stock transfers", body: "Moving stock between branches works once the business is online." },
      { target: "transfers-incoming", title: "Arriving here", body: "Transfers on their way to this branch. Receive one when the goods arrive." },
      { target: "transfers-send", title: "Send stock", body: "Choose the branch and the items. The stock leaves here now and is added there when received.", placement: "top" },
      { target: "transfers-history", title: "History", body: "Every transfer received or cancelled.", placement: "top" },
    ],
  },

  "/reports": {
    title: "Reports",
    steps: [
      { target: "reports-branch", title: "One branch or all", body: "See the figures for a single branch or the whole business.", placement: "left" },
      { target: "reports-periods", title: "How you're doing", body: "Net sales and gross profit for today, this week, this month and all time." },
      { target: "reports-breakdown", title: "The breakdown", body: "Tax, returns, cost of goods, and money collected by cash, card and UPI.", placement: "top" },
    ],
  },

  "/gst": {
    title: "GST Returns",
    steps: [
      {
        target: "gst-options",
        title: "Pick the return and period",
        body: "Choose GSTR-1, GSTR-3B or a composition return, the GSTIN and the month or quarter. The figures come from the sales and returns recorded here.",
      },
      {
        title: "Check before you file",
        body: "Fix anything flagged, download the file for the GST portal, and have your accountant review it before filing.",
        placement: "center",
      },
    ],
  },

  "/activity": {
    title: "Activity",
    steps: [
      { target: "activity-filter", title: "Filter the log", body: "Show only one kind of change, like price changes or cancelled bills.", placement: "left" },
      { target: "activity-log", title: "Who did what", body: "Every important change, newest first. Open one for the details.", placement: "top" },
    ],
  },

  "/settings": {
    title: "Settings",
    steps: [
      {
        target: "settings-tab-business",
        title: "Your business",
        body: "Name, GST number, logo, rounding and discount limits for the whole business.",
        gif: "settings-tabs",
      },
      { target: "settings-tab-branches", title: "Branches and counters", body: "Each branch's address and GSTIN, and its counters (tills)." },
      { target: "settings-tab-receipts", title: "Receipts", body: "How receipts look: the paper your printer takes, how items are laid out and what is printed." },
      { target: "settings-tab-cashiers", title: "Cashiers and access", body: "Add staff and choose what each cashier may do beyond selling." },
      { target: "settings-tab-printer", title: "Printer", body: "The receipt printer and cash drawer on this computer." },
      { target: "settings-tab-backups", title: "Backups", body: "Backups kept on this computer and copies kept elsewhere, and restoring one." },
      { target: "settings-tab-data", title: "Your data", body: "Download your sales register, or everything the business has, as files." },
    ],
  },

  "/change-password": {
    title: "Change Password",
    steps: [
      {
        target: "password-form",
        title: "Your own password",
        body: "Enter your current password and a new one. You stay signed in here; other places you're signed in are signed out.",
      },
    ],
  },
};
