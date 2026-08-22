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

// Saved task values are defaults. The launch environment overrides those
// defaults, and explicit values for one run override both.
function buildWorkflowVariables(taskVariables = {}, runVariables = {}) {
    return Object.assign(
        flattenVariableSource(taskVariables),
        getEnvironmentVariables(),
        flattenVariableSource(runVariables)
    );
}

function getWorkflowVariables(data = {}) {
    if (data.workflowVariables && typeof data.workflowVariables === 'object') {
        return flattenVariableSource(data.workflowVariables);
    }

    // Editor runs include the saved task snapshot separately from values
    // supplied for this run, so environment values can override task defaults.
    if (data.taskSnapshot && typeof data.taskSnapshot === 'object') {
        return buildWorkflowVariables(
            data.taskSnapshot.variables || {},
            data.runtimeVariables || {}
        );
    }

    // Direct CLI/agent calls treat their supplied variables as run-time input.
    return buildWorkflowVariables({}, data.variables || data.taskVariables || {});
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
    getWorkflowVariables,
    resolveWorkflowValue
};
