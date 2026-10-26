// Sincroniza los leads locales con Supabase, para el panel online.
//
//   npm run sincronizar
//
// 1. Trae lo que se cambió desde el panel online (estado, nota, historial) y lo aplica acá.
// 2. Sube todos los leads locales.
// Usa la clave service_role del .env: nunca va al navegador ni al repo.

import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { aCsv } from './buscar.mjs';

const DATA = new URL('../data/', import.meta.url);
const ARCHIVO_LEADS = new URL('leads.json', DATA);
const ARCHIVO_CSV = new URL('leads.csv', DATA);

// Lo que el panel puede cambiar: se guarda en columnas propias, no dentro de "datos"
const CAMPOS_PANEL = ['estado', 'nota', 'historial', 'borrador', 'actualizado_panel'];

function cliente() {
  const url = process.env.SUPABASE_URL;
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !clave) throw new Error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el archivo .env');
  return async (ruta, opciones = {}) => {
    const res = await fetch(`${url}/rest/v1/${ruta}`, {
      ...opciones,
      headers: { apikey: clave, Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json', ...opciones.headers },
    });
    if (!res.ok) throw new Error(`Supabase respondió ${res.status}: ${await res.text()}`);
    // Con return=minimal Supabase responde 201 sin cuerpo
    const texto = await res.text();
    return texto ? JSON.parse(texto) : null;
  };
}

// Aplica a los leads locales los cambios hechos en el panel después del último cambio local
export function aplicarCambiosDelPanel(leads, remotos) {
  const porUrl = new Map(remotos.map((r) => [r.linkedin_url, r]));
  let aplicados = 0;
  for (const lead of leads) {
    const r = porUrl.get(lead.linkedin_url);
    if (!r?.actualizado_panel) continue;
    if (lead.actualizado_panel && new Date(lead.actualizado_panel) >= new Date(r.actualizado_panel)) continue;
    Object.assign(lead, { estado: r.estado, nota: r.nota, historial: r.historial, borrador: r.borrador ?? lead.borrador, actualizado_panel: r.actualizado_panel });
    aplicados++;
  }
  return aplicados;
}

export function aFila(lead) {
  const datos = Object.fromEntries(Object.entries(lead).filter(([k]) => !CAMPOS_PANEL.includes(k)));
  return {
    linkedin_url: lead.linkedin_url,
    datos,
    estado: lead.estado ?? 'nuevo',
    nota: lead.nota ?? '',
    historial: lead.historial ?? [],
    borrador: lead.borrador ?? null,
    actualizado_panel: lead.actualizado_panel ?? null,
    actualizado: new Date().toISOString(),
  };
}

// Trae los cambios del panel online y sube los leads. La usan también otros scripts (enviar).
export async function sincronizar() {
  const supabase = cliente();
  const leads = JSON.parse(await readFile(ARCHIVO_LEADS, 'utf8'));

  const remotos = [];
  for (let desde = 0; ; desde += 1000) {
    const pagina = await supabase(`leads?select=linkedin_url,estado,nota,historial,borrador,actualizado_panel`, {
      headers: { Range: `${desde}-${desde + 999}` },
    });
    remotos.push(...pagina);
    if (pagina.length < 1000) break;
  }
  const aplicados = aplicarCambiosDelPanel(leads, remotos);
  if (aplicados) {
    await writeFile(ARCHIVO_LEADS, JSON.stringify(leads, null, 2));
    await writeFile(ARCHIVO_CSV, aCsv(leads));
  }

  for (let i = 0; i < leads.length; i += 500) {
    await supabase('leads?on_conflict=linkedin_url', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(leads.slice(i, i + 500).map(aFila)),
    });
  }
  return { aplicados, subidos: leads.length };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  sincronizar().then(({ aplicados, subidos }) => console.log(`Listo: ${aplicados} cambios traídos del panel, ${subidos} leads subidos.`)).catch((e) => {
    console.error('Error:', e.message);
    process.exit(1);
  });
}
