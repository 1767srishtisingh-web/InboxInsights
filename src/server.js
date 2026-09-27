require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const logger = require('./logger');
const database = require('./database');
const gmailAuth = require('./gmail-auth');
const pipeline = require('./pipeline');
const scheduler = require('./scheduler');
const whatsappSender = require('./whatsapp-sender');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static dashboard files
app.use('/static', express.static(path.join(__dirname, 'public')));

// Serve generated reports (for PDF download)
app.use('/reports', express.static(config.paths.reports));

// ===== Dashboard Route =====
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===== OAuth Routes =====
app.get('/auth/google', (req, res) => {
  try {
    const authUrl = gmailAuth.getAuthUrl();
    logger.info('OAuth flow started - redirecting to Google');
    res.redirect(authUrl);
  } catch (error) {
    logger.error('OAuth URL generation failed: ' + error.message);
    res.redirect('/?auth=error&message=' + encodeURIComponent(
      config.google.clientId ? error.message : 'Google OAuth not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env'
    ));
  }
});

app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/?auth=error&message=No+authorization+code');
  try {
    const account = await gmailAuth.handleAuthCallback(code);
    logger.info('OAuth callback successful for ' + account.email);
    res.redirect('/?auth=success&email=' + encodeURIComponent(account.email));
  } catch (error) {
    logger.error('OAuth callback failed: ' + error.message);
    res.redirect('/?auth=error&message=' + encodeURIComponent(error.message));
  }
});

// ===== API Routes =====

// Dashboard data
app.get('/api/dashboard', (req, res) => {
  try {
    const stats = database.getDashboardStats();
    const accounts = database.getActiveAccounts();
    const schedulerStatus = scheduler.getSchedulerStatus();
    const deliveryMode = whatsappSender.getDeliveryMode();
    res.json({
      success: true,
      data: {
        ...stats,
        accounts: accounts.map(a => ({
          email: a.email,
          displayName: a.display_name,
          lastSync: a.last_sync,
          isActive: a.is_active === 1,
          isDemo: a.token_file === 'demo',
        })),
        scheduler: schedulerStatus,
        deliveryMode,
        oauthConfigured: !!(config.google.clientId && config.google.clientSecret),
      },
    });
  } catch (error) {
    logger.error('Dashboard API error: ' + error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// User registration
app.post('/api/register', (req, res) => {
  try {
    const { name, whatsappNumber, reportTime, timezone } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Name is required' });
    }
    const user = database.registerUser(
      name.trim(),
      whatsappNumber || '',
      reportTime || '20:00',
      timezone || 'Asia/Kolkata'
    );

    // Update scheduler with new time if changed
    if (reportTime) {
      scheduler.restartScheduler(reportTime, timezone || config.scheduler.timezone, async () => {
        await pipeline.runPipeline({ sendWhatsApp: true, force: false });
      });
    }

    logger.info('User registered: ' + name);
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get user
app.get('/api/user', (req, res) => {
  try {
    const user = database.getUser();
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update schedule
app.post('/api/schedule', (req, res) => {
  try {
    const { reportTime, timezone } = req.body;
    if (!reportTime) return res.status(400).json({ success: false, error: 'reportTime required' });
    database.updateUserSchedule(reportTime, timezone || 'Asia/Kolkata');
    scheduler.restartScheduler(reportTime, timezone || 'Asia/Kolkata', async () => {
      await pipeline.runPipeline({ sendWhatsApp: true, force: false });
    });
    res.json({ success: true, scheduler: scheduler.getSchedulerStatus() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Accounts
app.get('/api/accounts', (req, res) => {
  try {
    const accounts = database.getActiveAccounts();
    res.json({
      success: true,
      accounts: accounts.map(a => ({
        email: a.email, displayName: a.display_name,
        lastSync: a.last_sync, isActive: a.is_active === 1,
        isDemo: a.token_file === 'demo',
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add demo account
app.post('/api/accounts/demo', (req, res) => {
  try {
    const { email, displayName } = req.body;
    if (!email) return res.status(400).json({ success: false, error: 'Email required' });
    database.addDemoAccount(email, displayName || email);
    logger.info('Demo account added: ' + email);
    res.json({ success: true, message: 'Demo account added: ' + email });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Verify accounts
app.get('/api/accounts/verify', async (req, res) => {
  try {
    const results = await gmailAuth.verifyAllAccounts();
    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Remove account
app.delete('/api/accounts/:email', (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    gmailAuth.removeAccount(email);
    res.json({ success: true, message: 'Account ' + email + ' removed' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Run pipeline (with delivery)
app.post('/api/run', async (req, res) => {
  try {
    const force = req.body.force === true || req.query.force === 'true';
    const demoData = req.body.demoData === true || req.query.demo === 'true';
    logger.info('Manual pipeline run triggered (delivery enabled, demo=' + demoData + ')');
    const result = await pipeline.runPipeline({ sendWhatsApp: true, force, demoData });
    res.json({ success: result.success, result });
  } catch (error) {
    logger.error('Pipeline error: ' + error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Run pipeline in test mode (no delivery)
app.post('/api/run/test', async (req, res) => {
  try {
    const force = req.body.force === true || req.query.force === 'true';
    const demoData = req.body.demoData === true || req.query.demo === 'true';
    logger.info('Test pipeline run (no delivery, demo=' + demoData + ')');
    const result = await pipeline.runPipeline({ sendWhatsApp: false, force, demoData });
    res.json({ success: result.success, result });
  } catch (error) {
    logger.error('Test pipeline error: ' + error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Reports
app.get('/api/reports', (req, res) => {
  try {
    const reports = database.getAllReports();
    res.json({ success: true, reports });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/reports/latest', (req, res) => {
  try {
    const report = database.getLatestReport();
    res.json({ success: true, report });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Download latest PDF
app.get('/api/reports/download', (req, res) => {
  try {
    const report = database.getLatestReport();
    if (!report || !report.file_path) {
      return res.status(404).json({ success: false, error: 'No report available' });
    }
    if (!fs.existsSync(report.file_path)) {
      return res.status(404).json({ success: false, error: 'PDF file not found' });
    }
    res.download(report.file_path);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Scheduler status
app.get('/api/scheduler', (req, res) => {
  res.json({ success: true, scheduler: scheduler.getSchedulerStatus() });
});

// System status
app.get('/api/status', (req, res) => {
  try {
    const user = database.getUser();
    const accounts = database.getActiveAccounts();
    const schedulerStatus = scheduler.getSchedulerStatus();
    const deliveryMode = whatsappSender.getDeliveryMode();
    const latestReport = database.getLatestReport();
    res.json({
      success: true,
      status: {
        registered: !!user,
        userName: user ? user.name : null,
        connectedAccounts: accounts.length,
        schedulerActive: schedulerStatus.running,
        reportTime: schedulerStatus.reportTime,
        deliveryMode,
        latestReportDate: latestReport ? latestReport.report_date : null,
        latestReportStatus: latestReport ? latestReport.generation_status : null,
        oauthConfigured: !!(config.google.clientId && config.google.clientSecret),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== Initialize and Start =====
async function initialize() {
  await database.initDb();
  logger.info('Database ready');

  // Check if user has custom schedule
  const user = database.getUser();
  const reportTime = (user && user.report_time) || config.scheduler.reportTime;
  const timezone = (user && user.timezone) || config.scheduler.timezone;

  scheduler.startScheduler(async () => {
    await pipeline.runPipeline({ sendWhatsApp: true, force: false });
  }, reportTime, timezone);

  app.listen(config.port, () => {
    logger.info('\n' + '='.repeat(50));
    logger.info('InboxInsights Server Started');
    logger.info('='.repeat(50));
    logger.info('Server:     http://localhost:' + config.port);
    logger.info('Dashboard:  http://localhost:' + config.port + '/');
    logger.info('Add Gmail:  http://localhost:' + config.port + '/auth/google');
    logger.info('Report at:  ' + reportTime + ' (' + timezone + ')');
    logger.info('Delivery:   ' + whatsappSender.getDeliveryMode() + ' mode');
    logger.info('='.repeat(50) + '\n');
  });
}

process.on('SIGINT', () => { logger.info('Shutting down...'); scheduler.stopScheduler(); database.close(); process.exit(0); });
process.on('SIGTERM', () => { logger.info('Shutting down...'); scheduler.stopScheduler(); database.close(); process.exit(0); });

initialize().catch((error) => {
  logger.error('Failed to start server: ' + error.message);
  process.exit(1);
});

module.exports = app;
