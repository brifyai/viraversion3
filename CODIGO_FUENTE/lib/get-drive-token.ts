/**
 * Google Drive Token Helper
 * Obtiene el refresh token según jerarquía admin/user
 */

import { supabaseAdmin } from '@/lib/supabase-server'

/**
 * Obtiene el refresh token de Google Drive para un usuario
 * Si el usuario es un sub-usuario (role=user), obtiene el token de su admin
 */
export async function getDriveRefreshToken(userId: string): Promise<string | null> {
    const supabase = supabaseAdmin

    // Obtener datos del usuario
    const { data: user, error } = await supabase
        .from('users')
        .select('id, role, admin_id, google_refresh_token')
        .eq('id', userId)
        .single()

    if (error || !user) {
        console.error('Error obteniendo usuario para Drive token:', error)
        return null
    }

    // Si el usuario tiene su propio token, usarlo
    if (user.google_refresh_token) {
        return user.google_refresh_token
    }

    // Si es un sub-usuario, buscar el token del admin
    if (user.role === 'user' && user.admin_id) {
        const { data: admin, error: adminError } = await supabase
            .from('users')
            .select('google_refresh_token')
            .eq('id', user.admin_id)
            .single()

        if (adminError || !admin) {
            console.error('Error obteniendo admin para Drive token:', adminError)
            return null
        }

        return admin.google_refresh_token || null
    }

    return null
}

/**
 * Verifica si un usuario tiene acceso a Google Drive (propio o del admin)
 */
export async function hasDriveAccess(userId: string): Promise<boolean> {
    const token = await getDriveRefreshToken(userId)
    return token !== null
}

/**
 * Obtiene información de la cuenta Google vinculada
 */
export async function getGoogleAccountInfo(userId: string): Promise<{
    connected: boolean
    email: string | null
    connectedAt: string | null
    isOwnAccount: boolean
} | null> {
    const supabase = supabaseAdmin

    // Obtener datos del usuario
    const { data: user, error } = await supabase
        .from('users')
        .select('id, role, admin_id, google_refresh_token, google_email, google_connected_at')
        .eq('id', userId)
        .single()

    if (error || !user) {
        return null
    }

    // Si el usuario tiene su propia cuenta vinculada
    if (user.google_refresh_token) {
        return {
            connected: true,
            email: user.google_email,
            connectedAt: user.google_connected_at,
            isOwnAccount: true
        }
    }

    // Si es sub-usuario, buscar info del admin
    if (user.role === 'user' && user.admin_id) {
        const { data: admin } = await supabase
            .from('users')
            .select('google_refresh_token, google_email, google_connected_at')
            .eq('id', user.admin_id)
            .single()

        if (admin?.google_refresh_token) {
            return {
                connected: true,
                email: admin.google_email,
                connectedAt: admin.google_connected_at,
                isOwnAccount: false  // Es del admin, no propia
            }
        }
    }

    return {
        connected: false,
        email: null,
        connectedAt: null,
        isOwnAccount: false
    }
}
