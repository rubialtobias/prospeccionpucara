// Busca dueños de negocios en LinkedIn a través de Google (API de Serper)
// y guarda los leads en data/leads.json y data/leads.csv.
//
// Uso:
//   npm run buscar -- --rubro inmobiliarias --max-busquedas 20
//   npm run buscar:prueba -- --rubro inmobiliarias     (muestra las consultas sin gastar créditos)
//
// Opciones:
//   --rubro <nombre>        rubro de config/busquedas.json (por defecto, todos por prioridad)
//   --max-busquedas <n>     tope de llamadas a Serper en esta corrida (por defecto 30)
//   --max-paginas <n>       páginas de Google por consulta (por defecto 3)
//   --dry-run               no llama a la API, solo lista las consultas
//   --reprocesar            rearma los leads desde los resultados ya guardados, sin gastar búsquedas

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resultadoALead } from './parse.mjs';

const RAIZ = new URL('..', import.meta.url);
const DATA = new URL('data/', RAIZ);
const ARCHIVO_LEADS = new URL('leads.json', DATA);
const ARCHIVO_CSV = new URL('leads.csv', DATA);
const ARCHIVO_CONSULTAS = new URL('consultas.json', DATA);
// Respuestas completas de Serper, para poder mejorar el parser y reprocesar sin volver a pagar
const ARCHIVO_CRUDOS = new URL('resultados.json', DATA);

function leerArgs(argv) {
  const args = { maxBusquedas: 30, maxPaginas: 3, dryRun: false, reprocesar: false, rubro: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--reprocesar') args.reprocesar = true;
    else if (a === '--rubro') args.rubro = argv[++i];
    else if (a === '--max-busquedas') args.maxBusquedas = Number(argv[++i]);
    else if (a === '--max-paginas') args.maxPaginas = Number(argv[++i]);
    else throw new Error(`Opción desconocida: ${a}`);
  }
  return args;
}

async function leerJson(url, porDefecto) {
  if (!existsSync(url)) return porDefecto;
  return JSON.parse(await readFile(url, 'utf8'));
}

function comillas(texto) {
  return texto.includes(' ') ? `"${texto}"` : texto;
}

export function armarConsultas(config, rubro) {
  const cargos = `(${config.cargos.map(comillas).join(' OR ')})`;
  const consultas = [];
  for (const palabra of config.rubros[rubro].palabras) {
    for (const ciudad of config.ciudades) {
      const partes = [config.sitio, cargos, comillas(palabra)];
      if (ciudad) partes.push(comillas(ciudad));
      for (const marca of config.excluir ?? []) partes.push(`-${comillas(marca)}`);
      consultas.push(partes.join(' '));
    }
  }
  return consultas;
}

export async function buscarEnSerper(q, pagina, apiKey) {
  for (let intento = 1; intento <= 3; intento++) {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, gl: 'ar', hl: 'es', num: 10, page: pagina }),
    });
    if (res.ok) return (await res.json()).organic ?? [];
    if (res.status === 401 || res.status === 403) throw new Error('Clave de Serper inválida o sin créditos.');
    if (intento === 3) throw new Error(`Serper respondió ${res.status}: ${await res.text()}`);
    await new Promise((r) => setTimeout(r, 2000 * intento));
  }
}

const COLUMNAS = ['nombre', 'apellido', 'cargo', 'empresa', 'email', 'email_tipo', 'web', 'whatsapp', 'ubicacion', 'rubro', 'encaja', 'motivo', 'linkedin_url', 'estado', 'nota', 'revisar', 'encontrado', 'titulo', 'snippet', 'consulta'];

// Agrega un resultado a la lista si es un perfil nuevo. Devuelve true si lo agregó.
function sumarLead(leads, vistos, resultado, contexto, encontrado) {
  const lead = resultadoALead(resultado, contexto);
  if (!lead || vistos.has(lead.linkedin_url)) return false;
  vistos.add(lead.linkedin_url);
  leads.push({ ...lead, estado: 'nuevo', encontrado });
  return true;
}

async function guardar(leads, hechas, crudos) {
  await writeFile(ARCHIVO_LEADS, JSON.stringify(leads, null, 2));
  await writeFile(ARCHIVO_CONSULTAS, JSON.stringify(hechas, null, 2));
  await writeFile(ARCHIVO_CRUDOS, JSON.stringify(crudos, null, 2));
  await writeFile(ARCHIVO_CSV, aCsv(leads));
}

// Rearma los leads con el parser actual, conservando el estado y la fecha de cada uno
async function reprocesar() {
  const crudos = await leerJson(ARCHIVO_CRUDOS, {});
  const hechas = await leerJson(ARCHIVO_CONSULTAS, {});
  const anteriores = new Map((await leerJson(ARCHIVO_LEADS, [])).map((l) => [l.linkedin_url, l]));
  const leads = [];
  const vistos = new Set();
  for (const { rubro, consulta, fecha, resultados } of Object.values(crudos)) {
    for (const r of resultados) sumarLead(leads, vistos, r, { rubro, consulta }, fecha);
  }
  for (const l of leads) {
    const previo = anteriores.get(l.linkedin_url);
    // Un lead ya calificado conserva las correcciones de nombre, empresa y lo que se le agregó después
    if (previo) Object.assign(l, previo.encaja ? previo : { estado: previo.estado, encontrado: previo.encontrado });
  }
  await guardar(leads, hechas, crudos);
  console.log(`Reprocesados ${leads.length} leads desde ${Object.keys(crudos).length} búsquedas guardadas.`);
}

export function aCsv(leads) {
  const celda = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const filas = leads.map((l) => COLUMNAS.map((c) => celda(l[c])).join(','));
  // BOM para que Excel y Sheets lean bien las tildes
  return '﻿' + [COLUMNAS.join(','), ...filas].join('\n');
}

async function main() {
  const args = leerArgs(process.argv.slice(2));
  if (args.reprocesar) return reprocesar();
  const config = await leerJson(new URL('config/busquedas.json', RAIZ));
  const rubros = args.rubro
    ? [args.rubro]
    : Object.keys(config.rubros).sort((a, b) => config.rubros[a].prioridad - config.rubros[b].prioridad);
  for (const r of rubros) if (!config.rubros[r]) throw new Error(`Rubro desconocido: ${r}`);

  if (args.dryRun) {
    for (const r of rubros) {
      const consultas = armarConsultas(config, r);
      console.log(`\n${r}: ${consultas.length} consultas (hasta ${consultas.length * args.maxPaginas} búsquedas)`);
      for (const q of consultas) console.log('  ' + q);
    }
    return;
  }

  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) throw new Error('Falta SERPER_API_KEY en el archivo .env');

  await mkdir(DATA, { recursive: true });
  const leads = await leerJson(ARCHIVO_LEADS, []);
  const hechas = await leerJson(ARCHIVO_CONSULTAS, {});
  const crudos = await leerJson(ARCHIVO_CRUDOS, {});
  const vistos = new Set(leads.map((l) => l.linkedin_url));
  const hoy = new Date().toISOString().slice(0, 10);
  let usadas = 0;
  let nuevos = 0;

  // Se guarda aunque la corrida falle a mitad, para no perder búsquedas ya pagadas
  try {
  fuera: for (const rubro of rubros) {
    for (const q of armarConsultas(config, rubro)) {
      for (let pagina = 1; pagina <= args.maxPaginas; pagina++) {
        const clave = `${q} #${pagina}`;
        if (clave in hechas) {
          if (hechas[clave] < 10) break; // esa consulta ya no tenía más páginas
          continue;
        }
        if (usadas >= args.maxBusquedas) break fuera;

        const resultados = await buscarEnSerper(q, pagina, apiKey);
        usadas++;
        hechas[clave] = resultados.length;
        crudos[clave] = { rubro, consulta: q, fecha: hoy, resultados };

        let nuevosEnPagina = 0;
        for (const r of resultados) {
          if (sumarLead(leads, vistos, r, { rubro, consulta: q }, hoy)) nuevosEnPagina++;
        }
        nuevos += nuevosEnPagina;
        console.log(`[${usadas}/${args.maxBusquedas}] ${rubro} p${pagina}: ${resultados.length} resultados, ${nuevosEnPagina} nuevos`);
        if (resultados.length < 10) break;
      }
    }
  }
  } finally {
    await guardar(leads, hechas, crudos);
  }
  console.log(`\nListo: ${nuevos} leads nuevos, ${leads.length} en total. Búsquedas usadas: ${usadas}.`);
  console.log('Archivos: data/leads.csv y data/leads.json');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e) => {
    console.error('Error:', e.message);
    process.exit(1);
  });
}
