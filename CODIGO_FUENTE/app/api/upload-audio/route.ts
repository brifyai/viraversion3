import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/supabase-auth'
import { getResourceOwnerId, canModifyResources } from '@/lib/resource-owner'
import { getDriveRefreshToken } from '@/lib/get-drive-token'
import { uploadFileToDrive } from '@/lib/google-drive'

const supabase = supabaseAdmin

// Mapear tipo a nombre de subcarpeta en Drive
const tipoToFolder: Record<string, 'cortinas' | 'musica' | 'efectos' | 'jingles' | 'intros' | 'outros' | 'voces' | 'publicidad'> = {
  'cortina': 'cortinas',
  'musica': 'musica',
  'efecto': 'efectos',
  'jingle': 'jingles',
  'intro': 'intros',
  'outro': 'outros',
  'voz': 'voces',
  'publicidad': 'publicidad'  // Publicidad tiene su propia carpeta
}

export async function POST(request: NextRequest) {
  try {
    // Verificar autenticación y permisos
    const currentUser = await getCurrentUser()
    if (!currentUser) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // Solo ADMIN puede subir archivos
    if (!canModifyResources(currentUser)) {
      return NextResponse.json({
        error: 'No tienes permisos para subir archivos. Contacta a tu administrador.'
      }, { status: 403 })
    }

    // ============================================================
    // VERIFICAR QUE TIENE GOOGLE DRIVE VINCULADO
    // ============================================================
    const driveRefreshToken = await getDriveRefreshToken(currentUser.id)

    if (!driveRefreshToken) {
      return NextResponse.json({
        error: 'Google Drive no vinculado',
        message: 'Debes vincular tu cuenta de Google Drive antes de subir archivos. Ve a Integraciones para conectar tu cuenta.',
        code: 'DRIVE_NOT_LINKED'
      }, { status: 400 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File
    const nombre = (formData.get('nombre') as string) || (formData.get('type') as string)
    const tipo = (formData.get('tipo') as string) || 'musica'
    const descripcion = (formData.get('descripcion') as string) || ''

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Validar tipo de archivo
    if (!file.type.startsWith('audio/')) {
      return NextResponse.json({
        error: 'Tipo de archivo no permitido. Solo se aceptan archivos de audio.'
      }, { status: 400 })
    }

    // Validar tamaño del archivo (máximo 50MB)
    const maxSize = 50 * 1024 * 1024 // 50MB
    if (file.size > maxSize) {
      return NextResponse.json({
        error: 'Archivo demasiado grande. Máximo 50MB permitido.'
      }, { status: 400 })
    }

    // Obtener el owner_id correcto
    const resourceOwnerId = getResourceOwnerId(currentUser as any)

    // Leer el archivo
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // Generar nombre único para el archivo
    const timestamp = Date.now()
    const extension = file.name.split('.').pop() || 'mp3'
    const sanitizedName = (nombre || file.name.replace(/\.[^/.]+$/, ''))
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .substring(0, 100)
    const uniqueFileName = `${timestamp}_${sanitizedName}.${extension}`

    // ============================================================
    // SUBIR A GOOGLE DRIVE
    // ============================================================
    console.log(`☁️ Subiendo a Google Drive: ${uniqueFileName}`)

    const folderType = tipoToFolder[tipo] || 'cortinas'

    let driveResult
    try {
      driveResult = await uploadFileToDrive(
        driveRefreshToken,
        buffer,
        uniqueFileName,
        file.type,
        folderType
      )
    } catch (driveError: any) {
      console.error('❌ Error subiendo a Drive:', driveError)
      return NextResponse.json({
        error: 'Error al subir archivo a Google Drive',
        message: driveError.message || 'Intenta de nuevo o verifica tu conexión con Google Drive',
        code: 'DRIVE_UPLOAD_ERROR'
      }, { status: 500 })
    }

    console.log(`✅ Subido a Drive: ${driveResult.fileId}`)

    // Calcular duración aproximada (por tamaño, ~128kbps)
    const fileSizeKB = buffer.length / 1024
    const estimatedDurationSec = Math.round((fileSizeKB * 8) / 128)
    const durationMinutes = Math.floor(estimatedDurationSec / 60)
    const durationSeconds = estimatedDurationSec % 60
    const duracionStr = `${durationMinutes}:${durationSeconds.toString().padStart(2, '0')}`

    // Guardar registro en la base de datos
    const { data: insertData, error: insertError } = await supabase
      .from('biblioteca_audio')
      .insert([{
        nombre: nombre || file.name.replace(/\.[^/.]+$/, ''),
        audio: driveResult.directLink,
        tipo: tipo,
        descripcion: descripcion,
        duracion: duracionStr,
        duration_seconds: estimatedDurationSec,
        user_id: resourceOwnerId,
        drive_file_id: driveResult.fileId,
        is_active: true
      }])
      .select()

    if (insertError) {
      console.error('Error al insertar en BD:', insertError)
      return NextResponse.json({ error: 'Error al guardar en base de datos' }, { status: 500 })
    }

    console.log(`☁️ Audio subido a Drive: ${uniqueFileName} (${tipo})`)

    return NextResponse.json({
      success: true,
      message: 'Archivo subido exitosamente a Google Drive',
      data: insertData[0],
      audioUrl: driveResult.directLink,
      fileName: uniqueFileName,
      originalName: file.name,
      size: file.size,
      type: file.type,
      storageType: 'drive',
      driveFileId: driveResult.fileId,
      uploadedAt: new Date().toISOString()
    })

  } catch (error) {
    console.error('Error en upload-audio:', error)
    return NextResponse.json({
      error: 'Error interno del servidor al subir el audio',
      details: error instanceof Error ? error.message : 'Error desconocido'
    }, { status: 500 })
  }
}
