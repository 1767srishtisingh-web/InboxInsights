const logger = require('./logger');
const database = require('./database');
const emailFetcher = require('./email-fetcher');
const pdfGenerator = require('./pdf-generator');
const whatsappSender = require('./whatsapp-sender');

/**
 * Run the complete email report pipeline.
 * @param {Object} options
 * @param {boolean} options.sendWhatsApp - Whether to send via WhatsApp (default: true)
 * @param {boolean} options.force - Force even if report already sent today (default: false)
 * @returns {Promise<Object>} Pipeline result
 */
async function runPipeline(options = {}) {
  const sendWhatsApp = options.sendWhatsApp !== false;
  const force = options.force === true;
  const startTime = Date.now();

  logger.info('=== Report pipeline started ===');

  const now = new Date();
  const reportDate = `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`;

  const result = {
    reportDate,
    startedAt: now.toISOString(),
    emailFetch: null,
    pdfGeneration: null,
    whatsappDelivery: null,
    success: false,
    error: null,
    elapsedSeconds: 0,
  };

  try {
    // Step 0: Check for duplicate report
    const reportRecord = database.createReport(reportDate);
    if (reportRecord.duplicate && !force) {
      logger.warn(`Report for ${reportDate} already sent via WhatsApp. Use force=true to resend.`);
      result.error = 'Report already sent today. Use force option to regenerate.';
      result.elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
      return result;
    }

    // Step 1: Fetch emails from all accounts
    logger.info('Step 1: Fetching emails from all Gmail accounts...');
    const fetchResult = await emailFetcher.fetchAllEmails();
    result.emailFetch = fetchResult;

    if (!fetchResult.success) {
      logger.error('All Gmail accounts failed. Aborting pipeline.');
      result.error = 'All Gmail accounts failed during email fetch';
      database.updateReportGeneration(reportDate, null, 0, 0, 'failed');
      database.updateReportWhatsApp(reportDate, 'skipped', null, 'Email fetch failed');
      result.elapsedSeconds = parseFloat(((Date.now() - startTime) / 1000).toFixed(2));
      return result;
    }

    // Save emails to database
    if (fetchResult.allEmails.length > 0) {
      const inserted = database.saveEmails(fetchResult.allEmails, reportDate);
      logger.info(`Saved ${inserted} new emails to database (${fetchResult.allEmails.length} total fetched)`);
    }

    // Step 2: Generate PDF
    logger.info('Step 2: Generating PDF report...');
    const pdfResult = await pdfGenerator.generateReport(fetchResult.allEmails, { reportDate });
    result.pdfGeneration = pdfResult;

    if (!pdfResult.success) {
      logger.error(`PDF generation failed: ${pdfResult.error}`);
      result.error = 'PDF generation failed';
      database.updateReportGeneration(reportDate, null, fetchResult.successfulAccounts, fetchResult.totalEmails, 'failed');
      database.updateReportWhatsApp(reportDate, 'skipped', null, 'PDF generation failed');
      result.elapsedSeconds = parseFloat(((Date.now() - startTime) / 1000).toFixed(2));
      return result;
    }

    database.updateReportGeneration(
      reportDate,
      pdfResult.filePath,
      fetchResult.successfulAccounts,
      fetchResult.totalEmails,
      'success'
    );
    logger.info('PDF generated successfully');

    // Step 3: Send via WhatsApp (optional)
    if (sendWhatsApp) {
      logger.info('Step 3: Sending report via WhatsApp...');
      const whatsappResult = await whatsappSender.sendReportViaWhatsApp(
        pdfResult.filePath,
        `\u{1F4E7} Your daily email report is ready.\n\nDate: ${reportDate}\nAccounts: ${fetchResult.successfulAccounts}\nEmails: ${fetchResult.totalEmails}`
      );
      result.whatsappDelivery = whatsappResult;

      if (whatsappResult.success) {
        database.updateReportWhatsApp(reportDate, 'sent', whatsappResult.sid, null);
        logger.info('WhatsApp report sent successfully');
      } else {
        database.updateReportWhatsApp(reportDate, 'failed', null, whatsappResult.error);
        logger.error(`WhatsApp delivery failed: ${whatsappResult.error}`);
        // PDF is still available even though WhatsApp failed
      }
    } else {
      logger.info('Step 3: WhatsApp sending skipped (test mode)');
      result.whatsappDelivery = { success: true, sid: null, error: null, skipped: true };
    }

    result.success = true;
  } catch (error) {
    logger.error(`Pipeline error: ${error.message}`);
    result.error = error.message;
  }

  result.elapsedSeconds = parseFloat(((Date.now() - startTime) / 1000).toFixed(2));
  logger.info(`=== Report pipeline finished in ${result.elapsedSeconds}s ===${result.success ? '' : ' (with errors)'}`);

  return result;
}

module.exports = {
  runPipeline,
};
