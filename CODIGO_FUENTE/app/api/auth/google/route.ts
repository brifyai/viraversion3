/**
 * Google OAuth - Iniciar flujo de autorización
 */

import { NextRequest, NextResponse } from 'next/server'
import { getGoogleAuthUrl } from '@/lib/google-drive'
import { getCurrentUser } from '@/lib/supabase-auth'

export async function GET(request: NextRequest) {
    try {
        // Verificar que el usuario está autenticado
        const user = await getCurrentUser()
        if (!user) {
            return NextResponse.redirect(new URL('/auth/signin', request.url))
        }

        // Solo admin puede vincular Google Drive
        if (user.role !== 'admin' && user.role !== 'super_admin') {
            return NextResponse.json({
                error: 'Solo administradores pueden vincular Google Drive'
            }, { status: 403 })
        }

        // Generar URL de autorización con el user ID como state
        const authUrl = getGoogleAuthUrl(user.id)

        // Redirigir a Google
        return NextResponse.redirect(authUrl)

    } catch (error) {
        console.error('Error iniciando OAuth:', error)
        return NextResponse.json({
            error: 'Error al iniciar autorización de Google'
        }, { status: 500 })
    }
}
