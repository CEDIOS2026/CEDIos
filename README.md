# Cedi OS — guía de despliegue (sin necesitar programadores)

Esta carpeta es una app completa (React + Supabase). Ya no depende de Claude:
tiene su propia base de datos real, con contraseñas cifradas y permisos
aplicados directamente en el servidor (no solo en la pantalla).

Sigue estos pasos en orden. Ninguno requiere escribir código ni usar la
terminal — todo es clicks y copiar/pegar.

---

## Paso 1 — Crear el proyecto en Supabase (la base de datos)

1. Ve a **supabase.com** → **Start your project** → crea una cuenta gratis.
2. **New project** → ponle un nombre (ej. "cedi-os") y una contraseña de base
   de datos (guárdala, no la necesitarás seguido). Elige la región más cercana.
3. Espera 1-2 minutos a que se aprovisione.
4. En el menú izquierdo entra a **Authentication → Providers** y confirma que
   "Email" esté habilitado (lo está por defecto).
5. En **Authentication → Settings**, si quieres que la gente pueda entrar de
   inmediato sin confirmar su correo, desactiva **"Enable email confirmations"**.
   (Para un piloto interno es lo más simple; lo puedes reactivar después.)

## Paso 2 — Crear las tablas

1. En el menú izquierdo, abre **SQL Editor** → **New query**.
2. Abre el archivo `schema.sql` (está en esta misma carpeta), copia **todo**
   su contenido, pégalo ahí, y da clic en **Run**.
3. Esto crea las tablas, la seguridad por fila, y dos áreas de ejemplo
   (Ventas y Finanzas) con sus KPI y OKR — igual que el piloto que ya viste.

## Paso 3 — Crear a las personas reales

1. Ve a **Authentication → Users → Add user**.
2. Crea al **administrador**: su correo real y una contraseña temporal
   (pídele que la cambie la primera vez que entre, desde su correo, con
   "¿Olvidaste tu contraseña?" — Supabase ya incluye eso).
3. Repite para **Ventas** y **Finanzas** (o para quien vaya a usar el sistema).
4. Cada persona que crees aquí obtiene automáticamente un perfil dentro de la
   app (con rol "Usuario" por defecto). Falta un paso para el administrador:

5. Regresa a **SQL Editor** y corre esto, cambiando el usuario por el que
   corresponda (es el correo, sin el "@dominio.com"):

   ```sql
   update profiles set role = 'admin' where username = 'nombre-de-tu-admin';
   ```

   Ejemplo: si el correo del administrador es `admin@cedi.mx`, sería:
   ```sql
   update profiles set role = 'admin' where username = 'admin';
   ```

Con esto, esa persona ya puede entrar a la app y usar el panel de
Administración para completar el perfil de todos los demás (área, puesto,
jefe directo, funciones y permisos) — igual que en el piloto.

## Paso 4 — Obtener las dos claves que necesita la app

1. En Supabase, ve a **Settings → API**.
2. Copia el **Project URL** y la **anon public key**. Las vas a necesitar en
   el siguiente paso.

## Paso 5 — Subir el proyecto a GitHub (sin usar git)

1. Crea una cuenta gratis en **github.com** si no tienes una.
2. **New repository** → dale un nombre (ej. "cedi-os") → **Create repository**.
3. En la página del repo vacío, busca el enlace **"uploading an existing file"**
   y arrastra ahí **todos los archivos y carpetas de esta carpeta** (incluida
   la carpeta `src`). GitHub te deja hacerlo arrastrando desde tu explorador
   de archivos, sin instalar nada.
4. Confirma el commit ("Add files") con el botón verde.

## Paso 6 — Desplegar en Vercel

1. Ve a **vercel.com** → crea una cuenta gratis (puedes entrar directo con tu
   cuenta de GitHub).
2. **Add New… → Project** → selecciona el repositorio que acabas de subir.
3. Vercel detecta automáticamente que es un proyecto Vite/React — no cambies
   nada de esa configuración.
4. Antes de darle a "Deploy", abre **Environment Variables** y agrega dos:
   - `VITE_SUPABASE_URL` → pega el Project URL del Paso 4.
   - `VITE_SUPABASE_ANON_KEY` → pega la anon public key del Paso 4.
5. Dale a **Deploy**. En 1-2 minutos tendrás una URL como
   `https://cedi-os.vercel.app` — esa es tu app, ya real, ya en línea.

## Paso 7 — Probar

1. Abre la URL que te dio Vercel.
2. Entra con el correo y contraseña del administrador.
3. Ve a **Administración** y completa el perfil (área, puesto, jefe,
   funciones, permisos) de Ventas y Finanzas — y de cualquier persona nueva
   que agregues después desde Supabase.

---

## Para agregar a alguien nuevo más adelante

1. Supabase → **Authentication → Users → Add user** (correo + contraseña).
2. Entra a la app como administrador → **Administración** → busca a esa
   persona en la lista (ya aparece automáticamente) → **Editar** → completa
   sus datos y permisos.

## Para quitarle el acceso a alguien

Bórralo desde **Authentication → Users** en Supabase (esto borra también su
perfil y libera su lugar). No hay botón de borrar dentro de la app a propósito:
así solo alguien con acceso al panel de Supabase (idealmente el mismo
administrador) puede dar de baja cuentas.

## Costos

Tanto Supabase como Vercel tienen una capa gratuita que sobra por mucho para
un equipo de este tamaño. Si esto crece a cientos de usuarios o mucho tráfico,
en algún momento tocaría pasar a un plan de pago (unos cuantos dólares al mes),
pero no es algo de lo que preocuparse ahora.

## Si algo falla

- **"Correo o contraseña incorrectos"**: revisa que el usuario exista en
  Authentication → Users y que no esté pendiente de confirmar su correo
  (ver Paso 1.5).
- **La pantalla de login no cambia después de entrar**: revisa en Vercel que
  las dos variables de entorno estén bien copiadas (sin espacios de más).
- **No aparece nadie en Administración salvo el admin**: confirma que sí
  creaste a los demás usuarios desde Authentication → Users en Supabase.
