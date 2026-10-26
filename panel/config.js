// Panel online (Vercel). La clave "anon" es pública por diseño: lo que protege los datos son los permisos
// de Supabase (supabase/esquema.sql), que solo dejan ver los leads a los emails de la tabla "acceso".
// Nunca poner acá la clave service_role.
window.PANEL_CONFIG = {
  supabaseUrl: 'https://ahgcxyzvdoemzkkmiwxf.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFoZ2N4eXp2ZG9lbXpra21pd3hmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMwNDQzMDUsImV4cCI6MjEwODYyMDMwNX0.cOptJS5ocYD6q8STMehVNvi1Gx3Qcgo1b-ya_kSkVHw',
  limiteDiario: 10,
};
