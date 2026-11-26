const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('sidepanel.js', 'utf8');
function setup(tabs, probe) {
  const button = {};
  const calls = [];
  const result = {};
  const context = vm.createContext({
    $: () => button, chrome: { tabs: { query: async () => tabs } },
    sendToTab: async id => { calls.push(id); return probe(id); },
    showDisconnected: text => { result.status = text; },
    showConnected: () => { result.status = 'connected'; },
    showLoginState: text => { result.status = text; },
    showToast: text => { result.toast = text; }, centralLog: async () => {}, setTimeout, clearTimeout
  });
  vm.runInContext(source.slice(source.indexOf('let checkingConnection'), source.indexOf('function showConnected')), context);
  return { button, calls, result, run: () => vm.runInContext('checkConnection(true)', context) };
}
test('checks active tab first and finds session even if another tab fails', async () => {
  const state = setup([{ id: 1 }, { id: 2, active: true }], id => {
    if (id === 2) throw new Error('Old tab');
    return { ready: true };
  });
  await state.run();
  assert.deepEqual(state.calls, [2, 1]);
  assert.equal(state.result.status, 'connected');
  assert.equal(state.button.disabled, false);
});
test('failed check can be retried with the same button', async () => {
  let ready = false;
  const state = setup([{ id: 1 }], () => { if (!ready) throw new Error('Recarga Central'); return { ready }; });
  await state.run();
  assert.equal(state.result.status, 'Sin conexion');
  assert.equal(state.result.toast, 'Recarga Central');
  ready = true;
  await state.run();
  assert.equal(state.result.status, 'connected');
  assert.equal(state.button.disabled, false);
});
test('missing Central tab restores retry button', async () => {
  const state = setup([], () => {});
  await state.run();
  assert.equal(state.result.status, 'Central no esta abierto');
  assert.equal(state.button.disabled, false);
});
