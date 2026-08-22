'use strict';

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function flattenVariableSource(source) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return {};

    return Object.fromEntries(Object.entries(source).map(([key, value]) => [
        key,
        value && typeof value === 'object' && hasOwn(value, 'value') ? value.value : value
    ]));
}

function getEnvironmentVariables() {
    return Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined));
}

// Environment values are defaults. Later sources are more specific and
// override them (saved task variables, then per-run variables).
function buildWorkflowVariables(...sources) {
    return Object.assign(
        getEnvironmentVariables(),
        ...sources.map(flattenVariableSource)
    );
}

function resolveWorkflowValue(value, variables) {
    if (typeof value === 'string') {
        return value.replace(/\{\$([\w.]+)\}/g, (_match, name) => {
            if (name === 'now') return new Date().toISOString();
            const resolved = variables[name];
            if (resolved === undefined || resolved === null) return '';
            if (typeof resolved === 'string' || typeof resolved === 'number' || typeof resolved === 'boolean') {
                return String(resolved);
            }
            try {
                return JSON.stringify(resolved);
            } catch {
                return String(resolved);
            }
        });
    }

    if (Array.isArray(value)) return value.map((item) => resolveWorkflowValue(item, variables));
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [
            key,
            resolveWorkflowValue(item, variables)
        ]));
    }
    return value;
}

module.exports = {
    buildWorkflowVariables,
    resolveWorkflowValue
};
