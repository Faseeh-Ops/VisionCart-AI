import {test,expect} from '@playwright/test';

test('professional workspace navigation and settings remain clear on desktop',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/#/dashboard');
  await expect(page.getByRole('heading',{name:'A good day starts here.'})).toBeVisible();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Workspace settings',exact:true})).toBeVisible();
  await expect(page.locator('.settings-card')).toHaveCount(6);
  await expect(page.getByText('Operational',{exact:true})).toBeVisible();
  await expect(page.getByText('SigLIP2 product matching',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('professional workspace remains usable on a cashier-sized screen',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/#/billing');
  await expect(page.getByRole('heading',{name:'Let’s make checkout simple.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Scan',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await expect(page.locator('.settings-card')).toHaveCount(6);
  const overflow=await page.locator('body *').evaluateAll(elements=>elements.filter(element=>element.getBoundingClientRect().right>document.documentElement.clientWidth+1).map(element=>({tag:element.tagName,className:element.className,right:Math.round(element.getBoundingClientRect().right)})).slice(0,10));
  expect(overflow).toEqual([]);
});

test('USB keyboard scanner captures a barcode without focusing the field',async({page})=>{
  await page.goto('/#/billing');
  await expect(page.getByText('USB scanner ready. Scan a product from anywhere on this page.',{exact:true})).toBeVisible();
  await page.evaluate(()=>document.activeElement?.blur());
  await page.keyboard.type('ASPIRE-LAYS-52',{delay:10});await page.keyboard.press('Enter');
  await expect(page.locator('.cart-row')).toContainText("Lay's Classic Salted");
  await expect(page.locator('.detection-result')).toContainText('USB_SCANNER');
});
