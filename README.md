# Aspire AI Billing

**Retail checkout, branch inventory and store oversight in one MERN application.**

React | Express | Node.js | MongoDB | Barcode & QR scanning | PKR

![Aspire AI Billing dashboard](docs/screenshots/dashboard-overview.png)

## Features

| Checkout | Administration |
| --- | --- |
| Barcode and QR scanning | Separate inventory for every store |
| Webcam, USB scanner, photo and RTSP input | Stock allocation between branches |
| Quantity correction and product search | Products, prices and discounts |
| Invoice search, reprint and PDF | Store activity and CSV downloads |
| Persistent working-store selection | Cashier access controls and password resets |

**Current phase:** Barcode/QR billing is implemented. AI product recognition and Odoo integration are planned.

## Screenshots

Screens use fictional accounts and sample data. Click an image to view it at full size.

| Cashier checkout | Store inventory & activity |
| --- | --- |
| [![Billing station with a populated bill](docs/screenshots/billing.png)](docs/screenshots/billing.png) | [![Admin store stock and activity report](docs/screenshots/store-details.png)](docs/screenshots/store-details.png) |
| **Stock allocation** | **Invoice search & reprint** |
| [![Transfer preview between branches](docs/screenshots/stock-transfer.png)](docs/screenshots/stock-transfer.png) | [![Searchable invoice history](docs/screenshots/invoice-search.png)](docs/screenshots/invoice-search.png) |

## Quick start

**Requirements:** Node.js 20.19+, npm and a MongoDB replica set or Atlas deployment.

```powershell
npm.cmd install
Copy-Item .env.example .env
# Set MONGODB_URI and replace JWT_SECRET in .env.
npm.cmd run dev
```

Open **http://localhost:5173**. A guest demo is available without signing in.

- Use a random `JWT_SECRET` of at least 32 characters.
- MongoDB transactions require a replica set. [Local setup instructions](docs/OPERATIONS.md#local-mongodb).
- Connected accounts must be provisioned by an administrator; public signup is disabled.
- Camera access requires localhost or HTTPS and browser permission.

## Access

| Role | Responsibilities |
| --- | --- |
| **Admin** | Manage stores, allocate stock, review activity, export reports and control cashier accounts. |
| **Cashier** | Scan products, create invoices, search their receipts and choose their working store. |

Product details and prices are shared; stock belongs to individual branches. Sales preserve their original prices, cashier and store.

## Build & checks

```powershell
npm.cmd test                      # Unit tests
npm.cmd run build                 # Production build
npm.cmd start                     # http://localhost:4000
npx.cmd playwright test --headed  # Visible browser tests
```

Browser tests use Microsoft Edge and an isolated test database. [Latest test report](tests/TEST-REPORT.md).

## Documentation

- [Setup, cameras and daily operations](docs/OPERATIONS.md)
- [Model preparation](models/README.md)
- [Pakistani product training proposal](models/TRAINING-PROPOSAL.md)

Currency: **Rs (PKR)**. Cash/card selections are recorded; card payments and tax calculation are not integrated.
