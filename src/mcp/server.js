const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const baseUrl = (process.env.FIGRANIUM_URL || 'http://127.0.0.1:11345').replace(/\/$/, '');
const apiKey = process.env.FIGRANIUM_API_KEY || '';

async function requestJson(path, options = {}) {
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    if (apiKey) headers['x-api-key'] = apiKey;
    if (options.body !== undefined) headers['content-type'] = 'application/json';

    const timeoutMs = Number(process.env.FIGRANIUM_MCP_TIMEOUT_MS || 0);
    const requestOptions = { ...options, headers };
    if (timeoutMs > 0) requestOptions.signal = AbortSignal.timeout(timeoutMs);

    const response = await fetch(`${baseUrl}${path}`, {
        ...requestOptions,
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    let data;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = text;
    }
    if (!response.ok) {
        const detail = typeof data === 'string' ? data : JSON.stringify(data);
        throw new Error(`Figranium API ${response.status}: ${detail}`);
    }
    return data;
}

function result(data) {
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

const server = new McpServer({
    name: 'dev-figranium',
    version: '0.1.0'
});

server.tool('health', 'Check whether the local Figranium server is available.', {}, async () => {
    try {
        return result(await requestJson('/api/health'));
    } catch (error) {
        return result({ status: 'error', message: error.message });
    }
});

server.tool('list_tasks', 'List available Figranium automation tasks.', {}, async () => {
    try {
        return result(await requestJson('/api/tasks/list'));
    } catch (error) {
        return result({ error: error.message });
    }
});

server.tool(
    'create_task',
    'Create and save a new Figranium automation task. The task object should follow AGENT_SPEC.md.',
    {
        task: z.record(z.string(), z.unknown()).refine((value) => Object.keys(value).length > 0, {
            message: 'task must contain at least one field'
        })
    },
    async ({ task }) => {
        try {
            return result(await requestJson('/api/tasks', {
                method: 'POST',
                body: task
            }));
        } catch (error) {
            return result({ error: error.message });
        }
    }
);

server.tool(
    'get_task',
    'Get the saved definition of one Figranium task by ID.',
    { taskId: z.string().min(1) },
    async ({ taskId }) => {
        try {
            const tasks = await requestJson('/api/tasks');
            const task = Array.isArray(tasks) ? tasks.find((item) => item.id === taskId) : null;
            return result(task || { error: 'TASK_NOT_FOUND', taskId });
        } catch (error) {
            return result({ error: error.message });
        }
    }
);

server.tool(
    'update_task',
    'Partially update an existing Figranium task. A version snapshot is created automatically.',
    {
        taskId: z.string().min(1),
        updates: z.record(z.string(), z.unknown()).refine((value) => Object.keys(value).length > 0, {
            message: 'updates must contain at least one field'
        })
    },
    async ({ taskId, updates }) => {
        try {
            return result(await requestJson(`/api/tasks/${encodeURIComponent(taskId)}`, {
                method: 'PATCH',
                body: updates
            }));
        } catch (error) {
            return result({ error: error.message });
        }
    }
);

server.tool(
    'run_task',
    'Run a saved Figranium task asynchronously by default. Poll get_execution with the returned executionId. Set waitForCompletion=true only when a synchronous result is required.',
    {
        taskId: z.string().min(1),
        variables: z.record(z.string(), z.unknown()).optional(),
        url: z.string().url().optional(),
        waitForCompletion: z.boolean().optional(),
        headful: z.boolean().optional()
    },
    async ({ taskId, variables, url, waitForCompletion, headful }) => {
        try {
            const body = {};
            if (variables) body.variables = variables;
            if (url) body.url = url;
            body.headless = headful !== true;
            const endpoint = waitForCompletion ? `/api/tasks/${encodeURIComponent(taskId)}/api` : `/api/tasks/${encodeURIComponent(taskId)}/run-async`;
            return result(await requestJson(endpoint, {
                method: 'POST',
                body
            }));
        } catch (error) {
            return result({ error: error.message });
        }
    }
);

server.tool(
    'get_execution',
    'Get the status and result of an asynchronous Figranium task execution.',
    { executionId: z.string().min(1) },
    async ({ executionId }) => {
        try {
            return result(await requestJson(`/api/executions/${encodeURIComponent(executionId)}`));
        } catch (error) {
            return result({ error: error.message });
        }
    }
);

server.tool(
    'browser_action',
    'Perform one interaction in the active managed Figranium browser session.',
    {
        action: z.enum(['navigate', 'click', 'type', 'fill', 'press', 'refresh', 'wait']),
        sessionId: z.string().optional(),
        url: z.string().url().optional(),
        selector: z.string().optional(),
        value: z.string().optional(),
        key: z.string().optional(),
        timeout: z.number().int().positive().max(120000).optional()
    },
    async ({ action, sessionId, url, selector, value, key, timeout }) => {
        try {
            return result(await requestJson('/api/browser/action', {
                method: 'POST',
                body: { action, sessionId, url, selector, value, key, timeout }
            }));
        } catch (error) {
            return result({ error: error.message });
        }
    }
);

server.tool(
    'browser_inspect',
    'Inspect the active managed browser page, optionally querying one selector.',
    {
        sessionId: z.string().optional(),
        selector: z.string().optional()
    },
    async ({ sessionId, selector }) => {
        try {
            return result(await requestJson('/api/browser/inspect', {
                method: 'POST',
                body: { sessionId, selector }
            }));
        } catch (error) {
            return result({ error: error.message });
        }
    }
);

server.tool(
    'browser_assert',
    'Assert the active managed browser URL, title, text, or selector visibility.',
    {
        kind: z.enum(['url', 'title', 'text', 'selector']),
        expected: z.string().optional(),
        selector: z.string().optional(),
        contains: z.boolean().optional(),
        timeout: z.number().int().positive().max(120000).optional(),
        sessionId: z.string().optional()
    },
    async ({ kind, expected, selector, contains, timeout, sessionId }) => {
        try {
            return result(await requestJson('/api/browser/assert', {
                method: 'POST',
                body: { kind, expected, selector, contains, timeout, sessionId }
            }));
        } catch (error) {
            return result({ error: error.message });
        }
    }
);

server.tool(
    'open_browser',
    'Open or reuse Figranium’s managed browser session and optionally navigate to a URL.',
    {
        url: z.string().url().optional(),
        headless: z.boolean().optional(),
        devTools: z.boolean().optional()
    },
    async ({ url, headless, devTools }) => {
        try {
            return result(await requestJson('/api/browser/open', {
                method: 'POST',
                body: { url, headless, devTools }
            }));
        } catch (error) {
            return result({ error: error.message });
        }
    }
);

server.tool('list_executions', 'List recent Figranium task executions.', {}, async () => {
    try {
        return result(await requestJson('/api/executions/list'));
    } catch (error) {
        return result({ error: error.message });
    }
});

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch((error) => {
    console.error(`[dev-figranium] ${error.stack || error.message || error}`);
    process.exitCode = 1;
});
