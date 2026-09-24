# rmj.co.in — public website

Plain static HTML/CSS/JS, hand-coded (no build step, no framework). It is
**not** part of the Expo/React Native app in `frontend/` and is **not**
touched by `.github/workflows/deploy.yml` — it never goes near the shop's
Windows box. It deploys on its own via `.github/workflows/deploy-website.yml`
to Cloudflare Pages (see "Deploying" below) — not to Hostinger. Hostinger's
"Website Builder" plan (as opposed to their regular shared hosting) has no
file manager or FTP access at all, so the file-upload path this site was
originally built for isn't available on that plan; Cloudflare Pages sidesteps
it entirely, using the same Cloudflare account that already runs the
app.rmj.co.in / api.rmj.co.in tunnel. Hostinger stays on only as the domain
registrar.

## Pages

Apple-style single-page design (each page is fully self-contained — its own
inline `<style>`/`<script>`, no shared CSS/JS files to keep in sync):

- `index.html` — the whole site: live rate board, showcase, collections,
  new-at-the-counter rail, about and visit/contact, all on one page via
  anchor links (`#collections`, `#about`, `#visit`, ...). Also the live rates
  page.
- `payment.html` — payment methods, built to match `index.html`'s look
  (same nav/footer/colors), linked from the Visit section as "Pay online".
- `assets/images/logo-mark.png` — the real logo (from `RMJ_Logos.zip`), used
  for the favicon and every logo slot on both pages.

There's no `about.html` or `contact.html` anymore — that content now lives in
`index.html`'s About and Visit sections instead of separate pages.

## Still using placeholder text

- `index.html`'s Visit panel: `<p class="hrs">Opening hours: add your days
  and times here</p>` — replace with the real hours.
- `payment.html`'s QR panel: `[ UPI QR code ]` box and `[GSTIN Number]` —
  swap the box for a real `<img>` (drop the QR image in
  `assets/images/` and reference it with a relative path) and fill in the
  GSTIN.

Everything else (phone number, WhatsApp links, address, social links,
product photos) is already real content pulled from the live Hostinger
Website Builder site — search for `[` across `website/` if anything else
still needs filling in.

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

## Deploying (Cloudflare Pages)

Automatic: pushing to `main` with changes under `website/` runs
`.github/workflows/deploy-website.yml`, which publishes this folder straight
to Cloudflare Pages. Re-deploying after an edit is just committing and
pushing — no manual upload step.

One-time setup (see the comment at the top of that workflow file for the
full version):

1. In the Cloudflare dashboard — the same account already running the
   `app.rmj.co.in` / `api.rmj.co.in` tunnel — create an API token with the
   **Cloudflare Pages - Edit** permission, and note the account ID.
2. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as this repo's
   GitHub Actions secrets.
3. Push once to let the workflow create the `rmj-website` Pages project,
   then in that project's **Custom domains** tab add `rmj.co.in` and
   `www.rmj.co.in` — Cloudflare wires up the DNS itself since the zone is
   already on this account.
4. Visit `https://rmj.co.in`, and `https://rmj.co.in/pay`, on both desktop
   and mobile, to confirm rates load and nothing 404s.

If Hostinger's plan for this domain is ever upgraded to one with a file
manager/FTP (their regular shared hosting, not Website Builder), this same
static folder can still be uploaded to `public_html/` there instead — nothing
about the site itself depends on Cloudflare Pages specifically.
