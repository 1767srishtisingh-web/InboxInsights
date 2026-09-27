# SmartMail (InboxInsights) — Smart Email Dashboard

Automated multi-Gmail account email subject reporter with scheduled PDF generation and WhatsApp delivery.

```
MULTIPLE GMAIL ACCOUNTS (Google OAuth 2.0 or Demo Accounts)
                        ↓
             Fetch Emails (Gmail API / Demo)
                        ↓
              Extract Email Subjects
                        ↓
          Generate Structured PDF (PDFKit)
                        ↓
     Scheduled Daily Execution (node-cron, dynamic)
                        ↓
    Delivery Layer (Twilio WhatsApp or Demo / Local Download)
```

## Features

- **Multi-Gmail Account Management**: Connect multiple accounts securely via Google OAuth 2.0.
- **SaaS-Style Single Page Dashboard**: Modern blue palette (`#0f1b2d`, `#2563eb`), Inter typography, smooth hover micro-interactions, responsive across desktop & mobile.
- **User Registration & Preference Management**: Store user name, masked WhatsApp number, preferred report time, and timezone.
- **Subject Extraction & PDF Generation**: Groups emails by account, numbers subjects, adds timestamps, sender metadata, and summary counters. Includes Unicode text sanitization.
- **Free Demo Delivery Mode**: Clear distinction between Real Delivery (Twilio WhatsApp) and Demo Delivery (instant PDF download) without requiring paid credentials for presentation.
- **Manual Pipeline Execution**: Test the entire pipeline anytime with a single click via UI or terminal.
- **Dynamic Scheduler**: Change schedule time per user dynamically without restarting the server.
- **SQLite Persistence**: Uses `sql.js` (pure JS SQLite) with zero C++ compilation dependencies.

---

## Project Structure

```
InboxInsights/
├── src/
│   ├── server.js           # Express server & REST API routes
│   ├── config.js           # Centralized configuration & environment loader
│   ├── logger.js           # Winston logger with console & file rotation
│   ├── database.js         # SQLite database management (sql.js)
│   ├── gmail-auth.js       # Google OAuth 2.0 multi-account handling
│   ├── email-fetcher.js    # Gmail API fetcher with rate/error safety
│   ├── pdf-generator.js    # PDF report builder with Unicode sanitization
│   ├── whatsapp-sender.js  # Delivery layer abstraction (Twilio / Demo)
│   ├── scheduler.js        # Dynamic cron scheduler with restart support
│   ├── pipeline.js         # Pipeline orchestrator (Fetch → PDF → Deliver)
│   ├── test-pipeline.js    # CLI test harness
│   └── public/
│       └── index.html      # Responsive SaaS dashboard UI
├── data/                   # Runtime storage (gitignored)
│   ├── tokens/             # Stored OAuth tokens per account
│   ├── reports/            # Generated PDF files
│   ├── logs/               # Application log files
│   └── inbox_insights.db   # SQLite database file
├── package.json
├── .env.example
├── .env
├── .gitignore
└── README.md
```

---

## Quick Start (Demo Mode — 100% Free, No Setup Required)

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the application:**
   ```bash
   npm start
   ```

3. **Open the Dashboard:**
   Visit `http://localhost:3000/` in your browser.

4. **Register & Test:**
   - Enter your name (e.g. `Srishti Singh`).
   - Click **"+ Add Demo Account"** to add demo Gmail accounts.
   - Click **"Create My Report Schedule"**.
   - Click **"Demo Test Run"** under Actions.
   - Click **"Download PDF"** to inspect the generated report!

---

## Real Gmail & WhatsApp Setup (Optional)

### 1. Google OAuth 2.0 Setup
1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project and enable **Gmail API**.
3. Create an **OAuth 2.0 Client ID** (Web application).
4. Add Authorized redirect URI: `http://localhost:3000/auth/google/callback`.
5. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`.

### 2. Twilio WhatsApp Setup
1. Register a free account at [Twilio](https://www.twilio.com/).
2. Enable the WhatsApp Sandbox under Messaging.
3. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, and `WHATSAPP_TO` in `.env`.

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Single-page SaaS Dashboard |
| `GET` | `/api/status` | High-level system & registration status |
| `GET` | `/api/dashboard` | Aggregated dashboard metrics & accounts |
| `POST` | `/api/register` | Register or update user & scheduled report time |
| `POST` | `/api/accounts/demo` | Add demo account for zero-config testing |
| `GET` | `/auth/google` | Trigger Google OAuth 2.0 flow |
| `GET` | `/auth/google/callback` | OAuth redirect callback |
| `DELETE` | `/api/accounts/:email` | Disconnect an account |
| `POST` | `/api/run` | Trigger pipeline with delivery (`force=true`, `demo=true`) |
| `POST` | `/api/run/test` | Trigger pipeline in test mode (no delivery) |
| `GET` | `/api/reports/latest` | Retrieve metadata of most recent report |
| `GET` | `/api/reports/download` | Download current PDF report |
| `GET` | `/api/scheduler` | Check cron schedule status & report time |

---

## CLI Testing

Run pipeline test via command line anytime:
```bash
# Test in demo mode
node src/test-pipeline.js --demo

# Test with live Gmail accounts (skip WhatsApp)
node src/test-pipeline.js

# Test with live Gmail accounts and send WhatsApp
node src/test-pipeline.js --send-whatsapp
```
