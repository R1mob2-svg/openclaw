const validTransitions = {
    'NEW': ['CLAIMED'],
    'CLAIMED': ['IN_PROGRESS', 'BLOCKED', 'NEEDS_ROB'],
    'IN_PROGRESS': ['READY_FOR_AUDIT', 'BLOCKED', 'NEEDS_ROB'],
    'READY_FOR_AUDIT': ['DONE_WITH_RECEIPT', 'REJECTED'],
    'BLOCKED': ['NEW', 'CLAIMED'],
    'NEEDS_ROB': ['NEW', 'CLAIMED'],
    'REJECTED': ['NEW', 'CLAIMED']
};

const canTransition = (currentState, nextState) => {
    if (currentState === nextState) return true;
    if (!validTransitions[currentState]) return false;
    return validTransitions[currentState].includes(nextState);
};

const validateWorkerUpdate = (task, updates) => {
    if (updates.status) {
        if (updates.status === 'DONE_WITH_RECEIPT') {
            throw new Error('Worker cannot self-approve task to DONE_WITH_RECEIPT');
        }
        if (!canTransition(task.status, updates.status)) {
            throw new Error(`Illegal state transition from ${task.status} to ${updates.status}`);
        }
    }
};

module.exports = {
    validTransitions,
    canTransition,
    validateWorkerUpdate
};
