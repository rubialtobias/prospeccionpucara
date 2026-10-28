// Funciones para leer la web de una empresa: emails, WhatsApp y datos para personalizar el email.

// Portales y redes que aparecen al buscar una inmobiliaria pero no son su web propia
const NO_SON_WEB_PROPIA = [
  'linkedin.com', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'youtube.com', 'tiktok.com',
  'zonaprop.com.ar', 'argenprop.com', 'mercadolibre.com.ar', 'properati.com.ar', 'inmuebles24.com',
  'google.com', 'maps.google.com', 'wikipedia.org', 'cylex.com.ar', 'paginasamarillas.com.ar',
  'guiaypf.com.ar', 'infobae.com', 'lanacion.com.ar', 'clarin.com', 'remax.com.ar', 'kw.com',
  'doctoralia.com.ar', 'tripadvisor.com', 'tripadvisor.com.ar', 'pedidosya.com.ar', 'yelp.com',
  'cuit.com.ar', 'cuitonline.com', 'dateas.com', 'boletinoficial.gob.ar', 'colegioinmobiliario.org.ar',
  'zonajobs.com.ar', 'bumeran.com.ar', 'computrabajo.com', 'indeed.com', 'glassdoor.com', 'glassdoor.com.ar',
  'crunchbase.com', 'rocketreach.co', 'zoominfo.com', 'apollo.io', 'signalhire.com', 'lusha.com',
  'bebee.com', 'infobel.com', 'guiadebuenosaires.com.ar', 'guiaurbana.com.ar', 'indicadores.ar', 'isimarkets.com', 'empresite.com.ar',
];

const CORREO_GRATIS = /@(gmail|hotmail|yahoo|outlook|live|icloud)\.(com|com\.ar|es)$/;

// Dominios de otros países: una inmobiliaria argentina con el mismo nombre que una de afuera no es la misma
const OTRO_PAIS = /\.(cr|mx|es|cl|uy|pe|py|bo|ec|ve|br|com\.(mx|co|pe|uy|br|py|bo|ec|ve)|co\.uk)$/;
// Palabras del rubro que no sirven para reconocer a una empresa por su dominio
const PALABRAS_GENERICAS = new Set(['inmobiliaria', 'inmobiliarias', 'inmobiliario', 'propiedades', 'real', 'estate', 'negocios',
  'grupo', 'group', 'bienes', 'raices', 'soluciones', 'servicios', 'desarrollos', 'desarrolla', 'consultoria', 'gestion',
  'inversiones', 'relaciones', 'asociados', 'brokers', 'realty', 'the', 'and', 'del', 'las', 'los']);

export function dominio(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

export function esWebPropia(url) {
  const d = dominio(url);
  return Boolean(d) && !NO_SON_WEB_PROPIA.some((p) => d === p || d.endsWith('.' + p));
}

const sinTildes = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Palabras que identifican a la empresa: "Wolf Propiedades" -> ["wolf"]
export function palabrasClave(empresa) {
  return sinTildes(empresa).split(/[^a-z0-9]+/).filter((p) => p.length >= 3 && !PALABRAS_GENERICAS.has(p));
}

// De los resultados de Google, el primero que sea la web propia de esta empresa
export function elegirWeb(resultados, empresa) {
  const claves = palabrasClave(empresa);
  if (!claves.length) return '';
  for (const r of resultados) {
    if (!esWebPropia(r.link)) continue;
    const d = dominio(r.link);
    if (OTRO_PAIS.test(d)) continue;
    const dominioPlano = d.replace(/[^a-z0-9]/g, '');
    const titulo = sinTildes(r.title ?? '');
    // El dominio tiene que tener una palabra de la empresa. Solo el título no alcanza:
    // "Alamos" en el título trajo una vinoteca. Con 2+ palabras, todas en el título sí cuenta.
    const enDominio = claves.some((c) => dominioPlano.includes(c));
    const enTitulo = claves.length >= 2 && claves.every((c) => titulo.includes(c));
    if (enDominio || enTitulo) return new URL(r.link).origin;
  }
  return '';
}

// Cloudflare esconde los emails como <a data-cfemail="..."> o /cdn-cgi/l/email-protection#...
export function decodificarCloudflare(hex) {
  const clave = parseInt(hex.slice(0, 2), 16);
  let email = '';
  for (let i = 2; i < hex.length; i += 2) email += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ clave);
  return email;
}

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
// Falsos positivos típicos: nombres de imágenes, servicios de monitoreo, ejemplos
const EMAIL_FALSO = /\.(png|jpe?g|gif|webp|svg|css|js)$|@(\d+x|sentry|wixpress|example|ejemplo|domain|dominio|email|mail\.com$)|^(u00|xxx|nombre|tu@|your)/i;

export function extraerEmails(html) {
  const encontrados = new Set();
  const texto = html.replace(/&#64;|&#x40;|\[at\]|\(at\)| arroba /gi, '@');
  for (const m of texto.matchAll(EMAIL)) encontrados.add(m[0].toLowerCase().replace(/^mailto:/, ''));
  for (const m of html.matchAll(/data-cfemail="([0-9a-f]+)"|email-protection#([0-9a-f]+)/gi)) {
    encontrados.add(decodificarCloudflare(m[1] ?? m[2]).toLowerCase());
  }
  return [...encontrados].map((e) => e.replace(/^[._-]+|[._-]+$/g, '')).filter((e) => !EMAIL_FALSO.test(e) && e.length < 80);
}

export function extraerWhatsapp(html) {
  const m = html.match(/(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=|whatsapp\.com\/send\/?\?phone=)\+?(\d{10,15})/i);
  return m ? m[1] : '';
}

export function enlacesDeContacto(html, base) {
  const enlaces = new Set();
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    if (!/contact|nosotros|quienes|about|empresa/i.test(m[1])) continue;
    try {
      const u = new URL(m[1], base);
      if (dominio(u.href) === dominio(base) && /^https?:$/.test(u.protocol)) enlaces.add(u.href);
    } catch { /* enlace roto */ }
  }
  return [...enlaces].slice(0, 3);
}

// Herramientas de chat y bots que se reconocen por su script en la página
const CHATS = [
  ['Tawk.to', /tawk\.to/i], ['Crisp', /crisp\.chat/i], ['Intercom', /intercom/i], ['Zendesk', /zendesk|zdassets/i],
  ['JivoChat', /jivosite|jivochat/i], ['Tidio', /tidio/i], ['Botmaker', /botmaker/i], ['ManyChat', /manychat/i],
  ['Kommo', /kommo\.com|amocrm/i], ['Wati', /wati\.io/i], ['Leadsales', /leadsales/i], ['HubSpot', /js\.hs-scripts|hubspot.*conversations|usemessages\.com/i],
  ['Messenger', /customerchat|facebook\.com\/plugins\/customer_chat/i], ['Smartsupp', /smartsupp/i], ['LiveChat', /livechatinc|cdn\.livechat/i],
  ['Zoho SalesIQ', /salesiq\.zoho/i], ['Drift', /js\.driftt|drift\.com/i], ['Clientify', /clientify/i], ['Chatwoot', /chatwoot/i],
  ['Respond.io', /respond\.io/i], ['Landbot', /landbot/i], ['Userlike', /userlike/i], ['Freshchat', /freshchat|wchat\.freshchat/i],
  ['Olark', /olark/i],
];
// GetButton, Joinchat y similares no van: son solo un botón flotante de WhatsApp, no un chat

// Constructores gratuitos o subdominios prestados: la web no tiene dominio propio
const SUBDOMINIO_GRATIS = /\.(wixsite\.com|carrd\.co|blogspot\.com|weebly\.com|godaddysites\.com|webnode\.\w+|site123\.me|jimdosite\.com|business\.site|negocio\.site|wordpress\.com|squarespace\.com|mitiendanube\.com)$/i;

// Señales concretas de una web floja. No dicen que sea fea (eso se confirma mirándola), solo que vale la pena mirarla.
export function senalesDeWebFloja(html, urlFinal) {
  const texto = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
  const anios = [...texto.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(20\d{2}|19\d{2})/gi)].map((m) => Number(m[1]));
  const anioCopyright = anios.length ? Math.max(...anios) : null;
  const palabrasVisibles = texto.split(/\s+/).filter((p) => p.length > 1).length;
  const host = (() => { try { return new URL(urlFinal).hostname; } catch { return ''; } })();
  return {
    anio_copyright: anioCopyright,
    subdominio_gratis: SUBDOMINIO_GRATIS.test(host),
    muestra_precios: /\$\s?\d|precio|tarifa|valor(es)? (de la )?cuota|planes?\b/i.test(texto),
    palabras: palabrasVisibles,
  };
}

// Cuántas señales de web floja tiene. 2 o más: candidata a ofrecerle renovar la web (después de mirarla).
export function puntajeWebFloja(w) {
  if (!w || w.error) return 0;
  let p = 0;
  if (w.anio_copyright && w.anio_copyright <= new Date().getFullYear() - 4) p++;
  if (w.subdominio_gratis) p++;
  if (!w.muestra_precios) p++;
  if (!w.boton_whatsapp && !w.formulario) p++;
  if (w.segundos > 4) p++;
  if (w.palabras !== undefined && w.palabras < 120) p++;
  return p;
}

// Datos de la web que sirven para el gancho del email
export function revisarWeb(html, urlFinal, ms) {
  const plataformas = {
    tokko: /tokkobroker|tokko/i, wordpress: /wp-content|wordpress/i, wix: /wix\.com|wixstatic/i,
    tiendanube: /tiendanube|nuvemshop/i, shopify: /cdn\.shopify|shopify/i, webflow: /webflow/i,
  };
  return {
    https: urlFinal.startsWith('https://'),
    adaptada_celular: /<meta[^>]+name=["']viewport["']/i.test(html),
    boton_whatsapp: Boolean(extraerWhatsapp(html)),
    formulario: /<form[\s>]/i.test(html),
    // Solo lo que está en el HTML: un chat cargado después por Tag Manager o un bot detrás del WhatsApp no se ven
    chat: CHATS.find(([, re]) => re.test(html))?.[0] ?? '',
    plataforma: Object.entries(plataformas).find(([, re]) => re.test(html))?.[0] ?? '',
    segundos: Math.round(ms / 100) / 10,
    titulo: (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '').trim().slice(0, 120),
    ...senalesDeWebFloja(html, urlFinal),
  };
}

// Elige el mejor email: primero el de la persona en el dominio de la empresa, después uno genérico del dominio
export function elegirEmail(emails, { web, nombre, apellido, empresa = '' }) {
  const d = dominio(web);
  const claves = palabrasClave(empresa);
  const n = sinTildes(nombre ?? '').split(' ')[0];
  const a = sinTildes(apellido ?? '').split(' ')[0];
  const puntaje = (e) => {
    const [usuario, dom] = e.split('@');
    let p = 0;
    // Del dominio de la web, o de otro dominio con el nombre de la empresa (mel.ar usa melpropiedades.com.ar)
    if (d && (dom === d || dom.endsWith('.' + d) || d.endsWith('.' + dom))) p += 10;
    else if (claves.some((c) => dom.replace(/[^a-z0-9]/g, '').includes(c))) p += 10;
    if ((n && usuario.includes(n)) || (a && a.length > 2 && usuario.includes(a))) p += 5;
    if (/^(info|contacto|consultas|ventas|hola|administracion|inmobiliaria)/.test(usuario)) p += 2;
    if (/^(no-?reply|rrhh|cv|empleo|privacidad|soporte|webmaster)/.test(usuario)) p -= 20;
    // Email de otra empresa (el diseñador de la web, un proveedor): no es de ellos
    if (p < 10 && !CORREO_GRATIS.test(e) && !(n && usuario.includes(n))) p -= 20;
    return p;
  };
  const ordenados = emails.map((e) => [e, puntaje(e)]).filter(([, p]) => p > -10).sort((x, y) => y[1] - x[1]);
  if (!ordenados.length) return null;
  const [email, p] = ordenados[0];
  return { email, tipo: p >= 15 || (p >= 5 && p < 10) ? 'personal' : 'generico' };
}
