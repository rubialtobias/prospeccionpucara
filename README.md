# Prospección Pucará

Busca dueños de inmobiliarias, ecommerce, gimnasios y restaurantes de Argentina en LinkedIn (a través de Google, sin entrar a LinkedIn), los guarda en una planilla y, en las próximas etapas, les manda emails personalizados con seguimientos.

## Etapas

1. **Búsqueda** (lista): `src/buscar.mjs`
2. **Enriquecimiento:** web de la empresa, email y un problema real de su web (próximo paso)
3. **Redacción:** email personalizado por lead
4. **Envío:** API de Gmail con límite diario, seguimientos y freno cuando alguien responde
5. **Planilla y panel:** Google Sheets + tablero con el embudo

## Puesta en marcha

### 1. Clave de Serper (gratis, 2.500 búsquedas)

1. Entrá a https://serper.dev y creá una cuenta.
2. En el panel, copiá tu **API Key**.
3. Copiá `.env.example` como `.env` y pegá la clave en `SERPER_API_KEY=`.

### 2. Probar la búsqueda

```bash
npm run buscar:prueba -- --rubro inmobiliarias
```

Muestra las consultas que se van a hacer, sin gastar créditos.

```bash
npm run buscar -- --rubro inmobiliarias --max-busquedas 10
```

Hace 10 búsquedas reales (de 2.500 gratis) y guarda los resultados en `data/leads.csv`, que se puede abrir con Excel o importar a Google Sheets. Si lo volvés a correr, no repite búsquedas ni duplica leads.

### 3. Preparar Gmail (antes de enviar)

Cuenta de envío: `tobias.pucaratech@gmail.com`, separada de la cuenta personal para que un bloqueo no afecte nada más.

- **Nombre visible:** Gmail → Configuración → Cuentas e importación → "Enviar como" → editar → `Tobías | Pucará Technologies`.
- **Firma corta:** nombre, "Pucará Technologies", la web y el WhatsApp.
- **Volumen:** arrancamos con 10 emails por día y subimos de a poco hasta 30–40. Nunca más de eso desde Gmail gratis.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run buscar -- --rubro inmobiliarias --max-busquedas 10` | Busca leads nuevos en LinkedIn vía Google |
| `node src/calificar.mjs exportar` / `importar` | Claude limpia y califica los leads nuevos |
| `npm run enriquecer` | Busca web, email y WhatsApp de los que encajan |
| `npm run panel` | Panel local en http://localhost:4321 |
| `npm run sincronizar` | Sube los leads al panel online y trae lo que se cambió ahí |

## Panel online (Supabase + Vercel)

Solo pueden entrar los emails de la tabla `acceso` en `supabase/esquema.sql`.

1. **Supabase:** crear el proyecto, pegar `supabase/esquema.sql` en el SQL Editor y correrlo.
2. **Supabase → Authentication → Sign In / Providers:** desactivar "Allow new users to sign up".
3. **Supabase → Authentication → Users → Invite user:** invitar a cada email de la tabla `acceso`.
4. **`.env`:** completar `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API).
5. **`panel/config.js`:** copiar `panel/config.example.js` y poner la URL y la clave `anon`.
6. **Vercel:** importar el repo, con Root Directory `panel` y sin comando de build.
7. **Supabase → Authentication → URL Configuration:** poner la dirección de Vercel como Site URL.
8. `npm run sincronizar` para subir los leads.

Los datos (`data/`) y el `.env` nunca se suben al repo.

## Ajustar las búsquedas

Todo está en `config/busquedas.json`: cargos, ciudades y palabras por rubro. Cada combinación de palabra × ciudad es una consulta, y cada página de resultados cuesta una búsqueda.
