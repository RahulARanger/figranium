const express = require('express');
const { requireAuthOrApiKey } = require('../middleware');
const { launchApiSession, getActiveSession, ensureSessionId } = require('../../../headful');
const { validateUrl } = require('../../../url-utils');

const router = express.Router();

/**
 * In-page helper injected on demand: given an element, produce a best-effort
 * XPath. Defined as a string so it can be passed to page.evaluate.
 */
function buildXPathsInPage() {
    function getElementXPath(el) {
        if (!el || el.nodeType !== 1) return '';
        if (el.id) {
            return `//*[@id="${el.id}"]`;
        }
        const parts = [];
        while (el && el.nodeType === 1) {
            let index = 1;
            let sibling = el.previousElementSibling;
            while (sibling) {
                if (sibling.tagName === el.tagName) index++;
                sibling = sibling.previousElementSibling;
            }
            const tagName = el.tagName.toLowerCase();
            parts.unshift(`${tagName}[${index}]`);
            el = el.parentElement;
        }
        return '/' + parts.join('/');
    }
    return Array.from(arguments[0] ? [arguments[0]] : []).map(getElementXPath)[0] || '';
}

/**
 * Compute XPath for a given element handle, if page is available.
 */
async function getXPathForElement(page, elementHandle) {
    if (!page || !elementHandle) return '';
    try {
        return await page.evaluate((el) => {
            if (!el || el.nodeType !== 1) return '';
            if (el.id) return `//*[@id="${el.id}"]`;
            const parts = [];
            while (el && el.nodeType === 1) {
                let index = 1;
                let sibling = el.previousElementSibling;
                while (sibling) {
                    if (sibling.tagName === el.tagName) index++;
                    sibling = sibling.previousElementSibling;
                }
                parts.unshift(`${el.tagName.toLowerCase()}[${index}]`);
                el = el.parentElement;
            }
            return '/' + parts.join('/');
        }, elementHandle);
    } catch (e) {
        return '';
    }
}

/**
 * Find candidate elements for a targetHint and generate selectors + XPaths in page context.
 */
async function inspectTargetInPage(page, targetHint) {
    if (!page || !targetHint) return [];
    try {
        return await page.evaluate((hint) => {
            const results = [];
            const seen = new Set();
            const push = (el) => {
                if (el && !seen.has(el) && results.length < 5) {
                    seen.add(el);
                    results.push(el);
                }
            };
            const trimmed = (hint || '').trim();
            if (!trimmed) return [];

            // 1) Try as CSS selector
            try {
                const matches = document.querySelectorAll(trimmed);
                matches.forEach(push);
            } catch (e) { /* not a valid selector, fall through */ }

            // 2) Attribute-based matching (name, placeholder, aria-label, title, alt, value)
            if (results.length < 5) {
                const attrNames = ['name', 'placeholder', 'aria-label', 'title', 'alt', 'value', 'data-testid', 'data-test-id'];
                const safeAttrVal = trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                for (const attr of attrNames) {
                    if (results.length >= 5) break;
                    try {
                        document.querySelectorAll(`[${attr}="${safeAttrVal}"]`).forEach(push);
                    } catch (e) {}
                }
            }

            // 3) Text content matching (buttons, links, labels, headings)
            if (results.length < 5) {
                const textTags = ['button', 'a', 'label', 'span', 'div', 'h1', 'h2', 'h3', 'h4', 'li', 'p'];
                const lowerHint = trimmed.toLowerCase();
                for (const tag of textTags) {
                    if (results.length >= 5) break;
                    const els = Array.from(document.querySelectorAll(tag));
                    for (const el of els) {
                        const text = (el.textContent || '').trim().toLowerCase();
                        if (text && (text === lowerHint || text.includes(lowerHint))) {
                            push(el);
                            if (results.length >= 5) break;
                        }
                    }
                }
            }

            if (results.length === 0) return [];

            // Visually highlight the top match via overlay rectangle
            try {
                const topEl = results[0];
                const overlayId = 'figranium-api-highlight';
                let overlay = document.getElementById(overlayId);
                if (!overlay) {
                    overlay = document.createElement('div');
                    overlay.id = overlayId;
                    overlay.style.position = 'fixed';
                    overlay.style.pointerEvents = 'none';
                    overlay.style.zIndex = '2147483646';
                    overlay.style.backgroundColor = 'rgba(59, 130, 246, 0.15)';
                    overlay.style.border = '2px solid rgb(96, 165, 250)';
                    overlay.style.boxSizing = 'border-box';
                    document.body.appendChild(overlay);
                }
                const rect = topEl.getBoundingClientRect();
                overlay.style.top = rect.top + 'px';
                overlay.style.left = rect.left + 'px';
                overlay.style.width = rect.width + 'px';
                overlay.style.height = rect.height + 'px';
                overlay.style.display = 'block';
                topEl.scrollIntoView({ block: 'center', inline: 'center' });
            } catch (e) {}

            // Compute XPath for an element
            function getElementXPath(el) {
                if (!el || el.nodeType !== 1) return '';
                if (el.id) return `//*[@id="${el.id}"]`;
                const parts = [];
                while (el && el.nodeType === 1) {
                    let index = 1;
                    let sibling = el.previousElementSibling;
                    while (sibling) {
                        if (sibling.tagName === el.tagName) index++;
                        sibling = sibling.previousElementSibling;
                    }
                    parts.unshift(`${el.tagName.toLowerCase()}[${index}]`);
                    el = el.parentElement;
                }
                return '/' + parts.join('/');
            }

            // Generate selectors for each candidate element
            const selectorResults = [];
            for (let i = 0; i < results.length; i++) {
                const el = results[i];
                let cssList = [];
                if (window._figraniumGetSelectors) {
                    cssList = window._figraniumGetSelectors(el);
                } else if (el.tagName) {
                    cssList = [el.tagName.toLowerCase()];
                }
                const css = cssList[0] || '';
                const xpath = getElementXPath(el);
                if (!css && !xpath) continue;
                const base = 0.98 - (i * 0.05);
                selectorResults.push({ css, xpath, confidence: Math.max(0.5, base) });
            }

            return selectorResults;
        }, targetHint);
    } catch (e) {
        return [];
    }
}

/**
 * POST /api/browser/open
 * Launch (or reattach) a managed browser session.
 * Body: { url, mode? ('headful'), devTools?, headless? }
 * Returns: { sessionId, status, wsEndpoint }
 */
router.post('/browser/open', requireAuthOrApiKey, async (req, res) => {
    try {
        const { url, mode = 'headful', devTools = false, headless } = req.body || {};
        const session = await launchApiSession({ url, mode, devTools, headless });
        if (!session || session.status !== 'running') {
            return res.status(409).json({ error: 'BROWSER_LAUNCH_FAILED', details: 'Session did not reach running state.' });
        }
        const sessionId = ensureSessionId(session);

        // Derive wsEndpoint if available (only for non-persistent contexts)
        let wsEndpoint = null;
        try {
            if (session.browser && typeof session.browser.wsEndpoint === 'function') {
                wsEndpoint = session.browser.wsEndpoint();
            }
        } catch (e) {}

        if (!wsEndpoint) {
            const port = process.env.PORT || 11345;
            wsEndpoint = `ws://localhost:${port}/devtools/browser/${sessionId}`;
        }

        res.json({ sessionId, status: 'launched', wsEndpoint });
    } catch (e) {
        const message = String(e && e.message ? e.message : e);
        const displayUnavailable = /missing x server|\$display|platform failed to initialize|target page, context or browser has been closed|target closed|no display server|x11 connection failed|cannot open display/i.test(message);
        if (displayUnavailable) {
            return res.status(409).json({ error: 'HEADFUL_DISPLAY_UNAVAILABLE', details: message });
        }
        res.status(500).json({ error: 'BROWSER_LAUNCH_FAILED', details: message });
    }
});

function getManagedPage(req, res) {
    const session = getActiveSession();
    if (!session || session.status !== 'running' || !session.page) {
        res.status(404).json({ error: 'NO_ACTIVE_SESSION', details: 'Launch a browser session first via /api/browser/open.' });
        return null;
    }

    const activeId = ensureSessionId(session);
    if (req.body?.sessionId && req.body.sessionId !== activeId) {
        res.status(409).json({ error: 'SESSION_ID_MISMATCH', activeSessionId: activeId });
        return null;
    }
    return { session, page: session.page, sessionId: activeId };
}

async function browserState(page) {
    return {
        url: page.url(),
        title: await page.title().catch(() => ''),
        text: await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')
    };
}

/**
 * POST /api/browser/action
 * Execute one safe interaction against the active managed browser page.
 * Body: { sessionId?, action, url?, selector?, value?, key?, timeout? }
 */
router.post('/browser/action', requireAuthOrApiKey, async (req, res) => {
    const managed = getManagedPage(req, res);
    if (!managed) return;

    const { page, sessionId } = managed;
    const { action, url, selector, value, key, timeout = 15000 } = req.body || {};
    const waitTimeout = Math.max(100, Math.min(Number(timeout) || 15000, 120000));

    try {
        let result;
        switch (action) {
            case 'navigate':
                await validateUrl(url);
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: waitTimeout });
                result = { url: page.url() };
                break;
            case 'click':
                if (!selector) return res.status(400).json({ error: 'MISSING_SELECTOR' });
                await page.waitForSelector(selector, { state: 'visible', timeout: waitTimeout });
                await page.click(selector);
                result = { clicked: selector };
                break;
            case 'type':
            case 'fill':
                if (!selector) return res.status(400).json({ error: 'MISSING_SELECTOR' });
                await page.waitForSelector(selector, { state: 'visible', timeout: waitTimeout });
                if (action === 'fill') await page.fill(selector, String(value ?? ''));
                else await page.locator(selector).pressSequentially(String(value ?? ''));
                result = { selector, value: String(value ?? '') };
                break;
            case 'press':
                await page.keyboard.press(String(key || value || 'Enter'));
                result = { key: String(key || value || 'Enter') };
                break;
            case 'refresh':
                await page.reload({ waitUntil: 'domcontentloaded', timeout: waitTimeout });
                result = { url: page.url() };
                break;
            case 'wait':
                if (selector) await page.waitForSelector(selector, { state: 'visible', timeout: waitTimeout });
                else await page.waitForTimeout(Math.min(Number(value) || 1000, 120000));
                result = { waited: true };
                break;
            default:
                return res.status(400).json({ error: 'UNSUPPORTED_BROWSER_ACTION', action });
        }

        res.json({ sessionId, action, result, state: await browserState(page) });
    } catch (error) {
        res.status(500).json({ error: 'BROWSER_ACTION_FAILED', action, details: String(error.message || error) });
    }
});

/**
 * POST /api/browser/inspect
 * Return current page state and optionally selected element text/value.
 */
router.post('/browser/inspect', requireAuthOrApiKey, async (req, res) => {
    const managed = getManagedPage(req, res);
    if (!managed) return;

    const { page, sessionId } = managed;
    const { selector } = req.body || {};
    try {
        const state = await browserState(page);
        if (selector) {
            const locator = page.locator(selector).first();
            state.element = {
                exists: await locator.count() > 0,
                visible: await locator.isVisible().catch(() => false),
                text: await locator.innerText().catch(() => ''),
                value: await locator.inputValue().catch(() => null)
            };
        }
        res.json({ sessionId, state });
    } catch (error) {
        res.status(500).json({ error: 'BROWSER_INSPECT_FAILED', details: String(error.message || error) });
    }
});

/**
 * POST /api/browser/assert
 * Verify URL, title, page text, or selector state.
 */
router.post('/browser/assert', requireAuthOrApiKey, async (req, res) => {
    const managed = getManagedPage(req, res);
    if (!managed) return;

    const { page, sessionId } = managed;
    const { kind, expected, selector, contains = true, timeout = 10000 } = req.body || {};
    try {
        const state = await browserState(page);
        let actual;
        let passed = false;
        if (kind === 'url') actual = state.url;
        else if (kind === 'title') actual = state.title;
        else if (kind === 'text') actual = state.text;
        else if (kind === 'selector') {
            if (!selector) return res.status(400).json({ error: 'MISSING_SELECTOR' });
            const locator = page.locator(selector).first();
            await locator.waitFor({ state: 'attached', timeout: Math.min(Number(timeout) || 10000, 120000) }).catch(() => {});
            actual = { exists: await locator.count() > 0, visible: await locator.isVisible().catch(() => false) };
            passed = actual.exists && (!expected || expected === 'visible' ? actual.visible : true);
        } else {
            return res.status(400).json({ error: 'UNSUPPORTED_ASSERTION', kind });
        }

        if (kind !== 'selector') {
            const actualText = String(actual ?? '');
            const expectedText = String(expected ?? '');
            passed = contains ? actualText.includes(expectedText) : actualText === expectedText;
        }
        res.status(passed ? 200 : 422).json({ sessionId, passed, kind, expected, actual, state });
    } catch (error) {
        res.status(500).json({ error: 'BROWSER_ASSERT_FAILED', details: String(error.message || error) });
    }
});

/**
 * POST /api/inspector/highlight
 * Activate highlight/inspect mode on the active session and return verified
 * selectors matching targetHint (if provided).
 * Body: { sessionId?, url?, targetHint? }
 * Returns: { success, selectors: [{css, xpath, confidence}], snapshot? }
 */
router.post('/inspector/highlight', requireAuthOrApiKey, async (req, res) => {
    try {
        const { sessionId, url, targetHint } = req.body || {};
        let session = getActiveSession();

        if (!session || session.status !== 'running') {
            // Attempt to launch one if URL given
            if (url) {
                session = await launchApiSession({ url });
            }
        }

        if (!session || session.status !== 'running' || !session.page) {
            return res.status(404).json({ error: 'NO_ACTIVE_SESSION', details: 'No running browser session available. Launch one first via /api/browser/open.' });
        }

        // Validate sessionId if provided
        const activeId = ensureSessionId(session);
        if (sessionId && sessionId !== activeId) {
            return res.status(409).json({ error: 'SESSION_ID_MISMATCH', activeSessionId: activeId });
        }

        // Enable inspect mode (idempotent)
        session.inspectModeEnabled = true;
        try {
            const pages = session.context ? session.context.pages() : [session.page];
            for (const p of pages) {
                await p.evaluate(() => {
                    if (window.__figraniumInspectInit) window.__figraniumInspectInit();
                }).catch(() => {});
            }
        } catch (e) {}

        const page = session.page;

        // Optionally navigate
        if (url) {
            try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}); } catch (e) {}
        }

        let selectors = [];
        if (targetHint) {
            selectors = await inspectTargetInPage(page, targetHint);
        }

        // Optional snapshot (small, JPEG to keep size down)
        let snapshot = null;
        try {
            const buf = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: false });
            snapshot = buf.toString('base64');
        } catch (e) {}

        res.json({ success: true, selectors, snapshot });
    } catch (e) {
        const message = String(e && e.message ? e.message : e);
        res.status(500).json({ error: 'INSPECTOR_FAILED', details: message });
    }
});

module.exports = router;
