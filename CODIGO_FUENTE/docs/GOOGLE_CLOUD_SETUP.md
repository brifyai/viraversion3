# Guía: Configurar Google Cloud para VIRA

## Paso 1: Crear Proyecto en Google Cloud

1. Ve a [Google Cloud Console](https://console.cloud.google.com/)
2. Click en el selector de proyectos (arriba a la izquierda)
3. Click **"Nuevo Proyecto"**
4. Nombre: `VIRA Radio` (o el que prefieras)
5. Click **"Crear"**

---

## Paso 2: Habilitar API de Google Drive

1. En el menú lateral, ve a **APIs y Servicios** → **Biblioteca**
2. Busca "Google Drive API"
3. Click en el resultado
4. Click **"Habilitar"**

---

## Paso 3: Configurar Pantalla de Consentimiento OAuth

1. Ve a **APIs y Servicios** → **Pantalla de consentimiento OAuth**
2. Selecciona **"Externo"** (para usuarios de cualquier cuenta Google)
3. Click **"Crear"**
4. Completa:
   - **Nombre de la app**: VIRA Radio
   - **Correo de asistencia**: tu email
   - **Dominio autorizado**: (dejarlo vacío por ahora para desarrollo)
   - **Email del desarrollador**: tu email
5. Click **"Guardar y continuar"**
6. En **Alcances (Scopes)**: click "Agregar o quitar alcances"
   - Busca y selecciona: `../auth/drive.file`
   - Busca y selecciona: `../auth/userinfo.email`
7. Click **"Guardar y continuar"** hasta terminar

---

## Paso 4: Crear Credenciales OAuth 2.0

1. Ve a **APIs y Servicios** → **Credenciales**
2. Click **"+ Crear Credenciales"** → **"ID de cliente OAuth"**
3. Tipo de aplicación: **"Aplicación web"**
4. Nombre: `VIRA Web Client`
5. **URIs de redirección autorizados** - Agregar:
   - `http://localhost:3000/api/auth/google/callback` (desarrollo)
   - `http://localhost:8888/api/auth/google/callback` (Netlify dev)
   - `https://TU-DOMINIO.netlify.app/api/auth/google/callback` (producción)
6. Click **"Crear"**

---

## Paso 5: Copiar Credenciales

Después de crear, verás un popup con:
- **ID de cliente**: `xxxxxx.apps.googleusercontent.com`
- **Secreto de cliente**: `GOCSPX-xxxxxxx`

Copia ambos valores.

---

## Paso 6: Configurar Variables de Entorno

### Para desarrollo local (.env.local)

```env
GOOGLE_CLIENT_ID=tu-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-tu-secreto
GOOGLE_REDIRECT_URI=http://localhost:8888/api/auth/google/callback
```

### Para Netlify (producción)

1. Ve a tu sitio en Netlify → **Site settings** → **Environment variables**
2. Agrega las 3 variables:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI` = `https://tu-sitio.netlify.app/api/auth/google/callback`

---

## Paso 7: Verificar Configuración

Una vez configurado, ejecuta el proyecto y ve a `/integraciones`.
Deberías ver el botón "Vincular Google Drive".

---

## Notas Importantes

> ⚠️ **Modo de prueba**: Mientras la app está en modo de prueba (no verificada), solo usuarios que agregues como "testers" en la pantalla de consentimiento pueden usar OAuth.

> 💡 **Para producción**: Deberás enviar la app a verificación de Google si quieres que cualquier usuario pueda vincular su Drive.

---

## Checklist

- [ ] Proyecto creado en Google Cloud
- [ ] Google Drive API habilitada
- [ ] Pantalla de consentimiento configurada
- [ ] Credenciales OAuth 2.0 creadas
- [ ] URIs de redirección agregados (localhost + Netlify)
- [ ] Variables de entorno en `.env.local`
- [ ] Variables de entorno en Netlify Dashboard
