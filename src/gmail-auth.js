const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./logger');
const database = require('./database');

/**
 * Create an OAuth2 client configured with app credentials.
 */
function createOAuth2Client() {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
}

/**
 * Generate the authorization URL for a new Gmail account.
 */
function getAuthUrl() {
  const oauth2Client = createOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: config.google.scopes,
  });
}

/**
 * Exchange authorization code for tokens, save them, and register the account.
 * @param {string} code - Authorization code from Google OAuth callback
 * @returns {Promise<{email: string, displayName: string}>}
 */
async function handleAuthCallback(code) {
  const oauth2Client = createOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  // Get user info to identify the account
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const userInfo = await oauth2.userinfo.get();
  const email = userInfo.data.email;
  const displayName = userInfo.data.name || email;

  // Save token to file
  const tokenFileName = email.replace(/[^a-zA-Z0-9]/g, '_') + '.json';
  const tokenFilePath = path.join(config.paths.tokens, tokenFileName);

  fs.mkdirSync(config.paths.tokens, { recursive: true });
  fs.writeFileSync(tokenFilePath, JSON.stringify(tokens, null, 2));

  // Register account in database
  database.addAccount(email, displayName, tokenFileName);

  logger.info(`Gmail account authenticated: ${email}`);
  return { email, displayName };
}

/**
 * Get an authenticated OAuth2 client for a specific account.
 * Handles token refresh automatically.
 * @param {string} email - The Gmail account email
 * @param {string} tokenFile - The token filename
 * @returns {Promise<google.auth.OAuth2|null>}
 */
async function getAuthenticatedClient(email, tokenFile) {
  try {
    const tokenFilePath = path.join(config.paths.tokens, tokenFile);

    if (!fs.existsSync(tokenFilePath)) {
      logger.error(`Token file not found for ${email}: ${tokenFile}`);
      return null;
    }

    const tokens = JSON.parse(fs.readFileSync(tokenFilePath, 'utf8'));
    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials(tokens);

    // Set up automatic token refresh and save
    oauth2Client.on('tokens', (newTokens) => {
      const updatedTokens = { ...tokens, ...newTokens };
      fs.writeFileSync(tokenFilePath, JSON.stringify(updatedTokens, null, 2));
      logger.info(`Token refreshed for ${email}`);
    });

    // Test the token by trying to refresh it
    const tokenInfo = await oauth2Client.getAccessToken();
    if (!tokenInfo.token) {
      logger.error(`Failed to get access token for ${email}`);
      return null;
    }

    return oauth2Client;
  } catch (error) {
    logger.error(`Authentication failed for ${email}: ${error.message}`);
    return null;
  }
}

/**
 * Verify all active accounts and return their auth status.
 * @returns {Promise<Array<{email: string, authenticated: boolean, error?: string}>>}
 */
async function verifyAllAccounts() {
  const accounts = database.getActiveAccounts();
  const results = [];

  for (const account of accounts) {
    try {
      const client = await getAuthenticatedClient(account.email, account.token_file);
      results.push({
        email: account.email,
        authenticated: client !== null,
        error: client === null ? 'Token invalid or expired' : undefined,
      });
    } catch (error) {
      results.push({
        email: account.email,
        authenticated: false,
        error: error.message,
      });
    }
  }

  return results;
}

/**
 * Remove a Gmail account's token and deactivate it.
 * @param {string} email
 */
function removeAccount(email) {
  const accounts = database.getActiveAccounts();
  const account = accounts.find(a => a.email === email);
  if (account) {
    const tokenFilePath = path.join(config.paths.tokens, account.token_file);
    if (fs.existsSync(tokenFilePath)) {
      fs.unlinkSync(tokenFilePath);
    }
    database.deactivateAccount(email);
    logger.info(`Account removed: ${email}`);
  }
}

module.exports = {
  createOAuth2Client,
  getAuthUrl,
  handleAuthCallback,
  getAuthenticatedClient,
  verifyAllAccounts,
  removeAccount,
};
