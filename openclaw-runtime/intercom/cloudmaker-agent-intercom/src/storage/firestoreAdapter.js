const { Firestore } = require('@google-cloud/firestore');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

class FirestoreAdapter {
    constructor() {
        if (config.STORAGE_TYPE === 'firestore') {
            try {
                this.db = new Firestore();
                this.tasksRef = this.db.collection('tasks');
                this.idempotencyRef = this.db.collection('idempotency');
            } catch (err) {
                console.warn('Firestore initialization failed.');
            }
        }
    }

    async createTask(taskData, idempotencyKey) {
        if (!this.db) throw new Error('Firestore not initialized');

        if (idempotencyKey) {
            return await this.db.runTransaction(async (t) => {
                const idempDoc = await t.get(this.idempotencyRef.doc(idempotencyKey));
                if (idempDoc.exists) {
                    const existingId = idempDoc.data().taskId;
                    const existingTask = await t.get(this.tasksRef.doc(existingId));
                    return { task: existingTask.data(), isDuplicate: true };
                }

                const id = idempotencyKey;
                const task = {
                    id,
                    status: 'NEW',
                    lock_token_hash: null,
                    last_heartbeat: null,
                    receipt: null,
                    audit_trail: [],
                    ...taskData
                };

                t.set(this.tasksRef.doc(id), task);
                t.set(this.idempotencyRef.doc(idempotencyKey), { taskId: id });
                return { task, isDuplicate: false };
            });
        } else {
            const id = uuidv4();
            const task = {
                id,
                status: 'NEW',
                lock_token_hash: null,
                last_heartbeat: null,
                receipt: null,
                audit_trail: [],
                ...taskData
            };
            await this.tasksRef.doc(id).set(task);
            return { task, isDuplicate: false };
        }
    }

    async getTask(id) {
        if (!this.db) throw new Error('Firestore not initialized');
        const doc = await this.tasksRef.doc(id).get();
        return doc.exists ? doc.data() : null;
    }

    async listTasks(filters) {
        if (!this.db) throw new Error('Firestore not initialized');
        const { agent, status } = filters;
        let query = this.tasksRef;
        if (agent) query = query.where('target_agent', '==', agent);
        if (status) query = query.where('status', '==', status);
        
        const snapshot = await query.get();
        return snapshot.docs.map(doc => doc.data());
    }

    async executeTransaction(id, updateCallback) {
        if (!this.db) throw new Error('Firestore not initialized');
        return await this.db.runTransaction(async (t) => {
            const docRef = this.tasksRef.doc(id);
            const doc = await t.get(docRef);
            
            if (!doc.exists) throw new Error("Not found");
            const task = doc.data();

            const clone = JSON.parse(JSON.stringify(task));
            const updates = await updateCallback(clone);
            
            if (updates) {
                Object.assign(task, updates);
                t.update(docRef, task);
            }
            return task;
        });
    }
}

module.exports = new FirestoreAdapter();
