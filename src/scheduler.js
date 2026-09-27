const cron = require('node-cron');
const config = require('./config');
const logger = require('./logger');

let scheduledTask = null;
let isRunning = false;

/**
 * Parse the configured report time (HH:MM) into cron format.
 * @returns {string} Cron expression
 */
function getCronExpression() {
  const [hours, minutes] = config.scheduler.reportTime.split(':');
  // Cron: minute hour * * *
  return `${parseInt(minutes, 10)} ${parseInt(hours, 10)} * * *`;
}

/**
 * Start the daily report scheduler.
 * @param {Function} pipelineCallback - Async function to execute the report pipeline
 */
function startScheduler(pipelineCallback) {
  if (scheduledTask) {
    logger.warn('Scheduler is already running');
    return;
  }

  const cronExpr = getCronExpression();
  const timezone = config.scheduler.timezone;

  logger.info(`Scheduler started: will run at ${config.scheduler.reportTime} (${timezone})`);
  logger.info(`Cron expression: ${cronExpr}`);

  scheduledTask = cron.schedule(cronExpr, async () => {
    if (isRunning) {
      logger.warn('Previous scheduled run still in progress. Skipping this trigger.');
      return;
    }

    isRunning = true;
    logger.info('=== Scheduled report triggered ===' );
    const startTime = Date.now();

    try {
      await pipelineCallback();
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.info(`Scheduled report completed in ${elapsed}s`);
    } catch (error) {
      logger.error(`Scheduled report failed: ${error.message}`);
    } finally {
      isRunning = false;
    }
  }, {
    scheduled: true,
    timezone: timezone,
  });
}

/**
 * Stop the scheduler.
 */
function stopScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    logger.info('Scheduler stopped');
  }
}

/**
 * Get the current scheduler status.
 */
function getSchedulerStatus() {
  return {
    running: scheduledTask !== null,
    reportTime: config.scheduler.reportTime,
    timezone: config.scheduler.timezone,
    cronExpression: getCronExpression(),
    isPipelineRunning: isRunning,
  };
}

module.exports = {
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
};
