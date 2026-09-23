# rmj.co.in — public website

Plain static HTML/CSS/JS, hand-coded (no build step, no framework) so it can
be uploaded as-is to Hostinger's file hosting instead of using their
drag-and-drop AI Builder. It is **not** part of the Expo/React Native app in
`frontend/` and is **not** touched by `.github/workflows/deploy.yml` — it
never goes near the shop's Windows box. It's kept in this repo purely for
version control.

## Pages

- `index.html` — homepage, doubles as the live rates page.
- `about.html`
- `contact.html`
- `payment.html`
- `assets/css/style.css` — shared styles (brand-matched red/gold/cream theme).
- `assets/js/nav.js` — mobile hamburger menu, shared by every page.
- `assets/js/rates.js` — fetches live rates for the homepage.

## Before you upload: fill in the placeholders

Every page has `[Shop Address Line 1]`, `[Phone Number]`, `[GSTIN Number]`,
etc. — search for `[` across `website/` and replace them with the real
details. Also swap the `[ Store Photograph ]` / `[ UPI QR Code ]` boxes in
`index.html`, `about.html` and `payment.html` for real `<img>` tags once you
have photos (drop images in `assets/images/` and reference them with a
relative path, e.g. `assets/images/storefront.jpg`).

The map on `contact.html` searches for "Ram Murti Jewellers" by name — once
the address is real and the listing is on Google Maps, replace the iframe's
`src` with the exact embed link Google Maps gives you for this store
(Share → Embed a map), so it points at the right pin.

## One-time backend change this site depends on

`index.html` fetches live rates from `https://app.rmj.co.in/api/public/rates`
in the browser, from the `rmj.co.in` origin — the API's CORS allowlist has to
include `https://rmj.co.in` (and `https://www.rmj.co.in` if the site will
also answer on the `www` subdomain) or the browser will block the request.
Add both to `ALLOWED_ORIGINS` in the backend's production `.env` on the shop
server, comma-separated alongside the existing app origin, and restart the
backend service:

```
ALLOWED_ORIGINS=https://app.rmj.co.in,https://rmj.co.in,https://www.rmj.co.in
```

Nothing else needs a backend change — everything else on this site is static.

## Deploying to Hostinger

1. In hPanel, open **Files → File Manager** (or connect via FTP) for the
   `rmj.co.in` hosting plan.
2. Upload the *contents* of this `website/` folder (not the folder itself)
   into `public_html/` — `index.html` should end up directly at
   `public_html/index.html`.
3. If the AI Builder site is still attached to the domain, disable/unpublish
   it first (hPanel → Websites) so it stops serving `public_html/` instead of
   this one.
4. Visit `https://rmj.co.in` and click through all four pages, on both
   desktop and mobile, to confirm rates load and nothing 404s.

Re-deploying after an edit is the same: re-upload whichever files changed.
