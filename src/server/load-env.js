'use strict';

const fs = require('fs');
const path = require('path');

function stripMatchingQuotes(value) {
    if (value.length >= 2) {
        const first = value[0];
        const last = value[value.length - 1];
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
            return value.slice(1, -1);
        }
    }
    return value;
}

function loadEnvFile(directory = process.cwd()) {
    const envPath = path.join(directory, '.env');

    if (!fs.existsSync(envPath)) {
        return false;
    }

    const contents = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of contents.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;

        const assignment = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (!assignment) continue;

        const [, key, rawValue] = assignment;
        if (process.env[key] !== undefined) continue;

        const unquotedValue = rawValue.replace(/\s+#.*$/, '').trim();
        process.env[key] = stripMatchingQuotes(unquotedValue);
    }

    return true;
}

module.exports = { loadEnvFile };
