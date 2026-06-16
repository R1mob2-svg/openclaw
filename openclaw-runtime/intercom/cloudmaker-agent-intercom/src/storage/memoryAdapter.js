const { v4: uuidv4 } = require('uuid');

class MemoryAdapter {
    constructor() {
        this.tasks = new Map();
        this.idempotencyKeys = new Map(); 
    }

    async createTask(taskData, idempotencyKey) {
        if (idempotencyKey && this.idempotencyKeys.has(idempotencyKey)) {
            const existingId = this.idempotencyKeys.get(idempotencyKey);
            return { task: await this.getTask(existingId), isDuplicate: true };
        }

        const id = idempotencyKey || uuidv4();
        const task = {
            id,
            status: 'NEW',
            lock_token_hash: null,
            last_heartbeat: null,
            receipt: null,
            audit_trail: [],
            ...taskData
        };
        this.tasks.set(id, task);

        if (idempotencyKey) {
            this.idempotencyKeys.set(idempotencyKey, id);
        }

        return { task, isDuplicate: false };
    }

    async getTask(id) {
        return this.tasks.get(id) || null;
    }

    async listTasks(filters) {
        const { agent, status } = filters;
        return Array.from(this.tasks.values()).filter(t => {
            let match = true;
            if (agent && t.target_agent !== agent) match = false;
            if (status && t.status !== status) match = false;
            return match;
        });
    }

    async executeTransaction(id, updateCallback) {
        const task = this.tasks.get(id);
        if (!task) throw new Error("Not found");
        
        const clone = JSON.parse(JSON.stringify(task));
        const updates = await updateCallback(clone);
        
        if (updates) {
            Object.assign(task, updates);
        }
        return task;
    }
}

module.exports = new MemoryAdapter();
