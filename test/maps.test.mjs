import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esCadena, lugarALead } from '../src/buscar-maps.mjs';

const excluir = ['smart fit', 'megatlon', 'on fit', 'sport club'];

test('descarta cadenas aunque cambien mayúsculas y tildes', () => {
  assert.ok(esCadena('ON FIT La Plata', excluir));
  assert.ok(esCadena('Megatlón Palermo', excluir));
  assert.ok(!esCadena('SKAY GYM', excluir));
});

test('un lugar de Maps se vuelve lead con web propia o Instagram', () => {
  const ctx = { rubro: 'gimnasios', ciudad: 'La Plata', consulta: 'q', hoy: '2026-10-28' };
  const conWeb = lugarALead({ title: 'Core Gym', cid: '123', website: 'http://www.coregym.com.ar/', phoneNumber: '0221 495-9660', ratingCount: 88 }, ctx);
  assert.equal(conWeb.linkedin_url, 'https://maps.google.com/?cid=123');
  assert.equal(conWeb.web, 'http://www.coregym.com.ar');
  assert.equal(conWeb.fuente, 'maps');
  const conIg = lugarALead({ title: 'Fit Club', cid: '9', website: 'https://www.instagram.com/fit.clublp/?hl=es' }, ctx);
  assert.equal(conIg.web, '');
  assert.equal(conIg.instagram, 'https://www.instagram.com/fit.clublp/');
  assert.equal(lugarALead({ title: 'Sin id' }, ctx), null);
});

test('reconoce cadenas escritas con letras decorativas', () => {
  assert.ok(esCadena('𝙎𝙥𝙤𝙧𝙩𝘾𝙡𝙪𝙗 [Estrada]', ['sportclub']));
});
