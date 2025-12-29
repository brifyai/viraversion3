import 'server-only';

import { TTSProvider, TTSRequest, TTSResponse } from './types';
import { logTokenUsage, calculateGoogleTTSCost } from './usage-logger';

// ============================================================================
// TIMING CONSTANTS - Para cálculos de duración
// ============================================================================
export const TIMING_CONSTANTS = {
  SILENCE_BETWEEN_NEWS: 1.5,     // Segundos de silencio entre noticias
  INTRO_DURATION: 12,            // Duración real medida (incluye pausas TTS)
  OUTRO_DURATION: 6,             // Duración estimada del outro (~15 palabras)
  AD_DURATION: 25,               // Duración promedio de publicidad
  CORTINA_DURATION: 5,           // Duración de cortina musical
  BUFFER_PERCENTAGE: 0.05        // 5% de buffer para variaciones
};

// ============================================================================
// SSML CONVERSION - Limpieza profunda y optimización para TTS
// ============================================================================

// Diccionario de símbolos seguros (se pueden reemplazar globalmente)
const SAFE_SYMBOLS: Record<string, string> = {
  '%': ' por ciento',
  '&': ' y ',
  '+': ' más ',
  '=': ' igual a ',
  '°C': ' grados celsius',
  '°F': ' grados fahrenheit',
  '°': ' grados',
  '|': ', ',
  '/': ' por '
};

// Diccionario de abreviaturas (REQUIEREN límite de palabra \b para no romper "Ministro")
// NOTA: 'min' y 'seg' fueron removidos de aquí para evitar conflictos con Ministro/Según/Segundos
// Se manejan con seguridad en el código o se asume que 'min' suelto es minutos.
const ABBREVIATIONS: Record<string, string> = {
  'N°': 'número', 'n°': 'número', 'Nº': 'número', 'nº': 'número', 'No.': 'número',
  'km/h': 'kilómetros por hora', 'Km/h': 'kilómetros por hora',
  'm/s': 'metros por segundo',
  'Kg': 'kilos', 'kg': 'kilos', 'KG': 'kilos',
  'mts': 'metros', 'Mts': 'metros',
  'hrs': 'horas', 'Hrs': 'horas',
  'aprox': 'aproximadamente', 'Aprox': 'aproximadamente',
  'etc': 'etcétera', 'Etc': 'etcétera',
  'vs': 'versus', 'VS': 'versus',
  'c/u': 'cada uno',
  'p/': 'para', 's/': 'sin', 'c/': 'con',
  '(s)': ''
};

// Siglas que DEBEN deletrearse (para sonar profesional en radio)
const SPELL_ACRONYMS = [
  'SII', 'PDI', 'SAG', 'ISP', 'INE', 'CMF', 'SVS', 'UAF', 'SEC', 'ISL', 'INP',
  'UF', 'UTM', 'IPC', 'PIB', 'IVA', 'AFP', 'APV', 'CAE', 'SML', 'BRP', 'CVE',
  'PSU', 'SAE', 'NEM', 'PTU',
  'UDI', 'PPD', 'RN', 'PS', 'DC', 'PC', 'FA', 'RD',
  'URL', 'USB', 'GPS', 'LED', 'LCD', 'CEO', 'CFO', 'CTO',
  'ONU', 'OMS', 'OIT', 'BID', 'FMI', 'BCE', 'UE', 'FBI', 'CIA',
  'CNN', 'BBC', 'TVN', 'CHV'
];

// Siglas que se leen como PALABRA (no deletrear)
// EEUU eliminado de aquí porque se reemplazará por "Estados Unidos"
const READ_AS_WORD_ACRONYMS = [
  'NASA', 'UEFA', 'FIFA', 'NBA', 'NFL', 'COVID', 'SIDA', 'PAES',
  'VIH', 'ADN', 'RUT', 'ABS', 'ESP', 'SUV', 'VAN', 'SUB'
];

// Palabras comunes en mayúsculas que NO deben procesarse como siglas
const COMMON_UPPERCASE_WORDS = [
  'EL', 'LA', 'LOS', 'LAS', 'DE', 'EN', 'CON', 'POR', 'PARA', 'UN', 'UNA',
  'QUE', 'SE', 'ES', 'AL', 'DEL', 'MAS', 'MÁS', 'SU', 'SUS', 'NO', 'SI', 'SÍ',
  'YA', 'LE', 'LO', 'ME', 'MI', 'TU', 'TE', 'NOS', 'LES', 'SER', 'VER',
  'IR', 'DAR', 'HAY', 'HOY', 'AÚN', 'AUN', 'ASÍ', 'ASI', 'TAL', 'TAN', 'LEY'
];

/**
 * Convierte texto plano a SSML optimizado para Google Cloud TTS
 * - Limpia formato Markdown
 * - Reemplaza símbolos con palabras (Moneda, Unidades)
 * - Agrega pausas naturales con etiquetas <s>
 * - Procesa siglas inteligentemente
 * - Soporta <prosody> para noticias destacadas
 */
export function textToSSML(text: string, isHighlighted: boolean = false): string {
  let cleaned = text;

  // 0. LIMPIEZA CRÍTICA PRIMERO
  cleaned = cleaned
    .replace(/\*/g, '')
    .replace(/#/g, '')
    .replace(/_{2,}/g, '')
    .replace(/~{2,}/g, '');

  // 1. Limpieza de Markdown
  cleaned = cleaned
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/---+/g, '')
    .replace(/===+/g, '')
    .replace(/^[-+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/>/g, '')
    .replace(/\|/g, ', ')
    .replace(/\\/g, '')
    .replace(/\[\s*\]/g, '')
    .replace(/\[x\]/gi, '')
    .replace(/:\w+:/g, '');

  // 2. CORRECCIONES FONÉTICAS ESPECÍFICAS (Manuales)
  // Expandir EEUU antes de que se procese como sigla
  cleaned = cleaned
    .replace(/\bEE\.?UU\.?\b/g, 'Estados Unidos')
    .replace(/\bEEUU\b/g, 'Estados Unidos');

  // 3. MONEDA LOCALIZADA ($ -> pesos al final)
  // Transforma "$ 500.000" o "$500.000" -> "500.000 pesos"
  cleaned = cleaned.replace(/\$\s?(\d[\d\.]*)/g, '$1 pesos');

  // 4. Reemplazo de SÍMBOLOS SEGUROS
  for (const [symbol, replacement] of Object.entries(SAFE_SYMBOLS)) {
    const escapedSymbol = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleaned = cleaned.replace(new RegExp(escapedSymbol, 'g'), replacement);
  }

  // 5. Reemplazo de ABREVIATURAS con LÍMITE DE PALABRA (\b)
  // Esto evita que "min" reemplace "Ministro" o "seg" reemplace "Según"
  const sortedAbbrs = Object.entries(ABBREVIATIONS).sort((a, b) => b[0].length - a[0].length);

  for (const [abbr, replacement] of sortedAbbrs) {
    const escapedAbbr = abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Si termina en punto (ej: "No."), el punto delimita. Si no, usamos \b.
    if (abbr.endsWith('.')) {
      cleaned = cleaned.replace(new RegExp(`\\b${escapedAbbr}(?=\\s|$)`, 'gi'), replacement);
    } else {
      cleaned = cleaned.replace(new RegExp(`\\b${escapedAbbr}\\b`, 'gi'), replacement);
    }
  }

  // 6. Limpiar números con formato de miles (155.772 → 155772)
  // Neural2 lee mejor los números enteros sin puntos
  cleaned = cleaned.replace(/(\d)\.(\d{3})(?!\d)/g, '$1$2');

  // 7. Limpiar espacios múltiples y saltos
  cleaned = cleaned.replace(/\s+/g, ' ').replace(/\n+/g, ' ').replace(/\r+/g, '').trim();

  // 8. Procesar por oraciones
  const sentences = cleaned.split(/(?<=[.!?])\s+/);
  let ssmlBody = '';

  for (const sentence of sentences) {
    if (!sentence.trim()) continue;

    let processedSentence = sentence;

    // 9. Procesar siglas (2-5 letras mayúsculas)
    processedSentence = processedSentence.replace(/\b([A-ZÁÉÍÓÚÑ]{2,5})\b/g, (match) => {
      if (COMMON_UPPERCASE_WORDS.includes(match)) return match;
      if (READ_AS_WORD_ACRONYMS.includes(match)) return match;
      if (SPELL_ACRONYMS.includes(match)) {
        return `<say-as interpret-as="characters">${match}</say-as>`;
      }
      // Deletrear siglas cortas desconocidas por defecto
      if (match.length <= 3) {
        return `<say-as interpret-as="characters">${match}</say-as>`;
      }
      return match;
    });

    // 10. Pausas
    processedSentence = processedSentence.replace(/,\s+/g, ', <break time="250ms"/> ');
    let pauseTime = '600ms';
    if (sentence.endsWith('?') || sentence.endsWith('!')) pauseTime = '700ms';

    ssmlBody += `<s>${processedSentence.trim()}</s><break time="${pauseTime}"/> `;
  }

  if (isHighlighted) {
    ssmlBody = `<prosody rate="medium" pitch="+1st">${ssmlBody}</prosody>`;
  }

  return `<speak>${ssmlBody}</speak>`;
}

// ============================================================================
// GOOGLE CLOUD TTS - VOCES NEURAL2
// WPM CALIBRADOS: Valores reales medidos con 100 palabras @ speakingRate=1.0
// Fecha calibración: 2024-12-27
// ============================================================================
export const GOOGLE_CLOUD_VOICES = {
  'es-US-Neural2-A': {
    id: 'es-US-Neural2-A',
    name: 'Sofía (Mujer - Suave)',
    languageCode: 'es-US',
    ssmlGender: 'FEMALE',
    wpm: 152,  // CALIBRADO 2024-12-27 + ajuste SSML (157 * 0.94)
    description: 'Voz femenina suave, ideal para noticias tranquilas'
  },
  'es-US-Neural2-B': {
    id: 'es-US-Neural2-B',
    name: 'Carlos (Hombre - Profunda)',
    languageCode: 'es-US',
    ssmlGender: 'MALE',
    wpm: 157,  // CALIBRADO 2024-12-27 + ajuste SSML (288s/306s)
    description: 'Voz masculina profunda, ideal para noticias serias'
  },
  'es-US-Neural2-C': {
    id: 'es-US-Neural2-C',
    name: 'Diego (Hombre - Clara)',
    languageCode: 'es-US',
    ssmlGender: 'MALE',
    wpm: 166,  // CALIBRADO 2024-12-27 + ajuste SSML (176 * 0.94)
    description: 'Voz masculina clara y articulada'
  }
};

// ============================================================================
// GOOGLE CLOUD TTS PROVIDER
// ============================================================================
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

      // Obtener voiceId y validar
      const voiceId = this.mapVoiceId(options?.voiceId || options?.voice);
      const languageCode = voiceId.split('-').slice(0, 2).join('-');

      // Convertir texto a SSML con limpieza profunda
      const ssmlContent = textToSSML(text, options?.isHighlighted);
      console.log(`[GoogleCloudTTS] SSML generado: "${ssmlContent.substring(0, 100)}..."`);

      // Determinar pitch según el género de la voz
      // Masculino: -2.0 (más grave y con autoridad)
      // Femenino: -1.0 (quita lo chillón sin perder calidez)
      const voiceConfig = Object.values(GOOGLE_CLOUD_VOICES).find(v => v.id === voiceId);
      const isFemaleVoice = voiceConfig?.ssmlGender === 'FEMALE';
      const basePitch = isFemaleVoice ? -1.0 : -2.0;
      const finalPitch = options?.pitch !== undefined ? options.pitch : basePitch;

      const requestBody = {
        input: { ssml: ssmlContent },
        voice: {
          languageCode,
          name: voiceId
        },
        audioConfig: {
          audioEncoding: 'MP3',
          sampleRateHertz: 24000,
          // speakingRate = 1.0 base (velocidad normal de Google TTS)
          // Los WPM ya están calibrados reales, no se necesita fórmula
          // El usuario puede ajustar con options.speed (-10 a +10)
          speakingRate: 1.0 + ((options?.speed || 0) / 100),
          pitch: finalPitch,
          effectsProfileId: ['medium-bluetooth-speaker-class-device']
        }
      };

      console.log(`[GoogleCloudTTS] Voice: ${voiceId}, pitch: ${finalPitch}, gender: ${isFemaleVoice ? 'female' : 'male'}`);

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

      console.log(`[GoogleCloudTTS] ✅ Audio: ${audioBuffer.byteLength} bytes, ~${estimatedDuration}s`);

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
    return true;
  }

  async listVoices(): Promise<any[]> {
    return Object.values(GOOGLE_CLOUD_VOICES);
  }
}

// ============================================================================
// FACTORY - Solo Google Cloud TTS
// ============================================================================
export class TTSProviderFactory {
  static getProvider(): TTSProvider {
    const apiKey = process.env.GOOGLE_CLOUD_TTS_API_KEY || '';
    if (!apiKey) {
      throw new Error('GOOGLE_CLOUD_TTS_API_KEY no está configurada');
    }
    return new GoogleCloudTTSProvider(apiKey);
  }

  static getBestProvider(): TTSProvider {
    return this.getProvider();
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
    return providers;
  }

  static getAllProviders(): any[] {
    return [{ name: 'GoogleCloudTTS' }];
  }
}

// ============================================================================
// HELPER - Obtener WPM calibrado de una voz
// ============================================================================
export function getCalibratedWPM(voiceId: string): number {
  const voice = Object.values(GOOGLE_CLOUD_VOICES).find(v => v.id === voiceId);
  return voice?.wpm || 170;
}
