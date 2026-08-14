import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

const workflowPath = path.resolve(process.cwd(), '..', '.github', 'workflows', 'doordash-weekly-production.yml');
const validationPath = path.resolve(process.cwd(), '..', '.github', 'workflows', 'doordash-weekly-validation.yml');

const workflow = YAML.parse(fs.readFileSync(workflowPath, 'utf8')) as any;
const validation = YAML.parse(fs.readFileSync(validationPath, 'utf8')) as any;

assert.equal(workflow.on.schedule[0].cron, '5 18 * * 0');
assert.ok(workflow.on.workflow_dispatch);
assert.equal(workflow.jobs['weekly-production']['runs-on'], 'ubuntu-latest');
assert.equal(workflow.jobs['weekly-production']['timeout-minutes'], 30);
assert.equal(workflow.concurrency['cancel-in-progress'], false);
assert.ok(workflow.jobs['weekly-production'].steps.some((step: any) => step.uses === 'actions/upload-artifact@v4'));
assert.ok(workflow.jobs['weekly-production'].steps.some((step: any) => step.uses === 'actions/github-script@v8'));

assert.equal(validation.jobs.validate['runs-on'], 'ubuntu-latest');
assert.ok(validation.on.pull_request);
assert.ok(validation.on.push);

console.log('workflow-validation tests passed');
