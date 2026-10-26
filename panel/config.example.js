// Copiar como config.js para el panel online (Vercel).
// La clave "anon" es pública por diseño: lo que protege los datos son los permisos de Supabase
// (supabase/esquema.sql), que solo dejan ver los leads a los emails de la tabla "acceso".
// Nunca poner acá la clave service_role.
window.PANEL_CONFIG = {
  supabaseUrl: 'https://TU-PROYECTO.supabase.co',
  supabaseAnonKey: 'TU-CLAVE-ANON',
  limiteDiario: 10,
};
