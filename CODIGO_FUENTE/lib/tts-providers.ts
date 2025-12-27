import 'server-only';

import { TTSProvider, TTSRequest, TTSResponse } from './types';

// ============================================================================
// VOICEMAKER DEFAULT VOICES (Spanish) - Con WPM Base
// ============================================================================
// WPM Base: Valor ANTES del ajuste de velocidad
// Fórmula efectiva: WPM_base * (1 + speed/100) * CORRECTION_FACTOR
// CORRECTION_FACTOR = 0.89 (calibrado: 139 palabras en 53s = 157 WPM real)
// ============================================================================
export const VOICEMAKER_VOICES = {
  // Voz masculina principal - Vicente tiende a ser ligeramente más rápido
  MALE_CL: {
    id: 'ai3-es-CL-Vicente',
    name: 'Vicente (Masculino)',
    engine: 'neural',
    language: 'es-CL',
    wpm: 175,  // WPM base (antes de ajuste de velocidad)
    avgPauseMs: 200  // Pausa promedio entre frases
  },
  // Voz femenina principal - Eliana es ligeramente más pausada
  FEMALE_CL: {
    id: 'ai3-es-CL-Eliana',
    name: 'Eliana (Femenino)',
    engine: 'neural',
    language: 'es-CL',
    wpm: 162,  // WPM base (Eliana es más pausada que Vicente)
    avgPauseMs: 250  // Pausa promedio entre frases
  },
  // Aliases para compatibilidad
  MALE_ES: {
    id: 'ai3-es-CL-Vicente',
    name: 'Vicente (Masculino)',
    engine: 'neural',
    language: 'es-CL',
    wpm: 175,
    avgPauseMs: 200
  },
  FEMALE_ES: {
    id: 'ai3-es-CL-Eliana',
    name: 'Eliana (Femenino)',
    engine: 'neural',
    language: 'es-CL',
    wpm: 162,
    avgPauseMs: 250
  }
};

// Helper para obtener WPM calibrado de una voz
export function getCalibratedWPM(voiceId: string): number {
  const voiceEntry = Object.values(VOICEMAKER_VOICES).find(v => v.id === voiceId);
  return voiceEntry?.wpm || 175;  // Default = WPM base de Vicente
}

// Constantes de timing para cálculos precisos
export const TIMING_CONSTANTS = {
  SILENCE_BETWEEN_NEWS: 1.5,     // Segundos de silencio entre noticias (audio-assembler)
  INTRO_DURATION: 12,            // Duración real medida (incluye pausas TTS)
  OUTRO_DURATION: 6,             // Duración estimada del outro (~15 palabras)
  AD_DURATION: 25,               // Duración promedio de publicidad
  CORTINA_DURATION: 5,           // Duración de cortina musical
  BUFFER_PERCENTAGE: 0.05        // 5% de buffer para variaciones
};

// ============================================================================
// 1. VOICEMAKER TTS PROVIDER (Cloud API)
// ============================================================================
export class VoiceMakerTTSProvider implements TTSProvider {
  private apiKey: string;
  private baseUrl = 'https://developer.voicemaker.in';
  public name = 'VoiceMaker';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.VOICEMAKER_API_KEY || '';
  }

  async synthesize(text: string, options?: any): Promise<TTSResponse> {
    try {
      console.log(`[VoiceMaker] Generando audio para: "${text.substring(0, 50)}..."`);

      // Determinar voz a usar
      const voiceId = options?.voiceId || options?.voice || VOICEMAKER_VOICES.MALE_CL.id;
      const languageCode = 'es-CL';  // Español chileno

      // Normalizar texto a UTF-8 para evitar problemas con Ñ, acentos, etc.
      const normalizedText = text
        .normalize('NFC')  // Normalización Unicode
        .replace(/\u00A0/g, ' ');  // Reemplazar espacios no-breaking

      console.log(`[VoiceMaker] Texto normalizado: "${normalizedText.substring(0, 50)}..."`);

      const requestBody: any = {
        Engine: options?.engine || 'neural',
        VoiceId: voiceId,
        LanguageCode: languageCode,
        Text: normalizedText,
        OutputFormat: 'mp3',
        SampleRate: '48000',
        MasterSpeed: String(options?.speed ?? 1),  // +1% velocidad (recomendación VoiceMaker)
        MasterPitch: String(options?.pitch ?? 0),   // Tono natural (antes -5)
        MasterVolume: String(options?.volume ?? 2), // +2dB volumen (default)
        Effect: options?.effect || 'news',          // Estilo noticiero
        ResponseType: 'file',  // Returns URL
        FileStore: 24  // Keep file for 24 hours
      };

      // Agregar VoxFX si está configurado (FM Radio effect)
      if (options?.voxFx) {
        requestBody.VoxFx = {
          presetId: options.voxFx.presetId,
          dryWet: options.voxFx.dryWet || 27,
          effects: options.voxFx.effects || []
        };
        console.log(`[VoiceMaker] 📻 VoxFX FM Radio activado: ${options.voxFx.dryWet}% intensidad`);
      }

      console.log(`[VoiceMaker] Using voice: ${voiceId}, language: ${languageCode}`);

      const response = await fetch(`${this.baseUrl}/api/v1/voice/convert`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(120000) // 2 min timeout
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`VoiceMaker API Error (${response.status}): ${errorText}`);
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(`VoiceMaker Error: ${data.message || 'Unknown error'}`);
      }

      console.log(`[VoiceMaker] ✅ Audio generado: ${data.path}`);
      console.log(`[VoiceMaker] Caracteres usados: ${data.usedChars}, restantes: ${data.remainChars}`);

      // Descargar el audio para obtener el buffer
      const audioResponse = await fetch(data.path);
      if (!audioResponse.ok) {
        throw new Error(`Failed to download audio from VoiceMaker`);
      }

      const audioArrayBuffer = await audioResponse.arrayBuffer();

      // Estimar duración basada en palabras (150 WPM promedio)
      const words = text.trim().split(/\s+/).length;
      const estimatedDuration = Math.max(3, Math.round((words / 150) * 60));

      return {
        audioData: audioArrayBuffer,
        audioUrl: data.path,  // VoiceMaker URL
        format: 'mp3',
        duration: estimatedDuration,
        cost: data.usedChars * 0.00001,  // Estimación de costo
        success: true,
        provider: 'voicemaker',
        voice: voiceId
      };

    } catch (error) {
      console.error('[VoiceMaker] Error:', error);
      throw error;
    }
  }

  async validateConfig(): Promise<boolean> {
    if (!this.apiKey) {
      console.warn('[VoiceMaker] API Key no configurada');
      return false;
    }

    try {
      // Intentar listar voces para verificar API key
      const response = await fetch(`${this.baseUrl}/api/v1/voice/list`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ language: 'es-ES' })
      });

      return response.ok;
    } catch (e) {
      console.error('[VoiceMaker] Error validando config:', e);
      return false;
    }
  }

  // Listar voces disponibles en español
  async listSpanishVoices(): Promise<any[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/voice/list`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ language: 'es-ES' })
      });

      if (!response.ok) return [];

      const data = await response.json();
      return data.data?.voices_list || [];
    } catch (e) {
      console.error('[VoiceMaker] Error listando voces:', e);
      return [];
    }
  }
}

// ============================================================================
// 2. LOCAL TTS PROVIDER (Legacy - Ya no usado)
// ============================================================================
export class LocalTTSProvider implements TTSProvider {
  private baseUrl: string;
  public name: string = 'LocalTTS';

  constructor() {
    // URL del servidor Python local (SistemTTS)
    this.baseUrl = process.env.NEXT_PUBLIC_TTS_API_URL || 'http://127.0.0.1:5000';
  }

  async synthesize(text: string, options?: any): Promise<TTSResponse> {
    try {
      console.log(`[LocalTTS] Generando audio para: "${text.substring(0, 30)}..."`);

      // Determinar endpoint según si hay clonación de voz
      const voiceId = options?.voice || options?.voiceId;

      const endpoint = voiceId && voiceId.startsWith('http')
        ? '/tts_url'
        : '/tts';

      const payload: any = {
        text: text,
        language: 'es', // Forzar español para VIRA
        format: 'base64' // Solicitar respuesta en JSON con base64 y duración
      };

      if (endpoint === '/tts_url') {
        payload.audio_url = voiceId;
      } else if (voiceId) {
        // If it's a local file ID or default
        payload.voice = voiceId;
      }

      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(300000) // 300s timeout
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LocalTTS Error (${response.status}): ${errorText}`);
      }

      const data = await response.json();

      if (!data.success || !data.audio_base64) {
        throw new Error(`LocalTTS Error: Respuesta inválida del servidor`);
      }

      // Decodificar base64 a ArrayBuffer (Node.js safe)
      const buffer = Buffer.from(data.audio_base64, 'base64');

      // Copiar a un nuevo ArrayBuffer para asegurar que sea independiente
      const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

      return {
        audioData: arrayBuffer,
        format: 'wav', // SistemTTS devuelve WAV
        duration: data.duration || 0, // Usar duración real calculada por el servidor
        cost: 0,
        success: true,
        provider: 'local',
        voice: voiceId
      };

    } catch (error) {
      console.error('[LocalTTS] Error:', error);
      throw error;
    }
  }

  async validateConfig(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return response.ok;
    } catch (e) {
      return false;
    }
  }
}

// ============================================================================
// 3. GOOGLE CLOUD TTS PROVIDER (NEW PRIMARY)
// ============================================================================

// ============================================================================
// SSML CONVERSION - Limpieza profunda y optimización para TTS
// ============================================================================

// Diccionario de símbolos a reemplazar con palabras
const SYMBOL_REPLACEMENTS: Record<string, string> = {
  'N°': 'número',
  'n°': 'número',
  'Nº': 'número',
  'nº': 'número',
  '%': ' por ciento',
  '(s)': '',
  '&': ' y ',
  '+': ' más ',
  '=': ' igual a ',
  '°C': ' grados celsius',
  '°F': ' grados fahrenheit',
  '°': ' grados',
  'km/h': 'kilómetros por hora',
  'Km/h': 'kilómetros por hora',
  'KM/H': 'kilómetros por hora',
  'm/s': 'metros por segundo',
  'UF': 'u-efe',
  'Kg': 'kilos',
  'kg': 'kilos',
  'KG': 'kilos',
  'mts': 'metros',
  'Mts': 'metros',
  'hrs': 'horas',
  'Hrs': 'horas',
  'mins': 'minutos',
  'min': 'minutos',
  'seg': 'segundos',
  'aprox': 'aproximadamente',
  'Aprox': 'aproximadamente',
  'etc': 'etcétera',
  'Etc': 'etcétera',
  'vs': 'versus',
  'VS': 'versus',
  'c/u': 'cada uno',
  'p/': 'para',
  's/': 'sin',
  'c/': 'con',
};

// Lista de siglas conocidas que se leen como palabra (NO deletrear)
const KNOWN_ACRONYMS = [
  'PDI', 'SAG', 'SII', 'ISP', 'AFP', 'IVA', 'PIB', 'INE', 'IPC',
  'ONU', 'FBI', 'CIA', 'NASA', 'UEFA', 'FIFA', 'NBA', 'NFL',
  'CEO', 'COO', 'CFO', 'CTO', 'URL', 'USB', 'GPS', 'LED', 'LCD',
  'COVID', 'SIDA', 'VIH', 'ADN', 'RUT', 'UDI', 'PPD',
  'EEUU', 'OMS', 'OIT', 'BID', 'FMI', 'BCE', 'UE',
  'OS', 'MP', 'RN', 'PS', 'DC', 'PC', 'FA', 'RD',
  'CAE', 'BRP', 'CVE', 'SML', 'UTM', 'APV',
  'SAE', 'PSU', 'PAES', 'NEM', 'PTU',
  'INP', 'ISL', 'CMF', 'SVS', 'UAF', 'SEC',
  'AES', 'ABS', 'ESP', 'SUV', 'VAN', 'SUB',
  'CNN', 'BBC', 'TVN', 'CHV', 'T13'
];

// Palabras comunes en mayúsculas que NO deben procesarse como siglas
const COMMON_UPPERCASE_WORDS = [
  'EL', 'LA', 'LOS', 'LAS', 'DE', 'EN', 'CON', 'POR', 'PARA', 'UN', 'UNA',
  'QUE', 'SE', 'ES', 'AL', 'DEL', 'MAS', 'MÁS', 'SU', 'SUS', 'NO', 'SI', 'SÍ',
  'YA', 'LE', 'LO', 'ME', 'MI', 'TU', 'TE', 'NOS', 'LES', 'SER', 'VER',
  'IR', 'DAR', 'HAY', 'HOY', 'AÚN', 'AUN', 'ASÍ', 'ASI', 'TAL', 'TAN'
];

/**
 * Convierte texto plano a SSML optimizado para Google Cloud TTS
 * - Limpia formato Markdown
 * - Reemplaza símbolos con palabras
 * - Agrega pausas naturales con etiquetas <s>
 * - Procesa siglas inteligentemente
 * - Soporta <prosody> para noticias destacadas
 */
export function textToSSML(text: string, isHighlighted: boolean = false): string {
  let cleaned = text;

  // 1. Limpieza profunda de Markdown y símbolos decorativos
  cleaned = cleaned
    .replace(/\*\*([^*]+)\*\*/g, '$1')      // **Negritas**
    .replace(/\*([^*]+)\*/g, '$1')           // *Cursivas*
    .replace(/__([^_]+)__/g, '$1')           // __Subrayado__
    .replace(/_([^_]+)_/g, '$1')             // _Cursivas_
    .replace(/#{1,6}\s*/g, '')               // # Headers
    .replace(/^[-*+]\s+/gm, '')              // - Listas
    .replace(/^\d+\.\s+/gm, '')              // 1. Listas numeradas
    .replace(/`([^`]+)`/g, '$1')             // `Código inline`
    .replace(/```[\s\S]*?```/g, '')          // ```Bloques de código```
    .replace(/---+/g, '')                    // --- Líneas horizontales
    .replace(/===+/g, '')                    // === Líneas dobles
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [Links](url)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')  // ![Imágenes](url)
    .replace(/\*+/g, '')                     // Asteriscos sueltos
    .replace(/#+/g, '')                      // Almohadillas sueltas
    .replace(/_{2,}/g, '')                   // Guiones bajos decorativos
    .replace(/~{2,}/g, '')                   // ~~Tachado~~
    .replace(/>/g, '')                       // > Citas
    .replace(/\|/g, ', ')                    // | Tablas
    .replace(/\\/g, '')                      // Escapes
    .replace(/\[\s*\]/g, '')                 // [] Checkboxes vacías
    .replace(/\[x\]/gi, '')                  // [x] Checkboxes marcadas
    .replace(/:\w+:/g, '');                  // :emoji:

  // 2. Reemplazar símbolos con palabras (ordenar por longitud descendente)
  const sortedSymbols = Object.entries(SYMBOL_REPLACEMENTS)
    .sort((a, b) => b[0].length - a[0].length);

  for (const [symbol, replacement] of sortedSymbols) {
    const escapedSymbol = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleaned = cleaned.replace(new RegExp(escapedSymbol, 'g'), replacement);
  }

  // 3. Limpiar números con formato de miles (155.772 → 155772)
  cleaned = cleaned.replace(/(\d)\.(\d{3})(?!\d)/g, '$1$2');

  // 4. Limpiar espacios múltiples
  cleaned = cleaned.replace(/\s+/g, ' ').replace(/\n+/g, ' ').replace(/\r+/g, '').trim();

  // 5. Procesar por oraciones con etiquetas <s> (best practice de Google)
  const sentences = cleaned.split(/(?<=[.!?])\s+/);
  let ssmlBody = '';

  for (const sentence of sentences) {
    if (!sentence.trim()) continue;

    let processedSentence = sentence;

    // 6. Procesar siglas (2-4 letras mayúsculas consecutivas)
    processedSentence = processedSentence.replace(/\b([A-ZÁÉÍÓÚÑ]{2,4})\b/g, (match) => {
      if (COMMON_UPPERCASE_WORDS.includes(match)) return match;
      if (KNOWN_ACRONYMS.includes(match)) return match;
      return `<say-as interpret-as="characters">${match}</say-as>`;
    });

    // 7. Agregar pausas por comas (250ms)
    processedSentence = processedSentence.replace(/,\s+/g, ', <break time="250ms"/> ');

    // 8. Envolver oración en <s> con pausa al final
    let pauseTime = '600ms';
    if (sentence.endsWith('?') || sentence.endsWith('!')) pauseTime = '700ms';

    ssmlBody += `<s>${processedSentence.trim()}</s><break time="${pauseTime}"/> `;
  }

  // 9. Aplicar <prosody> si es noticia destacada (intro, outro, o es_destacada)
  if (isHighlighted) {
    ssmlBody = `<prosody rate="medium" pitch="+1st">${ssmlBody}</prosody>`;
  }

  return `<speak>${ssmlBody}</speak>`;
}

export const GOOGLE_CLOUD_VOICES = {
  // ===========================
  // VOCES NEURAL2 ESPAÑOL US (Latinoamericanas - Recomendadas)
  // ===========================
  'es-US-Neural2-A': {
    id: 'es-US-Neural2-A',
    name: 'Sofía (Mujer - Suave)',
    languageCode: 'es-US',
    ssmlGender: 'FEMALE',
    wpm: 165,
    description: 'Voz femenina suave, ideal para noticias tranquilas'
  },
  'es-US-Neural2-B': {
    id: 'es-US-Neural2-B',
    name: 'Carlos (Hombre - Profunda)',
    languageCode: 'es-US',
    ssmlGender: 'MALE',
    wpm: 175,
    description: 'Voz masculina profunda, ideal para noticias serias'
  },
  'es-US-Neural2-C': {
    id: 'es-US-Neural2-C',
    name: 'Diego (Hombre - Clara)',
    languageCode: 'es-US',
    ssmlGender: 'MALE',
    wpm: 170,
    description: 'Voz masculina clara y articulada'
  },
  'es-US-Neural2-D': {
    id: 'es-US-Neural2-D',
    name: 'Miguel (Hombre - Noticiosa)',
    languageCode: 'es-US',
    ssmlGender: 'MALE',
    wpm: 175,
    description: 'Voz masculina estilo noticiero profesional'
  },
  'es-US-Neural2-E': {
    id: 'es-US-Neural2-E',
    name: 'Laura (Mujer - Dinámica)',
    languageCode: 'es-US',
    ssmlGender: 'FEMALE',
    wpm: 170,
    description: 'Voz femenina dinámica y expresiva'
  },
  'es-US-Neural2-F': {
    id: 'es-US-Neural2-F',
    name: 'Ana (Mujer - Calmada)',
    languageCode: 'es-US',
    ssmlGender: 'FEMALE',
    wpm: 160,
    description: 'Voz femenina tranquila y relajante'
  },

  // ===========================
  // ALIASES PARA COMPATIBILIDAD (mapeo desde VoiceMaker)
  // ===========================
  'MALE_CL': {
    id: 'es-US-Neural2-B',
    name: 'Vicente → Carlos (Hombre)',
    languageCode: 'es-US',
    ssmlGender: 'MALE',
    wpm: 175,
    description: 'Alias: Vicente de VoiceMaker → Carlos de Google Cloud'
  },
  'FEMALE_CL': {
    id: 'es-US-Neural2-A',
    name: 'Eliana → Sofía (Mujer)',
    languageCode: 'es-US',
    ssmlGender: 'FEMALE',
    wpm: 165,
    description: 'Alias: Eliana de VoiceMaker → Sofía de Google Cloud'
  }
};

export class GoogleCloudTTSProvider implements TTSProvider {
  private apiKey: string;
  private baseUrl = 'https://texttospeech.googleapis.com/v1/text:synthesize';
  public name = 'GoogleCloudTTS';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.GOOGLE_CLOUD_TTS_API_KEY || '';
  }

  async synthesize(text: string, options?: any): Promise<TTSResponse> {
    try {
      console.log(`[GoogleCloudTTS] Generando audio para: "${text.substring(0, 50)}..."`);

      // Mapear voiceId de VoiceMaker a Google Cloud
      const voiceId = this.mapVoiceId(options?.voiceId || options?.voice);
      const languageCode = voiceId.split('-').slice(0, 2).join('-');

      // Convertir texto a SSML con limpieza profunda
      const ssmlContent = textToSSML(text);
      console.log(`[GoogleCloudTTS] SSML generado: "${ssmlContent.substring(0, 100)}..."`);

      // Determinar pitch según el género de la voz
      // Masculino: -2.0 (más grave y con autoridad)
      // Femenino: -1.0 (quita lo chillón sin perder calidez)
      const voiceConfig = Object.values(GOOGLE_CLOUD_VOICES).find(v => v.id === voiceId);
      const isFemaleVoice = voiceConfig?.ssmlGender === 'FEMALE' ||
        voiceId.includes('Neural2-A') ||
        voiceId.includes('Neural2-E') ||
        voiceId.includes('Neural2-F');
      const basePitch = isFemaleVoice ? -1.0 : -2.0;

      // Permitir override del pitch desde options, pero usar basePitch como default
      const finalPitch = options?.pitch !== undefined ? options.pitch : basePitch;

      const requestBody = {
        input: { ssml: ssmlContent },
        voice: {
          languageCode,
          name: voiceId
        },
        audioConfig: {
          audioEncoding: 'MP3',
          sampleRateHertz: 24000,  // Calidad óptima para voz
          speakingRate: 1.0 + ((options?.speed || 0) / 100),
          pitch: finalPitch,
          // Perfil de audio optimizado para reducir tonos metálicos
          effectsProfileId: ['medium-bluetooth-speaker-class-device']
        }
      };

      console.log(`[GoogleCloudTTS] Using voice: ${voiceId}, language: ${languageCode}, pitch: ${finalPitch}, gender: ${isFemaleVoice ? 'female' : 'male'}`);

      const response = await fetch(`${this.baseUrl}?key=${this.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Google Cloud TTS API Error (${response.status}): ${errorText}`);
      }

      const data = await response.json();

      if (!data.audioContent) {
        throw new Error('Google Cloud TTS returned no audio content');
      }

      // Decodificar Base64 a ArrayBuffer
      const binaryString = atob(data.audioContent);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const audioBuffer = bytes.buffer;

      // Estimar duración basado en WPM
      const wordCount = text.split(/\s+/).length;
      const wpm = this.getVoiceWPM(voiceId);
      const estimatedDuration = Math.round((wordCount / wpm) * 60);

      console.log(`[GoogleCloudTTS] ✅ Audio generado: ${audioBuffer.byteLength} bytes, ~${estimatedDuration}s, pitch: ${finalPitch}`);

      return {
        audioData: audioBuffer,
        format: 'mp3',
        duration: estimatedDuration,
        cost: (text.length / 1000000) * 16, // Neural2: $16 per 1M chars
        success: true,
        provider: 'google-cloud-tts',
        voice: voiceId
      };

    } catch (error) {
      console.error('[GoogleCloudTTS] Error:', error);
      throw error;
    }
  }

  private mapVoiceId(voiceId?: string): string {
    // Si no hay voiceId, usar voz masculina por defecto
    if (!voiceId) return 'es-US-Neural2-B';

    // Si ya es un ID de Google Cloud válido, usarlo directamente
    if (voiceId.startsWith('es-') && voiceId.includes('Neural2')) {
      return voiceId;
    }

    // Mapear voces de VoiceMaker a Google Cloud
    if (voiceId.includes('Vicente') || voiceId.includes('ai3-es-CL-Vicente')) {
      return 'es-US-Neural2-B'; // Carlos
    }
    if (voiceId.includes('Eliana') || voiceId.includes('ai3-es-CL-Eliana')) {
      return 'es-US-Neural2-A'; // Sofía
    }
    if (voiceId.includes('MALE')) {
      return 'es-US-Neural2-B';
    }
    if (voiceId.includes('FEMALE')) {
      return 'es-US-Neural2-A';
    }

    // Default: Carlos (Hombre)
    return 'es-US-Neural2-B';
  }

  private getVoiceWPM(voiceId: string): number {
    const voice = Object.values(GOOGLE_CLOUD_VOICES).find(v => v.id === voiceId);
    return voice?.wpm || 170;
  }

  async validateConfig(): Promise<boolean> {
    if (!this.apiKey) {
      console.warn('[GoogleCloudTTS] API Key no configurada');
      return false;
    }
    // Podríamos hacer un test call pero por ahora solo verificamos la key
    return true;
  }

  async listVoices(): Promise<any[]> {
    return Object.values(GOOGLE_CLOUD_VOICES);
  }
}

// ============================================================================
// FACTORY (UPDATED - Google Cloud TTS as Primary)
// ============================================================================
export class TTSProviderFactory {
  static getProvider(type: 'google-cloud' | 'voicemaker' | 'local' | 'chutes' = 'google-cloud'): TTSProvider {
    // PRIORIDAD 1: Google Cloud TTS (NEW PRIMARY)
    if (type === 'google-cloud') {
      const apiKey = process.env.GOOGLE_CLOUD_TTS_API_KEY || '';
      if (apiKey) {
        return new GoogleCloudTTSProvider(apiKey);
      }
      console.warn('[TTSFactory] Google Cloud TTS API key no configurada');
    }

    // PRIORIDAD 2: VoiceMaker (Legacy - fallback)
    if (type === 'voicemaker') {
      const apiKey = process.env.VOICEMAKER_API_KEY || '';
      if (apiKey) {
        return new VoiceMakerTTSProvider(apiKey);
      }
      console.warn('[TTSFactory] VoiceMaker API key no configurada');
    }

    // PRIORIDAD 3: Local TTS (Legacy - fallback)
    if (type === 'local') {
      return new LocalTTSProvider();
    }

    // Default: Google Cloud si hay key, sino VoiceMaker, sino Local
    const googleKey = process.env.GOOGLE_CLOUD_TTS_API_KEY || '';
    if (googleKey) {
      return new GoogleCloudTTSProvider(googleKey);
    }

    const voicemakerKey = process.env.VOICEMAKER_API_KEY || '';
    if (voicemakerKey) {
      return new VoiceMakerTTSProvider(voicemakerKey);
    }

    return new LocalTTSProvider();
  }

  // Helper for route.ts compatibility - now uses Google Cloud first
  static getBestProvider(): TTSProvider {
    const googleKey = process.env.GOOGLE_CLOUD_TTS_API_KEY || '';
    if (googleKey) {
      return new GoogleCloudTTSProvider(googleKey);
    }
    const voicemakerKey = process.env.VOICEMAKER_API_KEY || '';
    if (voicemakerKey) {
      return new VoiceMakerTTSProvider(voicemakerKey);
    }
    return new LocalTTSProvider();
  }

  static getAvailableProviders(): any[] {
    const providers = [];

    if (process.env.GOOGLE_CLOUD_TTS_API_KEY) {
      providers.push({
        name: 'GoogleCloudTTS',
        isConfigured: () => true,
        estimateCost: (chars: number) => chars * 0.000016 // Neural2 pricing
      });
    }

    if (process.env.VOICEMAKER_API_KEY) {
      providers.push({
        name: 'VoiceMaker',
        isConfigured: () => true,
        estimateCost: (chars: number) => chars * 0.00001
      });
    }

    providers.push({ name: 'LocalTTS', isConfigured: () => true });

    return providers;
  }

  static getAllProviders(): any[] {
    return [
      { name: 'GoogleCloudTTS' },
      { name: 'VoiceMaker' },
      { name: 'LocalTTS' }
    ];
  }
}


