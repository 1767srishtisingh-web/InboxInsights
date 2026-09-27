require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const config = require('./config');
const logger = require('./logger');
const database = require('./database');
const gmailAuth = require('./gmail-auth');
const pipeline = require('./pipeline');
const scheduler = require('./scheduler');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 },
}));

// Serve static dashboard
app.use('/static', express.static(path.join(__dirname, 'public')));

// ===== Dashboard Route =====
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===== OAuth Routes =====

// Start OAuth flow - redirect to Google
app.get('/auth/google', (req, res) => {
  try {
    const authUrl = gmailAuth.getAuthUrl();
    logger.info('OAuth flow started - redirecting to Google');
    res.redirect(authUrl);
  } catch (error) {
    logger.error(`OAuth URL generation failed: ${error.message}`);
    res.status(500).json({ error: 'Failed to start authentication' });
  }
});

// OAuth callback
app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).json({ error: 'No authorization code received' });
  }

  try {
    const account = await gmailAuth.handleAuthCallback(code);
    logger.info(`OAuth callback successful for ${account.email}`);
    res.redirect(`/?auth=success&email=${encodeURIComponent(account.email)}`);
  } catch (error) {
    logger.error(`OAuth callback failed: ${error.message}`);
    res.redirect('/?auth=error&message=' + encodeURIComponent(error.message));
  }
});

// ===== API Routes =====

// Get dashboard data
app.get('/api/dashboard', (req, res) => {
  try {
    const stats = database.getDashboardStats();
    const accounts = database.getActiveAccounts();
    const schedulerStatus = scheduler.getSchedulerStatus();

    res.json({
      success: true,
      data: {
        ...stats,
        accounts: accounts.map(a => ({
          email: a.email,
          displayName: a.display_name,
          lastSync: a.last_sync,
          isActive: a.is_active === 1,
        })),
        scheduler: schedulerStatus,
      },
    });
  } catch (error) {
    logger.error(`Dashboard API error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all connected accounts
app.get('/api/accounts', (req, res) => {
  try {
    const accounts = database.getActiveAccounts();
    res.json({
      success: true,
      accounts: accounts.map(a => ({
        email: a.email,
        displayName: a.display_name,
        lastSync: a.last_sync,
        isActive: a.is_active === 1,
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Verify all account authentications
app.get('/api/accounts/verify', async (req, res) => {
  try {
    const results = await gmailAuth.verifyAllAccounts();
    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Remove an account
app.delete('/api/accounts/:email', (req, res) => {
  try {
    gmailAuth.removeAccount(req.params.email);
    res.json({ success: true, message: `Account ${req.params.email} removed` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Run pipeline manually (with WhatsApp)
app.post('/api/run', async (req, res) => {
  try {
    const force = req.body.force === true || req.query.force === 'true';
    logger.info('Manual pipeline run triggered (with WhatsApp)');
    const result = await pipeline.runPipeline({ sendWhatsApp: true, force });
    res.json({ success: result.success, result });
  } catch (error) {
    logger.error(`Manual pipeline error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Run pipeline in test mode (no WhatsApp)
app.post('/api/run/test', async (req, res) => {
  try {
    const force = req.body.force === true || req.query.force === 'true';
    logger.info('Manual pipeline run triggered (TEST MODE - no WhatsApp)');
    const result = await pipeline.runPipeline({ sendWhatsApp: false, force });
    res.json({ success: result.success, result });
  } catch (error) {
    logger.error(`Test pipeline error: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get latest report info
app.get('/api/reports/latest', (req, res) => {
  try {
    const report = database.getLatestReport();
    res.json({ success: true, report });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get scheduler status
app.get('/api/scheduler', (req, res) => {
  res.json({ success: true, scheduler: scheduler.getSchedulerStatus() });
});

// ===== Initialize and Start =====

async function initialize() {
  // Initialize database (async for sql.js)
  await database.initDb();
  logger.info('Database ready');

  // Start scheduler
  scheduler.startScheduler(async () => {
    await pipeline.runPipeline({ sendWhatsApp: true, force: false });
  });

  // Start server
  app.listen(config.port, () => {
    logger.info(`\n${'='.repeat(50)}`);
    logger.info('InboxInsights Server Started');
    logger.info(`${'='.repeat(50)}`);
    logger.info(`Server:     http://localhost:${config.port}`);
    logger.info(`Dashboard:  http://localhost:${config.port}/`);
    logger.info(`Add Gmail:  http://localhost:${config.port}/auth/google`);
    logger.info(`Report at:  ${config.scheduler.reportTime} (${config.scheduler.timezone})`);
    logger.info(`${'='.repeat(50)}\n`);
  });
}

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down...');
  scheduler.stopScheduler();
  database.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Shutting down...');
  scheduler.stopScheduler();
  database.close();
  process.exit(0);
});

initialize().catch((error) => {
  logger.error(`Failed to start server: ${error.message}`);
  process.exit(1);
});

module.exports = app;
