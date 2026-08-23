const { Mutex } = require('./utils');

const taskMutex = new Mutex();
const executionStreams = new Map();
const executionSnapshots = new Map();
const executionSnapshotTimers = new Map();
const stopRequests = new Set();

const SNAPSHOT_RETENTION_MS = 5 * 60 * 1000;

const sendExecutionUpdate = (runId, payload) => {
    if (!runId) return;
    executionSnapshots.set(runId, payload);
    const previousTimer = executionSnapshotTimers.get(runId);
    if (previousTimer) clearTimeout(previousTimer);
    executionSnapshotTimers.set(runId, setTimeout(() => {
        executionSnapshots.delete(runId);
        executionSnapshotTimers.delete(runId);
    }, SNAPSHOT_RETENTION_MS));
    const clients = executionStreams.get(runId);
    if (!clients || clients.size === 0) return;
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    clients.forEach((res) => {
        try {
            res.write(data);
        } catch {
            // ignore
        }
    });
};

const getExecutionSnapshot = (runId) => executionSnapshots.get(runId) || null;

module.exports = {
    taskMutex,
    executionStreams,
    getExecutionSnapshot,
    stopRequests,
    sendExecutionUpdate
};
