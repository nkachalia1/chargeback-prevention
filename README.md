# Chargeback Manager MVP

A small full-stack MVP for preparing chargeback evidence packets for ecommerce stores.

## Run Locally

```bash
npm start
```

Then open `http://127.0.0.1:4173`.

Local dev credentials, unless you set your own `.env`:

- Email: `admin@example.com`
- Password: `change-me-now`

## Configure Secrets

Copy `.env.example` to `.env`, then fill in the values you have.

```bash
cp .env.example .env
```

For Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

The backend reads `.env` itself. Do not put API keys in `app.js`.

## What It Does

- Password-protected dashboard with HTTP-only session cookies.
- JSON-file database under `data/app.db.json`.
- Stripe dispute sync using `STRIPE_SECRET_KEY`.
- Stripe webhook endpoint at `/api/webhooks/stripe`.
- Shopify order sync using the Admin GraphQL API.
- Shopify webhook endpoint at `/api/webhooks/shopify`.
- Server-side OpenAI Responses API call for dispute letter generation.
- Local fallback letter generation when OpenAI is not configured.
- Print/PDF-ready packet creation.

## Webhook URLs

After deployment, use these URLs in provider dashboards:

- Stripe: `https://your-domain.com/api/webhooks/stripe`
- Shopify: `https://your-domain.com/api/webhooks/shopify`

## Deploy Online

This is no longer a static-only site. Deploy it to a Node host, not Netlify Drop or GitHub Pages.

Good beginner options:

- Render Web Service
- Railway
- Fly.io
- A small VPS

Set the environment variables from `.env.example` in the host dashboard. Use:

```bash
npm start
```

as the start command.

## Production Notes

- Use a long random `APP_SECRET`.
- Use a strong `ADMIN_PASSWORD`.
- Use HTTPS only.
- Keep `data/` persistent, or replace the JSON file with Postgres before selling this.
- Keep human review before submitting evidence to processors.
