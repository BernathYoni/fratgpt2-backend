# FratGPT 2.0 Backend

Node.js + TypeScript + Fastify + Prisma backend for FratGPT.

## Features

- JWT authentication
- Stripe subscription management (Free, Basic, Pro plans)
- Daily usage limits (20/50/500 solves per day)
- Multi-LLM support (Gemini, OpenAI, Claude)
- Three modes: Regular, Fast, Expert (consensus)
- Chat sessions with image support
- Automatic image cleanup (5-day retention)

## Tech Stack

- **Runtime**: Node.js 20+
- **Framework**: Fastify
- **Language**: TypeScript
- **Database**: PostgreSQL (via Prisma)
- **Auth**: JWT tokens
- **Payment**: Stripe
- **AI**: Google Gemini, OpenAI, Anthropic Claude

## Local Development Setup

### Prerequisites

- Node.js 20+
- PostgreSQL database
- Stripe account
- API keys for Gemini, OpenAI, and Anthropic

### Installation

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your local values

# Generate Prisma client
npm run db:generate

# Run database migrations
npm run db:push

# Start dev server
npm run dev
```

The server will run on `http://localhost:3000`.

### Database Commands

```bash
# Generate Prisma client after schema changes
npm run db:generate

# Push schema to database (development)
npm run db:push

# Create migration (production)
npm run db:migrate

# Open Prisma Studio (database GUI)
npm run db:studio
```

### Cleanup Job

To delete attachments older than 5 days:

```bash
npx tsx src/services/cleanup.ts
```

Set up a cron job or Railway cron to run this daily.

## Railway Deployment

### 1. Create Railway Project

1. Go to [Railway](https://railway.app)
2. Create new project
3. Add **PostgreSQL** plugin
4. Deploy this GitHub repo

### 2. Set Environment Variables

In Railway dashboard, add these variables:

```
# Database (auto-set by Railway Postgres)
DATABASE_URL=<automatically set>

# Server (auto-set by Railway)
PORT=<automatically set>

# App Config
NODE_ENV=production
JWT_SECRET=<generate-random-secret-key>

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_BASIC=price_1SQdkDCDxzHnrj8R0nSwZApT
STRIPE_PRICE_PRO=price_1SRQyxCDxzHnrj8RmTIm9ye6

# LLM APIs
GEMINI_API_KEY=<your-key>
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# CORS
FRONTEND_URL=https://your-frontend.up.railway.app
```

### 3. Set Build & Start Commands

Railway auto-detects from package.json:

- **Build**: `npm run build`
- **Start**: `npm start`

### 4. Run Migrations

After first deploy, run in Railway terminal:

```bash
npx prisma migrate deploy
```

### 5. Set Up Stripe Webhook

1. Get your Railway backend URL (e.g., `https://your-backend.up.railway.app`)
2. In Stripe Dashboard → Developers → Webhooks
3. Add endpoint: `https://your-backend.up.railway.app/webhooks/stripe`
4. Select events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Copy webhook signing secret to `STRIPE_WEBHOOK_SECRET`

### 6. Set Up Daily Cleanup (Optional)

In Railway, set up a cron job:

```bash
0 2 * * * npx tsx src/services/cleanup.ts
```

Or use Railway's cron plugin.

## API Endpoints

### Auth
- `POST /auth/register` - Register new user
- `POST /auth/login` - Login
- `GET /auth/me` - Get current user

### Chat
- `POST /chat/start` - Start new chat session
- `POST /chat/:sessionId/message` - Send follow-up message
- `GET /chat/sessions` - List all sessions
- `GET /chat/:sessionId` - Get session details

### Billing
- `POST /billing/create-checkout-session` - Create Stripe checkout
- `POST /billing/create-portal-session` - Create billing portal

### Usage
- `GET /usage/stats` - Get usage statistics
- `GET /usage/check` - Check current limit

### Webhooks
- `POST /webhooks/stripe` - Stripe webhook handler

## Plan Limits

| Plan  | Daily Solves | Price ID |
|-------|-------------|----------|
| Free  | 20/day      | N/A      |
| Basic | 50/day      | price_1SQdkDCDxzHnrj8R0nSwZApT |
| Pro   | 500/day     | price_1SRQyxCDxzHnrj8RmTIm9ye6 |

## Chat Modes

- **Fast**: Gemini Flash, faster/cheaper responses
- **Regular**: Gemini Pro, high-quality explanations
- **Expert**: Calls Gemini + OpenAI + Claude in parallel, creates consensus

## License

MIT
