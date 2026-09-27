const config = require('./config');
const logger = require('./logger');

/**
 * Delivery provider abstraction.
 * Supports: 'twilio' (real WhatsApp via Twilio) and 'demo' (log-only demo mode).
 */

function getDeliveryMode() {
  if (config.twilio.accountSid && config.twilio.authToken && config.twilio.whatsappTo) {
    return 'twilio';
  }
  return 'demo';
}

async function sendViaTwilio(message, mediaUrl) {
  const twilio = require('twilio');
  const client = twilio(config.twilio.accountSid, config.twilio.authToken);
  const msgOptions = {
    from: config.twilio.whatsappFrom,
    to: config.twilio.whatsappTo,
    body: message,
  };
  if (mediaUrl) {
    msgOptions.mediaUrl = [mediaUrl];
  }
  const result = await client.messages.create(msgOptions);
  return { sid: result.sid };
}

async function sendReportViaWhatsApp(pdfFilePath, message) {
  const defaultMsg = message || 'Your daily email report is ready.';
  const mode = getDeliveryMode();
  logger.info('Delivery started (mode: ' + mode + ')');

  if (mode === 'demo') {
    logger.info('[DEMO MODE] WhatsApp delivery simulated');
    logger.info('[DEMO MODE] Message: ' + defaultMsg);
    logger.info('[DEMO MODE] PDF available at: ' + pdfFilePath);
    return {
      success: true,
      sid: 'DEMO_' + Date.now(),
      method: 'demo',
      error: null,
      message: 'Demo mode - PDF generated and available for download. Configure Twilio for real WhatsApp delivery.',
    };
  }

  try {
    const fs = require('fs');
    if (!fs.existsSync(pdfFilePath)) {
      return { success: false, sid: null, method: 'twilio', error: 'PDF file not found: ' + pdfFilePath };
    }

    const publicBaseUrl = process.env.PUBLIC_REPORT_URL;
    let mediaUrl = null;
    if (publicBaseUrl) {
      const path = require('path');
      mediaUrl = publicBaseUrl + '/' + path.basename(pdfFilePath);
    }

    const result = await sendViaTwilio(defaultMsg, mediaUrl);
    if (result.sid) {
      logger.info('WhatsApp sent via Twilio. SID: ' + result.sid);
      return { success: true, sid: result.sid, method: 'twilio', error: null };
    }
    return { success: false, sid: null, method: 'twilio', error: 'No SID returned from Twilio' };
  } catch (error) {
    logger.error('WhatsApp delivery failed: ' + error.message);
    return { success: false, sid: null, method: 'twilio', error: error.message };
  }
}

module.exports = { sendReportViaWhatsApp, getDeliveryMode };
