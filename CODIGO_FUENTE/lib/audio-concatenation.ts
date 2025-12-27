/**
 * Audio Concatenation Utility
 * Uses Web Audio API to concatenate audio files in the browser
 */

export interface AudioSegment {
    url: string
    title?: string
    duration?: number
}

export interface ConcatenationProgress {
    stage: 'downloading' | 'processing' | 'encoding' | 'done'
    current: number
    total: number
    message: string
}

/**
 * Download an audio file and return it as an ArrayBuffer
 */
async function downloadAudio(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url)
    if (!response.ok) {
        throw new Error(`Failed to download audio: ${url}`)
    }
    return response.arrayBuffer()
}

/**
 * Concatenate audio buffers into a single buffer
 */
function concatenateBuffers(
    audioContext: AudioContext,
    buffers: AudioBuffer[]
): AudioBuffer {
    // Calculate total length
    const totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0)
    const numberOfChannels = Math.max(...buffers.map(b => b.numberOfChannels))
    const sampleRate = buffers[0].sampleRate

    // Create output buffer
    const outputBuffer = audioContext.createBuffer(
        numberOfChannels,
        totalLength,
        sampleRate
    )

    // Copy data from each buffer
    let offset = 0
    for (const buffer of buffers) {
        for (let channel = 0; channel < numberOfChannels; channel++) {
            const outputData = outputBuffer.getChannelData(channel)
            const inputData = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1))
            outputData.set(inputData, offset)
        }
        offset += buffer.length
    }

    return outputBuffer
}

/**
 * Convert AudioBuffer to WAV format
 */
function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
    const numChannels = buffer.numberOfChannels
    const sampleRate = buffer.sampleRate
    const format = 1 // PCM
    const bitDepth = 16

    const bytesPerSample = bitDepth / 8
    const blockAlign = numChannels * bytesPerSample

    const dataLength = buffer.length * blockAlign
    const wavLength = 44 + dataLength

    const wav = new ArrayBuffer(wavLength)
    const view = new DataView(wav)

    // Write WAV header
    writeString(view, 0, 'RIFF')
    view.setUint32(4, 36 + dataLength, true)
    writeString(view, 8, 'WAVE')
    writeString(view, 12, 'fmt ')
    view.setUint32(16, 16, true) // fmt chunk size
    view.setUint16(20, format, true)
    view.setUint16(22, numChannels, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * blockAlign, true)
    view.setUint16(32, blockAlign, true)
    view.setUint16(34, bitDepth, true)
    writeString(view, 36, 'data')
    view.setUint32(40, dataLength, true)

    // Write audio data
    const offset = 44
    const channels: Float32Array[] = []
    for (let i = 0; i < numChannels; i++) {
        channels.push(buffer.getChannelData(i))
    }

    let pos = offset
    for (let i = 0; i < buffer.length; i++) {
        for (let ch = 0; ch < numChannels; ch++) {
            const sample = Math.max(-1, Math.min(1, channels[ch][i]))
            const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF
            view.setInt16(pos, intSample, true)
            pos += 2
        }
    }

    return wav
}

function writeString(view: DataView, offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i))
    }
}

/**
 * Check if URL is a valid URL (not a local file system path)
 */
function isValidUrl(url: string): boolean {
    // Accept data URLs (Base64 encoded audio)
    if (url.startsWith('data:')) {
        return true
    }
    // Accept remote URLs
    if (url.startsWith('http://') || url.startsWith('https://')) {
        return true
    }
    // Accept local API proxy URLs
    if (url.startsWith('/api/')) {
        return true
    }
    return false
}

/**
 * Main function to concatenate audio segments
 */
export async function concatenateAudioSegments(
    segments: AudioSegment[],
    onProgress?: (progress: ConcatenationProgress) => void
): Promise<Blob> {
    const audioContext = new AudioContext()
    const audioBuffers: AudioBuffer[] = []

    // Filter out local URLs that can't be downloaded in production
    const validSegments = segments.filter(segment => {
        if (!isValidUrl(segment.url)) {
            console.warn(`⚠️ Omitiendo audio local (no disponible en producción): ${segment.title || segment.url}`)
            return false
        }
        return true
    })

    if (validSegments.length === 0) {
        throw new Error('No hay audios válidos para descargar. Los audios locales no están disponibles en producción.')
    }

    if (validSegments.length < segments.length) {
        console.warn(`⚠️ Se omitieron ${segments.length - validSegments.length} audios locales`)
    }

    // Download and decode all valid segments
    for (let i = 0; i < validSegments.length; i++) {
        const segment = validSegments[i]

        onProgress?.({
            stage: 'downloading',
            current: i + 1,
            total: validSegments.length,
            message: `Descargando: ${segment.title || `Audio ${i + 1}`}`
        })

        try {
            const arrayBuffer = await downloadAudio(segment.url)
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
            audioBuffers.push(audioBuffer)
        } catch (error) {
            console.error(`Error processing segment ${i}:`, error)
            // Skip failed segments instead of throwing
            console.warn(`⚠️ Omitiendo segmento fallido: ${segment.title || `Audio ${i + 1}`}`)
        }
    }

    if (audioBuffers.length === 0) {
        throw new Error('No se pudo descargar ningún audio')
    }

    // Concatenate buffers
    onProgress?.({
        stage: 'processing',
        current: 0,
        total: 1,
        message: 'Uniendo audios...'
    })

    const concatenatedBuffer = concatenateBuffers(audioContext, audioBuffers)

    // Encode to WAV
    onProgress?.({
        stage: 'encoding',
        current: 0,
        total: 1,
        message: 'Generando archivo final...'
    })

    const wavData = audioBufferToWav(concatenatedBuffer)
    const blob = new Blob([wavData], { type: 'audio/wav' })

    onProgress?.({
        stage: 'done',
        current: 1,
        total: 1,
        message: '¡Audio listo!'
    })

    await audioContext.close()
    return blob
}

/**
 * Download a blob as a file
 */
export function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}

/**
 * Calculate total duration from segments
 */
export function calculateTotalDuration(segments: AudioSegment[]): number {
    return segments.reduce((sum, s) => sum + (s.duration || 0), 0)
}
