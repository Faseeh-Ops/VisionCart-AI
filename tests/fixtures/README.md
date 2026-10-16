# Online Pakistani product scanner fixtures

Product: LU Tiger biscuits, EAN-13 `8961003694271`.

Product-code source: [Noor Rice Cash & Carry product listing](https://noorrice.pk/item-lusingle%20packtiger%20plain), which lists SKU `8961003694271`. The same number also appears on the user's previously supplied Tiger packet photo.

Downloaded on 15 October 2026:

- `tiger-ean13-online.png`: [TEC-IT EAN-13 generator](https://barcode.tec-it.com/barcode.ashx?data=8961003694271&code=EAN13&dpi=150).
- `tiger-qr-online.png`: [QRServer generator](https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=8961003694271).

Both images were downloaded from the internet and encode the product code. They are generated scanner fixtures, not photographs of the packaging. In particular, the QR is a test representation of the inventory identifier, not a claimed manufacturer-issued QR code.

The test uses Rs 10 and synthetic stock as explicit test fixtures. It does not obtain prices from the image, assert a live retailer price, or change the production database. Keeping these small images locally makes reruns independent of external download availability. They are test assets, not application branding or training data.

The browser test decodes both images using the real production decoder, verifies automatic format detection, adds stock as an admin, scans as a cashier, creates a Rs 20 invoice for two units, checks stock deduction and verifies persisted invoice history.
