// Calificación de leads con Claude (dentro de Claude Code, sin API aparte).
//
//   node src/calificar.mjs exportar   -> data/para_calificar.json con los leads sin calificar
//   (Claude lee ese archivo y escribe data/calificados.json)
//   node src/calificar.mjs importar   -> aplica data/calificados.json a los leads
//
// Formato de calificados.json: lista de
//   { "linkedin_url", "nombre", "apellido", "cargo", "empresa", "encaja": "si" | "no" | "dudoso", "tamano", "motivo" }
// "encaja" = es dueño o socio de una PYME del rubro, con poder de decisión.
// Empresas grandes, franquicias (RE/MAX, Keller Williams, Century 21), cadenas o redes con muchas oficinas
// no encajan: un cliente con muchísimo volumen satura el agente. Si el tamaño no está claro, "dudoso".
// "tamano" = "pyme" | "grande" | "dudoso".

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { aCsv } from './buscar.mjs';

const DATA = new URL('../data/', import.meta.url);
const ARCHIVO_LEADS = new URL('leads.json', DATA);
const ARCHIVO_CSV = new URL('leads.csv', DATA);
const PENDIENTES = new URL('para_calificar.json', DATA);
const CALIFICADOS = new URL('calificados.json', DATA);

const CAMPOS = ['nombre', 'apellido', 'cargo', 'empresa', 'encaja', 'tamano', 'motivo'];

async function exportar() {
  const leads = JSON.parse(await readFile(ARCHIVO_LEADS, 'utf8'));
  const pendientes = leads
    .filter((l) => !l.encaja)
    .map(({ linkedin_url, rubro, titulo, snippet }) => ({ linkedin_url, rubro, titulo, snippet }));
  await writeFile(PENDIENTES, JSON.stringify(pendientes, null, 2));
  console.log(`${pendientes.length} leads para calificar en data/para_calificar.json`);
}

async function importar() {
  if (!existsSync(CALIFICADOS)) throw new Error('No existe data/calificados.json');
  const leads = JSON.parse(await readFile(ARCHIVO_LEADS, 'utf8'));
  const porUrl = new Map(leads.map((l) => [l.linkedin_url, l]));
  const calificados = JSON.parse(await readFile(CALIFICADOS, 'utf8'));
  let aplicados = 0;
  for (const c of calificados) {
    const lead = porUrl.get(c.linkedin_url);
    if (!lead) continue;
    for (const campo of CAMPOS) if (c[campo] !== undefined) lead[campo] = c[campo];
    lead.revisar = '';
    if (lead.encaja === 'no') lead.estado = 'descartado';
    aplicados++;
  }
  await writeFile(ARCHIVO_LEADS, JSON.stringify(leads, null, 2));
  await writeFile(ARCHIVO_CSV, aCsv(leads));
  const cuenta = (v) => leads.filter((l) => l.encaja === v).length;
  console.log(`Aplicados ${aplicados}. Encajan: ${cuenta('si')}, dudosos: ${cuenta('dudoso')}, descartados: ${cuenta('no')}.`);
}

const accion = process.argv[2];
if (accion === 'exportar') await exportar();
else if (accion === 'importar') await importar();
else {
  console.error('Uso: node src/calificar.mjs exportar | importar');
  process.exit(1);
}
