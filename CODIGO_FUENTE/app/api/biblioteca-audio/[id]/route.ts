import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/supabase-auth'
import { canModifyResources, getResourceOwnerId } from '@/lib/resource-owner'
import { deleteFileFromDrive } from '@/lib/google-drive'
import { getDriveRefreshToken } from '@/lib/get-drive-token'

// DELETE - Eliminar audio
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

        const audioId = params.id
        const ownerId = getResourceOwnerId(user as any)

        // Obtener el audio para verificar ownership y drive_file_id
        const { data: audio, error: fetchError } = await supabaseAdmin
            .from('biblioteca_audio')
            .select('*')
            .eq('id', audioId)
            .eq('user_id', ownerId)
            .single()

        if (fetchError || !audio) {
            return NextResponse.json({ error: 'Audio no encontrado' }, { status: 404 })
        }

        // Si tiene archivo en Drive, intentar eliminarlo
        if (audio.drive_file_id) {
            try {
                const refreshToken = await getDriveRefreshToken(user.id)
                if (refreshToken) {
                    await deleteFileFromDrive(refreshToken, audio.drive_file_id)
                    console.log(`🗑️ Archivo eliminado de Drive: ${audio.drive_file_id}`)
                }
            } catch (driveError) {
                console.error('Error eliminando de Drive:', driveError)
                // Continuar con eliminación de BD de todas formas
            }
        }

        // Marcar como inactivo en BD (soft delete)
        const { error: deleteError } = await supabaseAdmin
            .from('biblioteca_audio')
            .update({ is_active: false })
            .eq('id', audioId)

        if (deleteError) {
            return NextResponse.json({ error: 'Error al eliminar' }, { status: 500 })
        }

        return NextResponse.json({ success: true })

    } catch (error) {
        console.error('Error in DELETE /api/biblioteca-audio/[id]:', error)
        return NextResponse.json({ error: 'Error interno' }, { status: 500 })
    }
}
