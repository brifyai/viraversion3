# Script de Migración de Seguridad - Auth

## 1. Generar NEXTAUTH_SECRET

Ejecuta este comando en PowerShell:
```powershell
# Generar secret aleatorio de 32 bytes en base64
-join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | ForEach-Object {[char]$_})
```

O usa este valor pre-generado seguro:
```
NEXTAUTH_SECRET=vK9mP2xR8nQ4wL7jH3fT6yU1sA5bN0cD
```

Agrégalo a tu archivo `.env.local`:
```bash
# En CODIGO_FUENTE/.env.local
NEXTAUTH_SECRET=vK9mP2xR8nQ4wL7jH3fT6yU1sA5bN0cD
NEXTAUTH_URL=http://localhost:3000
```

## 2. Migrar Contraseñas a Bcrypt

Ejecuta este SQL en Supabase SQL Editor:

```sql
-- Verificar contraseñas sin hashear
SELECT id, email, 
       CASE 
         WHEN password IS NOT NULL AND NOT password LIKE '$2%' THEN 'Plain Text'
         WHEN password_hash IS NOT NULL THEN 'Hashed'
         ELSE 'No Password'
       END as password_status
FROM users;

-- Migrar contraseñas en texto plano a bcrypt
-- NOTA: Esto requiere la extensión pgcrypto
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Migrar contraseñas
UPDATE users 
SET password_hash = crypt(password, gen_salt('bf', 10)),
    password = NULL
WHERE password IS NOT NULL 
  AND password_hash IS NULL
  AND NOT password LIKE '$2%';

-- Verificar migración
SELECT id, email, 
       password IS NULL as password_cleared,
       password_hash IS NOT NULL as has_hash
FROM users;
```

## 3. Actualizar lib/auth.ts

Los cambios ya están implementados en el código.

## 4. Verificar Configuración

```powershell
# Verificar que .env.local tiene el secret
Get-Content .env.local | Select-String "NEXTAUTH_SECRET"

# Reiniciar servidor
# Ctrl+C en la terminal de npm run dev
# Luego: npm run dev
```

## 5. Probar Login

```powershell
# Test de login (requiere usuario con contraseña hasheada)
$body = @{
    email = "admin@vira.app"
    password = "tu-password"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3000/api/auth/signin" `
  -Method POST `
  -ContentType "application/json" `
  -Body $body
```

## Checklist de Seguridad

- [ ] NEXTAUTH_SECRET generado y agregado a .env.local
- [ ] Contraseñas migradas a bcrypt en Supabase
- [ ] lib/auth.ts actualizado (eliminar fallback de secret)
- [ ] Servidor reiniciado
- [ ] Login probado y funcionando
- [ ] Contraseñas en texto plano eliminadas de DB

## Notas Importantes

⚠️ **IMPORTANTE:** Después de migrar las contraseñas, los usuarios NO podrán hacer login con las contraseñas antiguas si no estaban hasheadas correctamente. Asegúrate de tener una forma de resetear contraseñas.

✅ **Recomendación:** Implementar flujo de "Olvidé mi contraseña" antes de migrar en producción.
