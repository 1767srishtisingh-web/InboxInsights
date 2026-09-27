const logger = require('./logger');
const database = require('./database');
const emailFetcher = require('./email-fetcher');
const pdfGenerator = require('./pdf-generator');
const whatsappSender = require('./whatsapp-sender');

/**
 * Run the complete email report pipeline.
 * @param {Object} options
 * @param {boolean} options.sendWhatsApp - Whether to send via WhatsApp/delivery (default: true)
 * @param {boolean} options.force - Force even if report already sent today (default: false)
 * @param {boolean} options.demoData - Use demo data instead of real Gmail fetch (default: false)
 * @returns {Promise<Object>} Pipeline result
 */
async function runPipeline(options = {}) {
  const sendWhatsApp = options.sendWhatsApp !== false;
  const force = options.force === true;
  const useDemoData = options.demoData === true;
  const startTime = Date.now();

  logger.info('=== Report pipeline started ===');

  const now = new Date();
  const reportDate = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;

  const result = {
    reportDate,
    startedAt: now.toISOString(),
    emailFetch: null,
    pdfGeneration: null,
    delivery: null,
    success: false,
    error: null,
    elapsedSeconds: 0,
  };

  try {
    // Step 0: Check for duplicate report
    const reportRecord = database.createReport(reportDate);
    if (reportRecord.duplicate && !force) {
      logger.warn('Report for ' + reportDate + ' already delivered. Use force=true to resend.');
      result.error = 'Report already sent today. Use force option to regenerate.';
      result.elapsedSeconds = parseFloat(((Date.now() - startTime) / 1000).toFixed(2));
      return result;
    }

    const user = database.getUser();
    const userName = user ? user.name : 'User';

    let allEmails = [];
    let fetchResult = null;

    if (useDemoData) {
      // Step 1 (Demo): Generate demo email data
      logger.info('Step 1: Using demo data...');
      allEmails = generateDemoEmails();
      fetchResult = {
        success: true,
        allEmails,
        totalAccounts: [...new Set(allEmails.map(e => e.account))].length,
        successfulAccounts: [...new Set(allEmails.map(e => e.account))].length,
        failedAccounts: 0,
        totalEmails: allEmails.length,
      };
      result.emailFetch = fetchResult;
      logger.info('Demo data: ' + allEmails.length + ' emails from ' + fetchResult.totalAccounts + ' accounts');
    } else {
      // Step 1 (Real): Fetch emails from all accounts
      logger.info('Step 1: Fetching emails from all Gmail accounts...');
      fetchResult = await emailFetcher.fetchAllEmails();
      result.emailFetch = fetchResult;
      allEmails = fetchResult.allEmails;

      if (!fetchResult.success) {
        logger.error('All Gmail accounts failed. Aborting pipeline.');
        result.error = 'All Gmail accounts failed during email fetch';
        database.updateReportGeneration(reportDate, null, 0, 0, 'failed');
        database.updateReportDelivery(reportDate, 'skipped', 'none', null, 'Email fetch failed');
        result.elapsedSeconds = parseFloat(((Date.now() - startTime) / 1000).toFixed(2));
        return result;
      }
    }

    // Save emails to database
    if (allEmails.length > 0) {
      const inserted = database.saveEmails(allEmails, reportDate);
      logger.info('Saved ' + inserted + ' new emails to database (' + allEmails.length + ' total fetched)');
    }

    // Step 2: Generate PDF
    logger.info('Step 2: Generating PDF report...');
    const pdfResult = await pdfGenerator.generateReport(allEmails, { reportDate, userName });
    result.pdfGeneration = pdfResult;

    if (!pdfResult.success) {
      logger.error('PDF generation failed: ' + pdfResult.error);
      result.error = 'PDF generation failed';
      database.updateReportGeneration(reportDate, null, fetchResult.successfulAccounts || 0, fetchResult.totalEmails || 0, 'failed');
      database.updateReportDelivery(reportDate, 'skipped', 'none', null, 'PDF generation failed');
      result.elapsedSeconds = parseFloat(((Date.now() - startTime) / 1000).toFixed(2));
      return result;
    }

    database.updateReportGeneration(
      reportDate, pdfResult.filePath,
      fetchResult.successfulAccounts || fetchResult.totalAccounts || 0,
      fetchResult.totalEmails || allEmails.length, 'success'
    );
    logger.info('PDF generated successfully');

    // Step 3: Send via delivery provider (WhatsApp/Demo)
    if (sendWhatsApp) {
      logger.info('Step 3: Sending report via delivery provider...');
      const deliveryResult = await whatsappSender.sendReportViaWhatsApp(
        pdfResult.filePath,
        'Your daily email report is ready.\n\nDate: ' + reportDate +
        '\nAccounts: ' + (fetchResult.successfulAccounts || fetchResult.totalAccounts || 0) +
        '\nEmails: ' + (fetchResult.totalEmails || allEmails.length)
      );
      result.delivery = deliveryResult;

      if (deliveryResult.success) {
        database.updateReportDelivery(reportDate, 'sent', deliveryResult.method, deliveryResult.sid, null);
        logger.info('Report delivery completed (' + deliveryResult.method + ' mode)');
      } else {
        database.updateReportDelivery(reportDate, 'failed', deliveryResult.method, null, deliveryResult.error);
        logger.error('Delivery failed: ' + deliveryResult.error);
      }
    } else {
      logger.info('Step 3: Delivery skipped (test mode)');
      database.updateReportDelivery(reportDate, 'skipped', 'test', null, 'Test mode - no delivery');
      result.delivery = { success: true, sid: null, method: 'test', error: null, skipped: true };
    }

    result.success = true;
  } catch (error) {
    logger.error('Pipeline error: ' + error.message);
    result.error = error.message;
  }

  result.elapsedSeconds = parseFloat(((Date.now() - startTime) / 1000).toFixed(2));
  logger.info('=== Report pipeline finished in ' + result.elapsedSeconds + 's ===' + (result.success ? '' : ' (with errors)'));
  return result;
}

/**
 * Generate demo email data for testing/presentation.
 */
function generateDemoEmails() {
  const demoAccounts = [
    'srishti.singh@gmail.com',
    'srishti.work@gmail.com',
    'srishti.uni@gmail.com',
  ];

  const demoSubjects = [
    ['Meeting tomorrow at 3 PM - Project Review', 'Your AWS bill for September 2026', 'RE: Internship Application Status', 'GitHub: Pull request merged', 'LinkedIn: 5 new connection requests', 'Google Cloud: Your free trial is expiring', 'Weekly Newsletter: Tech Digest'],
    ['Team standup notes - Sept 27', 'Invitation: Design Sprint Workshop', 'Slack notification summary', 'RE: Q3 Performance Review', 'New comment on your document'],
    ['Assignment 3 deadline extended', 'Library: Books due in 3 days', 'Campus event: Tech Talk by Google', 'Exam schedule released for October', 'Scholarship application update', 'RE: Research paper collaboration'],
  ];

  const demoSenders = [
    ['boss@company.com', 'aws-billing@amazon.com', 'hr@techcorp.com', 'notifications@github.com', 'messages@linkedin.com', 'cloud@google.com', 'editor@techdigest.com'],
    ['pm@company.com', 'events@company.com', 'notifications@slack.com', 'hr@company.com', 'docs@google.com'],
    ['professor@university.edu', 'library@university.edu', 'events@university.edu', 'examoffice@university.edu', 'scholarships@university.edu', 'labpartner@university.edu'],
  ];

  const emails = [];
  const now = new Date();

  demoAccounts.forEach((account, accIdx) => {
    const subjects = demoSubjects[accIdx] || [];
    const senders = demoSenders[accIdx] || [];
    subjects.forEach((subject, i) => {
      const emailDate = new Date(now.getTime() - (i * 3600000 + Math.random() * 7200000));
      emails.push({
        account,
        sender: senders[i] || 'unknown@example.com',
        subject,
        date: emailDate.toISOString().replace('T', ' ').substring(0, 16),
        message_id: 'demo_' + accIdx + '_' + i + '_' + Date.now(),
      });
    });
  });

  return emails;
}

module.exports = { runPipeline, generateDemoEmails };
