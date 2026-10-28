// Busca negocios en Google Maps (Serper /places) y los guarda como leads.
// Sirve para rubros donde los dueños casi no están en LinkedIn: gimnasios, restaurantes.
//
//   node --env-file=.env src/buscar-maps.mjs --rubro gimnasios --max-busquedas 20
//   node src/buscar-maps.mjs --rubro gimnasios --prueba      (lista las consultas sin gastar créditos)
//
// Cada lead de Maps usa el link del lugar en Google Maps como identificador (campo linkedin_url,
// el mismo que usan los de LinkedIn) y tiene fuente "maps". No trae nombre del dueño.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { aCsv } from './buscar.mjs';

const RAIZ = new URL('..', import.meta.url);
const DATA = new URL('data/', RAIZ);
const ARCHIVO_LEADS = new URL('leads.json', DATA);
const ARCHIVO_CSV = new URL('leads.csv', DATA);
const ARCHIVO_CRUDOS = new URL('maps.json', DATA);

const leerJson = async (url, porDefecto) => (existsSync(url) ? JSON.parse(await readFile(url, 'utf8')) : porDefecto);
const sinTildes = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function esCadena(nombre, excluir) {
  const n = sinTildes(nombre);
  return excluir.some((marca) => n.includes(sinTildes(marca)));
}

const esRedSocial = (url) => /instagram\.com|facebook\.com|fb\.com|linktr\.ee|tiktok\.com|wa\.me|whatsapp\.com/i.test(url ?? '');

export function lugarALead(lugar, { rubro, ciudad, consulta, hoy }) {
  if (!lugar.cid || !lugar.title) return null;
  const web = lugar.website && !esRedSocial(lugar.website) ? new URL(lugar.website).origin : '';
  const instagram = /instagram\.com/i.test(lugar.website ?? '') ? lugar.website.split('?')[0] : '';
  return {
    linkedin_url: `https://maps.google.com/?cid=${lugar.cid}`,
    fuente: 'maps',
    nombre: '',
    apellido: '',
    cargo: '',
    empresa: lugar.title.trim(),
    categoria: lugar.category ?? '',
    direccion: lugar.address ?? '',
    ubicacion: ciudad,
    telefono: lugar.phoneNumber ?? '',
    web,
    instagram,
    calificacion: lugar.rating ?? null,
    resenas: lugar.ratingCount ?? 0,
    rubro,
    estado: 'nuevo',
    encontrado: hoy,
    consulta,
  };
}

async function buscarLugares(q, pagina, apiKey) {
  const res = await fetch('https://google.serper.dev/places', {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, gl: 'ar', hl: 'es', page: pagina }),
  });
  if (res.status === 401 || res.status === 403) throw new Error('Clave de Serper inválida o sin créditos.');
  if (!res.ok) throw new Error(`Serper respondió ${res.status}: ${await res.text()}`);
  return (await res.json()).places ?? [];
}

function leerArgs(argv) {
  const args = { rubro: null, maxBusquedas: 20, maxPaginas: 2, prueba: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--rubro') args.rubro = argv[++i];
    else if (argv[i] === '--max-busquedas') args.maxBusquedas = Number(argv[++i]);
    else if (argv[i] === '--max-paginas') args.maxPaginas = Number(argv[++i]);
    else if (argv[i] === '--prueba') args.prueba = true;
    else throw new Error(`Opción desconocida: ${argv[i]}`);
  }
  if (!args.rubro) throw new Error('Falta --rubro (por ejemplo: --rubro gimnasios)');
  return args;
}

async function main() {
  const args = leerArgs(process.argv.slice(2));
  const config = (await leerJson(new URL('config/busquedas.json', RAIZ), {})).maps;
  const rubro = config?.rubros?.[args.rubro];
  if (!rubro) throw new Error(`No hay búsqueda de Maps para el rubro ${args.rubro} en config/busquedas.json`);
  const consultas = rubro.palabras.flatMap((p) => config.ciudades.map((ciudad) => ({ q: `${p} ${ciudad}`, ciudad })));

  if (args.prueba) {
    console.log(`${consultas.length} consultas (hasta ${consultas.length * args.maxPaginas} búsquedas):`);
    for (const { q } of consultas) console.log('  ' + q);
    return;
  }
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) throw new Error('Falta SERPER_API_KEY en el archivo .env');

  await mkdir(DATA, { recursive: true });
  const leads = await leerJson(ARCHIVO_LEADS, []);
  const crudos = await leerJson(ARCHIVO_CRUDOS, {});
  const vistos = new Set(leads.map((l) => l.linkedin_url));
  const hoy = new Date().toISOString().slice(0, 10);
  let usadas = 0, nuevos = 0, cadenas = 0;

  try {
    fuera: for (const { q, ciudad } of consultas) {
      for (let pagina = 1; pagina <= args.maxPaginas; pagina++) {
        const clave = `${q} #${pagina}`;
        if (crudos[clave]) {
          if (crudos[clave].lugares.length < 10) break;
          continue;
        }
        if (usadas >= args.maxBusquedas) break fuera;
        const lugares = await buscarLugares(q, pagina, apiKey);
        usadas++;
        crudos[clave] = { rubro: args.rubro, ciudad, fecha: hoy, lugares };
        let enPagina = 0;
        for (const lugar of lugares) {
          if (esCadena(lugar.title ?? '', config.excluir ?? [])) { cadenas++; continue; }
          const lead = lugarALead(lugar, { rubro: args.rubro, ciudad, consulta: q, hoy });
          if (!lead || vistos.has(lead.linkedin_url)) continue;
          vistos.add(lead.linkedin_url);
          leads.push(lead);
          enPagina++;
        }
        nuevos += enPagina;
        console.log(`[${usadas}/${args.maxBusquedas}] ${q} p${pagina}: ${lugares.length} lugares, ${enPagina} nuevos`);
        if (lugares.length < 10) break;
      }
    }
  } finally {
    await writeFile(ARCHIVO_LEADS, JSON.stringify(leads, null, 2));
    await writeFile(ARCHIVO_CRUDOS, JSON.stringify(crudos, null, 2));
    await writeFile(ARCHIVO_CSV, aCsv(leads));
  }
  console.log(`\nListo: ${nuevos} lugares nuevos (${cadenas} cadenas descartadas). Búsquedas usadas: ${usadas}.`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e) => {
    console.error('Error:', e.message);
    process.exit(1);
  });
}
