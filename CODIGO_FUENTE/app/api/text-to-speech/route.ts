import { NextRequest, NextResponse } from 'next/server'
import { TTSProviderFactory, GOOGLE_CLOUD_VOICES } from '@/lib/tts-providers'

// Síntesis de voz usando Google Cloud TTS
interface TTSRequest {
  text: string
  voice?: string
  speed?: number
  pitch?: number
  format?: 'mp3' | 'wav'
  isHighlighted?: boolean
}

export async function POST(request: NextRequest) {
  try {
    const requestData: TTSRequest = await request.json()
    const { text, format = 'mp3', voice } = requestData

    // Validaciones básicas
    if (!text || text.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Texto requerido para síntesis' },
        { status: 400 }
      )
    }

    if (text.length > 4000) {
      return NextResponse.json(
        { success: false, error: 'Texto demasiado largo (máximo 4000 caracteres)' },
        { status: 400 }
      )
    }

    console.log(`🎙️ Iniciando síntesis de voz: ${text.length} caracteres`)
    const startTime = Date.now()

    // Usar Google Cloud TTS
    const provider = TTSProviderFactory.getProvider()
    console.log(`🔄 Usando proveedor: ${provider.name}`)

    const result = await provider.synthesize(text, {
      voiceId: voice || 'es-US-Neural2-B',
      speed: requestData.speed,
      pitch: requestData.pitch,
      isHighlighted: requestData.isHighlighted
    })

    if (!result.success) {
      throw new Error(`Error en síntesis con ${provider.name}`)
    }

    const processingTime = Date.now() - startTime
    console.log(`✅ Audio generado exitosamente con ${provider.name}: ${processingTime}ms`)

    // Convertir ArrayBuffer a Base64 para respuesta
    const audioBase64 = Buffer.from(result.audioData as ArrayBuffer).toString('base64')

    return NextResponse.json({
      success: true,
      provider: result.provider,
      voice: result.voice,
      duration: result.duration,
      audioBase64: audioBase64,
      format: format,
      metadata: {
        textLength: text.length,
        processingTime,
        estimatedCost: result.cost,
        provider: provider.name,
        synthesizedAt: new Date().toISOString()
      }
    })

  } catch (error) {
    console.error('TTS API Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Error desconocido en síntesis de voz',
        details: process.env.NODE_ENV === 'development' ? error : undefined
      },
      { status: 500 }
    )
  }
}

// Endpoint para obtener proveedores disponibles
export async function GET() {
  try {
    const providers = TTSProviderFactory.getAvailableProviders()
    const voices = Object.values(GOOGLE_CLOUD_VOICES)

    return NextResponse.json({
      success: true,
      providers: providers.map(p => ({
        name: p.name,
        configured: true,
        estimatedCost: p.estimateCost(1000)
      })),
      voices: voices.map(v => ({
        id: v.id,
        name: v.name,
        gender: v.ssmlGender,
        wpm: v.wpm
      })),
      totalProviders: providers.length,
      notes: {
        provider: 'Google Cloud TTS Neural2',
        pricing: '$16 por millón de caracteres'
      }
    })
  } catch (error) {
    console.error('Error getting TTS providers info:', error)
    return NextResponse.json(
      { success: false, error: 'Error obteniendo información de proveedores' },
      { status: 500 }
    )
  }
}
