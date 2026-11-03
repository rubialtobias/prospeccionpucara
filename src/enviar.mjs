// Envío diario de emails por Gmail, con rampa de volumen, seguimientos y detección de respuestas.
//
//   node --env-file=.env src/enviar.mjs --prueba     muestra qué mandaría hoy, sin mandar nada
//   node --env-file=.env src/enviar.mjs --muestra    se manda a sí mismo el primer email aprobado, para verlo en Gmail
//   node --env-file=.env src/enviar.mjs              revisa respuestas y manda lo que toca hoy
//
// Cada corrida:
// 1. Trae del panel online lo aprobado o cambiado (si Supabase está configurado).
// 2. Revisa la bandeja: quien respondió pasa a "Respondió" y no recibe más seguimientos; los rebotes se descartan.
// 3. Manda primero los seguimientos que vencieron y después emails nuevos aprobados, hasta el límite del día.
// 4. Sube todo al panel online.
// Solo manda emails con borrador "aprobado" a leads que encajan. Nunca reenvía el mismo paso.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { aCsv } from './buscar.mjs';
import { sincronizar } from './sincronizar.mjs';
import { verificarEmail } from './verificar.mjs';
import { redactarManual } from './redactar.mjs';

const RAIZ = new URL('..', import.meta.url);
const ARCHIVO_LEADS = new URL('data/leads.json', RAIZ);
const ARCHIVO_CSV = new URL('data/leads.csv', RAIZ);
const ARCHIVO_ESTADO = new URL('data/envios-estado.json', RAIZ);
const ARCHIVO_CONFIG = new URL('config/envios.json', RAIZ);

// Estados en los que ya no se le escribe más
const CERRADOS = ['respondio', 'reunion', 'cliente', 'no_interesado', 'descartado'];

const DIA_MS = 24 * 60 * 60 * 1000;
const fechaLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const diasEntre = (desde, hasta) => Math.floor((new Date(fechaLocal(hasta)) - new Date(fechaLocal(desde))) / DIA_MS);

// Solo los emails: lo mandado a mano por WhatsApp o Instagram no cuenta para el límite de Gmail
export const enviosDe = (lead) => (lead.historial ?? []).filter((h) => h.tipo === 'envio' && (h.canal ?? 'email') === 'email');

// Cuántos emails se pueden mandar hoy según la rampa. inicio = fecha del primer envío real (o null).
export function limiteDelDia(config, inicio, hoy) {
  const dia = inicio ? diasEntre(new Date(inicio), hoy) + 1 : 1;
  const paso = config.rampa.filter((r) => r.desde_dia <= dia).at(-1) ?? config.rampa[0];
  return Math.min(paso.por_dia, config.maximo);
}

export function enviadosHoy(leads, hoy) {
  const dia = fechaLocal(hoy);
  return leads.reduce((n, l) => n + enviosDe(l).filter((e) => fechaLocal(new Date(e.fecha)) === dia).length, 0);
}

// Lista de lo que toca mandar hoy: seguimientos vencidos primero, después primeros emails
export function armarCola(leads, config, hoy) {
  const seguimientos = [];
  const nuevos = [];
  for (const lead of leads) {
    if (lead.encaja !== 'si' || !lead.email || CERRADOS.includes(lead.estado)) continue;
    if (lead.borrador?.estado !== 'aprobado') continue;
    const hechos = enviosDe(lead);
    if (hechos.length === 0) {
      if (lead.estado === 'con_email') nuevos.push({ lead, paso: 0 });
      continue;
    }
    const paso = hechos.length; // 1 = primer seguimiento, 2 = segundo
    if (paso > config.seguimientos.length) continue;
    // Si un seguimiento quedó vacío, se saltea
    if (!lead.borrador[`seguimiento${paso}`]?.trim()) continue;
    if (diasEntre(new Date(hechos[0].fecha), hoy) >= config.seguimientos[paso - 1]) seguimientos.push({ lead, paso });
  }
  // Los aprobados primero que se aprobaron
  nuevos.sort((a, b) => String(a.lead.borrador.revisado ?? '').localeCompare(String(b.lead.borrador.revisado ?? '')));
  return [...seguimientos, ...nuevos];
}

const escaparHtml = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Formato mínimo: párrafos normales, firma con el nombre en negrita y el resto en gris, línea de baja chica.
// Sin fuentes propias, colores de marca ni imágenes: un email "de persona" llega mejor y lo responden más.
export function aHtml(texto) {
  const parrafos = texto.trim().split(/\n{2,}/).map((p) => {
    const lineas = p.split('\n').map(escaparHtml);
    if (/^Tobías Rubial/.test(p)) {
      const [nombre, ...resto] = lineas;
      const datos = resto.join('<br>')
        .replace('pucaratechnologies.com', '<a href="https://pucaratechnologies.com" style="color:#555">pucaratechnologies.com</a>')
        .replace(/WhatsApp (\+54 9 11 5486-6935)/, 'WhatsApp <a href="https://wa.me/5491154866935" style="color:#555">$1</a>');
      return `<p style="margin:18px 0 0"><strong>${nombre}</strong><br><span style="color:#555;font-size:13px">${datos}</span></p>`;
    }
    if (/^Si no (querés|quieren) que/.test(p)) return `<p style="margin:18px 0 0;color:#888;font-size:12px">${lineas.join('<br>')}</p>`;
    return `<p style="margin:0 0 12px">${lineas.join('<br>')}</p>`;
  });
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">${parrafos.join('')}</div>`;
}

export function armarMensaje(lead, paso, remitente) {
  const b = lead.borrador;
  const primero = enviosDe(lead)[0];
  const mensaje = {
    from: { name: remitente.nombre, address: remitente.email },
    to: lead.email,
    subject: paso === 0 ? b.asunto : `Re: ${b.asunto}`,
    text: paso === 0 ? b.cuerpo : b[`seguimiento${paso}`],
  };
  mensaje.html = aHtml(mensaje.text);
  // Los seguimientos van en el mismo hilo que el primer email
  if (paso > 0 && primero?.message_id) {
    mensaje.inReplyTo = primero.message_id;
    mensaje.references = [primero.message_id];
  }
  return mensaje;
}

function hayHorario(config, ahora) {
  const diaSemana = ahora.getDay() === 0 ? 7 : ahora.getDay();
  const hora = ahora.getHours();
  return config.dias.includes(diaSemana) && hora >= config.hora_desde && hora < config.hora_hasta;
}

function remitenteDelEnv() {
  const email = process.env.GMAIL_REMITENTE;
  const clave = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, '');
  if (!email || !clave) throw new Error('Faltan GMAIL_REMITENTE y GMAIL_APP_PASSWORD en el archivo .env');
  return { email, clave, nombre: process.env.NOMBRE_REMITENTE || email };
}

async function crearTransporte(remitente) {
  const { default: nodemailer } = await import('nodemailer');
  const t = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: remitente.email, pass: remitente.clave } });
  await t.verify();
  return t;
}

// Email que no existe (rebotó o la verificación lo rechazó): no se descarta el lead, se pasa a WhatsApp o
// Instagram. Los envíos que rebotaron quedan en el historial como "rebote", así no cuentan como contacto.
export function marcarEmailInvalido(lead, motivo) {
  const ahora = new Date().toISOString();
  const email = lead.email;
  lead.historial = (lead.historial ?? []).map((h) => (h.tipo === 'envio' && (h.canal ?? 'email') === 'email' ? { ...h, tipo: 'rebote' } : h));
  if (lead.estado !== 'nuevo') lead.historial.push({ fecha: ahora, tipo: 'estado', de: lead.estado, a: 'nuevo' });
  lead.estado = 'nuevo';
  lead.email_invalido = [...(lead.email_invalido ?? []), email];
  delete lead.email;
  delete lead.email_tipo;
  if (lead.borrador) lead.borrador = { ...lead.borrador, estado: 'descartado' };
  lead.mensaje_manual = redactarManual(lead) ?? undefined;
  lead.nota = [lead.nota, `${motivo} (${email})${lead.mensaje_manual ? ` Pasó a ${lead.mensaje_manual.canal === 'whatsapp' ? 'WhatsApp' : 'Instagram'}.` : ' No tiene otro canal: queda para llamar.'}`].filter(Boolean).join('\n');
  lead.actualizado_panel = ahora;
}

const dominioDe = (email) => email.split('@')[1];
const CORREO_GRATIS = /^(gmail|hotmail|yahoo|outlook|live|icloud)\./;

// Revisa la bandeja de entrada: respuestas y rebotes de los leads que ya recibieron algo
async function revisarBandeja(leads, remitente) {
  const contactados = leads.filter((l) => enviosDe(l).length && !CERRADOS.includes(l.estado));
  if (!contactados.length) return { respuestas: 0, rebotes: 0 };
  const { ImapFlow } = await import('imapflow');
  const imap = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user: remitente.email, pass: remitente.clave }, logger: false });
  await imap.connect();
  let respuestas = 0;
  let rebotes = 0;
  const ahora = new Date().toISOString();
  try {
    await imap.mailboxOpen('INBOX', { readOnly: true });
    for (const lead of contactados) {
      const desde = new Date(enviosDe(lead)[0].fecha);
      const despues = `${desde.getFullYear()}/${desde.getMonth() + 1}/${desde.getDate()}`;
      // Responde la persona o alguien más del mismo dominio (salvo Gmail, Hotmail, etc.)
      const quien = CORREO_GRATIS.test(dominioDe(lead.email)) ? lead.email : `@${dominioDe(lead.email)}`;
      const [respuesta] = await imap.search({ gmailRaw: `from:(${quien}) after:${despues}` }) || [];
      if (respuesta) {
        const msg = await imap.fetchOne(respuesta, { envelope: true });
        lead.historial.push({ fecha: (msg.envelope?.date ?? new Date()).toISOString(), tipo: 'respuesta', asunto: msg.envelope?.subject ?? '' });
        lead.historial.push({ fecha: ahora, tipo: 'estado', de: lead.estado, a: 'respondio' });
        lead.estado = 'respondio';
        lead.actualizado_panel = ahora;
        respuestas++;
        continue;
      }
      const [rebote] = await imap.search({ gmailRaw: `from:(mailer-daemon OR postmaster) "${lead.email}" after:${despues}` }) || [];
      if (rebote) {
        marcarEmailInvalido(lead, 'El email rebotó: la dirección no existe.');
        rebotes++;
      }
    }
  } finally {
    await imap.logout();
  }
  return { respuestas, rebotes };
}

// Antes de un primer email se verifica que la casilla exista. Solo salen las válidas y las de servidores que
// aceptan todo (catch_all, no se puede saber). Las inválidas pasan a WhatsApp o Instagram; las que no se
// pudieron verificar se saltean y se reintentan el próximo día.
async function verificarCola(candidatos, cupo) {
  const cola = [];
  const UNA_SEMANA = 7 * DIA_MS;
  for (const item of candidatos) {
    if (cola.length >= cupo) break;
    if (item.paso > 0) { cola.push(item); continue; }
    const { lead } = item;
    const previa = lead.email_verificado;
    const vigente = previa?.email === lead.email && Date.now() - new Date(previa.fecha) < UNA_SEMANA && previa.resultado !== 'desconocido';
    const v = vigente ? previa : { ...(await verificarEmail(lead.email)), email: lead.email, fecha: new Date().toISOString() };
    lead.email_verificado = v;
    if (v.resultado === 'valido' || v.resultado === 'catch_all') cola.push(item);
    else if (v.resultado === 'invalido') {
      console.log(`  No existe ${lead.email} (${lead.empresa}): pasa a WhatsApp o Instagram.`);
      marcarEmailInvalido(lead, 'La verificación dice que el email no existe.');
    } else console.log(`  No se pudo verificar ${lead.email} (${lead.empresa}): se reintenta mañana.`);
  }
  return cola;
}

async function guardar(leads) {
  await writeFile(ARCHIVO_LEADS, JSON.stringify(leads, null, 2));
  await writeFile(ARCHIVO_CSV, aCsv(leads));
}

// Si el panel online no responde (por ejemplo, Supabase pausó el proyecto), se avisa y se sigue con los datos
// de esta compu: lo aprobado en el panel online después del último sincronizado no llega, pero nada se pierde.
async function sincronizarSinFrenar(cuando) {
  try {
    const { aplicados } = await sincronizar();
    if (aplicados) console.log(`Traídos ${aplicados} cambios del panel online.`);
  } catch (e) {
    console.log(`Aviso: no se pudo sincronizar con el panel online ${cuando} (${e.message}). Se sigue con los datos de esta compu.`);
  }
}

const hayPanelOnline = () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const args = new Set(process.argv.slice(2));
  const prueba = args.has('--prueba');
  const config = JSON.parse(await readFile(ARCHIVO_CONFIG, 'utf8'));
  const estado = existsSync(ARCHIVO_ESTADO) ? JSON.parse(await readFile(ARCHIVO_ESTADO, 'utf8')) : { inicio: null };
  const ahora = new Date();

  if (hayPanelOnline() && !prueba) await sincronizarSinFrenar('al empezar');
  const leads = JSON.parse(await readFile(ARCHIVO_LEADS, 'utf8'));

  if (args.has('--muestra')) {
    const remitente = remitenteDelEnv();
    const lead = leads.find((l) => l.borrador?.estado === 'aprobado') ?? leads.find((l) => l.borrador);
    if (!lead) throw new Error('No hay borradores todavía.');
    const t = await crearTransporte(remitente);
    // El primer email y el seguimiento del día 3, para ver las dos firmas
    await t.sendMail({ ...armarMensaje(lead, 0, remitente), to: remitente.email, subject: `[MUESTRA] ${lead.borrador.asunto}` });
    const seguimiento = armarMensaje({ ...lead, historial: [] }, 1, remitente);
    await t.sendMail({ ...seguimiento, to: remitente.email, subject: `[MUESTRA día 3] ${seguimiento.subject}` });
    console.log(`Muestras enviadas a ${remitente.email}: el primer email y el seguimiento para ${lead.empresa}. No se marcaron como enviados.`);
    return;
  }

  const remitente = prueba ? null : remitenteDelEnv();
  if (!prueba) {
    const { respuestas, rebotes } = await revisarBandeja(leads, remitente);
    if (respuestas || rebotes) console.log(`Bandeja: ${respuestas} respuestas, ${rebotes} rebotes.`);
  }

  const limite = limiteDelDia(config, estado.inicio, ahora);
  const cupo = Math.max(0, limite - enviadosHoy(leads, ahora));
  const cola = await verificarCola(armarCola(leads, config, ahora), cupo);
  await guardar(leads);
  console.log(`Límite de hoy: ${limite}. Ya enviados hoy: ${limite - cupo}. Para mandar ahora: ${cola.length}.`);

  if (!hayHorario(config, ahora) && !args.has('--fuera-de-horario')) {
    console.log(`Fuera del horario de envío (días ${config.dias.join(',')}, ${config.hora_desde} a ${config.hora_hasta} h). No se manda nada.`);
    cola.length = 0;
  }

  if (prueba) {
    for (const { lead, paso } of cola) console.log(`  ${paso === 0 ? 'Primer email' : `Seguimiento ${paso}`} -> ${lead.email} (${lead.empresa})`);
    console.log('Modo prueba: no se mandó nada.');
    return;
  }

  let transporte = null;
  let enviados = 0;
  try {
    for (const [i, { lead, paso }] of cola.entries()) {
      if (i > 0 && !args.has('--sin-pausa')) {
        const [min, max] = config.pausa_minutos;
        const espera = (min + Math.random() * (max - min)) * 60 * 1000;
        console.log(`  Esperando ${Math.round(espera / 60000)} min antes del próximo...`);
        await new Promise((r) => setTimeout(r, espera));
      }
      transporte ??= await crearTransporte(remitente);
      const mensaje = armarMensaje(lead, paso, remitente);
      const info = await transporte.sendMail(mensaje);
      const fecha = new Date().toISOString();
      lead.historial = [...(lead.historial ?? []), { fecha, tipo: 'envio', paso, asunto: mensaje.subject, message_id: info.messageId }];
      const nuevoEstado = paso === 0 ? 'enviado' : 'seguimiento';
      if (lead.estado !== nuevoEstado) lead.historial.push({ fecha, tipo: 'estado', de: lead.estado, a: nuevoEstado });
      lead.estado = nuevoEstado;
      lead.actualizado_panel = fecha;
      estado.inicio ??= fecha;
      enviados++;
      console.log(`  Enviado: ${paso === 0 ? 'primer email' : `seguimiento ${paso}`} a ${lead.email} (${lead.empresa})`);
      // Se guarda después de cada envío: si algo falla, no se vuelve a mandar el mismo email
      await guardar(leads);
      await writeFile(ARCHIVO_ESTADO, JSON.stringify(estado, null, 2));
    }
  } finally {
    await guardar(leads);
    transporte?.close();
  }
  console.log(`Listo: ${enviados} enviados.`);
  if (hayPanelOnline()) await sincronizarSinFrenar('al terminar');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e) => {
    console.error('Error:', e.message);
    process.exit(1);
  });
}
