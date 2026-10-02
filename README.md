# PholletAI

PholletAI is a Khmer-focused AI assistant project. The Node.js/Express server serves the web chat UI and exposes chat, image-analysis, account, and webhook endpoints. The repository also includes an Expo mobile application and Messenger bot handlers.

## Features

- Khmer and multilingual AI chat through the server API.
- Image-question endpoint at `/api/image`.
- PostgreSQL-backed account and chat data.
- Messenger webhook handlers for text, image, and audio messages.
- Static web chat UI served at `/`.
- Expo mobile application source.

## Technology stack

- Node.js and Express
- PostgreSQL (`pg`)
- Google GenAI SDK and Groq SDK integrations
- Expo / React Native application source
- Docker and Fly.io deployment configuration

## Local setup

1. Install Node.js 22 or later and PostgreSQL (or obtain a PostgreSQL connection URL).
2. Install dependencies:

   ```sh
   npm ci
   ```

3. Copy `.env.example` to `.env` and set the credentials for the services you want to use. `DATABASE_URL` and AI provider keys are optional for starting the web server and health route, but their corresponding database/API features remain unavailable until configured. Keep `.env` private and never commit it.
4. Start the server:

   ```sh
   node server.js
   ```

5. Open `http://localhost:5000`. Check `http://localhost:5000/health` for `{"ok":true}`.

The server listens on `0.0.0.0` and uses `PORT`, defaulting to `5000`.

## Environment variables

The names below are referenced by the server or other repository source. Leave unused provider credentials unset in the deployment environment; `.env.example` contains names with empty values only.

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port; defaults to `5000`. |
| `DATABASE_URL` | PostgreSQL connection URL. |
| `GEMINI_API_KEY` | Google GenAI client used by a chat route. |
| `GROQ_API_KEY` | Groq client used by chat and image routes. |
| `GROQ_MODEL` | Optional model override in the Groq helper. |
| `OPENAI_API_KEY` | OpenAI helper integration. |
| `ANTHROPIC_API_KEY` | Anthropic helper integration. |
| `DEEPGRAM_API_KEY` | Speech transcription helper integration. |
| `ELEVENLABS_API_KEY` | Text-to-speech helper integration. |
| `ELEVENLABS_VOICE_ID` | Optional text-to-speech voice selection. |
| `JWT_SECRET` | Secret for signing account tokens. Set a strong private value in deployment. |
| `STRIPE_SECRET_KEY` | Optional Stripe SDK initialization; checkout is not implemented. |
| `APP_SECRET` | Messenger app-secret verification. |
| `PAGE_ACCESS_TOKEN` | Default Messenger page token. |
| `PAGE_TOKEN_<PAGE_ID>` | Optional Messenger token for a specific page; replace `<PAGE_ID>` with the page identifier. The `.env.example` placeholder is `PAGE_TOKEN_PAGE_ID=`. |

Stripe is initialized only when `STRIPE_SECRET_KEY` is configured; checkout is not implemented.

## Deploy to Fly.io

1. Create and configure your own Fly.io account and install/authenticate the `flyctl` CLI.
2. `fly.toml` is configured for the Fly app `pholletai-chat` in region `sin`. If this app does not already exist in your account, create it:

   ```sh
   fly apps create pholletai-chat
   ```

3. Set the database and provider credentials you intend to use as Fly secrets. `DATABASE_URL` is needed for database-backed features; configure at least one supported AI key to use AI routes. Supply real values through your secure deployment process; do not put them in source files:

   ```sh
   fly secrets set DATABASE_URL="replace-with-your-database-url" GEMINI_API_KEY="replace-with-your-key" GROQ_API_KEY="replace-with-your-key" JWT_SECRET="replace-with-a-strong-random-secret"
   ```

4. Deploy the Docker image:

   ```sh
   fly deploy
   ```

5. Verify the deployment health check at `https://pholletai-chat.fly.dev/health` and open `https://pholletai-chat.fly.dev/`.

Use only credentials for services you have configured. Missing AI credentials leave the server and static UI available; the affected AI endpoints respond with HTTP 503 until a provider is configured.

## Product announcement / sales draft

### PholletAI — a Khmer-focused AI assistant starter

Build on a Node.js and Express project that serves a Khmer-oriented chat interface and connects it to configurable AI providers. PholletAI is a starting point for developers who want to adapt an AI assistant for Khmer-speaking users.

**Included in the repository**

- A browser chat page served from `/`, with Khmer text and topic prompts.
- Chat and image-request API routes in the Express server.
- PostgreSQL-backed account and chat-related schema/helpers.
- Messenger text, image, and audio handler modules.
- Expo / React Native application source.
- Docker and Fly.io deployment configuration.

**Technology:** Node.js, Express, PostgreSQL, Google GenAI SDK, Groq SDK, Stripe SDK initialization, and Expo / React Native.

**API credentials and services:** Configure your own `GEMINI_API_KEY`, `GROQ_API_KEY`, `DATABASE_URL`, and `STRIPE_SECRET_KEY` for the current server startup path. Add other variables from the environment table only when using their related modules. This repository contains no provider accounts or credentials; users must obtain and pay for their own third-party services.

**Getting started:** Install Node.js 22+, run `npm ci`, configure the required values in a local `.env` based on `.env.example`, then run `node server.js`. Visit `http://localhost:5000`; verify the server at `http://localhost:5000/health`.

**Current status and buyer notes:** This is a developer starter, not a turnkey hosted subscription service. Stripe/Paddle checkout is not connected, PDF upload is unsupported, and provider availability depends on the user's own account, model access, and region. Review and test the routes and provider configuration for your intended use before launch.

## Payments

Payments are not active yet. The application currently has no checkout-session route or Stripe/Paddle checkout flow. Adding payment credentials alone will not enable purchases. `server.js` currently reads `STRIPE_SECRET_KEY`; the other names below are for connecting a provider when checkout support is implemented.

Environment variable names (set values only in your deployment environment, never in source control):

- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`
- Paddle: `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN`, `PADDLE_WEBHOOK_SECRET`

To connect your own provider:

1. Create a Stripe or Paddle account owned by you and configure its business and payout details.
2. Start with the provider's test/sandbox mode. Create the plans and prices you intend to offer.
3. Add that provider's credentials to your server's environment. Keep secret keys and webhook secrets server-side; never put them in browser code or commit them.
4. Implement a provider-specific checkout endpoint and configure its verified webhook. The current `/api/webhook/payment` route is a generic notification handler, not a Stripe- or Paddle-verified checkout integration.
5. Test checkout, signature verification, and subscription handling before enabling the purchase button or switching to live credentials.

## Known limitations

- **Payments:** Stripe/Paddle checkout and provider-specific webhook signature verification are not connected. The payment UI is intentionally marked as coming soon.
- **PDF uploads:** No PDF upload or document-extraction endpoint is implemented.
- **AI provider availability:** Model access, quotas, and service availability depend on each provider's account, region, model access, and deployment location. Confirm regional availability before choosing a hosting region.
- **Provider initialization:** AI and Stripe clients are initialized only when their corresponding API keys are configured. Database-backed routes require a reachable `DATABASE_URL`.
- **JWT configuration:** `server.js` contains a built-in fallback when `JWT_SECRET` is missing. Always configure a strong, private `JWT_SECRET` for deployed environments.
