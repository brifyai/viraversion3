import { TTSProvider, TTSRequest, TTSResponse } from './types';

// ============================================================================
// 1. LOCAL TTS PROVIDER (SistemTTS - Python Flask)
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
      const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

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
// 2. CHUTES TTS PROVIDER (Fallback Cloud)
// ============================================================================
export class ChutesTTSProvider implements TTSProvider {
  private apiKey: string;
  public name: string = 'ChutesTTS';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async synthesize(text: string, options?: any): Promise<TTSResponse> {
    // Implementación básica de Chutes si fuera necesaria como backup
    // Por ahora placeholder para cumplir la interfaz
    throw new Error("Chutes TTS no implementado completamente aún. Usar LocalTTS.");
  }

  async validateConfig(): Promise<boolean> {
    return !!this.apiKey;
  }
}

// ============================================================================
// FACTORY
// ============================================================================
export class TTSProviderFactory {
  static getProvider(type: 'local' | 'chutes' = 'local'): TTSProvider {
    if (type === 'local') {
      return new LocalTTSProvider();
    }

    // Fallback a Chutes si se solicita explícitamente
    if (type === 'chutes') {
      const apiKey = process.env.NEXT_PUBLIC_CHUTES_API_KEY || '';
      return new ChutesTTSProvider(apiKey);
    }

    return new LocalTTSProvider();
  }

  // Helper for route.ts compatibility
  static getBestProvider(): TTSProvider {
    return new LocalTTSProvider();
  }

  static getAvailableProviders(): any[] {
    return [{ name: 'LocalTTS', isConfigured: () => true }];
  }

  static getAllProviders(): any[] {
    return [{ name: 'LocalTTS' }, { name: 'ChutesTTS' }];
  }
}
