// Web Crypto API helper to verify HMAC SHA-256 signature in Cloudflare Worker
async function verifySignature(rawBody, signatureHeader, secret) {
    if (!signatureHeader || !secret) return false;
    const parts = signatureHeader.split('=');
    if (parts.length !== 2 || parts[0] !== 'sha256') return false;
    const providedHex = parts[1];

    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const bodyData = encoder.encode(rawBody);

    const key = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify']
    );

    const sigBytes = new Uint8Array(providedHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

    return await crypto.subtle.verify(
        'HMAC',
        key,
        sigBytes,
        bodyData
    );
}

const TARGET_BRANCH = 'newton-ag-bridge-v2-ledger-dry-run';
const TARGET_PATH_PREFIX = 'CommandLedger/approved/';

export default {
    async fetch(request, env, ctx) {
        if (request.method !== 'POST') {
            return new Response('Method Not Allowed', { status: 405 });
        }

        const signature = request.headers.get('x-hub-signature-256');
        const deliveryId = request.headers.get('x-github-delivery');
        
        // GITHUB_WEBHOOK_SECRET must be configured as a secret env var in Cloudflare Worker dashboard
        const secret = env.GITHUB_WEBHOOK_SECRET;

        if (!deliveryId) {
            return new Response('Missing X-GitHub-Delivery header', { status: 400 });
        }

        if (!signature) {
            return new Response('Missing signature header', { status: 401 });
        }

        // Read raw body
        const rawBody = await request.text();

        // Verify HMAC signature
        const isValid = await verifySignature(rawBody, signature, secret);
        if (!isValid) {
            return new Response('Signature verification failed', { status: 401 });
        }

        // Parse payload
        const payload = JSON.parse(rawBody);

        // Validate branch
        const ref = payload.ref || '';
        if (ref !== `refs/heads/${TARGET_BRANCH}`) {
            return new Response(JSON.stringify({ status: 'ignored', reason: 'Not target branch' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Validate changed file paths
        const commits = payload.commits || [];
        const filesToIngest = [];
        let hasInvalidPaths = false;

        for (const commit of commits) {
            const paths = [...(commit.added || []), ...(commit.modified || [])];
            for (const p of paths) {
                if (p.startsWith(TARGET_PATH_PREFIX)) {
                    filesToIngest.push(p);
                } else {
                    hasInvalidPaths = true;
                }
            }
        }

        if (hasInvalidPaths) {
            return new Response('Forbidden: commit contains files outside of CommandLedger/approved/', { status: 403 });
        }

        if (filesToIngest.length === 0) {
            return new Response(JSON.stringify({ status: 'ignored', reason: 'No command files modified' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Relay to safe queue or event broker here
        // No execution of commands happens in public relay.
        
        return new Response(JSON.stringify({
            status: 'queued',
            delivery_id: deliveryId,
            ingested_files: filesToIngest
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
