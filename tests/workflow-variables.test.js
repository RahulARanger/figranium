const assert = require('assert');
const { buildWorkflowVariables, resolveWorkflowValue } = require('../src/server/workflow-variables');

const originalEnv = process.env.WORKFLOW_ENV_TEST;

try {
    process.env.WORKFLOW_ENV_TEST = 'from-env';

    const variables = buildWorkflowVariables(
        { saved: { type: 'string', value: 'from-task' }, shared: { value: 'task-value' } },
        { shared: 'from-run' }
    );

    assert.strictEqual(variables.WORKFLOW_ENV_TEST, 'from-env');
    assert.strictEqual(variables.saved, 'from-task');
    assert.strictEqual(variables.shared, 'from-run');
    assert.strictEqual(
        resolveWorkflowValue('{$WORKFLOW_ENV_TEST}/{$saved}/{$shared}', variables),
        'from-env/from-task/from-run'
    );
    assert.deepStrictEqual(
        resolveWorkflowValue({ headers: ['Bearer {$WORKFLOW_ENV_TEST}'] }, variables),
        { headers: ['Bearer from-env'] }
    );

    console.log('Workflow environment variable tests passed!');
} finally {
    if (originalEnv === undefined) delete process.env.WORKFLOW_ENV_TEST;
    else process.env.WORKFLOW_ENV_TEST = originalEnv;
}
