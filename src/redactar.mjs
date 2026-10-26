// Arma el borrador del primer email y de los dos seguimientos para cada lead que encaja y tiene email.
//
//   node src/redactar.mjs              borradores para los que todavía no tienen
//   node src/redactar.mjs --de-nuevo   rehace los que no están aprobados ni enviados
//
// Reglas (acordadas con Tobías):
// - El gancho dice solo lo que se ve en su web y lo convierte en pregunta. Nunca "no tienen asistente".
// - Email personal -> "Hola Juan,". Email genérico (info@, consultas@) -> "Hola, equipo de X:".
// - Menos de 100 palabras, sin links ni imágenes, con línea para darse de baja.
// - La demo se arma recién cuando contestan, así que los emails no prometen nada ya hecho.
// Los borradores quedan "pendiente" hasta que alguien los aprueba en el panel.

import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { aCsv } from './buscar.mjs';

const ARCHIVO_LEADS = new URL('../data/leads.json', import.meta.url);
const ARCHIVO_CSV = new URL('../data/leads.csv', import.meta.url);

// Firma: en el primer email sin web ni teléfono (los links en el primer contacto suben el riesgo de spam).
// En los seguimientos, con la web y el WhatsApp. El formato (negrita, gris, links) lo agrega enviar.mjs.
export const FIRMA = 'Tobías Rubial\nPucará Technologies · Automatización e IA para negocios';
export const FIRMA_COMPLETA = `${FIRMA}\npucaratechnologies.com · WhatsApp +54 9 11 5486-6935`;
// Email personal: le hablamos a una persona. Genérico: al equipo, en plural.
function trato(lead) {
  const uno = lead.email_tipo === 'personal' && Boolean(lead.nombre);
  return uno
    ? { te: 'te', Te: 'Te', interesa: 'te interesa', veas: 'lo veas', querés: 'querés', bandeja: 'llenarte la bandeja', respondé: 'respondé',
        baja: 'Si no querés que te vuelva a escribir, respondé "no" y no te escribo más.' }
    : { te: 'les', Te: 'Les', interesa: 'les interesa', veas: 'lo vean', querés: 'quieren', bandeja: 'llenarles la bandeja', respondé: 'respondan',
        baja: 'Si no quieren que les vuelva a escribir, respondan "no" y no les escribo más.' };
}

// Como lo diría una persona: "Gustavo De Simone Soluciones Inmobiliarias" -> "Gustavo De Simone"
const SUFIJOS_LARGOS = /\s+(negocios inmobiliarios|soluciones inmobiliarias|servicios inmobiliarios|real estate & art)$/i;
export function nombreCorto(empresa) {
  const corto = empresa.replace(SUFIJOS_LARGOS, '').trim();
  return corto || empresa;
}

export function saludo(lead) {
  return lead.email_tipo === 'personal' && lead.nombre ? `Hola ${lead.nombre},` : `Hola, equipo de ${nombreCorto(lead.empresa)}:`;
}

function saludoSeguimiento(lead) {
  return lead.email_tipo === 'personal' && lead.nombre ? `Hola ${lead.nombre},` : 'Hola de nuevo,';
}

// Qué vimos en la web, para elegir el gancho
export function variante(lead) {
  const w = lead.web_revisada ?? {};
  if (w.boton_whatsapp || lead.whatsapp) return 'whatsapp';
  if (w.formulario) return 'formulario';
  return 'general';
}

const GANCHOS = {
  whatsapp: (e) => ({
    asunto: `consultas de WhatsApp en ${e}`,
    gancho: `Vi que en la web de ${e} las consultas van directo a WhatsApp. ¿Quién las responde cuando llegan de noche o el fin de semana?`,
    canal: 'responden al instante',
  }),
  formulario: (e) => ({
    asunto: `consultas en la web de ${e}`,
    gancho: `Vi que en la web de ${e} las consultas entran por formulario. Si alguien lo completa un domingo a la noche, ¿cuándo recibe la primera respuesta?`,
    canal: 'contestan en el momento, por WhatsApp o en la misma web,',
  }),
  general: (e) => ({
    asunto: `consultas en ${e}`,
    gancho: `Estuve viendo ${e} y me quedé con una pregunta: las consultas que llegan de noche o el fin de semana, ¿quién las responde?`,
    canal: 'responden al instante',
  }),
};

export function redactar(lead) {
  const g = GANCHOS[variante(lead)](nombreCorto(lead.empresa));
  const t = trato(lead);
  const cuerpo = [
    saludo(lead),
    g.gancho,
    `En Pucará armamos asistentes de IA para inmobiliarias: ${g.canal} con la información de cada propiedad, preguntan qué busca la persona (zona, presupuesto, compra o alquiler) y ${t.te} pasan solo a los interesados que vale la pena llamar.`,
    `¿${t.Te} muestro en 15 minutos cómo respondería a una consulta sobre una de sus propiedades?`,
    FIRMA,
    t.baja,
  ].join('\n\n');
  const seguimiento1 = [
    saludoSeguimiento(lead),
    `${t.Te} escribo de nuevo por si el email anterior quedó tapado. Si ${t.interesa}, con 15 minutos alcanza para que ${t.veas} funcionando con una de sus propiedades.`,
    FIRMA_COMPLETA,
    t.baja,
  ].join('\n\n');
  const seguimiento2 = [
    saludoSeguimiento(lead),
    `Este es mi último mensaje para no ${t.bandeja}. Si en algún momento ${t.querés} ver cómo funciona, ${t.respondé} este email y lo coordinamos.`,
    FIRMA_COMPLETA,
  ].join('\n\n');
  return { asunto: g.asunto, cuerpo, seguimiento1, seguimiento2, variante: variante(lead), estado: 'pendiente', creado: new Date().toISOString() };
}

export const palabras = (texto) => texto.split(/\s+/).filter(Boolean).length;

async function main() {
  const deNuevo = process.argv.includes('--de-nuevo');
  const leads = JSON.parse(await readFile(ARCHIVO_LEADS, 'utf8'));
  let hechos = 0;
  for (const lead of leads) {
    if (lead.encaja !== 'si' || !lead.email) continue;
    const yaEnviado = (lead.historial ?? []).some((h) => h.tipo === 'envio');
    if (yaEnviado) continue;
    if (lead.borrador && !(deNuevo && lead.borrador.estado === 'pendiente')) continue;
    lead.borrador = redactar(lead);
    lead.actualizado_panel = new Date().toISOString();
    hechos++;
  }
  await writeFile(ARCHIVO_LEADS, JSON.stringify(leads, null, 2));
  await writeFile(ARCHIVO_CSV, aCsv(leads));
  console.log(`${hechos} borradores nuevos. Se aprueban desde el panel.`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e) => {
    console.error('Error:', e.message);
    process.exit(1);
  });
}
