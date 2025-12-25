/**
 * API para obtener estado de conexión Google y desvincular
 */

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/supabase-auth'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getGoogleAccountInfo } from '@/lib/get-drive-token'
import { canModifyResources } from '@/lib/resource-owner'

// GET - Obtener estado de conexión
export async function GET() {
    try {
        const user = await getCurrentUser()
        if (!user) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
        }

        const info = await getGoogleAccountInfo(user.id)

        return NextResponse.json({
            connected: info?.connected || false,
            email: info?.email || null,
            connectedAt: info?.connectedAt || null,
            isOwnAccount: info?.isOwnAccount || false,
            canModify: canModifyResources(user as any)
        })

    } catch (error) {
        console.error('Error obteniendo estado Google:', error)
        return NextResponse.json({ error: 'Error interno' }, { status: 500 })
    }
}

// DELETE - Desvincular cuenta Google
export async function DELETE() {
    try {
        const user = await getCurrentUser()
        if (!user) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
        }

        // Solo admin puede desvincular
        if (!canModifyResources(user as any)) {
            return NextResponse.json({
                error: 'Solo administradores pueden desvincular Google Drive'
            }, { status: 403 })
        }

        // Eliminar tokens
        const { error } = await supabaseAdmin
            .from('users')
            .update({
                google_refresh_token: null,
                google_email: null,
                google_connected_at: null
            })
            .eq('id', user.id)

        if (error) {
            console.error('Error desvinculando Google:', error)
            return NextResponse.json({ error: 'Error al desvincular' }, { status: 500 })
        }

        console.log(`✅ Google Drive desvinculado para usuario ${user.id}`)

        return NextResponse.json({ success: true })

    } catch (error) {
        console.error('Error desvinculando Google:', error)
        return NextResponse.json({ error: 'Error interno' }, { status: 500 })
    }
}
