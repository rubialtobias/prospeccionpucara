// Verifica que una casilla de email exista antes de mandarle algo, sin mandar nada:
// se conecta al servidor de correo del dominio y pregunta si acepta esa dirección (RCPT TO), y corta.
// Los rebotes le bajan la reputación a la cuenta de Gmail, así que todo email se verifica antes de salir.
//
//   node --env-file=.env src/verificar.mjs          verifica los emails de leads que encajan y no se enviaron
//   node --env-file=.env src/verificar.mjs a@b.com  verifica una dirección
//
// Resultado: valido | invalido | catch_all (el servidor acepta cualquier dirección: no se puede saber) | desconocido

import { readFile, writeFile } from 'node:fs/promises';
import { resolveMx } from 'node:dns/promises';
import { connect } from 'node:net';
import { pathToFileURL } from 'node:url';
import { aCsv } from './buscar.mjs';

const ARCHIVO_LEADS = new URL('../data/leads.json', import.meta.url);
const ARCHIVO_CSV = new URL('../data/leads.csv', import.meta.url);

// Conversación SMTP mínima: espera cada respuesta antes de mandar la línea siguiente
function preguntarAlServidor(servidor, remitente, direcciones) {
  return new Promise((resolve) => {
    const socket = connect(25, servidor);
    const respuestas = [];
    const pasos = [
      'EHLO pucaratechnologies.com',
      `MAIL FROM:<${remitente}>`,
      ...direcciones.map((d) => `RCPT TO:<${d}>`),
      'QUIT',
    ];
    let buffer = '';
    let paso = -1; // -1 = esperando el saludo del servidor
    const terminar = (error) => { socket.destroy(); resolve({ respuestas, error }); };
    socket.setTimeout(12000, () => terminar('timeout'));
    socket.on('error', (e) => terminar(e.code ?? e.message));
    socket.on('data', (datos) => {
      buffer += datos.toString();
      // Una respuesta termina en una línea "250 ..." (con espacio, no "250-")
      const lineas = buffer.split(/\r?\n/).filter(Boolean);
      const ultima = lineas.at(-1) ?? '';
      if (!/^\d{3} /.test(ultima)) return;
      buffer = '';
      if (paso >= 0) respuestas.push({ paso: pasos[paso], codigo: Number(ultima.slice(0, 3)), texto: ultima });
      paso++;
      if (paso >= pasos.length) return terminar();
      socket.write(`${pasos[paso]}\r\n`);
    });
    socket.on('close', () => resolve({ respuestas }));
  });
}

export async function verificarEmail(email, remitente = process.env.GMAIL_REMITENTE ?? 'verificacion@gmail.com') {
  const dominio = email.split('@')[1];
  let mx;
  try {
    mx = (await resolveMx(dominio)).sort((a, b) => a.priority - b.priority)[0]?.exchange;
  } catch {
    return { resultado: 'invalido', motivo: 'El dominio no recibe correo' };
  }
  if (!mx) return { resultado: 'invalido', motivo: 'El dominio no recibe correo' };
  // Una dirección inventada: si el servidor también la acepta, acepta cualquiera (catch-all)
  const inventada = `no-existe-${Math.random().toString(36).slice(2, 10)}@${dominio}`;
  const { respuestas, error } = await preguntarAlServidor(mx, remitente, [email, inventada]);
  const rcpt = respuestas.filter((r) => r.paso.startsWith('RCPT'));
  if (rcpt.length < 2) return { resultado: 'desconocido', motivo: error ? `Sin respuesta del servidor (${error})` : 'El servidor cortó la conversación' };
  const [real, falsa] = rcpt;
  // Solo es inválida si el servidor dice que la cuenta no existe. Un 5.7.x (bloqueo por política, Spamhaus,
  // IP de casa) no dice nada de la casilla: es "desconocido".
  if (real.codigo >= 500 && real.codigo < 600) {
    const bloqueo = /5\.7\.\d|spamhaus|blocked|block ?list|blacklist|policy|not permitted|relay/i.test(real.texto);
    const noExiste = /5\.1\.\d|does not exist|no such|user unknown|unknown user|invalid recipient|recipient (not found|rejected)|mailbox (unavailable|not found)/i.test(real.texto);
    if (noExiste && !bloqueo) return { resultado: 'invalido', motivo: real.texto.slice(0, 160) };
    return { resultado: 'desconocido', motivo: real.texto.slice(0, 160) };
  }
  if (real.codigo === 250 && falsa.codigo === 250) return { resultado: 'catch_all', motivo: 'El servidor acepta cualquier dirección' };
  if (real.codigo === 250) return { resultado: 'valido', motivo: '' };
  return { resultado: 'desconocido', motivo: real.texto.slice(0, 160) };
}

async function main() {
  const suelta = process.argv[2];
  if (suelta) {
    console.log(suelta, await verificarEmail(suelta));
    return;
  }
  const leads = JSON.parse(await readFile(ARCHIVO_LEADS, 'utf8'));
  const enviado = (l) => (l.historial ?? []).some((h) => h.tipo === 'envio' && (h.canal ?? 'email') === 'email');
  const pendientes = leads.filter((l) => l.encaja === 'si' && l.email && !enviado(l));
  const cuenta = {};
  for (const lead of pendientes) {
    const v = await verificarEmail(lead.email);
    lead.email_verificado = { ...v, email: lead.email, fecha: new Date().toISOString() };
    lead.actualizado_panel = new Date().toISOString();
    cuenta[v.resultado] = (cuenta[v.resultado] ?? 0) + 1;
    console.log(`${v.resultado.padEnd(11)} ${lead.email} (${lead.empresa})${v.motivo ? ` · ${v.motivo.slice(0, 80)}` : ''}`);
  }
  await writeFile(ARCHIVO_LEADS, JSON.stringify(leads, null, 2));
  await writeFile(ARCHIVO_CSV, aCsv(leads));
  console.log('\n', cuenta);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e) => {
    console.error('Error:', e.message);
    process.exit(1);
  });
}
