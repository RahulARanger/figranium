import { useState, useRef, useEffect } from 'react';
import { Task, Results } from '../types';
import { formatExecutionError, isDisplayUnavailable } from '../utils/executionUtils';
import { ensureActionIds } from '../utils/taskUtils';
import { useHeadfulStatus } from './useHeadfulStatus';

export function useExecution(showAlert: (msg: string, tone?: 'success' | 'error') => void) {
    const [isExecuting, setIsExecuting] = useState(false);
    const [isHeadfulOpen, setIsHeadfulOpen] = useState(false);
    const [results, setResults] = useState<Results | null>(null);
    const [activeRunId, setActiveRunId] = useState<string | null>(null);
    const useNovnc = useHeadfulStatus();
    const executeAbortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        if (!activeRunId) return;
        const streamRunId = activeRunId;
        const source = new EventSource(`/api/executions/stream?runId=${encodeURIComponent(streamRunId)}`, { withCredentials: true });

        source.onmessage = (event) => {
            if (!event.data) return;
            try {
                const payload = JSON.parse(event.data);
                const result = payload?.result && typeof payload.result === 'object' ? payload.result : payload;
                const isTerminal = payload?.status === 'completed' || payload?.status === 'failed';
                setResults((previous) => {
                    const base: Results = previous || { url: '', logs: [], timestamp: 'Running...' };
                    const next = { ...base };
                    if (Array.isArray(payload?.logs)) next.logs = payload.logs;
                    else if (Array.isArray(result?.logs)) next.logs = result.logs;
                    if (Object.prototype.hasOwnProperty.call(payload || {}, 'data')) next.data = payload.data;
                    if (Object.prototype.hasOwnProperty.call(result || {}, 'data')) next.data = result.data;
                    if (result?.html !== undefined) next.html = result.html;
                    if (result?.final_url || result?.finalUrl) next.finalUrl = result.final_url || result.finalUrl;
                    if (result?.downloads !== undefined) next.downloads = result.downloads;
                    const screenshotUrl = payload?.screenshotUrl || payload?.screenshot_url || result?.screenshotUrl || result?.screenshot_url;
                    if (screenshotUrl) next.screenshotUrl = screenshotUrl;
                    if (payload?.screenshotVersion || result?.screenshotVersion) {
                        next.screenshotVersion = payload.screenshotVersion || result.screenshotVersion;
                    }
                    if (isTerminal) next.timestamp = new Date().toLocaleTimeString();
                    return next;
                });
                if (isTerminal) source.close();
            } catch {
                // Ignore malformed progress events; the final request remains authoritative.
            }
        };

        return () => source.close();
    }, [activeRunId]);

    const stopHeadful = async () => {
        try {
            await fetch('/headful/stop', { method: 'POST' });
        } catch (e) {
            console.error('Failed to stop headful session', e);
        } finally {
            setIsHeadfulOpen(false);
        }
    };

    const openHeadful = async (url: string, targetActionId?: string, taskSnapshot?: Task, variables?: any) => {
        if (isHeadfulOpen) {
            await stopHeadful();
            return;
        }
        setIsHeadfulOpen(true);
        try {
            const res = await fetch('/headful', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, targetActionId, taskSnapshot, variables })
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                const msg = data?.details || data?.error || 'Failed to start headful session';
                showAlert(msg, 'error');
                setIsHeadfulOpen(false);
            }
        } catch (e: any) {
            showAlert('Failed to start headful session', 'error');
            setIsHeadfulOpen(false);
        }
    };

    const stopTask = async () => {
        if (activeRunId) {
            try {
                await fetch('/api/executions/stop', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ runId: activeRunId })
                });
            } catch (e) {
                console.error('Failed to request stop', e);
            }
        }
        if (executeAbortRef.current) {
            executeAbortRef.current.abort();
        }
        setIsExecuting(false);
    };

    const runTaskWithSnapshot = async (
        taskToRunRaw: Task | null,
        currentTask: Task | null,
        setCurrentTask: (t: Task) => void,
        options: { headful?: boolean } = {},
    ) => {
        if (!taskToRunRaw || !taskToRunRaw.url) return;
        const taskToRun = ensureActionIds(taskToRunRaw);
        if (currentTask && taskToRun !== currentTask) {
            setCurrentTask(taskToRun);
        }

        const runId = `run_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        setActiveRunId(runId);

        if (isExecuting) return;

        setIsExecuting(true);
        setResults({
            url: taskToRun.url,
            logs: [],
            timestamp: 'Running...',
        });

        let payload: any = null;

        try {
            const cleanedVars: Record<string, any> = {};
            Object.entries(taskToRun.variables).forEach(([name, def]) => {
                cleanedVars[name] = def.value;
            });

            const resolveTemplate = (input: string) => {
                return input.replace(/\\{\$(\w+)\\}/g, (_match, name) => {
                    if (name === 'now') return new Date().toISOString();
                    const value = cleanedVars[name];
                    if (value === undefined || value === null || value === '') return '';
                    return String(value);
                });
            };

            const resolveMaybe = (value?: string) => {
                if (typeof value !== 'string') return value;
                return resolveTemplate(value);
            };

            const shouldResolve = taskToRun.mode !== 'agent';
            const resolvedTask = {
                ...taskToRun,
                url: shouldResolve ? resolveTemplate(taskToRun.url || '') : (taskToRun.url || ''),
                selector: shouldResolve ? resolveMaybe(taskToRun.selector) : taskToRun.selector,
                actions: shouldResolve
                    ? taskToRun.actions.map((action) => ({
                        ...action,
                        selector: resolveMaybe(action.selector),
                        value: resolveMaybe(action.value),
                        key: resolveMaybe(action.key)
                    }))
                    : taskToRun.actions
            };

            payload = {
                ...resolvedTask,
                taskVariables: cleanedVars,
                variables: cleanedVars,
                runSource: 'editor',
                taskId: taskToRun.id,
                taskName: taskToRun.name,
                taskSnapshot: taskToRun,
                runId
            };

            // Agent runs are headless by default. The UI's explicit Headful
            // choice maps to the same `headless: false` option used by MCP.
            if (taskToRun.mode === 'agent') {
                payload.headless = options.headful !== true;
            }

            const executeTask = async (mode: 'scrape' | 'agent') => {
                const controller = new AbortController();
                executeAbortRef.current = controller;
                const res = await fetch(`/${mode}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: controller.signal
                });

                if (!res.ok) {
                    let errorData: any = null;
                    try {
                        errorData = await res.json();
                    } catch {
                        errorData = null;
                    }
                    const error = new Error(errorData?.details || errorData?.error || "Request failed");
                    (error as any).code = errorData?.error;
                    throw error;
                }

                return res.json();
            };

            const effectiveMode = taskToRun.mode === 'headful' ? 'scrape' : taskToRun.mode;
            const data = await executeTask(effectiveMode);

            setResults({
                url: taskToRun.url,
                finalUrl: data.final_url,
                html: data.html,
                data: data.data ?? data.html ?? null,
                screenshotUrl: data.screenshot_url || data.screenshotUrl || undefined,
                screenshotVersion: Date.now(),
                downloads: data.downloads,
                logs: data.logs || [],
                timestamp: new Date().toLocaleTimeString(),
            });
        } catch (e: any) {
            if (e?.name === 'AbortError') {
                setResults((previous) => ({
                    ...(previous || { url: taskToRun.url, logs: [], timestamp: '' }),
                    logs: ['Execution stopped.'],
                    timestamp: new Date().toLocaleTimeString(),
                }));
                showAlert('Execution stopped.', 'success');
                setIsExecuting(false);
                return;
            }
            if (
                taskToRun?.mode === 'headful'
                && payload
                && (e?.code === 'HEADFUL_DISPLAY_UNAVAILABLE' || isDisplayUnavailable(e?.message || String(e)))
            ) {
                try {
                    const data = await (async () => {
                        const controller = new AbortController();
                        executeAbortRef.current = controller;
                        const res = await fetch(`/scrape`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload),
                            signal: controller.signal
                        });
                        if (!res.ok) {
                            const errorData = await res.json();
                            throw new Error(errorData.details || errorData.error || "Request failed");
                        }
                        return res.json();
                    })();
                    data.logs = [`Headful display unavailable; ran headless instead.`, ...(data.logs || [])];
                    setResults({
                        url: taskToRun.url,
                        finalUrl: data.final_url,
                        html: data.html,
                        data: data.data ?? data.html ?? null,
                        screenshotUrl: data.screenshot_url || data.screenshotUrl || undefined,
                        screenshotVersion: Date.now(),
                        downloads: data.downloads,
                        logs: data.logs || [],
                        timestamp: new Date().toLocaleTimeString(),
                    });
                    setIsExecuting(false);
                    return;
                } catch (fallbackError: any) {
                    const errorMessage = formatExecutionError(fallbackError?.message || String(fallbackError), taskToRun?.mode);
                    setResults((previous) => ({
                        ...(previous || { url: taskToRun.url, logs: [], timestamp: '' }),
                        logs: [`Execution failed: ${errorMessage}`],
                        timestamp: new Date().toLocaleTimeString(),
                    }));
                    showAlert(`Execution crash: ${errorMessage}`, 'error');
                    setIsExecuting(false);
                    return;
                }
            }
            const errorMessage = formatExecutionError(e?.message || String(e), taskToRun?.mode);
            setResults((previous) => ({
                ...(previous || { url: taskToRun.url, logs: [], timestamp: '' }),
                logs: [`Execution failed: ${errorMessage}`],
                timestamp: new Date().toLocaleTimeString(),
            }));
            showAlert(`Execution crash: ${errorMessage}`, 'error');
            if (taskToRun?.mode === 'headful') {
                setIsExecuting(false);
            }
        } finally {
            executeAbortRef.current = null;
            setIsExecuting(false);
        }
    };

    return {
        isExecuting,
        isHeadfulOpen,
        results,
        setResults,
        activeRunId,
        useNovnc,
        runTaskWithSnapshot,
        stopTask,
        openHeadful,
        stopHeadful
    };
}
