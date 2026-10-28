import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extraerEmails, extraerWhatsapp, decodificarCloudflare, elegirEmail, esWebPropia, enlacesDeContacto } from '../src/web.mjs';

test('saca emails del texto, de mailto y descarta imágenes', () => {
  const html = '<a href="mailto:Info@WolfProp.com.ar">x</a> ventas&#64;wolfprop.com.ar <img src="logo@2x.png">';
  assert.deepEqual(extraerEmails(html).sort(), ['info@wolfprop.com.ar', 'ventas@wolfprop.com.ar']);
});

test('decodifica emails escondidos por Cloudflare', () => {
  // "a@b.co" con clave 0x42
  const hex = '42' + [...'a@b.co'].map((c) => (c.charCodeAt(0) ^ 0x42).toString(16).padStart(2, '0')).join('');
  assert.equal(decodificarCloudflare(hex), 'a@b.co');
  assert.deepEqual(extraerEmails(`<span data-cfemail="${hex}">`), ['a@b.co']);
});

test('WhatsApp desde wa.me y api.whatsapp.com', () => {
  assert.equal(extraerWhatsapp('href="https://wa.me/5492215551234"'), '5492215551234');
  assert.equal(extraerWhatsapp('https://api.whatsapp.com/send?phone=+5491155551234&text=hola'), '5491155551234');
});

test('prefiere el email de la persona en el dominio de la empresa', () => {
  const r = elegirEmail(['info@wolf.com.ar', 'juan@wolf.com.ar', 'x@gmail.com'], { web: 'https://www.wolf.com.ar', nombre: 'Juan', apellido: 'Wolf' });
  assert.deepEqual(r, { email: 'juan@wolf.com.ar', tipo: 'personal' });
  assert.equal(elegirEmail(['rrhh@wolf.com.ar', 'info@wolf.com.ar'], { web: 'https://wolf.com.ar', nombre: 'Ana' }).email, 'info@wolf.com.ar');
});

test('descarta portales como web propia', () => {
  assert.ok(!esWebPropia('https://www.zonaprop.com.ar/inmobiliarias/wolf.html'));
  assert.ok(!esWebPropia('https://ar.linkedin.com/company/wolf'));
  assert.ok(esWebPropia('https://wolfpropiedades.com.ar/'));
});

test('enlaces de contacto solo del mismo sitio', () => {
  const html = '<a href="/contacto">c</a><a href="https://otro.com/contact">o</a><a href="nosotros.html">n</a>';
  assert.deepEqual(enlacesDeContacto(html, 'https://wolf.com.ar/'), ['https://wolf.com.ar/contacto', 'https://wolf.com.ar/nosotros.html']);
});

test('la web tiene que coincidir con la empresa y ser de Argentina', async () => {
  const { elegirWeb } = await import('../src/web.mjs');
  const r = [
    { title: 'Trabajo en GO', link: 'https://www.zonajobs.com.ar/empresas/go' },
    { title: 'GO Real Estate Costa Rica', link: 'https://goreal.cr/' },
    { title: 'GO Real Estate | Propiedades en Buenos Aires', link: 'https://www.goprop.com.ar/inicio' },
  ];
  assert.equal(elegirWeb(r, 'GO Real Estate'), '');
  assert.equal(elegirWeb([{ title: 'Inicio', link: 'https://merellobas.com/' }], 'Merello Bas Propiedades'), 'https://merellobas.com');
  // Una sola palabra en el título no alcanza
  assert.equal(elegirWeb([{ title: 'Wolf', link: 'https://otra.com.ar/' }], 'Wolf Propiedades'), '');
});

test('descarta el email de otra empresa que aparece en la web', () => {
  assert.equal(elegirEmail(['info@realtortrackpro.com'], { web: 'https://gustavodesimone.com', nombre: 'Gustavo' }), null);
  assert.equal(elegirEmail(['juancupertinoinmo@gmail.com'], { web: 'https://cupertinoinmobiliaria.ar', nombre: 'Juan' }).email, 'juancupertinoinmo@gmail.com');
});

test('señales de web floja', async () => {
  const { senalesDeWebFloja, puntajeWebFloja } = await import('../src/web.mjs');
  const vieja = senalesDeWebFloja('<footer>© 2016 Gym Pepe</footer><p>Bienvenidos</p>', 'https://gympepe.wixsite.com/inicio');
  assert.equal(vieja.anio_copyright, 2016);
  assert.equal(vieja.subdominio_gratis, true);
  assert.equal(vieja.muestra_precios, false);
  assert.ok(puntajeWebFloja({ ...vieja, segundos: 1 }) >= 4);
  const buena = senalesDeWebFloja(`<p>Planes desde $25.000 por mes</p>${'<p>texto del gimnasio </p>'.repeat(80)}<footer>© 2025</footer>`, 'https://gym.com.ar/');
  assert.equal(buena.muestra_precios, true);
  assert.equal(puntajeWebFloja({ ...buena, boton_whatsapp: true, segundos: 1 }), 0);
  assert.equal(puntajeWebFloja({ error: 'No abre' }), 0);
});
