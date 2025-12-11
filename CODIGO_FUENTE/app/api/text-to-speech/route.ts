
import { NextRequest, NextResponse } from 'next/server'
import { TTSProviderFactory } from '@/lib/tts-providers'
import { getDownloadUrl } from '@/lib/s3'

// Real síntesis de voz usando múltiples proveedores
interface TTSRequest {
  text: string
  provider?: 'openai' | 'elevenlabs' | 'azure' | 'polly' | 'edge' | 'auto'
  voice?: string
  speed?: number
  format?: 'mp3' | 'wav' | 'ogg'
  // Opciones específicas por proveedor
  stability?: number
  similarityBoost?: number
  rate?: string
  pitch?: string
}

// Función auxiliar para mapear opciones por proveedor
function getProviderOptions(provider: string, request: TTSRequest) {
  switch (provider) {
    case 'elevenlabs':
      return {
        voice: request.voice || 'Adam',
        stability: request.stability || 0.5,
        similarityBoost: request.similarityBoost || 0.8,
        style: 0.0
      }
    case 'azure':
      return {
        voice: request.voice || 'es-CL-CatalinaNeural',
        rate: request.rate || '+0%',
        pitch: request.pitch || '+0Hz'
      }
    case 'openai':
      return {
        voice: request.voice || 'nova',
        model: 'tts-1',
        speed: request.speed || 1.0
      }
    case 'polly':
      return {
        voice: request.voice || 'Conchita',
        engine: 'neural',
        outputFormat: request.format || 'mp3'
      }
    case 'edge':
      return {
        voice: request.voice || 'es-CL-CatalinaNeural',
        rate: request.rate || '+0%',
        pitch: request.pitch || '+0Hz'
      }
    default:
      return {}
  }
}

// Función auxiliar para escribir cabecera WAV
function writeWavHeader(sampleRate: number, numChannels: number, bitsPerSample: number, dataLength: number) {
  const buffer = Buffer.alloc(44);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);
  return buffer;
}

export async function POST(request: NextRequest) {
  try {
    const requestData: TTSRequest = await request.json()
    const { text, provider = 'auto', format = 'mp3', voice } = requestData

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

    // PRIORIDAD 1: Intentar con servidor TTS local (localhost:5000)
    try {
      console.log('🔄 Intentando con servidor TTS local (localhost:5000)...')

      // URL del servidor TTS local
      const TTS_API_URL = process.env.TTS_API_URL || 'http://127.0.0.1:5000'
      console.log(`🔌 TTS_API_URL: ${TTS_API_URL}`)
      console.log(`🗣️ Voice requested: ${voice || 'default'}`)

      let audioBuffer: Buffer;
      let duration = 0;

      // DECISIÓN: Usar /tts o /tts_batch según longitud
      if (text.length > 500) {
        console.log(`📜 Texto largo detectado (${text.length} chars). Usando /tts_batch...`);

        const batchResponse = await fetch(`${TTS_API_URL}/tts_batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: text,
            voice: voice || 'es-mx',
            language: 'es',
            max_chunk_chars: 400
          }),
          signal: AbortSignal.timeout(600000) // 10 min timeout para batch
        });

        if (!batchResponse.ok) {
          throw new Error(`Batch TTS Error: ${batchResponse.statusText}`);
        }

        const batchData = await batchResponse.json();

        // El servidor devuelve stitched_audio_base64 (audio ya unido)
        if (!batchData.success || !batchData.stitched_audio_base64) {
          console.error('❌ Respuesta batch:', JSON.stringify(batchData).slice(0, 200));
          throw new Error('Respuesta inválida de /tts_batch');
        }

        console.log(`✅ Batch completado: ${batchData.duration}s`);
        duration = batchData.duration || 0;

        // Usar el audio ya unido (stitched)
        audioBuffer = Buffer.from(batchData.stitched_audio_base64, 'base64');


      } else {
        // Texto corto: Usar /tts normal
        const localTTSResponse = await fetch(`${TTS_API_URL}/tts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: text,
            voice: voice || 'es-mx',
            format: 'base64'
          }),
          signal: AbortSignal.timeout(300000)
        })

        if (!localTTSResponse.ok) {
          throw new Error(`TTS Error: ${localTTSResponse.statusText}`);
        }

        const contentType = localTTSResponse.headers.get('content-type')

        if (contentType && contentType.includes('application/json')) {
          const data = await localTTSResponse.json()
          if (data.audio_base64) {
            audioBuffer = Buffer.from(data.audio_base64, 'base64')
            duration = data.duration || 0;
          } else {
            throw new Error('Respuesta JSON inválida del servidor TTS local')
          }
        } else {
          const audioBlob = await localTTSResponse.blob()
          audioBuffer = Buffer.from(await audioBlob.arrayBuffer())
          // Estimación si no viene duración
          const words = text.trim().split(/\s+/).length
          duration = Math.max(5, Math.round((words / 150) * 60))
        }
      }

      // Guardar localmente en public/generated-audio/
      const fs = require('fs')
      const path = require('path')

      const audioDir = path.join(process.cwd(), 'public', 'generated-audio')
      if (!fs.existsSync(audioDir)) {
        fs.mkdirSync(audioDir, { recursive: true })
      }

      const timestamp = Date.now()
      // Usar .wav porque ahora siempre aseguramos formato WAV (ya sea directo o construido)
      const fileName = `tts_${timestamp}.wav`
      const filePath = path.join(audioDir, fileName)

      fs.writeFileSync(filePath, audioBuffer)

      const audioUrl = `/generated-audio/${fileName}`
      const processingTime = Date.now() - startTime

      console.log(`✅ Audio generado exitosamente con servidor local: ${processingTime}ms`)
      console.log(`📁 Guardado en: ${filePath}`)

      return NextResponse.json({
        success: true,
        provider: 'local-tts-server',
        voice: voice || 'default',
        duration: duration,
        audioUrl: audioUrl,
        format: 'wav', // Siempre devolvemos WAV ahora
        metadata: {
          textLength: text.length,
          processingTime,
          estimatedCost: 0,
          provider: 'Servidor TTS Local (localhost:5000)',
          configuredProviders: ['Local TTS Server'],
          synthesizedAt: new Date().toISOString()
        }
      })
    } catch (localError) {
      console.warn('⚠️ Servidor TTS local no disponible:', localError instanceof Error ? localError.message : 'Error desconocido')
      console.log('🔄 Intentando con proveedores alternativos...')
    }

    // PRIORIDAD 2: Intentar con proveedores configurados
    const providerToUse = provider === 'auto' ? TTSProviderFactory.getBestProvider() : TTSProviderFactory.getProvider(provider)

    if (!providerToUse) {
      return NextResponse.json(
        {
          success: false,
          error: 'No hay proveedores de TTS disponibles. Asegúrate de que el servidor local esté corriendo en localhost:5000 o configura ElevenLabs/Azure.'
        },
        { status: 503 }
      )
    }

    console.log(`🔄 Usando proveedor: ${providerToUse.name}`)

    // Mapear opciones según el proveedor
    const providerOptions = getProviderOptions(providerToUse.name.toLowerCase(), requestData)

    // Sintetizar voz
    const result = await providerToUse.synthesize(text, providerOptions)

    if (!result.success) {
      throw new Error(`Error en síntesis con ${providerToUse.name}`)
    }

    // Obtener URL de descarga si se subió a S3
    const audioUrl = result.s3Key ? await getDownloadUrl(result.s3Key) : result.audioUrl

    const processingTime = Date.now() - startTime

    console.log(`✅ Audio generado exitosamente con ${providerToUse.name}: ${processingTime}ms`)

    return NextResponse.json({
      success: true,
      provider: result.provider,
      voice: result.voice,
      duration: result.duration,
      audioUrl: audioUrl,
      s3Key: result.s3Key,
      format: format,
      metadata: {
        textLength: text.length,
        processingTime,
        estimatedCost: result.cost,
        provider: providerToUse.name,
        configuredProviders: TTSProviderFactory.getAvailableProviders().map(p => p.name),
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
    const allProviders = TTSProviderFactory.getAllProviders()
    const configuredProviders = TTSProviderFactory.getAvailableProviders()
    const bestProvider = TTSProviderFactory.getBestProvider()

    const providersInfo = allProviders.map(provider => ({
      name: provider.name,
      id: provider.name.toLowerCase().replace(' ', ''),
      configured: provider.isConfigured(),
      estimatedCost: provider.estimateCost(1000), // Costo por 1000 caracteres
      recommended: provider.name === bestProvider.name
    }))

    return NextResponse.json({
      success: true,
      providers: providersInfo,
      totalProviders: allProviders.length,
      configuredProviders: configuredProviders.length,
      bestProvider: bestProvider.name,
      notes: {
        auto: 'Usa "auto" como provider para selección automática del mejor proveedor disponible',
        fallback: 'Edge TTS se usa como fallback gratuito si otros proveedores no están configurados'
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
