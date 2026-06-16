const https = require('https');

const API_KEY = '002ed024f4694a4cb00e80be4ff691c3';
const API_URL = 'https://cloudmaker-agent-intercom-608388585234.us-central1.run.app';

// Mock GitHub Issue Envelope
const issueBody = `
Please execute the following command:
\`\`\`json
{
  "command_id": "PHONE_COMMAND_FINAL_E2E_20260527_001",
  "source": "github_fallback",
  "target_agent": "NEO",
  "cc_agents": ["AG", "GeminX", "Miyagi"],
  "task_type": "COMMS_PICKUP_PROOF",
  "live_actions": false
}
\`\`\`
`;

async function postTask(payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request(API_URL + '/tasks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'Content-Length': data.length
      }
    }, res => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b) }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function getTask(taskId) {
  return new Promise((resolve, reject) => {
    const req = https.request(API_URL + '/tasks/' + taskId, {
      method: 'GET',
      headers: { 'x-api-key': API_KEY }
    }, res => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b) }));
    });
    req.on('error', reject);
    req.end();
  });
}

let lockToken = '';

async function claimTask(taskId, agent) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify({ agent: agent });
      const req = https.request(API_URL + '/tasks/' + taskId + '/claim', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
          'Content-Length': data.length
        }
      }, res => {
        let b = '';
        res.on('data', d => b += d);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b) }));
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
}

async function heartbeatTask(taskId, statusMsg) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify({ status: statusMsg, lock_token: lockToken });
      const req = https.request(API_URL + '/tasks/' + taskId + '/heartbeat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
          'Content-Length': Buffer.byteLength(data)
        }
      }, res => {
        let b = '';
        res.on('data', d => b += d);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b) }));
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
}

async function runProof() {
  console.log("1. Simulating GitHub Issue Trigger (Workflow Extracts Payload)");
  const match = issueBody.match(/```json\n([\s\S]*?)\n```/);
  const payload = JSON.parse(match[1]);
  payload.github_issue_number = 999; // mock issue number

  console.log("2. Sending command to Intercom API...");
  const createRes = await postTask(payload);
  console.log("Status:", createRes.status);
  
  if (createRes.status !== 201) {
      console.log("Failed:", createRes.body);
      return;
  }
  
  const taskId = createRes.body.id || createRes.body.task_id;
  console.log("Task Created ID:", taskId);
  console.log("GitHub ACK: Command successfully received and routed to Intercom API.");
  
  console.log("\n3. Agent (NEO) claiming task...");
  const claimRes = await claimTask(taskId, 'NEO');
  lockToken = claimRes.body.lock_token;
  
  let t = await getTask(taskId);
  const taskData = t.body.task || t.body;
  console.log(`Task Status: ${taskData.status}, Assigned: ${taskData.assigned_agent}`);
  
  console.log("\n4. Agent writing heartbeat...");
  await heartbeatTask(taskId, 'IN_PROGRESS');
  
  console.log("\n5. Agent completing task with receipt...");
  const completeRes = await new Promise((resolve, reject) => {
    const data = JSON.stringify({
      lock_token: lockToken,
      receipt: {
         command_id: payload.command_id,
         verdict: "READY_FOR_NEWTON_REVIEW",
         live_actions: false,
         google_sheets_machine_truth: false,
         secrets_printed: false
      }
    });
    const req = https.request(API_URL + '/tasks/' + taskId + '/receipt', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b) }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
  
  console.log("Result Status:", completeRes.status);
  console.log("Final Task State:");
  t = await getTask(taskId);
  const finalTaskData = t.body.task || t.body;
  console.log(JSON.stringify(finalTaskData, null, 2));
  
  console.log("\n6. Simulated GitHub Receipt Workflow (command_receipt event)");
  console.log(`Posting comment to issue #${payload.github_issue_number}:`);
  console.log("### Command Execution Receipt");
  console.log("```json\n" + JSON.stringify(finalTaskData.receipt || finalTaskData.result || completeRes.body.receipt, null, 2) + "\n```");
}

runProof();
