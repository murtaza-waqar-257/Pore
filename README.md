# pore

A phone-friendly web page that checks skincare and makeup ingredient lists for ingredients that may clog pores.

- Three ways in: scan the barcode (live camera, a photo of it, or typing the digits), photograph the product (front of pack or ingredient list), or type/paste ingredients.
- Barcodes and product names are looked up in Open Beauty Facts (free, open data under the ODbL licence, which asks you to credit it).
- Photos are read by Claude (Haiku 5.5) through `api/read-label.js`. The checking itself is plain code against `data.js`, built from the research sheet. No AI is used for the verdict.
- Photos are sent once to be read and are not stored.

## Files

| File | What it does |
| --- | --- |
| `index.html` | The page |
| `styles.css` | Look: light pink, sea green, Archivo type |
| `app.js` | Screens: home, reading, check the list, results |
| `match.js` | Splits a label into ingredients and matches them (handles INCI names, brackets, CI colour codes, "may contain") |
| `data.js` | 177 watch-list ingredients + 99 rated-fine ones, from the sheet |
| `api/read-label.js` | Server function that sends a photo to Claude: returns the ingredient list if printed, plus brand, product name and barcode digits |
| `api/web-ingredients.js` | When a product isn't in Open Beauty Facts, Claude searches the web for its ingredient list and must cite a page it found (about 1p per lookup) |
| `api/product.js` | Server function that looks a barcode or product name up in Open Beauty Facts |
| `vendor/zxing-browser.min.js` | Barcode reader (ZXing, MIT licence), runs on the phone |

## Deploy on Vercel

1. Put this folder in a GitHub repo (for example `pore`).
2. On vercel.com: **Add New → Project**, import the repo. Framework preset: **Other**. No build command needed.
3. In the project's **Settings → Environment Variables**, add `ANTHROPIC_API_KEY` with your key from console.anthropic.com. Never put the key in the page files.
4. Deploy. Open the link on your phone and try "Scan with camera".

Optional variables:

- `CLAUDE_MODEL`: defaults to `claude-haiku-5-5` (the cheapest model, under 0.1p per scan).
- `CONTACT_EMAIL`: your email, sent to Open Beauty Facts so they know who's calling (they ask apps to identify themselves).
- `DAILY_SCANS_PER_IP`: defaults to 40.
- `DAILY_WEB_LOOKUPS_PER_IP`: defaults to 20. Basic limit only; also set a monthly spend limit in the Claude Console.

## Updating the ingredient data

Edit the sheet, then update the matching rows in `data.js`. Each watch-list row is
`[name, rating, risk, aliases, type, evidence, note, acneOrg]`; add the label spellings you see on real products to `aliases`.
