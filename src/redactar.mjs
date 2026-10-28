// Arma los mensajes para cada lead que encaja:
// - Con email: borrador del primer email y de los dos seguimientos (los manda enviar.mjs cuando se aprueban).
// - Sin email: un mensaje de WhatsApp o Instagram para que Tobías lo mande a mano desde el panel.
//
//   node src/redactar.mjs              mensajes para los que todavía no tienen
//   node src/redactar.mjs --de-nuevo   rehace los que no están aprobados ni enviados
//
// Reglas (acordadas con Tobías):
// - El gancho dice solo lo que se ve (su web, su ficha de Google Maps) y lo convierte en pregunta.
//   Nunca "no tienen asistente".
// - Email personal -> "Hola Juan,". Email genérico (info@, consultas@) -> "Hola, equipo de X:".
// - Menos de 100 palabras, sin links ni imágenes en el primer email, con línea para darse de baja.
// - La demo se arma recién cuando contestan, así que los mensajes no prometen nada ya hecho.
// - Con web propia se ofrece el agente de IA; sin web, la página web.
// Los borradores de email quedan "pendiente" hasta que alguien los aprueba en el panel.

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
    ? { te: 'te', Te: 'Te', sirve: 'te sirve', llevan: 'llevás', bandeja: 'llenarte la bandeja', Respondé: 'Respondé',
        baja: 'Si no querés que te vuelva a escribir, respondé "no" y no te escribo más.' }
    : { te: 'les', Te: 'Les', sirve: 'les sirve', llevan: 'llevan', bandeja: 'llenarles la bandeja', Respondé: 'Respondan',
        baja: 'Si no quieren que les vuelva a escribir, respondan "no" y no les escribo más.' };
}

// Como lo diría una persona: "Gustavo De Simone Soluciones Inmobiliarias" -> "Gustavo De Simone"
const SUFIJOS_LARGOS = /\s+(negocios inmobiliarios|soluciones inmobiliarias|servicios inmobiliarios|real estate & art)$/i;
// Los nombres de Google Maps traen agregados: "Bestial Gym Caballito Bs. As.", "RED FITNESS CLUB (Sede Morón)",
// "LUPAGYM – Vemos el Mínimo Detalle", "OPEN BOX 24/7: HYROX Official GYM". Se saca la ciudad o barrio del final.
export function nombreCorto(empresa, ubicacion = '') {
  const lugar = ubicacion.replace(/\s+CABA$/i, '').trim();
  let corto = empresa
    .replace(SUFIJOS_LARGOS, '')
    .replace(/\s*\([^)]*\)$/, '')
    .replace(/\s+[–|-]\s+.+$/, '')
    .replace(/\s*:\s.+$/, '')
    .replace(/\s+(bs\.?\s*as\.?|buenos aires|caba)\.?$/i, '')
    .trim();
  if (lugar) corto = corto.replace(new RegExp(`\\s+${lugar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), '').trim();
  return corto || empresa;
}

export function saludo(lead) {
  return lead.email_tipo === 'personal' && lead.nombre ? `Hola ${lead.nombre},` : `Hola, equipo de ${nombreCorto(lead.empresa, lead.ubicacion)}:`;
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

// Lo que cambia según el rubro. La estructura de los emails es la misma para todos.
const RUBROS = {
  inmobiliarias: {
    noche: 'cuando llegan de noche o el fin de semana',
    nocheGeneral: 'las consultas que llegan de noche o el fin de semana, ¿quién las responde?',
    agente: (canal, t) => `En Pucará armamos asistentes de IA para inmobiliarias: ${canal} con la información de cada propiedad, preguntan qué busca la persona (zona, presupuesto, compra o alquiler) y ${t.te} pasan solo a los interesados que vale la pena llamar.`,
    pregunta: (t) => `¿${t.Te} muestro en 15 minutos cómo respondería a una consulta sobre una de sus propiedades?`,
    automatizar: 'en inmobiliarias solemos automatizar lo que se hace a mano: el seguimiento de cada interesado, los recordatorios de visitas y pasar las consultas a una planilla o sistema ordenado, para que no se pierda ninguna.',
  },
  gimnasios: {
    noche: 'cuando alguien pregunta precios u horarios a las 11 de la noche',
    nocheGeneral: 'cuando alguien escribe a la noche para preguntar precios u horarios, ¿quién le responde?',
    agente: (canal, t) => `En Pucará armamos asistentes de IA para gimnasios: ${canal} con precios, horarios y clases, anotan a la persona para una clase de prueba y ${t.te} avisan cuando hay alguien listo para inscribirse.`,
    pregunta: (t) => `¿${t.Te} muestro en 15 minutos cómo respondería a alguien que quiere empezar a entrenar?`,
    automatizar: 'en gimnasios solemos automatizar lo que se hace a mano: los avisos de cuotas vencidas, los recordatorios de clases y el seguimiento de los que vinieron a probar y no se anotaron.',
  },
};
const textosDe = (lead) => RUBROS[lead.rubro] ?? RUBROS.inmobiliarias;

function gancho(lead) {
  const e = nombreCorto(lead.empresa, lead.ubicacion);
  const r = textosDe(lead);
  return {
    whatsapp: {
      asunto: `consultas de WhatsApp en ${e}`,
      gancho: `Vi que en la web de ${e} las consultas van directo a WhatsApp. ¿Quién las responde ${r.noche}?`,
      canal: 'responden al instante',
    },
    formulario: {
      asunto: `consultas en la web de ${e}`,
      gancho: `Vi que en la web de ${e} las consultas entran por formulario. ¿Cómo hacen con las que llegan un domingo a la noche?`,
      canal: 'contestan en el momento, por WhatsApp o en la misma web,',
    },
    general: {
      asunto: `consultas en ${e}`,
      gancho: `Estuve viendo ${e} y me quedé con una pregunta: ${r.nocheGeneral}`,
      canal: 'responden al instante',
    },
  }[variante(lead)];
}

export function redactar(lead) {
  if (lead.web_floja) return redactarWebFloja(lead);
  const g = gancho(lead);
  const r = textosDe(lead);
  const t = trato(lead);
  const cuerpo = [saludo(lead), g.gancho, r.agente(g.canal, t), r.pregunta(t), FIRMA, t.baja].join('\n\n');
  // Cada email muestra otro servicio: el primero los agentes, el día 3 automatización y digitalización,
  // el día 7 todo lo que hace Pucará en una línea. Así cada email sigue teniendo una sola idea.
  const seguimiento1 = [
    saludo(lead),
    `${t.Te} escribo de nuevo con otra idea. Además de responder consultas, ${r.automatizar}`,
    `¿Hoy cómo ${t.llevan} eso? Si ${t.sirve}, en 15 minutos ${t.te} muestro un ejemplo.`,
    FIRMA_COMPLETA,
    t.baja,
  ].join('\n\n');
  const seguimiento2 = [
    saludoSeguimiento(lead),
    `Este es mi último mensaje para no ${t.bandeja}. Si en algún momento ${t.sirve}, en Pucará hacemos asistentes de IA, automatizaciones, sistemas de gestión a medida y páginas web. ${t.Respondé} este email y lo vemos.`,
    FIRMA_COMPLETA,
  ].join('\n\n');
  return { asunto: g.asunto, cuerpo, seguimiento1, seguimiento2, variante: variante(lead), estado: 'pendiente', creado: new Date().toISOString() };
}

// Webs flojas confirmadas mirándolas (lead.web_floja). Con clase: el gancho nunca juzga la web ni el negocio.
// Pregunta por el resultado que les importa (que la web les traiga consultas), no por lo que está mal.
// "como" dice qué se vio: actualizar (diseño viejo u oscuro), vieja (© de hace años),
// suspendida (la dio de baja el hosting), subdominio (armada gratis, sin dominio propio).
export function ganchoWebFloja(lead) {
  const e = nombreCorto(lead.empresa, lead.ubicacion);
  const f = lead.web_floja ?? {};
  const deDonde = lead.rubro === 'gimnasios' ? 'consultas o inscripciones' : 'consultas';
  return {
    // Un aviso útil: es lo único que se dice tal cual, porque les sirve saberlo
    suspendida: `Les escribo porque quise entrar a la web de ${e} y hoy está fuera de línea (aparece un aviso del hosting). Les aviso por si no lo sabían.`,
    subdominio: `Estuve viendo la web de ${e}. ¿Les llegan ${deDonde} desde ahí, o la mayoría viene por Instagram y WhatsApp?`,
  }[f.como] ?? `Estuve viendo la web de ${e} y me quedé con una pregunta: ¿hoy les llegan ${deDonde} desde la web, o la mayoría viene por Instagram y WhatsApp?`;
}

// Cómo se pasa del gancho a la oferta: si la web está caída, se ofrece una mano para volver a tenerla
const puenteWeb = (lead) => (lead.web_floja?.como === 'suspendida' ? 'Si les sirve una mano para tenerla de nuevo online, en Pucará armamos' : 'En Pucará armamos');

const webParaElRubro = (lead) => (lead.rubro === 'gimnasios'
  ? 'páginas web para gimnasios pensadas para que quien los encuentra en Google vea precios, horarios y clases, y reserve una clase de prueba solo'
  : 'páginas web pensadas para que quien los encuentra en Google vea todo lo que ofrecen y consulte solo');

// Email para quien tiene la web floja: el primero ofrece renovarla, el día 3 el agente de IA, el día 7 todo
function redactarWebFloja(lead) {
  const e = nombreCorto(lead.empresa, lead.ubicacion);
  const t = trato(lead);
  const cuerpo = [
    saludo(lead),
    ganchoWebFloja(lead),
    `${puenteWeb(lead)} ${webParaElRubro(lead)}.`,
    `¿${t.Te} muestro en 15 minutos un ejemplo de cómo podría quedar la de ${e}?`,
    FIRMA,
    t.baja,
  ].join('\n\n');
  const seguimiento1 = [
    saludo(lead),
    `${t.Te} escribo de nuevo con otra idea. Además de la web, armamos asistentes de IA que responden al instante por WhatsApp ${lead.rubro === 'gimnasios' ? 'precios y horarios, anotan para una clase de prueba' : 'las consultas, toman los datos de la persona'} y ${t.te} avisan cuando hay alguien listo para ${lead.rubro === 'gimnasios' ? 'inscribirse' : 'comprar'}.`,
    `¿Hoy quién responde esas consultas? Si ${t.sirve}, en 15 minutos ${t.te} muestro un ejemplo.`,
    FIRMA_COMPLETA,
    t.baja,
  ].join('\n\n');
  const seguimiento2 = [
    saludoSeguimiento(lead),
    `Este es mi último mensaje para no ${t.bandeja}. Si en algún momento ${t.sirve}, en Pucará hacemos páginas web, asistentes de IA, automatizaciones y sistemas de gestión a medida. ${t.Respondé} este email y lo vemos.`,
    FIRMA_COMPLETA,
  ].join('\n\n');
  return { asunto: `la web de ${e}`, cuerpo, seguimiento1, seguimiento2, variante: 'web_floja', estado: 'pendiente', creado: new Date().toISOString() };
}

// Número de WhatsApp en formato internacional (5491112345678), o '' si parece un fijo.
// En Argentina los celulares se escriben con 15 después del código de área: "0221 15-436-6542".
export function numeroWhatsapp(telefono) {
  const d = String(telefono ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (/^549\d{10}$/.test(d)) return d;
  if (/^54\d{10}$/.test(d)) return ''; // +54 sin el 9: fijo
  const local = d.replace(/^0/, '');
  for (const largoArea of [2, 3, 4]) {
    if (local.length === 12 && local.slice(largoArea, largoArea + 2) === '15') {
      return `549${local.slice(0, largoArea)}${local.slice(largoArea + 2)}`;
    }
  }
  // "11 2345-6789" sin 15: puede ser celular o fijo; sin el 15 no se puede saber
  return '';
}

// WhatsApp sacado de una web: a veces viene sin el 9 ("543413682675") y así wa.me no abre el chat
export function normalizarWhatsapp(numero) {
  const d = String(numero ?? '').replace(/\D/g, '');
  if (/^549\d{10}$/.test(d)) return d;
  if (/^54\d{10}$/.test(d)) return `549${d.slice(2)}`;
  return d;
}

// Teléfono sin 15 que puede ser celular: en Argentina los fijos empiezan casi siempre con 4 o 5
// ("011 4776-6496", "0341 449-5233"). "011 7623-1725" o "0221 676-4043" probablemente sean celulares.
export function posibleCelular(telefono) {
  const local = String(telefono ?? '').replace(/\D/g, '').replace(/^0/, '');
  if (local.length !== 10) return '';
  for (const largoArea of [2, 3, 4]) {
    const area = local.slice(0, largoArea);
    const abonado = local.slice(largoArea);
    // Códigos de área válidos: 11 (AMBA) o 2xx/3xx 3-4 dígitos del interior
    const areaValida = largoArea === 2 ? area === '11' : /^[23]/.test(area);
    if (areaValida && !/^[45]/.test(abonado)) return `549${area}${abonado}`;
    if (areaValida) return '';
  }
  return '';
}

// Solo se mencionan las reseñas si son un elogio real: buena nota y suficientes opiniones
export const buenasResenas = (lead) => Number(lead.calificacion) >= 4.5 && Number(lead.resenas) >= 30;

// Mensaje corto para mandar a mano por WhatsApp o Instagram. Con web propia: agente. Sin web: página web.
export function redactarManual(lead) {
  const e = nombreCorto(lead.empresa, lead.ubicacion);
  const sinWeb = !lead.web;
  const seguro = normalizarWhatsapp(lead.whatsapp) || numeroWhatsapp(lead.telefono);
  // Instagram va antes que un número dudoso; sin Instagram, se prueba el número
  const dudoso = !seguro && !lead.instagram ? posibleCelular(lead.telefono) : '';
  const numero = seguro || dudoso;
  const canal = numero ? 'whatsapp' : lead.instagram ? 'instagram' : '';
  if (!canal) return null;
  const extra = { numero_dudoso: Boolean(dudoso) };
  const que = lead.rubro === 'gimnasios' ? 'precios y horarios' : 'lo que ofrecen';
  // Sin web: se arranca por algo bueno que se ve en Maps (las reseñas) y se muestra lo que una web hace
  // y Instagram no: que la gente vea todo y reserve sola, sin tener que escribirles.
  const resenas = buenasResenas(lead) ? ` tiene muy buenas reseñas en Google Maps (${String(lead.calificacion).replace('.', ',')} ★ con ${lead.resenas} opiniones) y` : '';
  if (lead.web_floja) {
    const texto = [
      `Hola, ¿cómo están? Soy Tobías, de Pucará Technologies.`,
      ganchoWebFloja(lead),
      `${puenteWeb(lead)} ${webParaElRubro(lead)}. ¿Les muestro un ejemplo de cómo podría quedar la de ${e}?`,
      'Si no les interesa, me avisan y no les escribo más.',
    ].join('\n\n');
    return { canal, numero, instagram: lead.instagram ?? '', oferta: 'renovar_web', texto, ...extra, creado: new Date().toISOString() };
  }
  const texto = sinWeb
    ? [
        `Hola, ¿cómo están? Soy Tobías, de Pucará Technologies.`,
        resenas ? `Vi que ${e}${resenas} que todavía no tiene página web propia.` : `Vi que ${e} está en Google Maps pero todavía no tiene página web propia.`,
        lead.rubro === 'gimnasios'
          ? 'Armamos páginas web para gimnasios donde la gente ve precios, horarios y clases, y reserva una clase de prueba sola, sin tener que escribirles por Instagram o WhatsApp para preguntar. ¿Les interesaría ver un ejemplo?'
          : 'Armamos páginas web para negocios donde la gente ve todo lo que ofrecen y consulta sola, sin tener que escribirles para preguntar. ¿Les interesaría ver un ejemplo?',
        'Si no les interesa, me avisan y no les escribo más.',
      ].join('\n\n')
    : [
        `Hola, ¿cómo están? Soy Tobías, de Pucará Technologies.`,
        `Estuve viendo la web de ${e}. Cuando alguien les escribe a la noche para preguntar ${que}, ¿quién le responde?`,
        `Armamos asistentes de IA que responden al instante por WhatsApp, ${lead.rubro === 'gimnasios' ? 'anotan para una clase de prueba' : 'toman los datos de la persona'} y les avisan cuando hay alguien listo para ${lead.rubro === 'gimnasios' ? 'inscribirse' : 'comprar'}. ¿Les muestro cómo funcionaría con ${e}?`,
        'Si no les interesa, me avisan y no les escribo más.',
      ].join('\n\n');
  return { canal, numero, instagram: lead.instagram ?? '', oferta: sinWeb ? 'web' : 'agente', texto, ...extra, creado: new Date().toISOString() };
}

export const palabras = (texto) => texto.split(/\s+/).filter(Boolean).length;

async function main() {
  const deNuevo = process.argv.includes('--de-nuevo');
  const leads = JSON.parse(await readFile(ARCHIVO_LEADS, 'utf8'));
  let emails = 0;
  let manuales = 0;
  for (const lead of leads) {
    if (lead.encaja !== 'si') continue;
    const yaContactado = (lead.historial ?? []).some((h) => h.tipo === 'envio');
    if (yaContactado) continue;
    if (lead.email) {
      if (lead.borrador && !(deNuevo && lead.borrador.estado === 'pendiente')) continue;
      lead.borrador = redactar(lead);
      emails++;
    } else {
      if (lead.mensaje_manual && !deNuevo) continue;
      const m = redactarManual(lead);
      if (!m) continue;
      lead.mensaje_manual = m;
      manuales++;
    }
    lead.actualizado_panel = new Date().toISOString();
  }
  await writeFile(ARCHIVO_LEADS, JSON.stringify(leads, null, 2));
  await writeFile(ARCHIVO_CSV, aCsv(leads));
  console.log(`${emails} borradores de email (se aprueban en el panel) y ${manuales} mensajes para mandar a mano.`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e) => {
    console.error('Error:', e.message);
    process.exit(1);
  });
}
