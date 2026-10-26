// Para cada lead que encaja: busca la web de su empresa, saca el email y el WhatsApp publicados,
// revisa la web (celular, WhatsApp, formulario) y comprueba que el dominio del email reciba correo.
//
// Uso:
//   npm run enriquecer -- --max 3        prueba con 3 leads
//   npm run enriquecer                   todos los que encajan y todavía no se buscaron
//   npm run enriquecer -- --de-nuevo     vuelve a revisar las webs (sin gastar búsquedas si ya se hicieron)
//
// Cada lead gasta 1 búsqueda de Serper (la de la web). Leer la web es gratis.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolveMx } from 'node:dns/promises';
import { buscarEnSerper, aCsv } from './buscar.mjs';
import { elegirWeb, extraerEmails, extraerWhatsapp, enlacesDeContacto, revisarWeb, elegirEmail, dominio, palabrasClave } from './web.mjs';

const DATA = new URL('../data/', import.meta.url);
const ARCHIVO_LEADS = new URL('leads.json', DATA);
const ARCHIVO_CSV = new URL('leads.csv', DATA);
const ARCHIVO_WEBS = new URL('webs.json', DATA);

const NAVEGADOR = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

function leerArgs(argv) {
  const args = { max: Infinity, deNuevo: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--max') args.max = Number(argv[++i]);
    else if (argv[i] === '--de-nuevo') args.deNuevo = true;
    else throw new Error(`Opción desconocida: ${argv[i]}`);
  }
  return args;
}

async function bajar(url) {
  const inicio = Date.now();
  const res = await fetch(url, {
    headers: { 'User-Agent': NAVEGADOR, 'Accept-Language': 'es-AR,es;q=0.9' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = (await res.text()).slice(0, 2_000_000);
  return { html, urlFinal: res.url, ms: Date.now() - inicio };
}

async function recibeCorreo(email) {
  try {
    return (await resolveMx(email.split('@')[1])).length > 0;
  } catch {
    return false;
  }
}

// Reusa la búsqueda guardada si ya se hizo, así mejorar el criterio no gasta créditos
async function buscarWeb(lead, apiKey, guardada) {
  const empresa = lead.empresa.split(' / ')[0];
  let { consulta: q, resultados } = guardada ?? {};
  if (!resultados) {
    const lugar = lead.ubicacion && lead.ubicacion !== 'Argentina' ? lead.ubicacion.replace(/ y alrededores$/, '') : 'Argentina';
    q = `"${empresa}" ${lugar}`;
    resultados = (await buscarEnSerper(q, 1, apiKey)).map(({ title, link }) => ({ title, link }));
  }
  return { q, resultados, web: elegirWeb(resultados, empresa) };
}

async function enriquecer(lead, apiKey, guardada) {
  const { q, resultados, web } = await buscarWeb(lead, apiKey, guardada);
  const registro = { consulta: q, resultados, web };
  if (!web) return { registro, cambios: { web: '', web_revisada: { error: 'No se encontró web propia' } } };

  let principal;
  try {
    principal = await bajar(web);
  } catch (e) {
    return { registro, cambios: { web, web_revisada: { error: `No se pudo abrir: ${e.message}` } } };
  }
  // Dominios vencidos suelen redirigir a la página del hosting
  if (dominio(principal.urlFinal) !== dominio(web) && !palabrasClave(lead.empresa).some((c) => dominio(principal.urlFinal).includes(c))) {
    return { registro, cambios: { web, web_revisada: { error: `Redirige a otro sitio (${dominio(principal.urlFinal)})` } } };
  }
  const paginas = [principal.html];
  for (const url of enlacesDeContacto(principal.html, principal.urlFinal)) {
    try {
      paginas.push((await bajar(url)).html);
    } catch { /* una página de contacto caída no frena el resto */ }
  }
  const todo = paginas.join('\n');
  const emails = extraerEmails(todo);
  const elegido = elegirEmail(emails, { web: principal.urlFinal, nombre: lead.nombre, apellido: lead.apellido, empresa: lead.empresa });
  const cambios = {
    web: new URL(principal.urlFinal).origin,
    whatsapp: extraerWhatsapp(todo),
    emails_encontrados: emails,
    web_revisada: revisarWeb(principal.html, principal.urlFinal, principal.ms),
  };
  if (elegido && (await recibeCorreo(elegido.email))) {
    Object.assign(cambios, { email: elegido.email, email_tipo: elegido.tipo });
  }
  return { registro, cambios };
}

async function main() {
  const args = leerArgs(process.argv.slice(2));
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) throw new Error('Falta SERPER_API_KEY en el archivo .env');

  const leads = JSON.parse(await readFile(ARCHIVO_LEADS, 'utf8'));
  const webs = existsSync(ARCHIVO_WEBS) ? JSON.parse(await readFile(ARCHIVO_WEBS, 'utf8')) : {};
  // --de-nuevo vuelve a leer las webs ya revisadas; usa las búsquedas guardadas, así que no gasta créditos
  const pendientes = leads.filter((l) => l.encaja === 'si' && l.empresa && (args.deNuevo || !l.web_revisada)).slice(0, args.max);
  console.log(`${pendientes.length} leads para enriquecer\n`);

  let conEmail = 0;
  for (const [i, lead] of pendientes.entries()) {
    const etiqueta = `[${i + 1}/${pendientes.length}] ${lead.nombre} ${lead.apellido} (${lead.empresa})`;
    try {
      const { registro, cambios } = await enriquecer(lead, apiKey, webs[lead.linkedin_url]);
      webs[lead.linkedin_url] = registro;
      // Al revisar de nuevo, lo que ya no se encuentra se borra en vez de quedar el dato viejo
      for (const campo of ['email', 'email_tipo', 'whatsapp', 'emails_encontrados']) delete lead[campo];
      Object.assign(lead, cambios, { enriquecido: new Date().toISOString().slice(0, 10) });
      if (!lead.email && lead.estado === 'con_email') lead.estado = 'nuevo';
      if (lead.email && lead.estado === 'nuevo') {
        lead.estado = 'con_email';
        conEmail++;
      }
      const detalle = cambios.web_revisada?.error ?? `${dominio(lead.web)} · ${lead.email || 'sin email'}${lead.whatsapp ? ' · WhatsApp' : ''}`;
      console.log(`${etiqueta}: ${detalle}`);
    } catch (e) {
      console.log(`${etiqueta}: error ${e.message}`);
      if (/Serper/.test(e.message)) break;
    }
    // Se guarda después de cada lead para no perder búsquedas si algo falla
    await writeFile(ARCHIVO_LEADS, JSON.stringify(leads, null, 2));
    await writeFile(ARCHIVO_WEBS, JSON.stringify(webs, null, 2));
    await writeFile(ARCHIVO_CSV, aCsv(leads));
  }
  console.log(`\nListo: ${conEmail} leads nuevos con email.`);
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
