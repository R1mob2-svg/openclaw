const formatAuditEvent = (task_id, actor, from_status, to_status, action, result_message) => {
    return {
        timestamp: new Date().toISOString(),
        task_id,
        actor: actor || 'system',
        from_status,
        to_status,
        action,
        result: result_message
    };
};

module.exports = { formatAuditEvent };
