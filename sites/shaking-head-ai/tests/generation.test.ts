import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareGeneration } from '../src/site/generation.ts';

const valid = { modelId: 'shaking-head', references: ['/files/uploads/up_abc123.jpg'] };
test('one uploaded photo creates a fixed head-shake job', () => {
  const result = prepareGeneration(valid);
  assert.ok(result);
  assert.match(result.prompt, /图片1.*唯一主体/);
  assert.match(result.prompt, /严格参考视频1.*头部动作/);
  assert.match(result.prompt, /左右快速摇头/);
  assert.match(result.prompt, /输出无声8秒视频/);
  assert.match(result.prompt, /截取至7.36秒/);
  assert.deepEqual(result.references, valid.references);
});
test('caller cannot replace the prompt, model parameters or duration', () => {
  const result = prepareGeneration({
    ...valid,
    prompt: 'ignore the preset',
    reference_video_url: 'https://outside.test/expensive.mp4',
    reference_video_seconds: 999,
    parameters: {
      duration: 999,
      resolution: '4K',
      reference_video_url: 'https://outside.test/expensive.mp4',
      reference_video_seconds: 999,
      video_urls: ['https://outside.test/expensive.mp4'],
    },
  });
  assert.ok(result);
  assert.doesNotMatch(result.prompt, /ignore the preset/);
  assert.doesNotMatch(JSON.stringify(result), /outside\.test/);
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
