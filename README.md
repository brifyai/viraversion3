# VIRA - Sistema de Generación de Noticieros con IA

## Requisitos del Sistema

### Hardware Mínimo
- **RAM**: 16GB (32GB recomendado)
- **GPU**: NVIDIA con 8GB VRAM (para F5-TTS)
- **Almacenamiento**: 20GB libres

### Software Requerido
- **Node.js**: v18+ 
- **Python**: 3.10+
- **FFmpeg**: Instalado y en PATH
- **CUDA**: 11.8+ (para GPU)

---

## Instalación Rápida

### 1. Clonar el Proyecto
```bash
git clone <url-repo> virapp
cd virapp
```

### 2. Configurar Variables de Entorno

Copiar el archivo de ejemplo y completar:
```bash
cd CODIGO_FUENTE
copy .env.example .env.local
```

Editar `.env.local` con tus credenciales (ver sección Variables de Entorno).

### 3. Instalar Frontend (Next.js)
```bash
cd CODIGO_FUENTE
npm install
# o
yarn install
```

### 4. Instalar Backend TTS (Python)
```bash
cd F5_Test
python -m venv venv
.\venv\Scripts\activate  # Windows
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
pip install -r requirements.txt
```

### 5. Configurar Base de Datos

Ejecutar los scripts SQL en Supabase:
1. `vira_schema_definitivo.sql` - Schema principal
2. `DATOS_RADIOS_SQL.sql` - Radios de ejemplo
3. `DATOS_FUENTES_FINAL_SQL.sql` - Fuentes de noticias

---

## Ejecución Local

### Terminal 1: Servidor TTS (Python)
```bash
cd F5_Test
.\venv\Scripts\activate
python app_f5.py
```
El servidor TTS corre en `http://localhost:5000`

### Terminal 2: Frontend (Next.js)
```bash
cd CODIGO_FUENTE
npm run dev
# o
yarn dev
```
La aplicación corre en `http://localhost:3000`

---

## Variables de Entorno (.env.local)

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# TTS Local
TTS_API_URL=http://127.0.0.1:5000

# Scraping (opcional)
SCRAPINGBEE_API_KEY=xxx

# Chutes AI (humanización)
CHUTES_API_KEY=cpk_xxx

# Cron Jobs (producción)
CRON_SECRET=tu-secreto-seguro
```

---

## Estructura del Proyecto

```
virapp/
├── CODIGO_FUENTE/          # Frontend Next.js
│   ├── app/                # Páginas y rutas API
│   ├── components/         # Componentes React
│   ├── lib/                # Utilidades y servicios
│   └── public/             # Assets estáticos
│
├── F5_Test/                # Servidor TTS
│   ├── app_f5.py           # Servidor Flask
│   ├── config.py           # Configuración
│   ├── targets/            # Voces de referencia
│   └── requirements.txt    # Dependencias Python
│
└── vira_schema_definitivo.sql  # Schema de BD
```

---

## Flujo de Uso

1. **Login** → `/auth/signin`
2. **Dashboard** → `/dashboard`
3. **Crear Noticiero** → `/crear-noticiero`
4. **Editar Timeline** → `/timeline-noticiero/[id]`
5. **Finalizar Audio** → Botón "Finalizar"

---

## Solución de Problemas

### Error: "TTS server not available"
- Verificar que `app_f5.py` esté corriendo en puerto 5000
- Verificar que `TTS_API_URL=http://127.0.0.1:5000` en `.env.local`

### Error: "CUDA out of memory"
- Reducir `NFE_STEP` en `F5_Test/config.py` (de 48 a 32)
- Usar GPU con más VRAM

### Error: "No noticias disponibles"
- Ejecutar scraping desde `/super-admin/scraping`
- Verificar que hay fuentes activas en la BD
