# Aspire AI Billing

MERN retail dashboard built in the existing **VisionCart AI** folder. Barcode scanning is the primary method for this phase. No AI or Odoo integration is enabled.

## Run the dashboard

Requires Node.js 20.19+.

```powershell
npm.cmd install
Copy-Item .env.example .env
# Replace JWT_SECRET in .env with a random secret of at least 32 characters.
npm.cmd run dev
```

Open http://localhost:5173. The labeled demo workspace works without MongoDB, saves sample products/invoices locally, and supports camera scanning, barcode entry, USB scanners, manual product search, quantity corrections, unknown scans, and printable invoices. Sample barcodes appear in the Products page. Demo mode is for evaluation only.

## Connect MongoDB

Use MongoDB Atlas or a local MongoDB replica set. Set MONGODB_URI in `.env`. A replica set is required for atomic invoice creation and inventory deduction; a standalone MongoDB server cannot commit these transactions. Production invoices use server catalog prices and reject unverified or out-of-stock products.

Click **Sign in** for explicit **Cashier** and **Administrator** tabs. Public signup can only create cashier accounts; attempts to request an administrator role are rejected by the server. Initial administrator setup is permanently disabled now that the store administrator exists.

A signed-in administrator can create another administrator through **Team & access > Create administrator**. Enter their name, email, and initial password. This creates a separate account without changing the current session. The server checks the caller's current role in MongoDB on each authenticated request and records which administrator created the new account. Anonymous visitors and cashiers cannot use the admin-creation endpoint, even if they modify the frontend or send a direct API request. User list responses omit password hashes.

Admins can add verified catalog products; cashiers can scan and invoice. Both users and roles are stored in MongoDB, with bcrypt password hashes and expiring JWT sessions. Demo and database data are separate.

## Role responsibilities, reports, and discounts

Only cashiers can scan products into a sale and generate sales invoices. Administrators have no billing station, New sale button, or Add to bill action; the backend also rejects admin requests to the sales scanning and invoice-creation APIs. Cashiers can view their own invoices and unknown checkout scans; administrators can review all store invoices and unknown scans.

Administrators manage products manually or with **Products > Scan into inventory**, and can edit the selling price, barcode, stock, and **Discount (%)**. Discounts are per-product percentages from 0 to 100. The server calculates discounted unit prices in paise and stores original prices, discounts, cashier identity, and quantities on each invoice. Cashiers cannot change the discount by modifying a billing request. Later price or discount changes do not rewrite existing invoices.

The admin-only **Sales reports** page shows products sold, quantities, invoice counts, sales amounts, and discounts by cashier and day. Filter by date range and cashier; summary totals cover all matching sales, with paginated detail rows. Day boundaries use **Asia/Karachi**, including the entire selected end day. Invoice history shows the cashier on each invoice; older records without a cashier name are marked as legacy, while reports resolve their stored cashier ID when the account still exists.

The admin-only **Login logs** page records successful and failed logins, wrong-role attempts, cashier registration, and explicit sign-outs, with timestamp, account, role, IP, and browser information. Filter by date, account, and result; results are paginated. Logs start from this update; historical login activity was not recorded and cannot be reconstructed. Passwords and JWTs are never included in the log records.

Click the top-right avatar to open **Profile & photo** or **Log out**. Cashiers can upload/change/remove their own photo in **Team & access**; admins can also manage cashier photos from the team list. Accounts without a photo show the uppercase first initial of their name. JPEG, PNG, and WebP inputs up to 5 MB are cropped to a 256×256 square JPEG in the browser and saved in MongoDB. The server checks image type/signature and limits stored photos to 256 KB. Photos persist across refreshes and sign-ins. Uploading a photo does not clear an unfinished bill.

## Store locations and saved cashier preference

Administrators can add locations under **Stores > Add store**, supplying a store name and branch/location. Only authenticated administrators can create stores; cashiers can list the available stores and change their own working-store preference under **Profile & photo > Your working store**. Click **Save working store** to persist it in MongoDB. The sidebar immediately shows that store and location; refreshes, sign-outs, later logins, and photo updates preserve the preference. Existing accounts default to the existing Aspire main branch until the cashier selects another store. Admins cannot change a cashier's saved preference through this API.

Switching stores with an unfinished bill requires confirmation and clears that bill. New invoices receive the store ID, name, and location from the cashier's saved database preference, not from client-supplied invoice fields. Old sales retain their original store snapshot when the cashier switches again. Admin **Sales reports** can filter by store, and invoice history/receipts show store details. Older invoices without store data remain labeled as legacy/unassigned rather than being reassigned.

This phase adds persistent store selection and sale attribution. Product catalog, prices, discounts, and stock are currently shared across locations; separate branch inventory is not implemented.

In **Stores**, administrators can **Deactivate** or **Activate** each location. Inactive stores remain visible to admins and in historical sales report filters, but disappear from cashier store choices. A cashier already assigned to an inactive store keeps that saved preference and sees an inactive warning; they must choose another active store before generating new invoices. The backend blocks sales for inactive stores even if the cashier's screen is outdated. Reactivating a store makes it available again without changing anyone's preference. No historical invoice is deleted or reassigned.

Camera scanning requires HTTPS or localhost and camera permission. Grant access in your browser. Select a webcam or rear camera in the billing station. A barcode is billed once while it remains in view; click **Scan next unit** to scan another unit of the same product, or increase its quantity in the bill. Camera stops when navigating away. You can also upload a clear barcode photo for decoding. Camera preview shows the actual video; recognized product names/prices appear beside it in the bill. Unknown barcodes appear in a persistent review queue and never enter the bill. Queue counts represent unknown **scan events**, not unique products. History is retained after catalog registration.

The starter catalog contains Lay's, Pepsi, K&N's nuggets, eggs, Dalda ghee, and Sufi basmati rice. Prices are editable examples shown in **Rs (PKR)**, not current retail quotations. The ASPIRE codes are internal sample identifiers, not manufacturer barcodes. Sign in as an administrator and use **Products → Edit price / barcode** to enter the barcode printed on the exact pack size you sell. The starter catalog is seeded once into MongoDB and will not reset edited prices or stock.

Dashboard and billing are separate views. Navigation uses hash routes and supports browser back/forward. **New sale** opens billing and asks before clearing an existing bill. Notifications open a panel containing unknown scan, low-stock, and invoice summaries. Administrators can see registered accounts in **Team & access**; account role changes still require database administration.

Administrators can select **Products > Scan into inventory**. Camera, USB barcode entry, and barcode photos are supported. A known barcode opens a quantity form; confirmation adds stock atomically with an audit entry in MongoDB. Retries of the same stock request do not add stock twice. An unknown barcode opens a product registration form with its barcode prefilled; the administrator supplies its name, category, price in Rs, and initial stock. Cashiers and anonymous visitors cannot access inventory lookup or restocking endpoints. Inventory scans do not create bill items or count as unverified checkout scans.

## Build and verify

```powershell
npm.cmd test
npm.cmd run build
npm.cmd start
```

Run browser and database integration checks with `npx.cmd playwright test`. These checks use installed Microsoft Edge and an isolated local MongoDB replica-set database. That temporary database is removed after the tests. They verify navigation, billing, camera startup with a simulated camera, real EAN-13 image decoding, administrator-only account creation, cashier permissions, catalog editing, invoice persistence, and stock deduction. Physical webcam performance depends on focus, lighting, and the actual product barcode.

The production server serves `dist` on port 4000. Currency is PKR. No tax is charged until tax rules are implemented. Payments record the selected method; this app does not process card payments.

## Future AI integration

See [model download preparation](models/README.md) for verified official YOLO26, SigLIP 2, and optional Qwen3.5 downloads. No AI model is active yet.

The UI's `scan` function resolves a detection into a catalog product, then the shared `add` function updates the bill. A future detector can supply a barcode/catalog ID through this boundary, with confidence and confirmation added before `add`. Invoice price validation and inventory transactions stay on the server regardless of detection provider.

Before public deployment, add auth rate limiting, account recovery, store-specific authorization, deployment hardening, and business tax rules. Reporting includes dashboard totals, a seven-day sales chart, and invoice history.
