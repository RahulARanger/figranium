const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { cleanupRecordingsForTask, moveCapture } = require('../src/server/capture-storage');

async function run() {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'figranium-captures-'));
    const tempDir = path.join(root, 'temp');
    const promotedDir = path.join(root, 'promoted');

    try {
        const source = path.join(tempDir, 'source.png');
        await fs.promises.mkdir(tempDir, { recursive: true });
        await fs.promises.writeFile(source, 'capture');
        const destination = await moveCapture(source, promotedDir, 'capture.png');
        assert.strictEqual(await fs.promises.readFile(destination, 'utf8'), 'capture');
        await assert.rejects(() => fs.promises.access(source));

        const taskPrefix = 'task_a_';
        for (let i = 0; i < 12; i += 1) {
            const name = `${taskPrefix}run_${i}.webm`;
            await fs.promises.writeFile(path.join(promotedDir, name), String(i));
            const timestamp = new Date(Date.now() + i).getTime();
            await fs.promises.utimes(path.join(promotedDir, name), new Date(timestamp), new Date(timestamp));
        }
        await fs.promises.writeFile(path.join(promotedDir, 'task_b_run_old.webm'), 'other task');
        await cleanupRecordingsForTask(promotedDir, taskPrefix, 10);

        const remaining = (await fs.promises.readdir(promotedDir)).filter((name) => name.startsWith(taskPrefix));
        assert.strictEqual(remaining.length, 10);
        assert.ok((await fs.promises.readdir(promotedDir)).includes('task_b_run_old.webm'));
        console.log('Capture storage tests passed.');
    } finally {
        await fs.promises.rm(root, { recursive: true, force: true });
    }
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
