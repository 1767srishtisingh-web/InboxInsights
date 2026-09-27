const cron = require('node-cron');
const config = require('./config');
const logger = require('./logger');

let scheduledTask = null;
let isRunning = false;
let currentReportTime = null;
let currentTimezone = null;

function getCronExpression(reportTime) {
  const time = reportTime || config.scheduler.reportTime || '20:00';
  const parts = time.split(':');
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  if (isNaN(hours) || isNaN(minutes)) {
    logger.error('Invalid report time: ' + time + ', defaulting to 20:00');
    return '0 20 * * *';
  }
  return minutes + ' ' + hours + ' * * *';
}

function startScheduler(pipelineCallback, reportTime, timezone) {
  if (scheduledTask) {
    logger.warn('Scheduler is already running');
    return;
  }
  currentReportTime = reportTime || config.scheduler.reportTime;
  currentTimezone = timezone || config.scheduler.timezone;
  const cronExpr = getCronExpression(currentReportTime);

  logger.info('Scheduler started: will run at ' + currentReportTime + ' (' + currentTimezone + ')');
  logger.info('Cron expression: ' + cronExpr);

  scheduledTask = cron.schedule(cronExpr, async () => {
    if (isRunning) {
      logger.warn('Previous scheduled run still in progress. Skipping this trigger.');
      return;
    }
    isRunning = true;
    logger.info('=== Scheduled report triggered ===');
    const startTime = Date.now();
    try {
      await pipelineCallback();
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.info('Scheduled report completed in ' + elapsed + 's');
    } catch (error) {
      logger.error('Scheduled report failed: ' + error.message);
    } finally {
      isRunning = false;
    }
  }, {
    scheduled: true,
    timezone: currentTimezone,
  });
}

function stopScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    logger.info('Scheduler stopped');
  }
}

function restartScheduler(reportTime, timezone, pipelineCallback) {
  stopScheduler();
  startScheduler(pipelineCallback, reportTime, timezone);
  logger.info('Scheduler restarted with new time: ' + reportTime + ' (' + timezone + ')');
}

function getSchedulerStatus() {
  return {
    running: scheduledTask !== null,
    reportTime: currentReportTime || config.scheduler.reportTime,
    timezone: currentTimezone || config.scheduler.timezone,
    cronExpression: getCronExpression(currentReportTime),
    isPipelineRunning: isRunning,
  };
}

module.exports = { startScheduler, stopScheduler, restartScheduler, getSchedulerStatus };
