const assert = require('assert');
const { spawnSync } = require('child_process');

const runMiddleware = (authRequired, nodeEnv) => {
    const script = `
        const assert = require('assert');
        const { requireAuth, requireAuthOrApiKey, csrfProtection } = require('./src/server/middleware');
        const headers = {
            origin: 'http://localhost:5173',
            referer: 'http://localhost:5173/'
        };
        const req = {
            session: {},
            xhr: true,
            path: '/api/settings/theme',
            method: 'POST',
            get(name) { return headers[name.toLowerCase()]; }
        };
        const res = {
            statusCode: 200,
            body: null,
            status(code) { this.statusCode = code; return this; },
            json(body) { this.body = body; return this; }
        };
        let authNext = false;
        requireAuth(req, res, () => { authNext = true; });
        assert.strictEqual(authNext, ${authRequired ? 'false' : 'true'});
        let apiNext = false;
        Promise.resolve(requireAuthOrApiKey(req, res, () => { apiNext = true; }))
            .then(() => {
                assert.strictEqual(apiNext, ${authRequired ? 'false' : 'true'});
                let csrfNext = false;
                csrfProtection(req, res, () => { csrfNext = true; });
                assert.strictEqual(csrfNext, ${nodeEnv === 'production' ? 'false' : 'true'});
                if (${nodeEnv === 'production' ? 'true' : 'false'}) {
                    assert.strictEqual(res.statusCode, 403);
                    assert.strictEqual(res.body.error, 'CSRF_ORIGIN_MISMATCH');
                }
            })
            .catch((error) => { console.error(error); process.exitCode = 1; });
    `;
    return spawnSync(process.execPath, ['-e', script], {
        cwd: require('path').join(__dirname, '..'),
        env: {
            ...process.env,
            NODE_ENV: nodeEnv,
            AUTH_REQUIRED: authRequired ? 'true' : 'false',
            VITE_DEV_PORT: '5173'
        },
        encoding: 'utf8'
    });
};

console.log('Testing local optional-auth mode...');
const optional = runMiddleware(false, 'development');
assert.strictEqual(optional.status, 0, optional.stderr || optional.stdout);
console.log('PASS: local auth bypass and Vite origin are allowed');

console.log('Testing protected-auth mode in development...');
const requiredInDevelopment = runMiddleware(true, 'development');
assert.strictEqual(requiredInDevelopment.status, 0, requiredInDevelopment.stderr || requiredInDevelopment.stdout);
console.log('PASS: auth remains enforced while local Vite origin is accepted');

console.log('Testing protected-auth mode in production...');
const required = runMiddleware(true, 'production');
assert.strictEqual(required.status, 0, required.stderr || required.stdout);
console.log('PASS: auth and CSRF remain enforced when enabled');
