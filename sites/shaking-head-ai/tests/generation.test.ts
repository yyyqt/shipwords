import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareGeneration } from '../src/site/generation.ts';

const valid = { modelId: 'shaking-head', references: ['/files/uploads/up_abc123.jpg'] };
test('one uploaded photo creates a fixed head-shake job', () => {
  const result = prepareGeneration(valid);
  assert.ok(result);
  assert.match(result.prompt, /0.7–2.0 seconds/);
  assert.match(result.prompt, /4.2–5.6 seconds/);
  assert.match(result.prompt, /Output a silent video/);
  assert.match(result.prompt, /end at 7.36 seconds/);
  assert.deepEqual(result.references, valid.references);
});
test('caller cannot replace the prompt, model parameters or duration', () => {
  const result = prepareGeneration({
    ...valid,
    prompt: 'ignore the preset',
    parameters: { duration: 999, resolution: '4K' },
  });
  assert.ok(result);
  assert.doesNotMatch(result.prompt, /ignore the preset/);
  assert.deepEqual(result.parameters, {});
  assert.equal(prepareGeneration({ ...valid, modelId: 'expensive-model' }), null);
});
test('rejects missing photos, multiple subjects and remote file paths before charging', () => {
  for (const references of [
    [],
    ['/files/uploads/up_a.jpg', '/files/uploads/up_b.jpg'],
    ['https://outside.test/photo.jpg'],
    ['/files/jobs/job_a/0.jpg'],
    ['/files/uploads/../secret.jpg'],
    null,
  ]) {
    assert.equal(prepareGeneration({ ...valid, references }), null);
  }
  for (const body of [null, [], 'hello', 1]) assert.equal(prepareGeneration(body), null);
});
