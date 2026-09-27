const { google } = require('googleapis');
const logger = require('./logger');
const gmailAuth = require('./gmail-auth');
const database = require('./database');

/**
 * Fetch emails from a single Gmail account.
 * @param {string} email - The Gmail account email
 * @param {string} tokenFile - Token filename
 * @param {Object} options - Fetch options
 * @param {number} options.maxResults - Maximum emails to fetch (default: 50)
 * @param {string} options.query - Gmail search query (default: 'newer_than:1d')
 * @returns {Promise<Array>} Array of normalized email objects
 */
async function fetchEmailsFromAccount(email, tokenFile, options = {}) {
  const maxResults = options.maxResults || 50;
  const query = options.query || 'newer_than:1d';

  try {
    const auth = await gmailAuth.getAuthenticatedClient(email, tokenFile);
    if (!auth) {
      logger.error(`Cannot fetch emails - authentication failed for ${email}`);
      return { success: false, emails: [], error: 'Authentication failed' };
    }

    const gmail = google.gmail({ version: 'v1', auth });

    // List messages matching the query
    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults,
    });

    const messages = listResponse.data.messages || [];
    
    if (messages.length === 0) {
      logger.info(`No emails found for ${email}`);
      return { success: true, emails: [], error: null };
    }

    logger.info(`Found ${messages.length} emails for ${email}`);

    // Fetch details for each message
    const emails = [];
    const seenIds = new Set();

    for (const msg of messages) {
      // Deduplicate within same fetch
      if (seenIds.has(msg.id)) continue;
      seenIds.add(msg.id);

      try {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'Date'],
        });

        const headers = detail.data.payload.headers || [];
        const getHeader = (name) => {
          const h = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
          return h ? h.value : '';
        };

        const subject = getHeader('Subject') || '(No Subject)';
        const sender = getHeader('From') || 'Unknown';
        const dateStr = getHeader('Date') || '';

        // Parse and format the date
        let formattedDate = '';
        try {
          const parsed = new Date(dateStr);
          if (!isNaN(parsed.getTime())) {
            formattedDate = parsed.toISOString().replace('T', ' ').substring(0, 16);
          } else {
            formattedDate = dateStr;
          }
        } catch {
          formattedDate = dateStr;
        }

        emails.push({
          account: email,
          sender: sender,
          subject: subject,
          date: formattedDate,
          message_id: msg.id,
        });
      } catch (msgError) {
        logger.warn(`Failed to fetch message ${msg.id} for ${email}: ${msgError.message}`);
        // Continue with other messages
      }
    }

    database.updateAccountSync(email);
    logger.info(`Successfully fetched ${emails.length} emails for ${email}`);

    return { success: true, emails, error: null };
  } catch (error) {
    logger.error(`Email fetch error for ${email}: ${error.message}`);
    return { success: false, emails: [], error: error.message };
  }
}

/**
 * Fetch emails from ALL active Gmail accounts.
 * Continues processing even if individual accounts fail.
 * @param {Object} options - Fetch options
 * @returns {Promise<Object>} Results object with all emails and per-account status
 */
async function fetchAllEmails(options = {}) {
  const accounts = database.getActiveAccounts();
  const startTime = Date.now();

  if (accounts.length === 0) {
    logger.warn('No active Gmail accounts found');
    return {
      success: false,
      allEmails: [],
      accountResults: [],
      totalAccounts: 0,
      totalEmails: 0,
      error: 'No active Gmail accounts configured',
    };
  }

  logger.info(`Starting email fetch for ${accounts.length} account(s)`);

  const accountResults = [];
  const allEmails = [];
  let successCount = 0;
  let failCount = 0;

  for (const account of accounts) {
    logger.info(`Processing account: ${account.email}`);
    const result = await fetchEmailsFromAccount(account.email, account.token_file, options);
    
    accountResults.push({
      email: account.email,
      success: result.success,
      emailCount: result.emails.length,
      error: result.error,
    });

    if (result.success) {
      allEmails.push(...result.emails);
      successCount++;
      logger.info(`Account ${account.email} processed — ${result.emails.length} emails`);
    } else {
      failCount++;
      logger.error(`Account ${account.email} failed: ${result.error}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  logger.info(`Email fetch complete: ${successCount} succeeded, ${failCount} failed, ${allEmails.length} total emails in ${elapsed}s`);

  return {
    success: successCount > 0,
    allEmails,
    accountResults,
    totalAccounts: accounts.length,
    successfulAccounts: successCount,
    failedAccounts: failCount,
    totalEmails: allEmails.length,
    elapsedSeconds: parseFloat(elapsed),
  };
}

module.exports = {
  fetchEmailsFromAccount,
  fetchAllEmails,
};
