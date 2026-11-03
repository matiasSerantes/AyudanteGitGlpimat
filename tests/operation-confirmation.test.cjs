const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('content.js', 'utf8');
function setup(alerts = [], successAt = Infinity) {
  let now = 0;
  const context = vm.createContext({
    Set, Date: { now: () => now },
    document: { querySelectorAll: () => alerts, body: { innerText: '' } },
    isVisible: node => node.visible,
    normalize: value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(),
    delay: async ms => { now += ms; },
    readTicketSuccess: () => now >= successAt ? { titleMatches: true, reference: '#7003' } : null,
    findButton: () => null,
    TICKET_CLOSURE_TIMEOUT: 45000,
    readTicketDetail: () => now >= successAt ? null : {},
    isTicketCompleted: () => now >= successAt,
    returnAfterCompletion: async () => {}
  });
  vm.runInContext(source.slice(source.indexOf('function readVisibleErrors'), source.indexOf('function readTicketSuccess')), context);
  vm.runInContext(source.slice(source.indexOf('async function waitForTicketClosure'), source.indexOf('async function openTicketForm')), context);
  return context;
}
test('hidden alerts and old visible errors are ignored', () => {
  const context = setup([{ visible: false, textContent: 'Error oculto' }, { visible: true, textContent: 'Error anterior' }]);
  assert.equal(vm.runInContext('readOperationError(new Set(["Error anterior"]))', context), '');
});
test('uncertain response waits for successful creation', async () => {
  const context = setup([{ visible: true, textContent: 'No se pudo confirmar la operación. Consultá su estado antes de repetirla.' }], 1400);
  const result = await vm.runInContext('waitForSubmission("cambio de cable")', context);
  assert.equal(result.ok, true);
  assert.equal(result.reference, '#7003');
});
test('new validation errors still stop creation', async () => {
  const result = await vm.runInContext('waitForSubmission("test")', setup([{ visible: true, textContent: 'Campo obligatorio' }]));
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Campo obligatorio');
});
test('uncertain creation without success times out safely', async () => {
  const result = await vm.runInContext('waitForSubmission("test")', setup([{ visible: true, textContent: 'No se pudo confirmar la operación' }]));
  assert.equal(result.ok, false);
  assert.match(result.error, /evitar duplicados/);
});
test('closure also waits past an uncertain response', async () => {
  await vm.runInContext('waitForTicketClosure("#7003")', setup([{ visible: true, textContent: 'No se pudo confirmar la operación' }], 1400));
});
