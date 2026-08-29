const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_RECORDINGS_TEMP_DIR = path.join(PROJECT_ROOT, 'data', 'recordings');
const DEFAULT_SCREENSHOTS_TEMP_DIR = path.join(PROJECT_ROOT, 'data', 'screenshots');
const DEFAULT_CAPTURE_DIR = path.join(PROJECT_ROOT, 'public', 'captures');
const LEGACY_CAPTURE_DIR = path.join(PROJECT_ROOT, 'src', 'public', 'captures');

const resolveConfiguredPath = (value, fallback) => {
    const configured = typeof value === 'string' ? value.trim() : '';
    return path.resolve(PROJECT_ROOT, configured || fallback);
};

const parseRetentionCount = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : 10;
};

const RECORDINGS_TEMP_DIR = resolveConfiguredPath(process.env.FIGRANIUM_RECORDINGS_TEMP_DIR, DEFAULT_RECORDINGS_TEMP_DIR);
const RECORDINGS_DIR = resolveConfiguredPath(process.env.FIGRANIUM_RECORDINGS_DIR, DEFAULT_CAPTURE_DIR);
const SCREENSHOTS_TEMP_DIR = resolveConfiguredPath(process.env.FIGRANIUM_SCREENSHOTS_TEMP_DIR, DEFAULT_SCREENSHOTS_TEMP_DIR);
const SCREENSHOTS_DIR = resolveConfiguredPath(process.env.FIGRANIUM_SCREENSHOTS_DIR, DEFAULT_CAPTURE_DIR);
const RECORDING_RETENTION_COUNT = parseRetentionCount(process.env.FIGRANIUM_RECORDING_RETENTION_COUNT);

const uniquePaths = (paths) => [...new Set(paths)];

// Keep the legacy src/public/captures directory discoverable while allowing
// deployments to move promoted captures elsewhere.
const PROMOTED_CAPTURE_DIRS = uniquePaths([
    RECORDINGS_DIR,
    SCREENSHOTS_DIR,
    DEFAULT_CAPTURE_DIR,
    LEGACY_CAPTURE_DIR
]);

const TEMP_CAPTURE_DIRS = uniquePaths([
    RECORDINGS_TEMP_DIR,
    SCREENSHOTS_TEMP_DIR,
    DEFAULT_RECORDINGS_TEMP_DIR
]);

module.exports = {
    DEFAULT_RECORDINGS_TEMP_DIR,
    DEFAULT_SCREENSHOTS_TEMP_DIR,
    DEFAULT_CAPTURE_DIR,
    LEGACY_CAPTURE_DIR,
    RECORDINGS_TEMP_DIR,
    RECORDINGS_DIR,
    SCREENSHOTS_TEMP_DIR,
    SCREENSHOTS_DIR,
    RECORDING_RETENTION_COUNT,
    PROMOTED_CAPTURE_DIRS,
    TEMP_CAPTURE_DIRS
};
