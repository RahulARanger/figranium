const fs = require('fs');
const path = require('path');

const ensureDirectory = async (directory) => {
    await fs.promises.mkdir(directory, { recursive: true });
    return directory;
};

const moveCapture = async (sourcePath, destinationDir, destinationName) => {
    await ensureDirectory(destinationDir);
    const destinationPath = path.join(destinationDir, destinationName);

    try {
        await fs.promises.rename(sourcePath, destinationPath);
    } catch (error) {
        if (error && error.code !== 'EXDEV') throw error;
        await fs.promises.copyFile(sourcePath, destinationPath);
        await fs.promises.unlink(sourcePath);
    }

    return destinationPath;
};

const cleanupRecordingsForTask = async (directory, taskPrefix, retentionCount) => {
    const entries = await fs.promises.readdir(directory).catch(() => []);
    const recordings = [];

    for (const name of entries) {
        if (!name.startsWith(taskPrefix) || !name.toLowerCase().endsWith('.webm')) continue;
        try {
            const stat = await fs.promises.stat(path.join(directory, name));
            if (stat.isFile()) recordings.push({ name, modified: stat.mtimeMs });
        } catch {
            // Ignore files that disappear during cleanup.
        }
    }

    recordings.sort((a, b) => b.modified - a.modified);
    for (const recording of recordings.slice(retentionCount)) {
        await fs.promises.unlink(path.join(directory, recording.name)).catch(() => {});
    }
};

module.exports = { ensureDirectory, moveCapture, cleanupRecordingsForTask };
