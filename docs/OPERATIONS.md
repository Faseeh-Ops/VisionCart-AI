# Setup & operations

## Local MongoDB

1. Install MongoDB Community Server as a Windows service.
2. Create `.env` from `.env.example` and set a random JWT secret.
3. Open PowerShell as Administrator in the project folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-local-mongo.ps1
```

- The helper targets MongoDB Server **9.0** at its default Windows installation path. Adjust the script for another installation.
- It backs up the server configuration, enables the `aspire-rs` replica set and updates `.env`.
- For another replica-set deployment, set `MONGODB_URI` directly. Atlas is also supported.
- Restart the backend after changing `.env`.

## Accounts

- Sign in using the **Cashier** or **Administrator** tab.
- Public signup and first-admin self-registration are disabled.
- An existing administrator creates accounts under **Team & access**.
- New cashiers replace their temporary password before using the workspace.
- **Forgot password?** sends a request to the admin queue and notification bell.
- Admins can also issue a temporary password directly with **Reset access**.
- Deactivation blocks requests immediately and invalidates existing sessions.
- An idle cashier workspace checks access every 10 seconds and on window focus.
- Reactivation preserves the account, profile, working store and sales history.
- Resetting an inactive account does not reactivate it.

## Products & stores

- **Products > Add product** registers a name, code, price, quantity and discount.
- **Scan into inventory** finds an existing product for restocking or registers a new code.
- Product names, barcodes, prices and discounts are shared across branches.
- Select **Inventory store** before editing a branch quantity or adding stock.
- New stores start with zero stock.
- Open **Inventory management** to scan incoming products, review branch stock and activity, or use **Allocate stock between stores** without changing the overall total.
- Both stores must be active; transfers cannot overdraw the source.
- Retrying the same restock or transfer request cannot duplicate stock.
- Cashiers choose their saved working store under **Profile & photo**.
- Changing stores clears an unfinished bill after confirmation.
- Inactive stores retain their inventory and history but cannot make new sales.

### Existing inventory migration

- The one-time `store-inventory-v1` migration assigns formerly shared stock to the original main branch.
- Other branches start at zero; historical invoices keep their original store snapshots.
- Back up inventory and stop an old backend before upgrading a shared-stock deployment.

```powershell
node scripts/backup-inventory.js
node scripts/test-store-migration.js
```

Backups are written to the ignored `.tools/backups/` folder and exclude user credentials. The migration check uses a temporary test database.

## Scanning & checkout

- Supported inputs: webcam, phone-as-webcam, USB keyboard scanner, uploaded image and RTSP camera.
- Barcode and QR formats are detected automatically.
- QR content must match the inventory product code; unrelated links are unverified.
- Unverified scans are retained for review and never enter a bill.
- **Scan next unit** allows the same product to be scanned again while using a live camera.
- Cashiers can adjust quantities or remove products before confirming a sale.
- The server applies catalog prices and discounts, checks branch stock and saves the invoice atomically.
- Sample catalog prices are examples; internal `ASPIRE` codes are not manufacturer barcodes.

## RTSP cameras

- Cashiers: **Billing station > Connect RTSP camera**.
- Admins: **Products > Scan into inventory > Connect RTSP camera**.
- Use the manufacturer's stream address, such as `rtsp://192.168.1.50:554/stream1`.
- The backend computer must be able to reach the camera's IPv4 address.
- Install FFmpeg and set `FFMPEG_PATH`, or install the local Windows dependency:

```powershell
python -m pip install imageio-ffmpeg --target .tools/rtsp-dependencies
```

- The backend converts RTSP video into JPEG frames. The main cashier RTSP entry checks barcode and QR codes while also monitoring product appearance. A registered code takes priority; an unknown or unreadable code falls back to cashier-confirmed AI matching. Capture waits for a decoded frame.
- Camera credentials stay in memory and are not returned in error messages.
- Sessions expire after inactivity; limits are one per account and four per server.
- Focus, distance, lighting and the printed code determine real-camera decoding quality.

## Receipts & reports

- **Invoices** searches the full receipt history by number, cashier, store and date.
- Cashiers see only their own receipts; admins can review all receipts.
- Open a receipt and select **Print / Save PDF** to reprint its saved prices.
- **Sales reports** summarizes cashier sales, quantities, revenue and discounts.
- **Stores > View details** shows current product quantities and store activity.
- Download the current inventory or all matching activity as CSV, across every page.
- Activity includes sale lines, scans, restocks, transfers, account actions and manual stock edits.
- Dates use **Asia/Karachi**; the selected end date is inclusive.
- Events without an original store ID remain unassigned.
- **Login logs** records sign-in results, password changes and administrative account actions.
- Passwords and JWTs are excluded from audit records.

## Screenshots & verification

```powershell
npm.cmd test
npm.cmd run build
npx.cmd playwright test --headed
node scripts/capture-readme.mjs
```

- Browser checks require Microsoft Edge and the local MongoDB replica set.
- Tests create isolated `aspire_test_*` databases and remove them afterward.
- Screenshot capture uses port **4003**, fictional accounts and a separate `aspire_readme_*` database.
- Capture writes to `docs/screenshots/` and removes only its temporary database.
- Camera tests simulate devices; they do not certify a physical webcam or CCTV camera.

## Current scope

- Barcode/QR checkout, branch inventory, receipts, reporting and account controls are implemented.
- Local single-product AI recognition is implemented with cashier confirmation. Multi-product detection and Odoo/eAsasa integration remain future work.
- Cash/card selections record a payment method; they do not process transactions.
- Tax calculation is not configured.
- Before external deployment, review authentication limits, network access, backups and deployment security.
