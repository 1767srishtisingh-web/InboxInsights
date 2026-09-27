const twilio = require('twilio');
const config = require('./config');
const logger = require('./logger');

/**
 * Send a PDF report via WhatsApp using Twilio.
 * @param {string} pdfFilePath - Absolute path to the PDF file
 * @param {string} message - Message to accompany the PDF
 * @returns {Promise<{success: boolean, sid: string|null, error: string|null}>}
 */
async function sendReportViaWhatsApp(pdfFilePath, message = 'Your daily email report is ready.') {
  logger.info('WhatsApp sending started');

  // Validate configuration
  if (!config.twilio.accountSid || !config.twilio.authToken) {
    const error = 'Twilio credentials not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.';
    logger.error(error);
    return { success: false, sid: null, error };
  }

  if (!config.twilio.whatsappTo) {
    const error = 'WhatsApp recipient not configured. Set WHATSAPP_TO.';
    logger.error(error);
    return { success: false, sid: null, error };
  }

  try {
    const client = twilio(config.twilio.accountSid, config.twilio.authToken);

    // For Twilio WhatsApp, we need the PDF to be accessible via URL.
    // In production, you'd host the file. For now, we send a text message
    // with the report info. To send media, the PDF must be at a public URL.
    // 
    // If you have a public URL for serving reports, set it in the config.
    // Otherwise, this sends a text summary with the report available locally.

    const fs = require('fs');
    if (!fs.existsSync(pdfFilePath)) {
      const error = `PDF file not found: ${pdfFilePath}`;
      logger.error(error);
      return { success: false, sid: null, error };
    }

    const messageOptions = {
      from: config.twilio.whatsappFrom,
      to: config.twilio.whatsappTo,
      body: message,
    };

    // If a public base URL is configured, include the PDF as media
    const publicBaseUrl = process.env.PUBLIC_REPORT_URL;
    if (publicBaseUrl) {
      const path = require('path');
      const fileName = path.basename(pdfFilePath);
      messageOptions.mediaUrl = [`${publicBaseUrl}/${fileName}`];
    }

    const result = await client.messages.create(messageOptions);

    if (result.sid) {
      logger.info(`WhatsApp report sent successfully. SID: ${result.sid}`);
      return { success: true, sid: result.sid, error: null };
    } else {
      const error = 'Twilio did not return a message SID';
      logger.error(error);
      return { success: false, sid: null, error };
    }
  } catch (error) {
    logger.error(`WhatsApp delivery failed: ${error.message}`);
    return { success: false, sid: null, error: error.message };
  }
}

module.exports = {
  sendReportViaWhatsApp,
};
