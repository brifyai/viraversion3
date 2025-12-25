import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/supabase-auth'
import { getResourceOwnerId } from '@/lib/resource-owner'

// GET - Listar audios del usuario/admin
export async function GET() {
    try {
        const user = await getCurrentUser()
        if (!user) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
        }

        const ownerId = getResourceOwnerId(user as any)

        const { data, error } = await supabaseAdmin
            .from('biblioteca_audio')
            .select('*')
            .eq('user_id', ownerId)
            .eq('is_active', true)
            .order('created_at', { ascending: false })

        if (error) {
            console.error('Error fetching audios:', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json(data || [])

    } catch (error) {
        console.error('Error in GET /api/biblioteca-audio:', error)
        return NextResponse.json({ error: 'Error interno' }, { status: 500 })
    }
}
