import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const runner = new URL('../ingest-runner.mjs', import.meta.url).href;
const fixture = `
let oidc = 0, posts = 0, pages = 0;
const items = Array.from({ length: 30 }, (_, i) =>
  '<item><title>Story ' + i + '</title><source>Outlet</source>' +
  '<link>https://example.com/' + i + '</link><guid>' + i + '</guid>' +
  '<pubDate>' + new Date().toUTCString() + '</pubDate></item>').join('');
const rss = '<rss><channel>' + items + '</channel></rss>';
globalThis.fetch = async input => {
  const url = String(input);
  if (url.startsWith('https://oidc.example/')) return Response.json({ value: 'assertion-' + ++oidc });
  if (url.includes('/api/ingest/targets')) {
    if (process.env.TEST_TARGETS_MODE === 'paused') return Response.json({ code: 'news_ingestion_paused' }, { status: 503 });
    if (process.env.TEST_TARGETS_MODE === 'unknown503') return Response.json({ code: 'other_error' }, { status: 503 });
    if (process.env.TEST_TARGETS_MODE === 'malformed') return Response.json({ targets: [] });
    if (process.env.TEST_TARGETS_MODE === 'empty') return Response.json([]);
    return Response.json(Array.from({ length: 10 }, () => ({ target: 'WORLD', rot: 0 })));
  }
  if (url.includes('/api/ingest/publishers')) {
    if (process.env.TEST_HEALTH === 'failing') return Response.json({ hosts: { 'example.com': [20, 0, Date.now()] } });
    return Response.json({ hosts: {} });
  }
  if (url.startsWith('https://example.com/')) {
    pages++;
    return new Response('<html lang="en"><meta property="article:published_time" content="' + new Date(Date.now() - 3600000).toISOString().replace(/\.\d+Z$/, 'Z') + '"><article><p>' + 'Report text for the fixture story. '.repeat(4) + '</p></article></html>', { headers: { 'content-type': 'text/html' } });
  }
  if (url.endsWith('/api/ingest')) {
    posts++;
    if (process.env.TEST_BATCH_FAILURES === '1' && posts === 1) return new Response('sensitive-response-marker', { status: 503 });
    if (process.env.TEST_BATCH_FAILURES === '1' && posts === 2) throw new Error('sensitive-exception-marker');
    return Response.json({ stored: 100 });
  }
  if (url.startsWith('https://news.google.com/')) return new Response(rss);
  throw new Error('Unexpected fixture URL');
};
process.on('exit', () => console.log('COUNTS', JSON.stringify({ oidc, posts }), 'PAGES', pages));
await import(${JSON.stringify(runner)});
`;

function run(failures, targetsMode = 'normal', extra = {}) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', fixture], {
    cwd: root,
    env: { ...process.env, SITE: 'https://globalnewsflix.com', SITE_RETRY_DELAYS: '', ENRICH_TOP: '0',
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example/assert?version=1',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'runner-fixture', TEST_BATCH_FAILURES: failures ? '1' : '0',
      TEST_TARGETS_MODE: targetsMode, ...extra },
    encoding: 'utf8', timeout: 20000,
  });
}

test('ingest attempts later batches and fails without exposing provider responses or tokens', () => {
  const result = run(true);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ingest batch 1: HTTP 503/);
  assert.match(result.stderr, /ingest batch 2: request failed/);
  assert.match(result.stdout, /stored batch 3: HTTP 200/);
  assert.match(result.stdout, /COUNTS {"oidc":5,"posts":3}/);
  assert.doesNotMatch(result.stdout + result.stderr, /sensitive-response-marker|sensitive-exception-marker|runner-fixture|assertion-/);
});

test('ingest succeeds when every batch is accepted', () => {
  const result = run(false);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /COUNTS {"oidc":5,"posts":3}/);
  assert.doesNotMatch(result.stderr, /ingest batch/);
});

test('explicit ingestion pause is a clean no-op', () => {
  const result = run(false, 'paused');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /news ingestion paused/);
  assert.match(result.stdout, /COUNTS {"oidc":1,"posts":0}/);
});

test('unknown target failure and malformed success both fail closed', () => {
  for (const mode of ['unknown503', 'malformed']) {
    const result = run(false, mode);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ingest targets:/);
    assert.match(result.stdout, /COUNTS {"oidc":1,"posts":0}/);
    assert.doesNotMatch(result.stdout + result.stderr, /other_error|assertion-|runner-fixture/);
  }
});

test('empty target list is a normal no-op', () => {
  const result = run(false, 'empty');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /COUNTS {"oidc":1,"posts":0}/);
});

test('collector reads healthy publishers and skips publishers that keep failing', () => {
  const ok = run(false, 'normal', { ENRICH_TOP: '3' });
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /PAGES [1-9]/, 'publisher pages are read');
  assert.match(ok.stdout, /publisher pages {"enriched":[1-9]/);
  const skipped = run(false, 'normal', { ENRICH_TOP: '3', TEST_HEALTH: 'failing' });
  assert.equal(skipped.status, 0);
  assert.match(skipped.stdout, /PAGES 0/, 'a publisher that repeatedly gave no dated page is not requested');
});

test('collector stops reading publisher pages near its share of the job deadline but still uploads', () => {
  const r = run(false, 'normal', { ENRICH_TOP: '3', INGEST_DEADLINE: String(Date.now() + 30000), PASSES: '4', PASS: '1' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /PAGES 0/);
  assert.match(r.stdout, /stored batch 1/);
});

test('the collector imports only its own pure modules and Node built-ins (no packages, database or site code)', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const { posix } = await import('node:path');
  const seen = new Set(), bare = new Set(), stack = ['ingest-runner.mjs'];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const body = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    for (const match of body.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = match[1] || match[2];
      if (!spec.startsWith('.')) { bare.add(spec); continue; }
      const target = posix.normalize(posix.join(posix.dirname(file), spec));
      assert.ok(existsSync(new URL('../' + target, import.meta.url)), target);
      stack.push(target);
    }
  }
  assert.deepEqual([...bare].filter(spec => !spec.startsWith('node:')), [], 'no npm packages: the collector runs without npm ci');
  for (const file of seen) assert.doesNotMatch(file, /^(?:ingest|db|ai|ai-client|worker|auth|render|media|pipeline|mail|changes)\.js$/, file);
  assert.ok(seen.has('news-collect.js') && seen.has('ingest-resolve.js') && seen.has('site-fetch.mjs'));
});

test('each collector pass reports a counts-only summary as a workflow annotation', () => {
  const r = run(false, 'normal', { ENRICH_TOP: '3', PASS: '2' });
  assert.equal(r.status, 0);
  const line = r.stdout.split('\n').find(l => l.startsWith('::notice title=Collector pass 2::'));
  assert.ok(line, 'one annotation line for the pass');
  const summary = JSON.parse(line.slice(line.indexOf('::', 2) + 2));
  assert.equal(summary.targets, 10);
  assert.ok(summary.rows > 0);
  assert.ok(summary.pages.enriched > 0);
  assert.equal(typeof summary.google.resolved, 'number');
  assert.doesNotMatch(line, /https?:|Story \d|example\.com/, 'no titles or URLs in the annotation');
});
