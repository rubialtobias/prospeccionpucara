// Pone o cambia la contraseña de un usuario del panel online. Si el usuario no existe, lo crea.
//
//   npm run usuario -- martincoronelconsultor@gmail.com
//
// Pide la contraseña en la terminal sin mostrarla. Correlo en tu propia terminal:
// la contraseña no pasa por ningún chat ni queda guardada en ningún archivo.
// Ojo: el usuario también tiene que estar en la tabla "acceso" (supabase/esquema.sql) para ver los leads.

import { createInterface } from 'node:readline';

function pedirOculto(pregunta) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Reemplaza lo que se escribe por asteriscos
    rl._writeToOutput = (texto) => rl.output.write(texto.startsWith(pregunta) ? texto : '*'.repeat(texto.length));
    rl.question(pregunta, (respuesta) => {
      rl.close();
      process.stdout.write('\n');
      resolve(respuesta);
    });
  });
}

async function main() {
  const email = (process.argv[2] ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Uso: npm run usuario -- email@ejemplo.com');
  const url = process.env.SUPABASE_URL;
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !clave) throw new Error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el archivo .env');

  const api = async (ruta, opciones = {}) => {
    const res = await fetch(`${url}/auth/v1/admin/${ruta}`, {
      ...opciones,
      headers: { apikey: clave, Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
    });
    const cuerpo = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(cuerpo.msg ?? cuerpo.message ?? `Supabase respondió ${res.status}`);
    return cuerpo;
  };

  const password = await pedirOculto(`Contraseña para ${email}: `);
  if (password.length < 8) throw new Error('La contraseña tiene que tener al menos 8 caracteres.');
  if ((await pedirOculto('Repetila: ')) !== password) throw new Error('Las contraseñas no coinciden.');

  const { users } = await api('users?per_page=1000');
  const existente = users.find((u) => u.email?.toLowerCase() === email);
  if (existente) {
    await api(`users/${existente.id}`, { method: 'PUT', body: JSON.stringify({ password, email_confirm: true }) });
    console.log(`Listo: contraseña actualizada para ${email}.`);
  } else {
    await api('users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true }) });
    console.log(`Listo: usuario ${email} creado con esa contraseña.`);
  }
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
