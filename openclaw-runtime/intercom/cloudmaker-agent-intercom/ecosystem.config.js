// PM2 Ecosystem Configuration — Cloudmaker Phone Command Spine
// Usage: pm2 start ecosystem.config.js [--env production]

const BASE_CWD = 'C:/Users/tauru/.gemini/antigravity/scratch/cloudmaker-agent-intercom';

module.exports = {
  apps: [
    {
      name: 'intercom',
      script: 'src/server.js',
      cwd: BASE_CWD,
      env: {
        NODE_ENV: 'development',
        STORAGE_TYPE: 'memory',
        PORT: 4444
      },
      env_production: {
        NODE_ENV: 'production',
        STORAGE_TYPE: 'firestore',
        PORT: 8080
      },
      autorestart: true,
      max_restarts: 10,
      watch: false
    },
    {
      name: 'ag-worker',
      script: 'workers/ag_worker.js',
      cwd: BASE_CWD,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000
    },
    {
      name: 'neo-worker',
      script: 'workers/neo_worker.js',
      cwd: BASE_CWD,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000
    },
    {
      name: 'miyagi-worker',
      script: 'workers/miyagi_worker.js',
      cwd: BASE_CWD,
      autorestart: true,
      max_restarts: 5,
      restart_delay: 3000
    },
    {
      name: 'github-receipt-writer',
      script: 'workers/github_receipt_writer.js',
      cwd: BASE_CWD,
      autorestart: true,
      max_restarts: 5,
      restart_delay: 10000
    }
  ]
};
