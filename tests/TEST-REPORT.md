# Aspire AI Billing test report

Historical report from 16 October 2026. For the maintained release checks and current AI results, see [verification and evaluation](../docs/MODEL-EVALUATION.md).

Date: 16 October 2026, Asia/Karachi.

## Final results

- Production build: passed.
- Playwright: **15 passed**, final full run approximately 2.5 minutes, using Microsoft Edge in visible browser windows.
- Node unit tests: **14 passed**.
- Database: an isolated `aspire_test_<timestamp>` MongoDB database, removed after the run. Production accounts, invoices and inventory were not modified.

## Online Pakistani product fixtures

Used LU Tiger biscuits with EAN-13 **8961003694271**, corroborated by a [Pakistani retailer's listing](https://noorrice.pk/item-lusingle%20packtiger%20plain) and the user's earlier packet photo.

The test downloaded an EAN-13 image and a QR image encoding this identifier from online generators. These are actual downloaded image files decoded by the production scanner, not mocked decoder results. They are not packaging photographs, and the QR is not a claimed manufacturer-issued code. See [fixture provenance and download links](fixtures/README.md).

Verified:

1. Admin uploads the downloaded EAN-13 image into inventory scanning.
2. Scanner identifies `EAN_13` and finds the correct Tiger product.
3. Admin adds two units: fixture stock changes from 5 to 7.
4. Cashier uploads the EAN-13 image and receives a verified product match.
5. Cashier uploads the downloaded QR image and receives `QR_CODE` for the same inventory product.
6. Both explicitly uploaded scans combine into one invoice line with quantity 2.
7. Fixture catalogue price Rs 10 produces a **Rs 20** invoice.
8. Inventory decreases from 7 to 5, and the invoice persists in cashier history.

Prices and initial stock are controlled test fixtures, not live retailer values. The initial new-test run hit an account-switch navigation race in test setup. Reloading the cashier session before navigating to billing corrected it; the final complete suite passed without retries.

## Other browser coverage

| Workflow | Result |
| --- | --- |
| Camera discovery, saved external-camera selection and disconnect fallback | Passed |
| Dashboard/navigation, new sale, notifications, corrections and invoice flow | Passed |
| Camera start and cleanup on navigation | Passed |
| Real EAN-13 image decoding into a matching product | Passed |
| MongoDB admin/cashier permissions, catalogue editing, restocking, atomic checkout, sales reports and login logs | Passed |
| Cashier creation, required first-login password replacement, profile/store controls and protected endpoints | Passed |
| QR photo identification and rejection of unrelated QR links | Passed |
| QR decoding from simulated RTSP image frames | Passed |
| Password-recovery submission, admin bell notification across separate browser sessions, reset approval and password replacement | Passed |
| Online Pakistani product barcode/QR, inventory addition, billing and persisted stock/invoice checks | Passed |

## Evidence and rerunning

Generated locally:

- [Playwright HTML report](../playwright-report/index.html)
- Local inventory screenshot: `test-results/pakistani-tiger-inventory.png`
- Local barcode screenshot: `test-results/pakistani-tiger-barcode.png`
- Local QR screenshot: `test-results/pakistani-tiger-qr.png`
- Local invoice screenshot: `test-results/pakistani-tiger-invoice.png`

Generated reports and screenshots are ignored by Git and may be replaced on the next test run.

```powershell
npm.cmd run build
npm.cmd test
$env:PLAYWRIGHT_HTML_OPEN='never'
npx.cmd playwright test --reporter=list,html
```

To view the interactive report:

```powershell
npx.cmd playwright show-report
```

## Limits

Passing these tests verifies the listed workflows, not every possible input or environment. Webcam hardware is simulated in automated tests; RTSP transport is simulated for the browser QR test, while the image decoder is real. This run does not establish physical-camera focus, network reliability, barcode readability under glare/occlusion, or AI packaging recognition accuracy. The large frontend-bundle build warning remains; it did not fail the build.


## Store inventory, allocation and admin tracking

Verified independent branch quantities, branch-scoped scans and invoice deductions, stock isolation during concurrent sales, admin allocation and returns, idempotent transfer retries, insufficient stock protection, inactive store rejection and cashier access restrictions.

Store tracking checks cover product stock and retail quantities, cashier sale lines with invoice numbers, exact timestamps, store selection, sign-in/out, scans, restocking, manual edits and transfer directions. Checked account/date filtering, pagination beyond 50 events, inventory and activity CSV downloads, export of every matching page, cross-store isolation, invalid dates and administrator-only API/UI access. CSV escaping and spreadsheet formula protection pass unit tests. Historical events without a store ID remain unassigned.


## Invoice search and reprint

Verified case-insensitive partial and exact invoice-number searches across the full database, including a receipt older than the latest 100. Combined cashier/store/Pakistan-date filters returned 104 fixtures across five pages. Confirmed inclusive local-day boundaries, literal regex characters, invalid input rejection, reset/no-result states, and historical inactive-store filter choices. Cashier search and filter options remain scoped to that cashier, and attempts to request another cashier's records are rejected. Opened an archived receipt, checked original saved prices and products, and verified the Print / Save PDF button invokes browser printing. The print call is intercepted during automation; no physical printer output is tested.


## Cashier account controls

Verified admin-only activation/deactivation and direct temporary-password resets. Covered confirmation/cancellation, rejection of cashier/anonymous access, protection of administrator accounts, invalid passwords, immediate API revocation, rejection of inactive logins, automatic browser sign-out and bill clearing, and invalidity of old tokens after reactivation. Confirmed an inactive account stays inactive after a reset, first login requires a new password, original credentials stop working, pending reset requests are resolved by direct reset, saved store selection survives, and the original invoice remains unchanged. Audit records identify the responsible administrator without exposing temporary passwords. Existing accounts without an active flag remain usable.
