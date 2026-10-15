# Phollet AI Builder

An isolated Next.js app for generating browser-previewable React projects. It does not replace the existing Express-served chat UI.

## Architecture

```text
Browser (Next.js + Tailwind + Lucide)
  ├── Chat panel ── POST /api/generate ── server-side provider adapter
  ├── Monaco editor <── validated { path, content } file set
  └── Sandpack iframe <── React + TypeScript source files
```

- **Next.js App Router:** hosts the Builder interface and server-only model API route.
- **Tailwind CSS:** styles the three-panel responsive workspace.
- **Monaco:** edits the selected generated source file.
- **Sandpack:** executes generated React/TypeScript inside a browser sandbox and refreshes as files change.
- **AI provider:** supports Groq, Gemini, Anthropic, and DeepSeek via server environment variables. API keys are never sent to the browser or preview. If `AI_PROVIDER` is unset, the server selects the first configured key in this order: Groq, Gemini, Anthropic, DeepSeek.
- **Accounts:** customers can register with verified email or sign in with Google OAuth. Passwords for email accounts are stored as scrypt hashes; sessions use signed, HttpOnly, SameSite cookies. Generation requests are authenticated, same-origin, size-limited, and rate-limited per session.
- **Image input:** accepts up to two JPEG, PNG, or WebP images. The browser resizes and re-encodes them before sending to the configured AI provider. Gemini and Anthropic support images; Groq requires a configured vision model, and DeepSeek image input is not supported.
- **Voice input:** uses browser speech recognition when available. Browser speech services may process audio outside this app.
- **Project response contract:** the model returns one JSON object, either `{ "status": "proposal", "message": "..." }` or `{ "status": "files", "message": "...", "files": [{ "path": "/App.tsx", "content": "..." }], "dependencies": {} }`.
- The agent proposes structure, visual theme, and features first, and generates files after the user approves.

## Run locally

Requirements: Node.js 20.9 or later.

```sh
cd ai-builder
npm install
copy .env.example .env.local
```

Configure the provider key in `.env.local`. `AI_PROVIDER` may be `groq`, `gemini`, `anthropic`, or `deepseek`; if omitted, the first configured key is selected in the order listed (image prompts prefer Gemini and then Anthropic). Model defaults are `openai/gpt-oss-120b` for Groq and `gemini-3.5-flash` for Gemini. If the default Gemini model still returns HTTP 503/504 after one retry, the Builder retries with `gemini-3.5-flash-lite`; a custom `GEMINI_MODEL` is not silently replaced. Optional model variables are `GROQ_MODEL`, `GROQ_VISION_MODEL`, `GEMINI_MODEL`, `ANTHROPIC_MODEL`, and `DEEPSEEK_MODEL`. For the existing Express project's provider setup, the Builder can use `GROQ_API_KEY` and `GROQ_MODEL`, or `GEMINI_API_KEY` and `GEMINI_MODEL`, when those variables are supplied to the Builder process.

Set `DATABASE_URL` to a PostgreSQL database URL and `BUILDER_SESSION_SECRET` to a random secret of at least 32 characters. Configure SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`) and the public HTTPS origin in `BUILDER_PUBLIC_URL` to enable email-verification links for public account registration. To enable Google sign-in, set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. In Google Cloud Console, the authorized redirect URI must exactly match `{BUILDER_PUBLIC_URL}/api/auth/google/callback`; the live domain currently redirects `phollet.live` to `www.phollet.live`, so use `BUILDER_PUBLIC_URL=https://www.phollet.live` unless the Vercel primary-domain redirect is changed. The Google OAuth flow uses authorization code + PKCE, a signed-session-secret-encrypted state cookie, and a verified Google ID token. Keep all secrets in server environment configuration only.

```sh
npm run dev
```

Open `http://localhost:3000`.

On PowerShell, generate a session secret with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

## Deploy to Vercel

1. Push this repository to a Git provider, then import it in Vercel. Set **Root Directory** to `ai-builder` and use the Next.js preset. The package scripts provide the standard install, build, and start behavior; do not set a static output directory.
2. Create a PostgreSQL database reachable from Vercel. Use the provider's pooled connection URL when available, with TLS enabled, and add it as `DATABASE_URL`. The database role must be allowed to create the Builder tables, alter `builder_users.password_hash`, and create the Google-subject index on first API use.
3. In **Project Settings → Environment Variables**, configure the required account and mail variables below for the environments you will deploy. Add secrets only in Vercel's server-side environment settings; never use a `NEXT_PUBLIC_` name for credentials. Set `BUILDER_PUBLIC_URL` to the exact HTTPS origin of the deployed app, then redeploy after changing variables.
4. In Google Cloud Console, create an OAuth 2.0 **Web application** client. Since Vercel currently redirects the apex domain to `www`, add `https://www.phollet.live/api/auth/google/callback` as an authorized redirect URI. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BUILDER_PUBLIC_URL=https://www.phollet.live`, and a random `BUILDER_SESSION_SECRET` of at least 32 characters in the Vercel **Production** environment. Add the exact Vercel Preview callback separately if Google sign-in is needed in Preview. The OAuth client must be of type Web application.
5. Configure exactly one AI provider by setting `AI_PROVIDER` and its matching API key. Add optional model variables only when you want to override the defaults.
6. For a first payment test, use ABA-issued sandbox credentials, set `PAYMENT_PROVIDER=aba_payway` and `PAYWAY_ENVIRONMENT=sandbox`, and add the callback secret. Ensure the sandbox callback URL is publicly reachable over HTTPS and is allowed by the merchant configuration. Do not put production payment credentials in Preview or Development environments.
7. Deploy to Preview first and verify the home page, Google sign-in, email registration and verification, password sign-in, project generation, and pricing page. Complete an actual ABA sandbox payment and confirm the matching account receives Pro only after server-side verification.
8. For production, configure a separate production database and production mail settings, keep `BUILDER_PUBLIC_URL=https://www.phollet.live`, and deploy ABA production credentials only after ABA has approved the merchant/domain and the business has published its customer, refund, privacy, and tax terms. Confirm the Google redirect URI is exactly `https://www.phollet.live/api/auth/google/callback`, deploy, then verify Google sign-in and the protected generation flow.

Required Vercel environment variables:

| Purpose | Variables |
| --- | --- |
| Account sessions and public links | `BUILDER_SESSION_SECRET`, `BUILDER_PUBLIC_URL` |
| Google sign-in | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Durable accounts and billing | `DATABASE_URL` |
| Email verification | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` |
| AI generation (choose one provider) | `AI_PROVIDER` and one of `GROQ_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, or `DEEPSEEK_API_KEY` |
| ABA KHQR payments (sandbox or production) | `PAYMENT_PROVIDER`, `PAYWAY_ENVIRONMENT`, `PAYWAY_MERCHANT_ID`, `PAYWAY_API_KEY`, `PAYWAY_CALLBACK_SECRET` |

Optional model overrides: `GROQ_MODEL`, `GROQ_VISION_MODEL`, `GEMINI_MODEL`, `ANTHROPIC_MODEL`, and `DEEPSEEK_MODEL`. Generate a new high-entropy `BUILDER_SESSION_SECRET` and `PAYWAY_CALLBACK_SECRET` for each environment; each must contain at least 32 characters. Keep Preview credentials and databases separate from production.

## Pricing and mobile app foundation

The `/pricing` page lists Phollet AI Pro at $14.99/month and $129.99/year. Both amounts are USD and each checkout purchases one term; there is no automatic renewal or automatic charge. ABA PayWay dynamic KHQR checkout is implemented for the `aba_payway` provider. The backend generates QR codes, stores orders in PostgreSQL, and checks transaction status directly with PayWay before activating or extending the account's subscription. The Builder generation API also checks that subscription server-side. Stripe is not implemented yet; `lib/payments/provider.ts` defines the provider boundary for adding it without coupling Stripe to pricing, orders, or subscription entitlements.

To enable sandbox checkout, use the PayWay sandbox account and credentials issued by ABA. Set `PAYMENT_PROVIDER=aba_payway`, `PAYWAY_ENVIRONMENT=sandbox`, `PAYWAY_MERCHANT_ID`, `PAYWAY_API_KEY`, and a random `PAYWAY_CALLBACK_SECRET` of at least 32 characters. Configure `BUILDER_PUBLIC_URL` as the public HTTPS app origin. The dynamic QR callback uses this URL and the callback secret; callbacks are only notifications and the backend still verifies each transaction directly with PayWay before granting Pro. For production, replace sandbox credentials with merchant production credentials, set `PAYWAY_ENVIRONMENT=production`, and have ABA whitelist the production website/domain and callback as required by the merchant profile. Never put merchant credentials or callback secrets in `NEXT_PUBLIC_*` or Expo public variables.

Before accepting live payments, confirm and publish the company's registered jurisdiction/address and company details, support contact, applicable tax treatment, one-term purchase and manual-renewal terms, and refund/privacy policies. Payment configuration is disabled unless the required server credentials, PostgreSQL, and account email-verification configuration are present.

`mobile-bridge/BuilderWebView.jsx` is a starter Expo/React Native WebView wrapper for the deployed Builder. Follow `mobile-bridge/README.md` to create an Expo SDK 56 project, install `react-native-webview`, and configure `EXPO_PUBLIC_BUILDER_URL`. It reuses the web app's same-origin login and API protections; it is not a native camera/microphone or app-store billing implementation.

## Safety and limitations

- The route validates model JSON, file paths, file count, file size, and dependency names/versions before returning project files.
- Sandpack executes AI-generated code in its preview iframe. Never add credentials or private data to generated files; review generated code before using it outside the preview.
- Generated projects are held in browser state and can be exported as source text; this starter does not save them to a server or Git repository.
- User accounts require verified email, scrypt password hashes, signed HttpOnly/SameSite sessions, same-origin checks, a 4 MB generation request limit, image signature validation, and per-process account/generation/payment rate limits. Rate limits are not shared across instances; add a durable shared limiter, quotas, monitoring, email-abuse protection, account recovery, and a documented data retention/privacy policy before public scale-up.
- The app does not persist chat, image, or generated-project data to its own database. Requests are sent to the configured provider, whose retention and processing policies apply.
- The live preview is a React + TypeScript sandbox, not a full Next.js runtime.
- ABA PayWay sandbox transactions require ABA-issued merchant credentials and a publicly reachable callback URL; localhost cannot receive PayWay callbacks. Run a real sandbox payment before enabling production mode. Stripe and other international payment providers are not wired.
- There is no automatic renewal: each successful PayWay payment grants one month or one year. Customer account recovery, cancellation flows, tax calculation, invoicing, refunds administration, and customer support processes are not implemented; subscription/refund administration still needs an operator workflow.
- Provider model names can be changed using the matching `*_MODEL` environment variable as provider availability changes. Set `GROQ_VISION_MODEL` to a vision-capable model to use Groq with image attachments.
