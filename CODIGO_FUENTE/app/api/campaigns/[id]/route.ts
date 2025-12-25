import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/supabase-auth'
import { canModifyResources, getResourceOwnerId } from '@/lib/resource-owner'

// DELETE - Eliminar campaña
export async function DELETE(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const user = await getCurrentUser()
        if (!user) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
        }

        if (!canModifyResources(user as any)) {
            return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
        }

        const campaignId = params.id
        const ownerId = getResourceOwnerId(user as any)

        // Verificar que la campaña pertenece al usuario
        const { data: campaign, error: fetchError } = await supabaseAdmin
            .from('campanas_publicitarias')
            .select('*')
            .eq('id', campaignId)
            .eq('user_id', ownerId)
            .single()

        if (fetchError || !campaign) {
            return NextResponse.json({ error: 'Campaña no encontrada' }, { status: 404 })
        }

        // Eliminar campaña de la BD (hard delete)
        const { error: deleteError } = await supabaseAdmin
            .from('campanas_publicitarias')
            .delete()
            .eq('id', campaignId)

        if (deleteError) {
            console.error('Error eliminando campaña:', deleteError)
            return NextResponse.json({ error: 'Error al eliminar' }, { status: 500 })
        }

        console.log(`🗑️ Campaña eliminada: ${campaign.nombre}`)
        return NextResponse.json({ success: true })

    } catch (error) {
        console.error('Error in DELETE /api/campaigns/[id]:', error)
        return NextResponse.json({ error: 'Error interno' }, { status: 500 })
    }
}
