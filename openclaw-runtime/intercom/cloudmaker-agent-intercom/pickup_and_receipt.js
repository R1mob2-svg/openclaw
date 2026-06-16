const https = require('https');

const API_KEY = process.env.INTERCOM_API_KEY || '002ed024f4694a4cb00e80be4ff691c3';
const API_URL = 'https://cloudmaker-agent-intercom-608388585234.us-central1.run.app';

async function request(path, method = 'GET', payload = null) {
  return new Promise((resolve, reject) => {
    const opts = { method, headers: { 'x-api-key': API_KEY } };
    let data;
    if (payload) {
      opts.headers['Content-Type'] = 'application/json';
      data = JSON.stringify(payload);
      opts.headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = https.request(API_URL + path, opts, res => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b) }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  const { status, body } = await request('/tasks');
  if (status !== 200) return console.error("Failed to list:", body);
  
  const tasks = Array.isArray(body) ? body : body.tasks;
  const targetTask = tasks.find(t => t.title === 'PHONE_COMMAND_REAL_E2E_20260527_001' && t.status === 'NEW');
  if (!targetTask) return console.error("Task not found!");
  
  const taskId = targetTask.id;
  console.log("Found task:", taskId);
  
  const claimRes = await request(`/tasks/${taskId}/claim`, 'POST', { agent: 'NEO' });
  console.log("Claim:", claimRes.status);
  const lockToken = claimRes.body.lock_token;
  
  const hbRes = await request(`/tasks/${taskId}/heartbeat`, 'POST', { status: 'IN_PROGRESS', lock_token: lockToken });
  console.log("Heartbeat:", hbRes.status);
  
  const receiptRes = await request(`/tasks/${taskId}/receipt`, 'POST', {
    lock_token: lockToken,
    receipt: {
       command_id: "PHONE_COMMAND_REAL_E2E_20260527_001",
       verdict: "READY_FOR_NEWTON_REVIEW",
       live_actions: false,
       github_issue_number: targetTask.github_issue_number
    }
  });
  console.log("Receipt:", receiptRes.status);
}
run();
