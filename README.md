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

Click **Sign in** for explicit **Cashier** and **Administrator** tabs. Public signup is disabled. Only signed-in administrators can create administrators and cashiers from **Team & access**. To create a cashier, enter their name, email and temporary password. On first sign-in, the cashier must enter that temporary password and choose a different password before accessing inventory, scanning or billing. The new password replaces the temporary one and invalidates earlier sessions. Existing cashier accounts keep their current passwords. Initial administrator setup is permanently disabled now that the store administrator exists.

A signed-in administrator can create another administrator through **Team & access > Create administrator**. Enter their name, email, and initial password. This creates a separate account without changing the current session. The server checks the caller's current role in MongoDB on each authenticated request and records which administrator created the new account. Anonymous visitors and cashiers cannot use the admin-creation endpoint, even if they modify the frontend or send a direct API request. User list responses omit password hashes.

Admins can add verified catalog products; cashiers can scan and invoice. Both users and roles are stored in MongoDB, with bcrypt password hashes and expiring JWT sessions. Demo and database data are separate.

## Role responsibilities, reports, and discounts

Only cashiers can scan products into a sale and generate sales invoices. Administrators have no billing station, New sale button, or Add to bill action; the backend also rejects admin requests to the sales scanning and invoice-creation APIs. Cashiers can view their own invoices and unknown checkout scans; administrators can review all store invoices and unknown scans.

Administrators manage products manually or with **Products > Scan into inventory**, and can edit the selling price, barcode, stock, and **Discount (%)**. Discounts are per-product percentages from 0 to 100. The server calculates discounted unit prices in paise and stores original prices, discounts, cashier identity, and quantities on each invoice. Cashiers cannot change the discount by modifying a billing request. Later price or discount changes do not rewrite existing invoices.

The admin-only **Sales reports** page shows products sold, quantities, invoice counts, sales amounts, and discounts by cashier and day. Filter by date range and cashier; summary totals cover all matching sales, with paginated detail rows. Day boundaries use **Asia/Karachi**, including the entire selected end day. Invoice history shows the cashier on each invoice; older records without a cashier name are marked as legacy, while reports resolve their stored cashier ID when the account still exists.

The admin-only **Login logs** page records successful and failed logins, wrong-role attempts, password changes, and explicit sign-outs, with timestamp, account, role, IP, and browser information. Filter by date, account, and result; results are paginated. Logs start from this update; historical login activity was not recorded and cannot be reconstructed. Passwords and JWTs are never included in the log records.

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


## RTSP network cameras

Signed-in cashiers can select **Billing station > Connect RTSP camera**. Administrators can use the same option in **Scan into inventory**. Enter the manufacturer-provided stream URL, for example `rtsp://192.168.1.50:554/stream1`, or a URL with camera credentials if required. The stream path varies by camera. The backend computer must be able to reach that camera IP; a browser cannot play RTSP directly.

The local FFmpeg bridge converts RTSP over TCP to JPEG frames, which the existing barcode decoder scans. This is a barcode-scanning feature, not AI product recognition. Sessions are per account, stop on disconnect and expire after inactivity. URLs are held in memory for the connection, never saved in MongoDB or browser storage; credentials are not returned in errors.

For a fresh checkout, install FFmpeg and set `FFMPEG_PATH` to its executable, or install the bundled Windows executable in the ignored local tools directory:

```powershell
python -m pip install imageio-ffmpeg --target .tools/rtsp-dependencies
```

RTSP currently accepts IPv4 camera addresses. Reachable network cameras with supported RTSP codecs can be tested; HTTP/MJPEG streams and devices without RTSP are not supported by this option. One connection is allowed per account, with four concurrent connections per server. Real-camera compatibility requires testing with the actual device; unit tests simulate frame delivery.

Cashiers no longer see **Team & access** in navigation or **Add product** in the catalogue. Their **Profile & photo**, including working-store selection, remains available from the avatar menu.


## Automatic barcode and QR detection

Webcam, RTSP and uploaded-photo scanners automatically decode EAN/UPC/Code 128 and supported barcode formats alongside QR codes; no manual format switch is needed. The result identifies the detected format. Photo retries decode canvases directly rather than repeatedly encoding and loading PNG images.

QR content must exactly match the product's inventory code (the existing barcode field, up to 128 characters). For example, a QR containing `8697449918281` matches the Mahmood coffee entry. A QR with an unrelated website URL is an unverified code: the app does not open links or use QR content as a price. Administrators can register a short custom QR value as a product code through the existing inventory workflow. Typed/USB input does not provide reliable format metadata and is marked as entered code. Sales-scan records preserve supplied decoder format metadata; this is informational and does not alter server-controlled prices.


## Cashier password recovery

On the sign-in dialog, select **Forgot password?** and submit the cashier email. The response is generic to protect account existence. Existing cashier accounts generate one pending request each; duplicate pending requests are combined. Administrator accounts cannot use this public cashier-recovery flow. Requests are rate-limited by connection IP.

Administrators review **Password requests** in their sidebar, confirm the cashier?s identity, then assign a new temporary password. The request is resolved atomically with the password update. Existing cashier tokens are invalidated, password hashes are stored, and an audit event is recorded without the password. The admin must share the temporary password privately; no email or SMS is sent automatically. The cashier signs in with that temporary password and must replace it through the existing first-login password screen before using the application. Submitting a request alone never changes an account password.

Pending cashier password requests also appear in the administrator notification bell with a count, cashier name/email and a review link. The shared pending list refreshes every five seconds, on window focus and when opening the bell. Resolving a request removes it from the badge and list.


### Inventory by store

Product names, barcodes, prices and discounts are shared across branches. Quantities are stored separately in `storeinventories`, with one unique record per store/product pair.

- Admins choose **Inventory store** before viewing quantities, editing stock or using **Scan into inventory**. Product details and price edits apply to every branch; the stock field updates only the selected branch.
- Cashiers see and sell stock from their saved **Working store**. Switching stores clears the unfinished bill and reloads inventory. Sales validate and deduct branch stock in the same MongoDB transaction as the invoice.
- New branches start with zero stock. Select the branch and restock an existing barcode to supply it. Inactive branches retain their stock but cannot be restocked or used for sales.
- On the first upgraded startup, an atomic, one-time migration assigns the existing shared stock to the original main branch (`000000000000000000000001`). Other branches start at zero; the old global quantity is cleared after migration. Historical invoices remain unchanged. The `store-inventory-v1` setup marker prevents stock being copied again on restart.
- Restock request IDs are bound to their branch, product, quantity and administrator, so retrying a request cannot duplicate stock or apply it to a different branch.

Before upgrading a running deployment, stop the old backend to avoid simultaneous writes to the old shared stock fields. Back up the database before starting the upgraded backend. Existing branch allocation cannot be inferred from the former shared quantity; assign opening stock for other branches using the administrator inventory controls.

Inventory verification commands (MongoDB replica set must be running):

```powershell
node scripts/backup-inventory.js
node scripts/test-store-migration.js
npx playwright test -g "inventory is isolated"
```

The backup contains product/store quantities, not user passwords, and is saved under ignored `.tools/backups/`. The migration check uses a temporary `aspire_test_*` database and removes only that test database afterward.


### Allocate stock between branches

Admins can click **Allocate stock between stores** below the inventory store selector. Choose the source store, destination store, product and quantity, review the resulting balances and click **Transfer stock**. Reverse the two stores to return stock. Both branches must be active. A transfer deducts from the source and credits the destination in one transaction; it cannot create stock or overdraw the source. Retrying an identical request does not duplicate the allocation. Recent transfer history records the product, branches, units, administrator and date. Cashiers cannot access allocation endpoints.


### Admin store details and downloads

Open **Stores > View details** or **Store details** in the administrator menu. Each store report includes its complete product catalog, current quantities, prices, discounts and retail stock value. The activity feed records individual sale lines with cashier, exact Pakistan time, units, amount and invoice number; it also shows scans, store changes, store-linked account events, manual inventory edits, restocks and transfers. Transfers appear as outgoing and incoming activity at the respective branches.

Filter activity by account and date. **Download inventory CSV** exports the current full branch catalog; **Download activity CSV** exports all matching events, across every page. Inventory is a current snapshot, not historical stock at the chosen dates. Sales and transfer history use existing records; scans/account activity/manual edits without an original store ID cannot be reconstructed and only become branch-specific from this update. Events record application actions rather than physical attendance. Only administrators can access the detail, activity and export APIs. CSV fields are quoted and spreadsheet formula prefixes are neutralized.


### Invoice search and reprinting

The **Invoices** page supports full or partial invoice-number search (case insensitive), cashier selection for admins, store selection, and inclusive Pakistan-time date ranges. Click **Search invoices** to apply any combination, or **Reset filters** to clear them. Results are paginated in groups of 25 and search the full database, including receipts older than the recent 100 used by the dashboard. Branch/cashier filter choices come from historical receipts, retaining closed branches and former cashiers. Cashiers can search only their own invoices; changing query parameters cannot reveal another cashier's receipts. Select **View**, then **Print / Save PDF**, to reprint the original saved prices and discounts.


### Cashier account controls

Administrators can open **Team & access** to deactivate/reactivate cashiers or **Reset access** with a temporary password. Confirmation is required before changing access. Deactivation immediately blocks authenticated requests and new logins; existing tokens are revoked and stay invalid after reactivation. Open cashier workspaces check their session every 10 seconds and on window focus, clearing their local session and unfinished bill when access is revoked.

Reset access revokes existing sessions, resolves pending password-reset requests, and requires the cashier to replace the temporary password before accessing billing. Resetting an inactive account keeps it inactive until an admin explicitly reactivates it. Existing accounts without an active flag remain active. User records, profile photos, saved store selection and historical invoices are retained. Administrator accounts cannot be changed through these cashier controls. Account actions record the responsible administrator in login logs and store activity; passwords are never included in responses or logs.
