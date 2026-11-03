import test from 'node:test';
import assert from 'node:assert/strict';
import version, {versionViteProxy} from '../api/version.js';

const response = () => ({headers:{}, setHeader(name, value) {this.headers[name] = value;}, end(body) {this.body = JSON.parse(body);}});

test('deployment diagnostics exposes only public revision metadata and cannot be cached', () => {
  const previous = process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    process.env.VERCEL_GIT_COMMIT_SHA = 'a'.repeat(40);
    const res = response();
    version({method:'GET', url:'/api/version?secret=must-not-echo'}, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(res.headers['Vercel-CDN-Cache-Control'], 'no-store');
    assert.equal(res.body.revision, 'a'.repeat(40));
    assert.equal(res.body.release, 'reporting-pilot-v2');
    assert.ok(res.body.features.includes('single-report-category'));
    assert.ok(!JSON.stringify(res.body).includes('must-not-echo'));
    assert.deepEqual(Object.keys(res.body).sort(), ['application','features','release','revision']);
    process.env.VERCEL_GIT_COMMIT_SHA = 'not-a-public-commit';
    const unknown = response();
    version({method:'GET'}, unknown);
    assert.notEqual(unknown.body.revision, 'not-a-public-commit');
    const post = response();
    version({method:'POST'}, post);
    assert.equal(post.statusCode, 405);
  } finally {
    if (previous === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = previous;
  }
});

test('Vite diagnostics middleware installs without returning an invalid post-hook', () => {
  let middleware;
  const plugin = versionViteProxy();
  const server = {middlewares:{use(handler) {middleware = handler; return () => {throw new Error('must not become post hook');};}}};
  assert.equal(plugin.configurePreviewServer(server), undefined);
  let next = false;
  middleware({url:'/api/unrelated'}, {}, () => {next = true;});
  assert.equal(next, true);
  const res = response();
  middleware({method:'GET', url:'/api/version?probe=1'}, res, () => assert.fail('diagnostics must be handled'));
  assert.equal(res.statusCode, 200);
});
