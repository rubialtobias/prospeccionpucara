// Convierte un resultado de Google de un perfil de LinkedIn en un lead.
// Títulos típicos:
//   "Juan Pérez - Dueño - Inmobiliaria Pérez | LinkedIn"
//   "María Gómez – CEO en Gómez Propiedades - LinkedIn"
//   "Carlos Ruiz - Inmobiliaria Ruiz | LinkedIn"

const SUFIJO_LINKEDIN = /\s*[|\-–—]\s*LinkedIn\s*$/i;
const SEPARADOR = /\s+[-–—|]\s+/;
// Sin "de": cortaría "Director de Ventas" como si "Ventas" fuera la empresa
const CONECTOR_EMPRESA = /\s+(?:en|at|@)\s+/i;
// Títulos cortados por Google: "Socio Gerente en"
const CONECTOR_FINAL = /\s+(?:en|de|del|at|@)$/i;

// Cargos de dueño seguidos directamente de la empresa: "CEO & Founder Metro X", "Propietario, Pratto Propiedades".
// Director y gerente solo cuentan acompañando a un cargo de dueño, para no cortar "Director de Ventas".
const ROL_DUENO = '(?:co-?)?(?:dueñ[oa]|fundador[a]?|founder|propietari[oa]|ceo|owner|socio(?: gerente| fundador)?)';
const ROL_CUALQUIERA = `(?:${ROL_DUENO}|director[a]?|gerente)`;
const CARGO_Y_EMPRESA = new RegExp(
  `^(${ROL_DUENO}(?:\\s*(?:y|&|/|,)\\s*${ROL_CUALQUIERA})*)\\s*(?:,|\\bde\\b|\\bdel\\b|\\ben\\b)?\\s+(.+)$`,
  'i',
);
// Evita que "Socio Gerente" se corte en cargo "Socio" y empresa "Gerente"
const EMPIEZA_CON_ROL = new RegExp(`^${ROL_CUALQUIERA}\\b`, 'i');

// Si el "nombre" tiene alguna de estas palabras, en realidad es un cargo o una empresa
const NO_ES_NOMBRE = /\b(?:dueñ[oa]|ceo|founder|fundador[a]?|propietari[oa]|socio|owner|inmobiliaria|propiedades|real estate|realty|abogados|negocios|grupo|bienes|brokers?|desarrollos?|relaciones)\b/i;

export function normalizarUrl(url) {
  try {
    const u = new URL(url);
    // es.linkedin.com, ar.linkedin.com y www.linkedin.com apuntan al mismo perfil
    const ruta = decodeURIComponent(u.pathname).replace(/\/+$/, '').toLowerCase();
    return `https://www.linkedin.com${ruta}`;
  } catch {
    return null;
  }
}

export function esPerfil(url) {
  const n = normalizarUrl(url);
  return n !== null && /^https:\/\/www\.linkedin\.com\/in\/[^/]+$/.test(n);
}

function limpiar(texto) {
  return (texto ?? '').replace(/\s+/g, ' ').replace(/\.{3}$|…$/, '').trim();
}

export function parsearTitulo(titulo) {
  const partes = limpiar(titulo).replace(SUFIJO_LINKEDIN, '').split(SEPARADOR).map(limpiar).filter(Boolean);
  let [nombre = '', cargo = '', empresa = ''] = partes;

  cargo = cargo.replace(CONECTOR_FINAL, '');

  // "CEO en Gómez Propiedades" -> cargo "CEO", empresa "Gómez Propiedades"
  if (!empresa && cargo) {
    const [c, ...resto] = cargo.split(CONECTOR_EMPRESA);
    if (resto.length) {
      cargo = c;
      empresa = resto.join(' ');
    }
  }
  // "Fundador y Director de GO Real Estate" -> cargo "Fundador y Director", empresa "GO Real Estate"
  if (!empresa && cargo) {
    const m = cargo.match(CARGO_Y_EMPRESA);
    if (m && !EMPIEZA_CON_ROL.test(m[2])) [, cargo, empresa] = m;
  }
  return { nombre, cargo, empresa };
}

// "juan-perez-a1b2c3" -> "Juan Perez". Descarta los sufijos con números que agrega LinkedIn.
export function nombreDesdeUrl(url) {
  const slug = (normalizarUrl(url) ?? '').split('/in/')[1] ?? '';
  const palabras = slug.split('-').filter((p) => p && !/\d/.test(p));
  return palabras.slice(0, 3).join(' ');
}

// "FACUNDO VERZI" o "francisco tallarico" -> "Facundo Verzi", "Francisco Tallarico"
export function capitalizar(texto) {
  const t = limpiar(texto);
  if (t !== t.toUpperCase() && t !== t.toLowerCase()) return t;
  return t.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep, letra) => sep + letra.toUpperCase());
}

// Devuelve el nombre de la persona y si hubo que adivinarlo
export function resolverNombre(nombreDelTitulo, url) {
  const n = limpiar(nombreDelTitulo).replace(/^[“"]|[”"]$/g, '');
  const m = n.match(NO_ES_NOMBRE);
  if (!m) return { nombre: capitalizar(n), adivinado: false };
  // "Ximena Gonzalez Alvarez Inmobiliaria" -> lo que está antes de la palabra
  const antes = n.slice(0, m.index).replace(/[\s,–-]+$/, '');
  if (antes.split(' ').length >= 2) return { nombre: capitalizar(antes), adivinado: true };
  return { nombre: capitalizar(nombreDesdeUrl(url)), adivinado: true };
}

export function parsearSnippet(snippet) {
  const texto = limpiar(snippet);
  const campo = (etiqueta) => {
    const m = texto.match(new RegExp(`${etiqueta}:\\s*([^·]+)`, 'i'));
    return m ? limpiar(m[1]) : '';
  };
  return {
    ubicacion: campo('Ubicación') || campo('Location'),
    experiencia: campo('Experiencia') || campo('Experience'),
  };
}

export function separarNombre(nombreCompleto) {
  const [nombre = '', ...apellidos] = limpiar(nombreCompleto).split(' ');
  return { nombre, apellido: apellidos.join(' ') };
}

export function resultadoALead(resultado, { rubro, consulta }) {
  if (!esPerfil(resultado.link)) return null;
  const titulo = parsearTitulo(resultado.title);
  let { cargo, empresa } = titulo;
  const { nombre: nombreCompleto, adivinado } = resolverNombre(titulo.nombre, resultado.link);
  if (!nombreCompleto) return null;
  // Si el título no traía nombre, lo que parecía nombre era el cargo: "Dueño en Grupo Ciudad Inmobiliaria"
  if (adivinado && !cargo) {
    const t = parsearTitulo(`x - ${titulo.nombre}`);
    cargo = t.cargo;
    empresa = empresa || t.empresa;
  }
  const { ubicacion, experiencia } = parsearSnippet(resultado.snippet);
  const { nombre, apellido } = separarNombre(nombreCompleto);
  empresa = empresa || experiencia;
  return {
    linkedin_url: normalizarUrl(resultado.link),
    nombre,
    apellido,
    cargo,
    empresa,
    ubicacion,
    rubro,
    // Para revisar a mano: nombre deducido del link o empresa desconocida
    revisar: adivinado || !empresa ? 'si' : '',
    titulo: limpiar(resultado.title),
    snippet: limpiar(resultado.snippet),
    consulta,
  };
}
