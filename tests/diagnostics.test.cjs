const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('logs serialize concurrent writes, retain 1500 events and report storage failures', async () => {
  let listener;
  let data = {};
  let fail = false;
  const chrome = {
    runtime: {
      onInstalled: { addListener() {} }, onStartup: { addListener() {} },
      onMessage: { addListener(fn) { listener = fn; } },
      getManifest: () => ({ version: '0.3.14' })
    },
    storage: { local: {
      async get() { await Promise.resolve(); return structuredClone(data); },
      async set(value) { if (fail) throw Error('storage unavailable'); data = structuredClone(value); }
    }}
  };
  vm.runInNewContext(fs.readFileSync('background.js', 'utf8'), { chrome });
  const append = event => new Promise(resolve => {
    assert.equal(listener({ type: 'diagnostics.append', entry: { event, source: 'central', details: { field: 'categoria' } } }, { tab: { id: 7 } }, resolve), true);
  });
  const responses = await Promise.all(Array.from({ length: 1510 }, (_, i) => append(`event-${i}`)));
  assert.ok(responses.every(result => result.ok));
  assert.equal(data.smartCentralDiagnostics.length, 1500);
  assert.equal(data.smartCentralDiagnostics[0].event, 'event-10');
  assert.equal(data.smartCentralDiagnostics.at(-1).event, 'event-1509');
  assert.equal(data.smartCentralDiagnostics[0].tabId, 7);
  assert.equal(data.smartCentralDiagnostics[0].version, '0.3.14');
  fail = true;
  assert.equal((await append('failed')).ok, false);
  fail = false;
  assert.equal((await append('recovered')).ok, true);
});

test('fallback injection registers the content listener only once', () => {
  let listeners = 0;
  const context = vm.createContext({ chrome: { runtime: { onMessage: { addListener() { listeners++; } } } } });
  const code = fs.readFileSync('content.js', 'utf8');
  vm.runInContext(code, context);
  vm.runInContext(code, context);
  assert.equal(listeners, 1);
});
