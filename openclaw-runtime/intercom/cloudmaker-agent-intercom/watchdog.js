#!/usr/bin/env node
/**
 * PM2 Watchdog — Command Spine Self-Healing Monitor
 *
 * Monitors: ag-worker, neo-worker, github-receipt-writer
 * If any crash: attempts PM2 restart, then fires Telegram alert to Rob.
 *
 * Run with: node watchdog.js
 * Or via PM2: pm2 start watchdog.js --name "watchdog"
 */

require('dotenv').config();
const { exec } = require('child_process');
const https = require('https');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CHECK_INTERVAL_MS = 30000; // 30 seconds

const MONITORED_WORKERS = ['ag-worker', 'neo-worker', 'github-receipt-writer'];

// Track last known crash so we don't spam
const alertedAt = {};

function log(msg) {
  console.log(`[${new Date().toISOString()}] [WATCHDOG] ${msg}`);
}

function sendTelegramAlert(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    log('WARNING: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set. Cannot send alert.');
    return;
  }

  const body = JSON.stringify({
    chat_id: TELEGRAM_CHAT_ID,
    text: message,
    parse_mode: 'Markdown'
  });

  const options = {
    hostname: 'api.telegram.org',
    path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  };

  const req = https.request(options, (res) => {
    log(`Telegram alert sent. Status: ${res.statusCode}`);
  });

  req.on('error', (err) => {
    log(`ERROR: Telegram alert failed: ${err.message}`);
  });

  req.write(body);
  req.end();
}

function restartWorker(name) {
  return new Promise((resolve) => {
    exec(`pm2 restart ${name}`, (err, stdout, stderr) => {
      if (err) {
        resolve({ success: false, error: err.message });
      } else {
        resolve({ success: true, output: stdout });
      }
    });
  });
}

function getPM2Status() {
  return new Promise((resolve, reject) => {
    exec('pm2 jlist', {windowsHide: true}, (err, stdout) => {
      if (err) return reject(err);
      try {
        const list = JSON.parse(stdout);
        resolve(list);
      } catch (e) {
        reject(new Error('Failed to parse pm2 jlist output'));
      }
    });
  });
}

async function checkWorkers() {
  let list;
  try {
    list = await getPM2Status();
  } catch (err) {
    log(`ERROR: Could not get PM2 status: ${err.message}`);
    return;
  }

  for (const workerName of MONITORED_WORKERS) {
    const worker = list.find(p => p.name === workerName);

    if (!worker) {
      log(`ALERT: ${workerName} not found in PM2. Attempting to start...`);
      const result = await restartWorker(workerName);
      const ts = Date.now();
      const lastAlert = alertedAt[workerName] || 0;

      if (ts - lastAlert > 300000) { // 5 min cooldown on alerts
        sendTelegramAlert(
          `🚨 *COMMAND SPINE ALERT*\n\n` +
          `Worker \`${workerName}\` was *NOT FOUND* in PM2.\n` +
          `Auto-restart attempted: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}\n` +
          `${result.error ? `Error: ${result.error}` : ''}\n\n` +
          `Time: ${new Date().toISOString()}`
        );
        alertedAt[workerName] = ts;
      }
      continue;
    }

    const status = worker.pm2_env?.status;
    const restartCount = worker.pm2_env?.restart_time || 0;

    if (status !== 'online') {
      log(`ALERT: ${workerName} is in state: ${status}. Restarting...`);
      const result = await restartWorker(workerName);
      const ts = Date.now();
      const lastAlert = alertedAt[workerName] || 0;

      if (ts - lastAlert > 300000) {
        sendTelegramAlert(
          `🚨 *COMMAND SPINE ALERT*\n\n` +
          `Worker \`${workerName}\` is *${status.toUpperCase()}*.\n` +
          `Restarts so far: ${restartCount}\n` +
          `Auto-restart attempted: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}\n\n` +
          `Time: ${new Date().toISOString()}`
        );
        alertedAt[workerName] = ts;
      }
    } else {
      log(`OK: ${workerName} → online (restarts: ${restartCount})`);
    }
  }
}

// Save PM2 state so workers survive PC restarts
function savePM2State() {
  exec('pm2 save', {windowsHide: true}, (err) => {
    if (err) {
      log(`WARNING: pm2 save failed: ${err.message}`);
    } else {
      log('PM2 state saved.');
    }
  });
}

// Boot
log('=== COMMAND SPINE WATCHDOG STARTED ===');
log(`Monitoring: ${MONITORED_WORKERS.join(', ')}`);
log(`Check interval: ${CHECK_INTERVAL_MS / 1000}s`);
log(`Telegram alerts: ${TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID ? 'ENABLED' : 'DISABLED (missing env vars)'}`);

// Save PM2 state on boot so startup persistence is confirmed
savePM2State();

// Initial check
checkWorkers();

// Recurring check
setInterval(checkWorkers, CHECK_INTERVAL_MS);

// Graceful shutdown
process.on('SIGTERM', () => { log('SIGTERM received. Watchdog stopping.'); process.exit(0); });
process.on('SIGINT',  () => { log('SIGINT received. Watchdog stopping.');  process.exit(0); });
