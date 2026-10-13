export function productPrice(product) {
  const discountPercent=product.discountPercent??0;
  if(!Number.isFinite(product.price)||product.price<0||!Number.isFinite(discountPercent)||discountPercent<0||discountPercent>100)throw Error('Invalid product price or discount.');
  const originalCents=Math.round(product.price*100);
  const priceCents=Math.round(originalCents*(100-discountPercent)/100);
  return {price:priceCents/100,originalPrice:originalCents/100,discountPercent,discountPerUnit:(originalCents-priceCents)/100};
}
