/**
 * Offline Owner Lock Policy verification module.
 * Demonstrates how allowlists, exec approvals, and routing gates should securely reject non-owner traffic.
 */

const PROTECTED_COMMANDS = ['/exec', '/export-session', '/shell', '/cloud-billing'];

/**
 * Validates whether a given user ID is allowed on a specific channel based on config allowlists.
 */
export function isUserAllowed(channel, userId, config) {
    if (!config || !config.channels) return false;
    
    const channelConfig = config.channels[channel];
    if (!channelConfig) return false;

    // Fail closed if allowFrom is missing
    if (!Array.isArray(channelConfig.allowFrom)) return false;

    return channelConfig.allowFrom.includes(userId);
}

/**
 * Validates whether a command requires and has execution approval.
 */
export function validateCommandApproval(userId, command, hasExecApproval, config) {
    const isProtected = PROTECTED_COMMANDS.some(cmd => command.startsWith(cmd));
    
    if (isProtected) {
        if (config.gateway && config.gateway.exec && config.gateway.exec.requireExecApproval) {
            return hasExecApproval;
        }
        // If requireExecApproval is not set but it's a protected command, fail closed
        return false;
    }
    
    return true; // Not protected, approval not needed
}

/**
 * Validates webhook route access.
 * Webhooks must explicitly prove route-level owner gating.
 */
export function validateWebhookRoute(routeData, config) {
    // If it's a general webhook, it must be proven gated.
    // Currently relying on signed deliveries for specific paths.
    if (!routeData.isSignatureVerified && !routeData.hasExplicitOwnerGate) {
        return false;
    }
    return true;
}

/**
 * Master evaluation for a command request.
 */
export function evaluateRequest(request, config) {
    // 1. Channel check
    if (!isUserAllowed(request.channel, request.userId, config)) {
        return { allowed: false, reason: 'non_owner_rejected' };
    }

    // 2. Webhook check
    if (request.channel === 'webhook' && !validateWebhookRoute(request.routeData || {}, config)) {
        return { allowed: false, reason: 'webhook_not_owner_gated' };
    }

    // 3. Protected command check
    if (!validateCommandApproval(request.userId, request.command, request.hasExecApproval, config)) {
        return { allowed: false, reason: 'protected_command_requires_approval' };
    }

    return { allowed: true, reason: 'success' };
}
