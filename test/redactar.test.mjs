import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactar, saludo, variante, palabras } from '../src/redactar.mjs';

const generico = { nombre: 'Susana', empresa: 'Merello Bas Propiedades', email_tipo: 'generico', web_revisada: { boton_whatsapp: true } };
const personal = { nombre: 'Juan', empresa: 'Cupertino Inmobiliaria', email_tipo: 'personal', web_revisada: { formulario: true } };

test('saludo según el tipo de email', () => {
  assert.equal(saludo(generico), 'Hola, equipo de Merello Bas Propiedades:');
  assert.equal(saludo(personal), 'Hola Juan,');
});

test('elige el gancho por lo que se vio en la web', () => {
  assert.equal(variante(generico), 'whatsapp');
  assert.equal(variante(personal), 'formulario');
  assert.equal(variante({ empresa: 'X' }), 'general');
});

test('email al equipo en plural y a una persona en singular', () => {
  const g = redactar(generico);
  assert.match(g.cuerpo, /¿Les muestro/);
  assert.match(g.cuerpo, /respondan "no"/);
  const p = redactar(personal);
  assert.match(p.cuerpo, /¿Te muestro/);
  assert.match(p.seguimiento1, /lo veas/);
});

test('nunca afirma que no tienen asistente, sin links y corto', () => {
  for (const lead of [generico, personal, { empresa: 'Sessa Propiedades', email_tipo: 'generico' }]) {
    const b = redactar(lead);
    for (const texto of [b.cuerpo, b.seguimiento1, b.seguimiento2]) {
      assert.doesNotMatch(texto, /no tienen (un )?(asistente|bot|chat)/i);
      assert.doesNotMatch(texto, /https?:\/\/|www\./i);
    }
    // El límite de 100 palabras es para el mensaje; la firma y la línea de baja van aparte
    const mensaje = b.cuerpo.split('\n\nTobías Rubial')[0];
    assert.ok(palabras(mensaje) <= 100, `${palabras(mensaje)} palabras`);
    assert.match(b.cuerpo, /no (te|les) escribo más/);
    assert.equal(b.estado, 'pendiente');
  }
});

test('nombre corto de la empresa, como lo diría una persona', async () => {
  const { nombreCorto } = await import('../src/redactar.mjs');
  assert.equal(nombreCorto('Gustavo De Simone Soluciones Inmobiliarias'), 'Gustavo De Simone');
  assert.equal(nombreCorto("O'Feely Negocios Inmobiliarios"), "O'Feely");
  assert.equal(nombreCorto('Miranda Bosch Real Estate & Art'), 'Miranda Bosch');
  assert.equal(nombreCorto('Cupertino Inmobiliaria'), 'Cupertino Inmobiliaria');
});

test('el primer email no lleva web ni teléfono; los seguimientos sí', () => {
  const b = redactar(personal);
  assert.match(b.cuerpo, /Tobías Rubial\nPucará Technologies/);
  assert.doesNotMatch(b.cuerpo, /pucaratechnologies\.com|5486/);
  assert.match(b.seguimiento1, /pucaratechnologies\.com · WhatsApp \+54 9 11 5486-6935/);
});
