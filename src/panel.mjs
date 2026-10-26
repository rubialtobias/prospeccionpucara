// Panel local para seguir la prospección. Solo escucha en esta computadora.
//
//   npm run panel   -> http://localhost:4321
//
// GET  /api/leads          todos los leads
// POST /api/leads/estado   { linkedin_url, estado?, nota? }  cambia el estado o la nota de un lead

import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { aCsv } from './buscar.mjs';

const PUERTO = Number(process.env.PUERTO_PANEL ?? 4321);
// Emails por día en la etapa actual de calentamiento de la cuenta
const LIMITE_DIARIO = Number(process.env.LIMITE_DIARIO ?? 10);
const RAIZ = new URL('..', import.meta.url);
const ARCHIVO_LEADS = new URL('data/leads.json', RAIZ);
const ARCHIVO_CSV = new URL('data/leads.csv', RAIZ);
const PAGINA = new URL('panel/index.html', RAIZ);

// Mismo orden que el embudo del panel
export const ESTADOS = ['nuevo', 'con_email', 'enviado', 'seguimiento', 'respondio', 'reunion', 'cliente', 'no_interesado', 'descartado'];

async function leerLeads() {
  if (!existsSync(ARCHIVO_LEADS)) return [];
  return JSON.parse(await readFile(ARCHIVO_LEADS, 'utf8'));
}

function responder(res, status, cuerpo, tipo = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': tipo, 'Cache-Control': 'no-store' });
  res.end(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo));
}

async function leerCuerpo(req) {
  let datos = '';
  for await (const parte of req) {
    datos += parte;
    if (datos.length > 1e5) throw new Error('Pedido demasiado grande');
  }
  return JSON.parse(datos || '{}');
}

async function cambiarEstado(req, res) {
  const { linkedin_url, estado, nota } = await leerCuerpo(req);
  if (estado !== undefined && !ESTADOS.includes(estado)) return responder(res, 400, { error: `Estado desconocido: ${estado}` });
  const leads = await leerLeads();
  const lead = leads.find((l) => l.linkedin_url === linkedin_url);
  if (!lead) return responder(res, 404, { error: 'No existe ese lead' });
  if (estado !== undefined && estado !== lead.estado) {
    lead.historial = [...(lead.historial ?? []), { fecha: new Date().toISOString(), tipo: 'estado', de: lead.estado, a: estado }];
    lead.estado = estado;
  }
  if (nota !== undefined) lead.nota = String(nota).slice(0, 2000);
  // Para que la sincronización con el panel online sepa cuál cambio es el más nuevo
  lead.actualizado_panel = new Date().toISOString();
  await writeFile(ARCHIVO_LEADS, JSON.stringify(leads, null, 2));
  await writeFile(ARCHIVO_CSV, aCsv(leads));
  responder(res, 200, lead);
}

const servidor = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && pathname === '/') return responder(res, 200, await readFile(PAGINA, 'utf8'), 'text/html; charset=utf-8');
    // Sin config: la página usa este servidor en vez de Supabase
    if (req.method === 'GET' && pathname === '/config.js') return responder(res, 200, '// modo local', 'text/javascript; charset=utf-8');
    if (req.method === 'GET' && pathname === '/api/leads') {
      return responder(res, 200, { leads: await leerLeads(), estados: ESTADOS, limiteDiario: LIMITE_DIARIO });
    }
    if (req.method === 'POST' && pathname === '/api/leads/estado') return await cambiarEstado(req, res);
    responder(res, 404, { error: 'No encontrado' });
  } catch (e) {
    responder(res, 500, { error: e.message });
  }
});

servidor.listen(PUERTO, '127.0.0.1', () => {
  console.log(`Panel en http://localhost:${PUERTO}`);
});
