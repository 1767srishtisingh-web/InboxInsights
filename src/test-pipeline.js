/**
 * Manual test script for the InboxInsights pipeline.
 * Run with: node src/test-pipeline.js [--send-whatsapp] [--force]
 */

require('dotenv').config();
const logger = require('./logger');
const database = require('./database');
const pipeline = require('./pipeline');

async function main() {
  const args = process.argv.slice(2);
  const sendWhatsApp = args.includes('--send-whatsapp');
  const force = args.includes('--force');

  logger.info('=== InboxInsights Manual Pipeline Test ===');
  logger.info(`Options: sendWhatsApp=${sendWhatsApp}, force=${force}`);

  // Initialize database
  await database.initDb();

  // Check accounts
  const accounts = database.getActiveAccounts();
  logger.info(`Active Gmail accounts: ${accounts.length}`);
  
  if (accounts.length === 0) {
    logger.warn('No Gmail accounts configured.');
    logger.warn('Start the server and visit http://localhost:3000/auth/google to add accounts.');
    process.exit(1);
  }

  for (const account of accounts) {
    logger.info(`  - ${account.email} (last sync: ${account.last_sync || 'never'})`);
  }

  // Run pipeline
  const result = await pipeline.runPipeline({
    sendWhatsApp,
    force,
  });

  // Print results
  console.log('\n--- Pipeline Result ---');
  console.log(JSON.stringify(result, null, 2));

  if (result.success) {
    logger.info('\nPipeline completed successfully!');
    if (result.pdfGeneration && result.pdfGeneration.filePath) {
      logger.info(`PDF saved at: ${result.pdfGeneration.filePath}`);
    }
  } else {
    logger.error(`\nPipeline failed: ${result.error}`);
  }

  // Clean up
  database.close();
  process.exit(result.success ? 0 : 1);
}

main().catch((error) => {
  logger.error(`Test pipeline error: ${error.message}`);
  database.close();
  process.exit(1);
});
