const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const crypto = require('crypto');
const https = require('https');

const config = require('./config');
const authMiddleware = require('./auth');
const memoryAdapter = require('./storage/memoryAdapter');
const firestoreAdapter = require('./storage/firestoreAdapter');
const { syncTaskToSheets } = require('./sync/sheets');
const { formatAuditEvent } = require('./auditLog');

// Initialize Cloud Tasks Client
const { CloudTasksClient } = require('@google-cloud/tasks');
let tasksClient;
try {
    tasksClient = new CloudTasksClient();
} catch (e) {
    console.warn("CloudTasksClient not initialized (expected in local/dev):", e.message);
}

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(authMiddleware);

// Select the appropriate storage adapter
const storage = config.STORAGE_TYPE === 'firestore' ? firestoreAdapter : memoryAdapter;

// Cloud Run Health Check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', environment: config.NODE_ENV, storage: config.STORAGE_TYPE });
});

app.get('/healthz', (req, res) => {
    res.status(200).json({ status: 'ok', environment: config.NODE_ENV });
});

// Helper to comment on GitHub
function postGithubComment(repo, issueNumber, commentText) {
    return new Promise((resolve, reject) => {
        const token = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT;
        if (!token) {
            console.warn("No GITHUB_TOKEN or GITHUB_PAT set. Skipping GitHub comment.");
            return resolve(null);
        }
        const body = JSON.stringify({ body: commentText });
        const req = https.request({
            hostname: 'api.github.com',
            path: `/repos/${repo}/issues/${issueNumber}/comments`,
            method: 'POST',
            headers: {
                'Authorization': `token ${token}`,
                'User-Agent': 'Antigravity-Intercom',
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// Helper to add label on GitHub
function addGithubLabel(repo, issueNumber, labelName) {
    return new Promise((resolve, reject) => {
        const token = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT;
        if (!token) {
            console.warn("No GITHUB_TOKEN or GITHUB_PAT set. Skipping GitHub label.");
            return resolve(null);
        }
        const body = JSON.stringify({ labels: [labelName] });
        const req = https.request({
            hostname: 'api.github.com',
            path: `/repos/${repo}/issues/${issueNumber}/labels`,
            method: 'POST',
            headers: {
                'Authorization': `token ${token}`,
                'User-Agent': 'Antigravity-Intercom',
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// Helper to enqueue task in Cloud Tasks
async function enqueueCloudTask(taskData) {
    if (!tasksClient) {
        console.warn("CloudTasksClient not initialized. Simulating enqueue...");
        return `simulated-task-id-${Date.now()}`;
    }
    const projectId = process.env.GOOGLE_CLOUD_PROJECT || 'iron-crane-485322-i6';
    const queueId = process.env.CLOUD_TASKS_QUEUE || 'neil-tasks';
    const locationId = process.env.CLOUD_TASKS_LOCATION || 'europe-west2';
    const url = process.env.NEIL_WORKER_URL || 'https://neil-worker-608388585234.europe-west2.run.app/execute';

    try {
        const parent = tasksClient.queuePath(projectId, locationId, queueId);
        const task = {
            httpRequest: {
                httpMethod: 'POST',
                url,
                headers: {
                    'Content-Type': 'application/json',
                },
                body: Buffer.from(JSON.stringify(taskData)).toString('base64'),
            },
        };

        const request = { parent, task };
        const [response] = await tasksClient.createTask(request);
        return response.name;
    } catch (err) {
        console.warn(`[CloudTasks] Warning: Failed to create Cloud Task (${err.message}). Falling back to simulated task.`);
        return `fallback-task-id-${Date.now()}`;
    }
}

// GitHub Webhook handler
app.post('/github/webhook', async (req, res) => {
    const signature = req.headers['x-hub-signature-256'];
    const secret = process.env.GITHUB_WEBHOOK_SECRET || 'gitos-v2-webhook-secret-2026';
    
    if (signature) {
        const payloadStr = JSON.stringify(req.body);
        const hmac = crypto.createHmac('sha256', secret);
        const digest = 'sha256=' + hmac.update(payloadStr).digest('hex');
        const sigBuf = Buffer.from(signature);
        const digBuf = Buffer.from(digest);
        if (sigBuf.length !== digBuf.length || !crypto.timingSafeEqual(sigBuf, digBuf)) {
            console.warn("GitHub webhook signature verification failed.");
            return res.status(401).json({ error: 'Invalid webhook signature.' });
        }
    }

    const event = req.headers['x-github-event'];
    console.log(`Received GitHub webhook event: ${event}`);

    // Subscribe exactly to issues, issue_comment, and label
    if (!['issues', 'issue_comment', 'label'].includes(event)) {
        return res.status(200).json({ status: 'ignored', reason: 'unsubscribed event' });
    }

    const body = req.body || {};
    const issue = body.issue;
    if (!issue) {
        return res.status(200).json({ status: 'ignored', reason: 'no issue object' });
    }

    const repoName = body.repository ? body.repository.full_name : null;
    const issueNumber = issue.number;
    const issueTitle = issue.title;
    const issueBody = issue.body || '';
    const commentBody = body.comment ? body.comment.body : '';

    const contentToParse = `${issueTitle}\n${issueBody}\n${commentBody}`;
    const agentMatch = contentToParse.match(/target_agent:\s*(\w+)/i) || contentToParse.match(/\/run\s+(\w+)/i);
    const targetAgent = agentMatch ? agentMatch[1] : null;

    if (!targetAgent) {
        return res.status(200).json({ status: 'ignored', reason: 'no target_agent found' });
    }

    console.log(`Parsed target agent: ${targetAgent} for Issue #${issueNumber}`);
    const timestamp = new Date().toISOString();
    const ackMessage = `COMMAND_RECEIVED\nreceiver: ${targetAgent}\nreceived_at: ${timestamp}\nsource_issue: ${issue.html_url}\nstatus: RECEIVED`;

    try {
        await postGithubComment(repoName, issueNumber, ackMessage);
        await addGithubLabel(repoName, issueNumber, "status:received");

        const taskData = {
            id: uuidv4(),
            title: issueTitle,
            description: issueBody,
            target_agent: targetAgent,
            github_issue_number: issueNumber,
            source_repo: repoName,
            metadata: {
                source_issue_number: issueNumber,
                github_issue_number: issueNumber,
                source_repo: repoName,
                event: event
            }
        };

        const taskName = await enqueueCloudTask(taskData);
        console.log(`Successfully enqueued task in Cloud Tasks: ${taskName}`);

        return res.status(200).json({
            status: 'received',
            target_agent: targetAgent,
            task_name: taskName
        });
    } catch (err) {
        console.error("Error handling GitHub webhook:", err);
        return res.status(500).json({ error: err.message });
    }
});

// Telegram Webhook handler
app.post('/telegram/webhook', (req, res) => {
    console.log("Received Telegram webhook body:", JSON.stringify(req.body));
    return res.status(200).json({ status: 'ok', source: 'telegram' });
});

// Helper for hashing
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function pickDefined(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined && value !== null));
}

// 1. POST /tasks (Create task)
app.post('/tasks', async (req, res) => {
    const body = req.body || {};
    const {
        title,
        description,
        mission,
        target_agent,
        idempotency_key,
        command_id,
        requested_by,
        source_surface,
        source_repo,
        source_issue_number,
        github_issue_number,
        github_comment_id,
        cc_agents,
        priority,
        task_type,
        live_actions,
        acceptance_gate
    } = body;

    const taskTitle = title || command_id || task_type || 'Untitled command task';
    const taskDescription = description || mission || taskTitle;

    const taskMetadata = pickDefined({
        command_id,
        requested_by,
        source_surface,
        source_repo,
        source_issue_number: source_issue_number || github_issue_number,
        github_issue_number: github_issue_number || source_issue_number,
        github_comment_id,
        cc_agents,
        priority,
        task_type,
        live_actions,
        mission,
        acceptance_gate,
        idempotency_key
    });
    
    try {
        const { task, isDuplicate } = await storage.createTask({
            title: taskTitle,
            description: taskDescription,
            target_agent,
            ...taskMetadata,
            metadata: taskMetadata
        }, idempotency_key);
        
        if (isDuplicate) {
            return res.status(200).json(task);
        }

        const auditEvent = formatAuditEvent(task.id, requested_by || 'Rob', 'NONE', 'NEW', 'CREATED', 'Task initialized');
        const updatedTask = await storage.executeTransaction(task.id, async (t) => {
            return { audit_trail: [...t.audit_trail, auditEvent] };
        });
        
        await syncTaskToSheets(updatedTask);
        res.status(201).json(updatedTask);
    } catch (error) {
        console.error(error.stack);
        res.status(500).json({ error: error.message });
    }
});

// 2. GET /tasks?agent=AG&status=NEW
app.get('/tasks', async (req, res) => {
    const filters = {
        agent: req.query.agent,
        status: req.query.status
    };
    const result = await storage.listTasks(filters);
    res.json(result);
});

// 3. GET /tasks/:id
app.get('/tasks/:id', async (req, res) => {
    let task = await storage.getTask(req.params.id);
    if (!task) {
        const tasks = await storage.listTasks({});
        task = tasks.find(t => t.command_id === req.params.id || t.idempotency_key === req.params.id);
    }
    if (!task) return res.status(404).json({ error: 'Not found' });
    res.json(task);
});

// 4. POST /tasks/:id/claim
app.post('/tasks/:id/claim', async (req, res) => {
    const { agent } = req.body;
    
    try {
        let rawToken = uuidv4();
        let updatedTask = await storage.executeTransaction(req.params.id, async (task) => {
            if (task.status === 'CLAIMED' || task.status === 'IN_PROGRESS') {
                if (task.last_heartbeat && (Date.now() - task.last_heartbeat > config.HEARTBEAT_TIMEOUT_MS)) {
                    // Stale override allowed
                } else {
                    throw new Error("409:Task already claimed");
                }
            } else if (!['NEW', 'BLOCKED', 'REJECTED'].includes(task.status)) {
                throw new Error("400:Illegal state transition to CLAIMED");
            }

            const hashedToken = hashToken(rawToken);
            const auditEvent = formatAuditEvent(task.id, agent, task.status, 'CLAIMED', 'CLAIMED', `Claimed by ${agent}`);
            
            return {
                status: 'CLAIMED',
                lock_token_hash: hashedToken,
                assigned_agent: agent,
                last_heartbeat: Date.now(),
                audit_trail: [...task.audit_trail, auditEvent]
            };
        });

        await syncTaskToSheets(updatedTask);
        res.json({ success: true, lock_token: rawToken, task: updatedTask });
    } catch (error) {
        if (error.message.startsWith('409:')) return res.status(409).json({ error: error.message.split(':')[1] });
        if (error.message.startsWith('400:')) return res.status(400).json({ error: error.message.split(':')[1] });
        if (error.message === 'Not found') return res.status(404).json({ error: 'Not found' });
        console.error(error.stack);
        res.status(500).json({ error: error.message });
    }
});

// 5. PATCH /tasks/:id
app.patch('/tasks/:id', async (req, res) => {
    const { lock_token, status, details } = req.body;
    
    try {
        const updatedTask = await storage.executeTransaction(req.params.id, async (task) => {
            if (!lock_token || task.lock_token_hash !== hashToken(lock_token)) {
                throw new Error("401:Invalid or missing lock token");
            }

            let updates = { last_heartbeat: Date.now() };
            let newTrail = [...task.audit_trail];

            if (status) {
                if (status === 'DONE_WITH_RECEIPT') throw new Error("403:Worker cannot self-approve task");

                const validNextStates = {
                    'CLAIMED': ['IN_PROGRESS', 'BLOCKED', 'NEEDS_ROB'],
                    'IN_PROGRESS': ['READY_FOR_AUDIT', 'BLOCKED', 'NEEDS_ROB'],
                    'READY_FOR_AUDIT': ['DONE_WITH_RECEIPT', 'REJECTED'],
                    'BLOCKED': ['NEW', 'CLAIMED'],
                    'NEEDS_ROB': ['NEW', 'CLAIMED']
                };

                if (validNextStates[task.status] && !validNextStates[task.status].includes(status)) {
                    throw new Error(`400:Illegal transition from ${task.status} to ${status}`);
                }

                updates.status = status;
                newTrail.push(formatAuditEvent(task.id, task.assigned_agent, task.status, status, 'STATUS_UPDATE', `Transitioned to ${status}`));
            }

            if (details) {
                updates.description = (task.description ? task.description + '\n' : '') + details;
                newTrail.push(formatAuditEvent(task.id, task.assigned_agent, task.status, status || task.status, 'DETAILS_UPDATE', 'Details updated'));
            }

            updates.audit_trail = newTrail;
            return updates;
        });

        await syncTaskToSheets(updatedTask);
        res.json(updatedTask);
    } catch (error) {
        if (error.message.startsWith('401:')) return res.status(401).json({ error: error.message.split(':')[1] });
        if (error.message.startsWith('403:')) return res.status(403).json({ error: error.message.split(':')[1] });
        if (error.message.startsWith('400:')) return res.status(400).json({ error: error.message.split(':')[1] });
        if (error.message === 'Not found') return res.status(404).json({ error: 'Not found' });
        console.error(error.stack);
        res.status(500).json({ error: error.message });
    }
});

// 6. POST /tasks/:id/heartbeat
app.post('/tasks/:id/heartbeat', async (req, res) => {
    const { lock_token } = req.body;
    
    try {
        const updatedTask = await storage.executeTransaction(req.params.id, async (task) => {
            if (!lock_token || task.lock_token_hash !== hashToken(lock_token)) {
                throw new Error("401:Invalid or missing lock token");
            }
            return { last_heartbeat: Date.now() };
        });
        
        await syncTaskToSheets(updatedTask);
        res.json({ success: true });
    } catch (error) {
        if (error.message.startsWith('401:')) return res.status(401).json({ error: error.message.split(':')[1] });
        if (error.message === 'Not found') return res.status(404).json({ error: 'Not found' });
        console.error(error.stack);
        res.status(500).json({ error: error.message });
    }
});

// 7. POST /tasks/:id/receipt
app.post('/tasks/:id/receipt', async (req, res) => {
    const { lock_token, receipt } = req.body;
    
    try {
        const updatedTask = await storage.executeTransaction(req.params.id, async (task) => {
            if (!lock_token || task.lock_token_hash !== hashToken(lock_token)) {
                throw new Error("401:Invalid or missing lock token");
            }
            if (task.status !== 'IN_PROGRESS' && task.status !== 'CLAIMED') {
                 throw new Error("400:Task must be CLAIMED or IN_PROGRESS to submit receipt");
            }

            const auditEvent = formatAuditEvent(task.id, task.assigned_agent, task.status, 'READY_FOR_AUDIT', 'RECEIPT_SUBMITTED', 'Receipt submitted');

            return {
                status: 'READY_FOR_AUDIT',
                receipt,
                last_heartbeat: Date.now(),
                audit_trail: [...task.audit_trail, auditEvent]
            };
        });

        await syncTaskToSheets(updatedTask);
        res.json(updatedTask);
    } catch (error) {
        if (error.message.startsWith('401:')) return res.status(401).json({ error: error.message.split(':')[1] });
        if (error.message.startsWith('400:')) return res.status(400).json({ error: error.message.split(':')[1] });
        if (error.message === 'Not found') return res.status(404).json({ error: 'Not found' });
        console.error(error.stack);
        res.status(500).json({ error: error.message });
    }
});

// Admin helper: Check stale heartbeat
app.post('/tasks/:id/check-stale', async (req, res) => {
    try {
        let wasStale = false;
        const updatedTask = await storage.executeTransaction(req.params.id, async (task) => {
            if (task.last_heartbeat && (Date.now() - task.last_heartbeat > config.HEARTBEAT_TIMEOUT_MS)) {
                wasStale = true;
                const auditEvent = formatAuditEvent(task.id, 'system', task.status, 'BLOCKED', 'STALE_HEARTBEAT', 'Task marked BLOCKED due to stale heartbeat');
                return {
                    status: 'BLOCKED',
                    lock_token_hash: null,
                    assigned_agent: null,
                    audit_trail: [...task.audit_trail, auditEvent]
                };
            }
            return null; // No updates needed
        });

        if (wasStale) {
            await syncTaskToSheets(updatedTask);
            return res.json({ stale: true, task: updatedTask });
        }
        res.json({ stale: false, task: updatedTask });
    } catch (error) {
        if (error.message === 'Not found') return res.status(404).json({ error: 'Not found' });
        res.status(500).json({ error: error.message });
    }
});

// Only listen if run directly
if (require.main === module) {
    const server = app.listen(config.PORT, () => {
        console.log(`Cloudmaker Agent Intercom running on port ${config.PORT} | Environment: ${config.NODE_ENV} | Storage: ${config.STORAGE_TYPE}`);
    });
}

// Export app for testing
module.exports = app;
