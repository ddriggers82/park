// @ts-nocheck
// Plain Node ESM scraper — NOT part of the Next.js build.
// Run with: node scripts/check-borough-taxes.mjs
// Requires: playwright installed (npm i -D playwright@latest + npx playwright install chromium)
// Env: APP_URL, TAX_SYNC_SECRET

import { chromium } from 'playwright';

const PARCELS = [
  { pin: '16902303', a: '53501', label: 'Parcel A' },
  { pin: '16902302', a: '53500', label: 'Parcel B' },
  { pin: '16902102', a: '53485', label: 'Parcel C' },
];

const APP_URL = process.env.APP_URL;
const TAX_SYNC_SECRET = process.env.TAX_SYNC_SECRET;

if (!APP_URL || !TAX_SYNC_SECRET) {
  console.error('ERROR: APP_URL and TAX_SYNC_SECRET env vars are required');
  process.exit(1);
}

const TOTAL_PAYABLE_RE = /Total\s+Payable[:\s]+\$([0-9,]+\.[0-9]{2})/i;

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const results = [];

  for (const parcel of PARCELS) {
    const url = `https://kpb.publicaccessnow.com/PropertyTax/TaxSearch/Account.aspx?p=${parcel.pin}&a=${parcel.a}`;
    console.log(`Checking ${parcel.label} (PIN ${parcel.pin})...`);

    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const text = await page.innerText('body');
      const match = TOTAL_PAYABLE_RE.exec(text);
      let owedCents = 0;
      if (match) {
        const dollars = parseFloat(match[1].replace(/,/g, ''));
        owedCents = Math.trunc(dollars * 100);
      }
      console.log(`  ${parcel.label}: $${(owedCents / 100).toFixed(2)} owed (${owedCents} cents)`);
      results.push({ pin: parcel.pin, owedCents });
    } finally {
      await page.close();
    }
  }

  console.log('\nPOSTing results to', `${APP_URL}/api/tax-sync`);
  const resp = await fetch(`${APP_URL}/api/tax-sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TAX_SYNC_SECRET}`,
    },
    body: JSON.stringify({ parcels: results }),
  });

  const responseText = await resp.text();
  console.log(`Response status: ${resp.status}`);
  console.log(`Response body: ${responseText}`);

  if (!resp.ok) {
    console.error('ERROR: non-200 response from tax-sync endpoint');
    process.exit(1);
  }

  console.log('Done.');
} catch (err) {
  console.error('ERROR:', err);
  process.exit(1);
} finally {
  if (browser) {
    await browser.close();
  }
}
