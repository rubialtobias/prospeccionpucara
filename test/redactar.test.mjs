import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactar, saludo, variante, palabras } from '../src/redactar.mjs';

const generico = { nombre: 'Susana', empresa: 'Merello Bas Propiedades', email_tipo: 'generico', web_revisada: { boton_whatsapp: true } };
const personal = { nombre: 'Juan', empresa: 'Cupertino Inmobiliaria', email_tipo: 'personal', web_revisada: { formulario: true } };

test('saludo según el tipo de email', () => {
  assert.equal(saludo(generico), 'Hola, equipo de Merello Bas Propiedades:');
  assert.equal(saludo(personal), 'Hola Juan,');
});

test('elige el gancho por lo que se vio en la web', () => {
  assert.equal(variante(generico), 'whatsapp');
  assert.equal(variante(personal), 'formulario');
  assert.equal(variante({ empresa: 'X' }), 'general');
});

test('email al equipo en plural y a una persona en singular', () => {
  const g = redactar(generico);
  assert.match(g.cuerpo, /¿Les muestro/);
  assert.match(g.cuerpo, /respondan "no"/);
  const p = redactar(personal);
  assert.match(p.cuerpo, /¿Te muestro/);
  assert.match(p.seguimiento1, /Te escribo de nuevo con otra idea[\s\S]*¿Hoy cómo llevás eso\? Si te sirve, en 15 minutos te muestro/);
  assert.match(g.seguimiento1, /^Hola, equipo de Merello Bas Propiedades:[\s\S]*¿Hoy cómo llevan eso\? Si les sirve, en 15 minutos les muestro/);
  assert.match(g.seguimiento2, /asistentes de IA, automatizaciones, sistemas de gestión a medida y páginas web\. Respondan/);
});

test('nunca afirma que no tienen asistente, sin links y corto', () => {
  for (const lead of [generico, personal, { empresa: 'Sessa Propiedades', email_tipo: 'generico' }]) {
    const b = redactar(lead);
    for (const texto of [b.cuerpo, b.seguimiento1, b.seguimiento2]) {
      assert.doesNotMatch(texto, /no tienen (un )?(asistente|bot|chat)/i);
      assert.doesNotMatch(texto, /https?:\/\/|www\./i);
    }
    // El límite de 100 palabras es para el mensaje; la firma y la línea de baja van aparte
    const mensaje = b.cuerpo.split('\n\nTobías Rubial')[0];
    assert.ok(palabras(mensaje) <= 100, `${palabras(mensaje)} palabras`);
    assert.match(b.cuerpo, /no (te|les) escribo más/);
    assert.equal(b.estado, 'pendiente');
  }
});

test('nombre corto de la empresa, como lo diría una persona', async () => {
  const { nombreCorto } = await import('../src/redactar.mjs');
  assert.equal(nombreCorto('Gustavo De Simone Soluciones Inmobiliarias'), 'Gustavo De Simone');
  assert.equal(nombreCorto("O'Feely Negocios Inmobiliarios"), "O'Feely");
  assert.equal(nombreCorto('Miranda Bosch Real Estate & Art'), 'Miranda Bosch');
  assert.equal(nombreCorto('Cupertino Inmobiliaria'), 'Cupertino Inmobiliaria');
});

test('el primer email no lleva web ni teléfono; los seguimientos sí', () => {
  const b = redactar(personal);
  assert.match(b.cuerpo, /Tobías Rubial\nPucará Technologies/);
  assert.doesNotMatch(b.cuerpo, /pucaratechnologies\.com|5486/);
  assert.match(b.seguimiento1, /pucaratechnologies\.com · WhatsApp \+54 9 11 5486-6935/);
});

test('gimnasios: el email habla de precios, horarios y clase de prueba', () => {
  const gym = { empresa: 'Bestial Gym', rubro: 'gimnasios', email_tipo: 'generico', web: 'https://bestialgym.com.ar', web_revisada: { boton_whatsapp: true } };
  const b = redactar(gym);
  assert.match(b.cuerpo, /^Hola, equipo de Bestial Gym:/);
  assert.match(b.cuerpo, /precios u horarios a las 11 de la noche/);
  assert.match(b.cuerpo, /asistentes de IA para gimnasios/);
  assert.match(b.seguimiento1, /cuotas vencidas/);
  assert.doesNotMatch(b.cuerpo, /propiedad|inmobiliaria/i);
});

test('celulares de Argentina a formato de WhatsApp', async () => {
  const { numeroWhatsapp } = await import('../src/redactar.mjs');
  assert.equal(numeroWhatsapp('0221 15-436-6542'), '5492214366542');
  assert.equal(numeroWhatsapp('011 15-5486-6935'), '5491154866935');
  assert.equal(numeroWhatsapp('+54 9 11 5486-6935'), '5491154866935');
  assert.equal(numeroWhatsapp('0221 495-9660'), '');
  assert.equal(numeroWhatsapp(''), '');
});

test('mensaje a mano: sin web ofrece página web, con web ofrece agente', async () => {
  const { redactarManual } = await import('../src/redactar.mjs');
  const sinWeb = redactarManual({ empresa: 'OBELIUS GYM', rubro: 'gimnasios', ubicacion: 'La Plata', telefono: '0221 15-362-7073', instagram: 'https://www.instagram.com/obelius/' });
  assert.equal(sinWeb.canal, 'whatsapp');
  assert.equal(sinWeb.oferta, 'web');
  assert.match(sinWeb.texto, /Vi que OBELIUS GYM está en Google Maps pero todavía no tiene página web propia/);
  assert.match(sinWeb.texto, /sin tener que escribirles por Instagram o WhatsApp/);
  assert.doesNotMatch(sinWeb.texto, /dónde los encuentra/);
  const elogio = redactarManual({ empresa: 'SKAY GYM', rubro: 'gimnasios', telefono: '0221 15-590-7587', calificacion: 4.8, resenas: 343 });
  assert.match(elogio.texto, /tiene muy buenas reseñas en Google Maps \(4,8 ★ con 343 opiniones\) y que todavía no tiene página web propia/);
  const pocas = redactarManual({ empresa: 'X Gym', rubro: 'gimnasios', telefono: '0221 15-590-7587', calificacion: 5, resenas: 4 });
  assert.doesNotMatch(pocas.texto, /reseñas/);
  const soloIg = redactarManual({ empresa: 'Fit Club', rubro: 'gimnasios', telefono: '0221 362-3735', instagram: 'https://www.instagram.com/fit.clublp/' });
  assert.equal(soloIg.canal, 'instagram');
  const conWeb = redactarManual({ empresa: 'Core Gym', rubro: 'gimnasios', web: 'https://coregym.com.ar', whatsapp: '5492214959660' });
  assert.equal(conWeb.oferta, 'agente');
  assert.equal(conWeb.numero, '5492214959660');
  assert.equal(redactarManual({ empresa: 'X', rubro: 'gimnasios', telefono: '0221 495-9660' }), null);
});

test('nombres de Google Maps sin agregados', async () => {
  const { nombreCorto } = await import('../src/redactar.mjs');
  assert.equal(nombreCorto('Bestial Gym Caballito Bs. As.', 'Caballito CABA'), 'Bestial Gym');
  assert.equal(nombreCorto('OPEN BOX 24/7: HYROX Official GYM', 'Palermo CABA'), 'OPEN BOX 24/7');
  assert.equal(nombreCorto('RED FITNESS CLUB (Sede Morón)', 'Morón'), 'RED FITNESS CLUB');
  assert.equal(nombreCorto('Gimnasio California Rosario', 'Rosario'), 'Gimnasio California');
  assert.equal(nombreCorto('Rosario', 'Rosario'), 'Rosario');
});

test('web floja: pregunta sobre lo que se vio y ofrece renovarla', async () => {
  const { redactarManual, ganchoWebFloja } = await import('../src/redactar.mjs');
  const base = { rubro: 'gimnasios', email_tipo: 'generico', ubicacion: 'Rosario' };
  assert.match(ganchoWebFloja({ ...base, empresa: 'Urban Six', web_floja: { como: 'vieja', anio: 2018 } }), /al pie dice © 2018\. ¿La están pensando renovar\?/);
  assert.match(ganchoWebFloja({ ...base, empresa: 'La Mecca', web_floja: { como: 'suspendida' } }), /aparece como suspendida/);
  assert.match(ganchoWebFloja({ ...base, empresa: 'FitLife', web: 'https://gimnasiofitlife.carrd.co', web_floja: { como: 'subdominio' } }), /armada en gimnasiofitlife\.carrd\.co/);
  const b = redactar({ ...base, empresa: 'Gimnasio California Rosario', email: 'x@gmail.com', web_floja: { como: 'actualizar' } });
  assert.equal(b.asunto, 'la web de Gimnasio California');
  assert.match(b.cuerpo, /¿Hace cuánto que no la actualizan\?/);
  assert.match(b.seguimiento1, /asistentes de IA/);
  assert.doesNotMatch(b.cuerpo, /fea|horrible|mala/i);
  const m = redactarManual({ ...base, empresa: 'ION GYM', web: 'https://iongym.com.ar', telefono: '0221 15-111-2222', web_floja: { como: 'actualizar' } });
  assert.equal(m.oferta, 'renovar_web');
});

test('números: WhatsApp de la web sin 9 y posibles celulares sin 15', async () => {
  const { normalizarWhatsapp, posibleCelular, redactarManual } = await import('../src/redactar.mjs');
  assert.equal(normalizarWhatsapp('543413682675'), '5493413682675');
  assert.equal(normalizarWhatsapp('5493417122180'), '5493417122180');
  assert.equal(posibleCelular('011 7623-1725'), '5491176231725');
  assert.equal(posibleCelular('0221 676-4043'), '5492216764043');
  assert.equal(posibleCelular('011 4776-6496'), '');
  assert.equal(posibleCelular('011 5602-3103'), '');
  assert.equal(posibleCelular('0341 449-5233'), '');
  const m = redactarManual({ empresa: 'La Mecca', rubro: 'gimnasios', telefono: '011 7623-1725' });
  assert.equal(m.numero, '5491176231725');
  assert.equal(m.numero_dudoso, true);
  const conIg = redactarManual({ empresa: 'X', rubro: 'gimnasios', telefono: '011 7623-1725', instagram: 'https://instagram.com/x' });
  assert.equal(conIg.canal, 'instagram');
});
