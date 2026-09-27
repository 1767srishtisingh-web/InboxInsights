# InboxInsights - Smart Email Dashboard

Automated multi-Gmail account email subject reporter with daily PDF generation and WhatsApp delivery via Twilio.

## Architecture

```
MULTIPLE GMAIL ACCOUNTS
        ↓
Google OAuth 2.0 authentication
        ↓
Fetch emails (Gmail API)
        ↓
Extract email subjects
        ↓
Generate structured PDF (PDFKit)
        ↓
Scheduled automatic execution (node-cron)
        ↓
Send PDF through WhatsApp (Twilio)
```

## Project Structure

```
InboxInsights/
├── src/
│   ├── server.js           # Express server & API routes
│   ├── config.js            # Centralized configuration
│   ├── logger.js            # Winston logging
│   ├── database.js          # SQLite database (better-sqlite3)
│   ├── gmail-auth.js        # Google OAuth 2.0 multi-account
│   ├── email-fetcher.js     # Gmail API email fetching
│   ├── pdf-generator.js     # PDF report generation (PDFKit)
│   ├── whatsapp-sender.js   # Twilio WhatsApp delivery
│   ├── scheduler.js         # Daily cron scheduler
│   ├── pipeline.js          # Orchestrates fetch → PDF → WhatsApp
│   ├── test-pipeline.js     # Manual test script
│   └── public/
│       └── index.html       # Dashboard UI
├── data/                    # Auto-created (gitignored)
│   ├── tokens/              # OAuth tokens per account
│   ├── reports/             # Generated PDF reports
│   ├── logs/                # Application logs
│   └── inbox_insights.db   # SQLite database
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

## Quick Start

### 1. Prerequisites

- Node.js >= 18
- Google Cloud Console project with Gmail API enabled
- Twilio account with WhatsApp sandbox enabled

### 2. Setup Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable **Gmail API** and **Google People API**
4. Go to **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
5. Set Application type: **Web application**
6. Add Authorized redirect URI: `http://localhost:3000/auth/google/callback`
7. Copy the Client ID and Client Secret

### 3. Setup Twilio WhatsApp

1. Create a [Twilio account](https://www.twilio.com/)
2. Activate the WhatsApp Sandbox in Twilio Console
3. Note your Account SID, Auth Token, and WhatsApp sandbox number

### 4. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
WHATSAPP_TO=whatsapp:+91XXXXXXXXXX
REPORT_TIME=20:00
TIMEZONE=Asia/Kolkata
```

### 5. Install & Run

```bash
npm install
npm start
```

### 6. Connect Gmail Accounts

Visit `http://localhost:3000/auth/google` to connect each Gmail account.
Repeat for each account you want to monitor.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Dashboard UI |
| GET | `/auth/google` | Start Gmail OAuth flow |
| GET | `/api/dashboard` | Dashboard data |
| GET | `/api/accounts` | List connected accounts |
| GET | `/api/accounts/verify` | Verify all account tokens |
| DELETE | `/api/accounts/:email` | Remove an account |
| POST | `/api/run` | Run pipeline + send WhatsApp |
| POST | `/api/run/test` | Run pipeline (no WhatsApp) |
| GET | `/api/reports/latest` | Latest report info |
| GET | `/api/scheduler` | Scheduler status |

## Manual Testing

### Test without WhatsApp:
```bash
# Via API
curl -X POST http://localhost:3000/api/run/test?force=true

# Via CLI
node src/test-pipeline.js
```

### Test with WhatsApp:
```bash
# Via API
curl -X POST http://localhost:3000/api/run?force=true

# Via CLI
node src/test-pipeline.js --send-whatsapp --force
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `GOOGLE_CLIENT_ID` | - | Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | - | Google OAuth Client Secret |
| `GOOGLE_REDIRECT_URI` | `http://localhost:3000/auth/google/callback` | OAuth redirect |
| `TWILIO_ACCOUNT_SID` | - | Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | - | Twilio Auth Token |
| `TWILIO_WHATSAPP_FROM` | `whatsapp:+14155238886` | Twilio WhatsApp sender |
| `WHATSAPP_TO` | - | Your WhatsApp number |
| `REPORT_TIME` | `20:00` | Daily report time (HH:MM) |
| `TIMEZONE` | `Asia/Kolkata` | Scheduler timezone |
| `PORT` | `3000` | Server port |

## Security

- OAuth tokens stored locally in `data/tokens/` (gitignored)
- No Gmail passwords stored
- Minimum Gmail API scopes (readonly)
- All sensitive data via environment variables
- Generated reports not publicly accessible
- `.env`, tokens, and reports excluded from git
