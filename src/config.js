require('dotenv').config();
const path = require('path');

const config = {
  // Google OAuth
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/userinfo.email'],
  },

  // Twilio
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    whatsappFrom: process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886',
    whatsappTo: process.env.WHATSAPP_TO,
  },

  // Scheduler
  scheduler: {
    reportTime: process.env.REPORT_TIME || '20:00',
    timezone: process.env.TIMEZONE || 'Asia/Kolkata',
  },

  // App
  port: parseInt(process.env.PORT, 10) || 3000,
  sessionSecret: process.env.SESSION_SECRET || 'inbox-insights-secret-change-me',

  // Paths
  paths: {
    data: path.join(__dirname, '..', 'data'),
    tokens: path.join(__dirname, '..', 'data', 'tokens'),
    reports: path.join(__dirname, '..', 'data', 'reports'),
    db: path.join(__dirname, '..', 'data', 'inbox_insights.db'),
  },
};

module.exports = config;
