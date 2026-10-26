import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limiteDelDia, armarCola, armarMensaje, enviadosHoy } from '../src/enviar.mjs';

const config = {
  rampa: [{ desde_dia: 1, por_dia: 2 }, { desde_dia: 4, por_dia: 3 }, { desde_dia: 8, por_dia: 5 }, { desde_dia: 22, por_dia: 10 }],
  maximo: 10,
  seguimientos: [3, 7],
};
const dia = (s) => new Date(`${s}T12:00:00`);
const borrador = { estado: 'aprobado', asunto: 'consultas en X', cuerpo: 'hola', seguimiento1: 's1', seguimiento2: 's2', revisado: '2026-10-27' };

test('la rampa sube con los días desde el primer envío', () => {
  assert.equal(limiteDelDia(config, null, dia('2026-11-02')), 2);
  assert.equal(limiteDelDia(config, '2026-11-02T10:00:00', dia('2026-11-04')), 2);
  assert.equal(limiteDelDia(config, '2026-11-02T10:00:00', dia('2026-11-05')), 3);
  assert.equal(limiteDelDia(config, '2026-11-02T10:00:00', dia('2026-12-30')), 10);
});

test('solo manda aprobados de leads que encajan, y nunca a cerrados', () => {
  const leads = [
    { email: 'a@a.com', encaja: 'si', estado: 'con_email', borrador },
    { email: 'b@b.com', encaja: 'si', estado: 'con_email', borrador: { ...borrador, estado: 'pendiente' } },
    { email: 'c@c.com', encaja: 'dudoso', estado: 'con_email', borrador },
    { email: 'd@d.com', encaja: 'si', estado: 'respondio', borrador, historial: [{ tipo: 'envio', fecha: '2026-11-01T10:00:00' }] },
  ];
  assert.deepEqual(armarCola(leads, config, dia('2026-11-10')).map((c) => c.lead.email), ['a@a.com']);
});

test('los seguimientos salen a los 3 y 7 días y van primero', () => {
  const enviado = (fecha, n = 1) => ({
    email: `s${n}@x.com`, encaja: 'si', estado: n === 1 ? 'enviado' : 'seguimiento', borrador,
    historial: Array.from({ length: n }, (_, i) => ({ tipo: 'envio', paso: i, fecha, message_id: '<m1@x>' })),
  });
  const nuevo = { email: 'n@x.com', encaja: 'si', estado: 'con_email', borrador };
  assert.deepEqual(armarCola([nuevo, enviado('2026-11-02T10:00:00')], config, dia('2026-11-04')).map((c) => c.lead.email), ['n@x.com']);
  const cola = armarCola([nuevo, enviado('2026-11-02T10:00:00')], config, dia('2026-11-05'));
  assert.deepEqual(cola.map((c) => [c.lead.email, c.paso]), [['s1@x.com', 1], ['n@x.com', 0]]);
  assert.equal(armarCola([enviado('2026-11-02T10:00:00', 2)], config, dia('2026-11-08')).length, 0);
  assert.equal(armarCola([enviado('2026-11-02T10:00:00', 2)], config, dia('2026-11-09'))[0].paso, 2);
  assert.equal(armarCola([enviado('2026-11-02T10:00:00', 3)], config, dia('2026-12-01')).length, 0);
});

test('el seguimiento va en el mismo hilo', () => {
  const lead = { email: 'a@a.com', borrador, historial: [{ tipo: 'envio', paso: 0, fecha: '2026-11-02T10:00:00', message_id: '<m1@x>' }] };
  const m = armarMensaje(lead, 1, { nombre: 'Tobías | Pucará Technologies', email: 't@gmail.com' });
  assert.equal(m.subject, 'Re: consultas en X');
  assert.equal(m.text, 's1');
  assert.equal(m.inReplyTo, '<m1@x>');
  assert.equal(armarMensaje({ ...lead, historial: [] }, 0, { nombre: 'T', email: 't@gmail.com' }).inReplyTo, undefined);
});

test('cuenta los envíos de hoy', () => {
  const leads = [{ historial: [{ tipo: 'envio', fecha: new Date().toISOString() }, { tipo: 'estado', fecha: new Date().toISOString() }] }];
  assert.equal(enviadosHoy(leads, new Date()), 1);
});

test('formato mínimo: firma en negrita, links solo donde hay web o WhatsApp', async () => {
  const { aHtml } = await import('../src/enviar.mjs');
  const { FIRMA, FIRMA_COMPLETA } = await import('../src/redactar.mjs');
  const primero = aHtml(`Hola Juan,\n\nTexto <con> signos.\n\n${FIRMA}\n\nSi no querés que te vuelva a escribir, respondé "no".`);
  assert.match(primero, /<strong>Tobías Rubial<\/strong>/);
  assert.match(primero, /Texto &lt;con&gt; signos/);
  assert.doesNotMatch(primero, /<a /);
  assert.doesNotMatch(primero, /<img|font-face|googleapis/);
  const seguimiento = aHtml(`Hola,\n\nOtra vez.\n\n${FIRMA_COMPLETA}`);
  assert.match(seguimiento, /href="https:\/\/pucaratechnologies.com"/);
  assert.match(seguimiento, /href="https:\/\/wa.me\/5491154866935"/);
});
