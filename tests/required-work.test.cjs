const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('content.js', 'utf8');

function setup(ticket) {
  const values = {};
  const context = vm.createContext({
    ticket, centralLog: async () => {}, openTicketDetail: async () => {},
    findButton: () => null, isTicketCompleted: () => false,
    setSelect: async () => {}, setCustomerMessage: value => { values.solution = value; },
    findControl: label => ({ label }), setNativeValue: (control, value) => { values[control.label] = value; },
    attachFieldImages: async () => {}, waitForOperationalCloseButton: async () => ({ click: () => { values.clicked = true; } }),
    readVisibleErrors: () => [], waitForTicketClosure: async () => {}, Set
  });
  vm.runInContext(source.slice(source.indexOf('async function finalizeTicket'), source.indexOf('async function openTicketDetail')), context);
  return { values, run: () => vm.runInContext('finalizeTicket(ticket)', context) };
}

test('old queued ticket uses its solution for the now required work reason', async () => {
  const ticket = { customerMessage: 'Se conecto la impresora', workDetail: '' };
  const { values, run } = setup(ticket);
  await run();
  assert.equal(values['detalle para el cliente / motivo'], ticket.customerMessage);
  assert.equal(values.clicked, true);
  assert.equal(ticket.workDetail, '');
});

test('explicit work reason is preserved', async () => {
  const { values, run } = setup({ customerMessage: 'Solucion', workDetail: 'Trabajo realizado' });
  await run();
  assert.equal(values['detalle para el cliente / motivo'], 'Trabajo realizado');
});

test('missing reason and solution stops before submitting', async () => {
  const { values, run } = setup({ customerMessage: ' ', workDetail: '' });
  await assert.rejects(run(), /Completa el detalle/);
  assert.equal(values.clicked, undefined);
});
