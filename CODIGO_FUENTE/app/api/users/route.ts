
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { withPermission, createSuccessResponse, createErrorResponse } from '@/lib/auth-middleware'

// Crear cliente de Supabase con Service Role Key para operaciones de backend
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: NextRequest) {
  return withPermission('users:read', async (request, user) => {
    try {
      // Obtener todos los usuarios
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, nombre_completo, email, role, company, is_active, created_at, last_login')
        .order('created_at', { ascending: false })

      if (usersError) {
        console.error('Error obteniendo usuarios:', usersError)
        return createErrorResponse('Error al obtener usuarios', 500)
      }

      return createSuccessResponse({ users: users || [] })

    } catch (error) {
      console.error('Error en GET /api/users:', error)
      return createErrorResponse('Error interno del servidor', 500)
    }
  })(request)
}

export async function POST(request: NextRequest) {
  return withPermission('users:write', async (request, currentUser) => {
    try {
      const { name, email, role, sendInvite } = await request.json()

      // Validaciones básicas
      if (!name || !email || !role) {
        return createErrorResponse('Faltan campos requeridos', 400)
      }

      // Validar rol usando el nuevo sistema
      if (!['admin', 'operator', 'user'].includes(role)) {
        return createErrorResponse('Rol inválido', 400)
      }

      // Verificar si el email ya existe
      const { data: existingUser } = await supabase
        .from('users')
        .select('email')
        .eq('email', email)
        .single()

      if (existingUser) {
        return createErrorResponse('El email ya está en uso', 400)
      }

      // Generar contraseña temporal
      const tempPassword = Math.random().toString(36).slice(-8)

      // Crear nuevo usuario en Supabase Auth
      const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true
      })

      if (authError) {
        console.error('Error creando usuario en Supabase Auth:', authError)
        return createErrorResponse('Error al crear usuario en auth', 500)
      }

      // Crear registro en la tabla users
      const { data: newUser, error: dbError } = await supabase
        .from('users')
        .insert({
          id: authUser.user.id,
          email,
          role,
          company: currentUser.company || 'VIRA',
          nombre_completo: name,
          is_active: true,
          last_login: new Date().toISOString()
        })
        .select()
        .single()

      if (dbError) {
        console.error('Error creando usuario en base de datos:', dbError)
        // Intentar rollback del usuario de auth
        await supabase.auth.admin.deleteUser(authUser.user.id)
        return createErrorResponse('Error al crear usuario', 500)
      }

      // En producción, aquí enviarías un email de invitación
      if (sendInvite) {
        // TODO: Implementar envío real de email
        // await sendInvitationEmail(newUser, tempPassword)
      }

      return createSuccessResponse({
        user: newUser,
        tempPassword: sendInvite ? tempPassword : undefined,
        message: 'Usuario creado exitosamente'
      })

    } catch (error) {
      console.error('Error en POST /api/users:', error)
      return createErrorResponse('Error interno del servidor', 500)
    }
  })(request)
}
