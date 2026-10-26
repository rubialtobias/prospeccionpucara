import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsearTitulo, parsearSnippet, normalizarUrl, esPerfil, resultadoALead } from '../src/parse.mjs';
import { armarConsultas } from '../src/buscar.mjs';

test('título con nombre, cargo y empresa', () => {
  assert.deepEqual(parsearTitulo('Juan Pérez - Dueño - Inmobiliaria Pérez | LinkedIn'), {
    nombre: 'Juan Pérez', cargo: 'Dueño', empresa: 'Inmobiliaria Pérez',
  });
});

test('título con "en" separa cargo y empresa', () => {
  assert.deepEqual(parsearTitulo('María Gómez – CEO en Gómez Propiedades - LinkedIn'), {
    nombre: 'María Gómez', cargo: 'CEO', empresa: 'Gómez Propiedades',
  });
});

test('"de" no se toma como empresa', () => {
  assert.equal(parsearTitulo('Ana Ruiz - Directora de Ventas | LinkedIn').cargo, 'Directora de Ventas');
});

test('snippet con ubicación y experiencia', () => {
  const s = parsearSnippet('Dueño en Pérez Propiedades · Experiencia: Pérez Propiedades · Ubicación: Córdoba · 500+ contactos');
  assert.equal(s.ubicacion, 'Córdoba');
  assert.equal(s.experiencia, 'Pérez Propiedades');
});

test('URLs de distintos subdominios se unifican', () => {
  assert.equal(normalizarUrl('https://ar.linkedin.com/in/juan-perez/?trk=x'), 'https://www.linkedin.com/in/juan-perez');
  assert.equal(normalizarUrl('https://es.linkedin.com/in/Juan-Perez'), 'https://www.linkedin.com/in/juan-perez');
});

test('solo acepta perfiles personales', () => {
  assert.ok(esPerfil('https://ar.linkedin.com/in/juan-perez'));
  assert.ok(!esPerfil('https://ar.linkedin.com/company/inmo-perez'));
  assert.ok(!esPerfil('https://ar.linkedin.com/posts/juan-perez_abc'));
});

test('resultado completo a lead', () => {
  const lead = resultadoALead(
    { title: 'Juan Carlos Pérez - Fundador - Pérez Propiedades | LinkedIn', link: 'https://ar.linkedin.com/in/jcperez', snippet: 'Ubicación: Rosario' },
    { rubro: 'inmobiliarias', consulta: 'q' },
  );
  assert.equal(lead.nombre, 'Juan');
  assert.equal(lead.apellido, 'Carlos Pérez');
  assert.equal(lead.empresa, 'Pérez Propiedades');
  assert.equal(lead.ubicacion, 'Rosario');
});

test('las consultas no pasan el límite de 32 palabras de Google', async () => {
  const { readFile } = await import('node:fs/promises');
  const config = JSON.parse(await readFile(new URL('../config/busquedas.json', import.meta.url), 'utf8'));
  for (const rubro of Object.keys(config.rubros)) {
    for (const q of armarConsultas(config, rubro)) {
      assert.ok(q.split(/\s+/).length <= 32, q);
    }
  }
});

test('cargo con la empresa pegada', () => {
  assert.deepEqual(parsearTitulo('Martín Díaz - Fundador y Director de HÚS REALTY | LinkedIn'), {
    nombre: 'Martín Díaz', cargo: 'Fundador y Director', empresa: 'HÚS REALTY',
  });
  assert.equal(parsearTitulo('Juan Degregorio - Propietario, Pratto Propiedades | LinkedIn').empresa, 'Pratto Propiedades');
  assert.equal(parsearTitulo('Mariela Schenone - CEO & Founder Metro X Real Estate | LinkedIn').empresa, 'Metro X Real Estate');
});

test('cargo cortado por Google', () => {
  assert.equal(parsearTitulo('Carlos Peñaloza - Socio Gerente en | LinkedIn').cargo, 'Socio Gerente');
});

test('título sin nombre usa el link y recupera cargo y empresa', () => {
  const lead = resultadoALead(
    { title: 'Dueño en Grupo Ciudad Inmobiliaria - LinkedIn', link: 'https://ar.linkedin.com/in/pablo-sosa-4a1b2c', snippet: '' },
    { rubro: 'inmobiliarias', consulta: 'q' },
  );
  assert.equal(lead.nombre, 'Pablo');
  assert.equal(lead.apellido, 'Sosa');
  assert.equal(lead.cargo, 'Dueño');
  assert.equal(lead.empresa, 'Grupo Ciudad Inmobiliaria');
  assert.equal(lead.revisar, 'si');
});

test('nombre con la empresa pegada y mayúsculas', () => {
  const lead = resultadoALead(
    { title: 'Diego Migliorisi Abogados - socio gerente en Migliorisi | LinkedIn', link: 'https://ar.linkedin.com/in/dm', snippet: '' },
    { rubro: 'inmobiliarias', consulta: 'q' },
  );
  assert.equal(`${lead.nombre} ${lead.apellido}`, 'Diego Migliorisi');
  const caps = resultadoALead(
    { title: 'FACUNDO VERZI - Arquitecto | LinkedIn', link: 'https://ar.linkedin.com/in/fv', snippet: '' },
    { rubro: 'inmobiliarias', consulta: 'q' },
  );
  assert.equal(`${caps.nombre} ${caps.apellido}`, 'Facundo Verzi');
});
