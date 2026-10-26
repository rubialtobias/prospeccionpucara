import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarCambiosDelPanel, aFila } from '../src/sincronizar.mjs';

test('trae del panel solo los cambios más nuevos que los locales', () => {
  const leads = [
    { linkedin_url: 'a', estado: 'nuevo', nota: '' },
    { linkedin_url: 'b', estado: 'enviado', nota: '', actualizado_panel: '2026-10-27T10:00:00Z' },
  ];
  const remotos = [
    { linkedin_url: 'a', estado: 'reunion', nota: 'jueves', historial: [], actualizado_panel: '2026-10-27T09:00:00Z' },
    { linkedin_url: 'b', estado: 'nuevo', nota: 'vieja', historial: [], actualizado_panel: '2026-10-26T09:00:00Z' },
  ];
  assert.equal(aplicarCambiosDelPanel(leads, remotos), 1);
  assert.equal(leads[0].estado, 'reunion');
  assert.equal(leads[1].estado, 'enviado');
});

test('la fila separa lo editable de los datos', () => {
  const f = aFila({ linkedin_url: 'a', nombre: 'Juan', estado: 'con_email', nota: 'x' });
  assert.deepEqual(f.datos, { linkedin_url: 'a', nombre: 'Juan' });
  assert.equal(f.estado, 'con_email');
  assert.deepEqual(f.historial, []);
});
