/**
 * Google OAuth - Callback después de autorización
 */

import { NextRequest, NextResponse } from 'next/server'
import { getTokensFromCode } from '@/lib/google-drive'
import { getCurrentUser } from '@/lib/supabase-auth'
import { supabaseAdmin } from '@/lib/supabase-server'
import { google } from 'googleapis'

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams
        const code = searchParams.get('code')
        const error = searchParams.get('error')
        const state = searchParams.get('state')  // User ID pasado en el state

        // Si hay error de Google
        if (error) {
            console.error('Error de Google OAuth:', error)
            return NextResponse.redirect(
                new URL('/integraciones?error=google_denied', request.url)
            )
        }

        if (!code) {
            return NextResponse.redirect(
                new URL('/integraciones?error=no_code', request.url)
            )
        }

        // Verificar usuario autenticado
        const user = await getCurrentUser()
        if (!user) {
            return NextResponse.redirect(new URL('/auth/signin', request.url))
        }

        // Verificar que el state coincide con el usuario actual (seguridad)
        if (state && state !== user.id) {
            console.warn('State mismatch en OAuth callback')
            // Permitir de todas formas pero loguear
        }

        // Intercambiar código por tokens
        const tokens = await getTokensFromCode(code)

        if (!tokens.refresh_token) {
            console.error('No se obtuvo refresh_token')
            return NextResponse.redirect(
                new URL('/integraciones?error=no_refresh_token', request.url)
            )
        }

        // Obtener email de la cuenta Google
        let googleEmail = null
        try {
            const oauth2Client = new google.auth.OAuth2()
            oauth2Client.setCredentials({ access_token: tokens.access_token })
            const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
            const { data } = await oauth2.userinfo.get()
            googleEmail = data.email
        } catch (e) {
            console.error('Error obteniendo email de Google:', e)
        }

        // Guardar tokens en la base de datos
        const { error: updateError } = await supabaseAdmin
            .from('users')
            .update({
                google_refresh_token: tokens.refresh_token,
                google_email: googleEmail,
                google_connected_at: new Date().toISOString()
            })
            .eq('id', user.id)

        if (updateError) {
            console.error('Error guardando tokens:', updateError)
            return NextResponse.redirect(
                new URL('/integraciones?error=save_failed', request.url)
            )
        }

        console.log(`✅ Google Drive vinculado para usuario ${user.id} (${googleEmail})`)

        // Redirigir con éxito
        return NextResponse.redirect(
            new URL('/integraciones?success=connected', request.url)
        )

    } catch (error) {
        console.error('Error en OAuth callback:', error)
        return NextResponse.redirect(
            new URL('/integraciones?error=unknown', request.url)
        )
    }
}
