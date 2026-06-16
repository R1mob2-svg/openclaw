const https = require('https');

const REPO_OWNER = "R1mob2-svg";
const REPO_NAME = "global-agent-brain";
const BRANCH = "newton-ag-bridge-v2-ledger-dry-run";

/**
 * Redacts any sensitive authorization values in strings.
 */
function redactSensitive(value) {
    if (typeof value !== 'string') return value;
    let redacted = value.replace(/(Authorization:\s*)(?:token|bearer)\s+([a-zA-Z0-9_\-]+)/gi, '$1[REDACTED_AUTH_TOKEN]');
    redacted = redacted.replace(/ghp_[a-zA-Z0-9]{36,40}/gi, '[REDACTED_GHP_TOKEN]');
    redacted = redacted.replace(/github_pat_[a-zA-Z0-9_]+/gi, '[REDACTED_PAT_TOKEN]');
    return redacted;
}

/**
 * Returns names of present tokens only without printing their values.
 */
function getSafeAuthStatus() {
    const status = {
        GITHUB_TOKEN: (process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN !== 'github_pat_antigravitydummytoken') ? "present" : "missing",
        GH_TOKEN: process.env.GH_TOKEN ? "present" : "missing"
    };
    return status;
}

/**
 * Retrieves the GitHub token from environment variables.
 */
function getGitHubToken() {
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (!token || token === 'github_pat_antigravitydummytoken') {
        return null; // Fail closed if dummy or missing
    }
    return token;
}

/**
 * Standard request wrapper with fallback to gh CLI.
 */
function request(method, apiPath, data = null) {
    return new Promise((resolve, reject) => {
        const token = getGitHubToken();
        
        // If token exists in environment, use direct HTTPS request
        if (token) {
            const headers = {
                'User-Agent': 'Antigravity-Phone-Bridge-V3',
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
                };

            let postData = null;
            if (data) {
                postData = JSON.stringify(data);
                headers['Content-Type'] = 'application/json';
                headers['Content-Length'] = Buffer.byteLength(postData);
            }

            const options = {
                hostname: 'api.github.com',
                path: apiPath,
                method: method,
                headers: headers
            };

            const req = https.request(options, (res) => {
                let body = '';
                res.on('data', (chunk) => { body += chunk; });
                res.on('end', () => {
                    let parsed = null;
                    try {
                        parsed = JSON.parse(body);
                    } catch (e) {
                        parsed = body;
                    }
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        data: parsed
                    });
                });
            });

            req.on('error', (err) => {
                reject(err);
            });

            if (postData) {
                req.write(postData);
            }
            req.end();
            return;
        }

        // If no token in env, fall back to gh CLI using keyring auth
        const { exec } = require('child_process');
        const fs = require('fs');
        const os = require('os');
        const path = require('path');
        
        // Build the gh api command line. apiPath starts with /
        // Trim leading / if present
        const cleanPath = apiPath.startsWith('/') ? apiPath.substring(1) : apiPath;
        
        let tempFilePath = null;
        let cmd = `gh api -X ${method} "${cleanPath}"`;
        
        if (data) {
            tempFilePath = path.join(os.tmpdir(), `gh-api-data-${Date.now()}-${Math.random().toString(36).substring(7)}.json`);
            fs.writeFileSync(tempFilePath, JSON.stringify(data), 'utf8');
            cmd = `gh api -X ${method} "${cleanPath}" --input "${tempFilePath}"`;
        }
        
        // Ensure GITHUB_TOKEN environment variable is cleared for this execution to avoid failures
        const options = {
            env: { ...process.env, GITHUB_TOKEN: '', GH_TOKEN: '' },
            windowsHide: true
        };

        exec(cmd, options, (err, stdout, stderr) => {
            if (tempFilePath) {
                try { fs.unlinkSync(tempFilePath); } catch (e) {}
            }
            
            if (err) {
                let statusCode = 500;
                const match = stderr.match(/HTTP\s+(\d+)/i);
                if (match) {
                    statusCode = parseInt(match[1], 10);
                }
                
                let parsedError = stderr;
                try {
                    parsedError = JSON.parse(stderr);
                } catch (e) {}
                resolve({
                    statusCode: statusCode,
                    headers: {},
                    data: { error: 'cli_error', details: parsedError }
                });
                return;
            }
            
            let parsed = null;
            try {
                parsed = JSON.parse(stdout);
            } catch (e) {
                parsed = stdout;
            }
            
            resolve({
                statusCode: 200, // CLI exit 0 indicates success
                headers: {},
                data: parsed
            });
        });
    });
}

const getPath = (filePath) => `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}?ref=${BRANCH}`;
const getPutPath = (filePath) => `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`;

async function getFileContent(filePath) {
    const res = await request('GET', getPath(filePath));
    if (res.statusCode === 404) {
        return null;
    }
    if (res.statusCode !== 200) {
        throw new Error(`GET ${filePath} failed with status ${res.statusCode}: ${JSON.stringify(res.data)}`);
    }
    const content = Buffer.from(res.data.content, 'base64').toString('utf-8');
    return {
        content: content,
        sha: res.data.sha
    };
}

async function putFileContent(filePath, content, message, sha = null) {
    const data = {
        message: message,
        content: Buffer.from(content).toString('base64'),
        branch: BRANCH
    };
    if (sha) {
        data.sha = sha;
    }
    const res = await request('PUT', getPutPath(filePath), data);
    if (res.statusCode !== 200 && res.statusCode !== 201) {
        throw new Error(`PUT ${filePath} failed with status ${res.statusCode}: ${JSON.stringify(res.data)}`);
    }
    return res.data;
}

async function deleteFile(filePath, message, sha) {
    const data = {
        message: message,
        sha: sha,
        branch: BRANCH
    };
    const res = await request('DELETE', getPutPath(filePath), data);
    if (res.statusCode !== 200) {
        throw new Error(`DELETE ${filePath} failed with status ${res.statusCode}: ${JSON.stringify(res.data)}`);
    }
    return res.data;
}

async function listDirContents(dirPath) {
    const res = await request('GET', getPath(dirPath));
    if (res.statusCode === 404) {
        return [];
    }
    if (res.statusCode !== 200) {
        throw new Error(`LIST ${dirPath} failed with status ${res.statusCode}: ${JSON.stringify(res.data)}`);
    }
    return res.data;
}

module.exports = {
    getGitHubToken,
    getFileContent,
    putFileContent,
    deleteFile,
    listDirContents,
    redactSensitive,
    getSafeAuthStatus,
    REPO_OWNER,
    REPO_NAME,
    BRANCH
};
