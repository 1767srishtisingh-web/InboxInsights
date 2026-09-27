const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./logger');

let db = null;
let dbReady = false;

/**
 * Initialize and return the database instance.
 * Uses sql.js (pure JS SQLite - no native compilation needed).
 */
async function initDb() {
  if (db && dbReady) return db;

  const dataDir = path.dirname(config.paths.db);
  fs.mkdirSync(dataDir, { recursive: true });

  const SQL = await initSqlJs();

  // Load existing database if it exists
  if (fs.existsSync(config.paths.db)) {
    const fileBuffer = fs.readFileSync(config.paths.db);
    db = new SQL.Database(fileBuffer);
    logger.info('Database loaded from file');
  } else {
    db = new SQL.Database();
    logger.info('New database created');
  }

  initializeSchema();
  saveToFile();
  dbReady = true;
  logger.info('Database initialized successfully');
  return db;
}

/**
 * Get the database instance (must call initDb first).
 */
function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

/**
 * Save the in-memory database to disk.
 */
function saveToFile() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(config.paths.db, buffer);
  } catch (error) {
    logger.error(`Failed to save database: ${error.message}`);
  }
}

function initializeSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS gmail_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      display_name TEXT,
      token_file TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      last_sync TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_email TEXT NOT NULL,
      message_id TEXT NOT NULL,
      sender TEXT,
      subject TEXT,
      received_date TEXT,
      report_date TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(account_email, message_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_date TEXT NOT NULL UNIQUE,
      file_path TEXT,
      total_accounts INTEGER DEFAULT 0,
      total_emails INTEGER DEFAULT 0,
      generation_status TEXT DEFAULT 'pending',
      whatsapp_status TEXT DEFAULT 'pending',
      whatsapp_sid TEXT,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Create indexes (IF NOT EXISTS not supported for indexes in all SQLite, use try-catch)
  try { db.run('CREATE INDEX IF NOT EXISTS idx_emails_account ON emails(account_email)'); } catch (e) {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_emails_report_date ON emails(report_date)'); } catch (e) {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_reports_date ON reports(report_date)'); } catch (e) {}
}

// --- Helper to run queries and return results ---

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function queryOne(sql, params = []) {
  const results = queryAll(sql, params);
  return results.length > 0 ? results[0] : null;
}

function runSql(sql, params = []) {
  db.run(sql, params);
  saveToFile();
  return { changes: db.getRowsModified() };
}

// --- Account operations ---

function addAccount(email, displayName, tokenFile) {
  runSql(`
    INSERT INTO gmail_accounts (email, display_name, token_file)
    VALUES (?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      display_name = excluded.display_name,
      token_file = excluded.token_file,
      is_active = 1,
      updated_at = datetime('now')
  `, [email, displayName, tokenFile]);
}

function getActiveAccounts() {
  return queryAll('SELECT * FROM gmail_accounts WHERE is_active = 1');
}

function updateAccountSync(email) {
  runSql(`
    UPDATE gmail_accounts SET last_sync = datetime('now'), updated_at = datetime('now')
    WHERE email = ?
  `, [email]);
}

function deactivateAccount(email) {
  runSql(`
    UPDATE gmail_accounts SET is_active = 0, updated_at = datetime('now')
    WHERE email = ?
  `, [email]);
}

// --- Email operations ---

function saveEmails(emails, reportDate) {
  let inserted = 0;
  for (const email of emails) {
    try {
      runSql(`
        INSERT OR IGNORE INTO emails (account_email, message_id, sender, subject, received_date, report_date)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [email.account, email.message_id, email.sender, email.subject, email.date, reportDate]);
      
      if (db.getRowsModified() > 0) inserted++;
    } catch (e) {
      // Duplicate or other error - skip
    }
  }
  saveToFile();
  return inserted;
}

function getEmailsByReportDate(reportDate) {
  return queryAll(
    'SELECT * FROM emails WHERE report_date = ? ORDER BY account_email, received_date DESC',
    [reportDate]
  );
}

function getEmailCountByAccount(reportDate) {
  return queryAll(
    'SELECT account_email, COUNT(*) as count FROM emails WHERE report_date = ? GROUP BY account_email',
    [reportDate]
  );
}

// --- Report operations ---

function createReport(reportDate) {
  const existing = queryOne('SELECT * FROM reports WHERE report_date = ?', [reportDate]);
  if (existing && existing.whatsapp_status === 'sent') {
    return { duplicate: true, report: existing };
  }

  runSql(`
    INSERT INTO reports (report_date)
    VALUES (?)
    ON CONFLICT(report_date) DO UPDATE SET
      generation_status = 'pending',
      error_message = NULL
  `, [reportDate]);

  const report = queryOne('SELECT * FROM reports WHERE report_date = ?', [reportDate]);
  return { duplicate: false, report };
}

function updateReportGeneration(reportDate, filePath, totalAccounts, totalEmails, status) {
  runSql(`
    UPDATE reports SET
      file_path = ?,
      total_accounts = ?,
      total_emails = ?,
      generation_status = ?,
      error_message = NULL
    WHERE report_date = ?
  `, [filePath, totalAccounts, totalEmails, status, reportDate]);
}

function updateReportWhatsApp(reportDate, status, sid, errorMessage) {
  runSql(`
    UPDATE reports SET
      whatsapp_status = ?,
      whatsapp_sid = ?,
      error_message = ?
    WHERE report_date = ?
  `, [status, sid, errorMessage, reportDate]);
}

function getLatestReport() {
  return queryOne('SELECT * FROM reports ORDER BY created_at DESC LIMIT 1');
}

function getReportByDate(reportDate) {
  return queryOne('SELECT * FROM reports WHERE report_date = ?', [reportDate]);
}

function getDashboardStats() {
  const accounts = queryOne('SELECT COUNT(*) as count FROM gmail_accounts WHERE is_active = 1');
  const latestReport = getLatestReport();
  const totalEmails = queryOne('SELECT COUNT(*) as count FROM emails');
  const totalReports = queryOne("SELECT COUNT(*) as count FROM reports WHERE generation_status = 'success'");

  return {
    activeAccounts: accounts ? accounts.count : 0,
    latestReport,
    totalEmailsCollected: totalEmails ? totalEmails.count : 0,
    totalReportsGenerated: totalReports ? totalReports.count : 0,
  };
}

function close() {
  if (db) {
    saveToFile();
    db.close();
    db = null;
    dbReady = false;
    logger.info('Database connection closed');
  }
}

module.exports = {
  initDb,
  getDb,
  addAccount,
  getActiveAccounts,
  updateAccountSync,
  deactivateAccount,
  saveEmails,
  getEmailsByReportDate,
  getEmailCountByAccount,
  createReport,
  updateReportGeneration,
  updateReportWhatsApp,
  getLatestReport,
  getReportByDate,
  getDashboardStats,
  close,
};
