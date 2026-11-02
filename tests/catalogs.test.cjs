const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('content.js', 'utf8');
const code = source.slice(source.indexOf('async function collectCatalogs'), source.indexOf('function readCatalogsFromOpenForm'));
function setup({ login = false, open = false } = {}) {
  let now = 0, opened = 0;
  const context = vm.createContext({
    Date: { now: () => now }, CONTROL_TIMEOUT: 12000,
    isLoginPage: () => login, isTicketFormOpen: () => open,
    openTicketForm: async () => { open = true; opened++; },
    delay: async ms => { now += ms; },
    readCatalogsFromOpenForm: () => ({ ok: true, catalogs: { entities: now >= 1000 ? ['Nueva entidad'] : [], technicians: [] } })
  });
  vm.runInContext(code, context);
  return { context, opened: () => opened, time: () => now };
}
test('manual refresh opens the form and waits for loaded options', async () => {
  const env = setup();
  const result = await vm.runInContext('collectCatalogs(true)', env.context);
  assert.equal(env.opened(), 1);
  assert.equal(result.catalogs.entities[0], 'Nueva entidad');
  assert.ok(env.time() >= 1800);
});
test('automatic refresh does not open a form', async () => {
  const env = setup();
  const result = await vm.runInContext('collectCatalogs()', env.context);
  assert.equal(result.ok, false);
  assert.equal(env.opened(), 0);
});
test('expired session reports an error without opening the form', async () => {
  const env = setup({ login: true });
  await assert.rejects(vm.runInContext('collectCatalogs(true)', env.context), /Inicia sesion/);
  assert.equal(env.opened(), 0);
});
test('an existing form is preserved', async () => {
  const env = setup({ open: true });
  await vm.runInContext('collectCatalogs(true)', env.context);
  assert.equal(env.opened(), 0);
});
