/**
 * Constantes centralizadas para estimación de duración de noticieros
 * 
 * IMPORTANTE: Cualquier cambio aquí afecta tanto el frontend (preview)
 * como el backend (generación real). Mantener sincronizados.
 */

// Factor de corrección global
// - Valor MENOR = menos palabras generadas = audio más corto
// - Valor MAYOR = más palabras generadas = audio más largo
// Historial:
// - 0.81: Audio 10% corto
// - 0.90: Audio 12% largo  
// - 0.82: Objetivo actual (reducir audio largo)
// Factor de corrección: compensa speakingRate dinámico (wpm/150) + pausas SSML
// Carlos 175 WPM → rate 1.17 (17% más rápido) → necesita factor 0.85
// Fórmula: 175 × 0.85 = ~149 WPM efectivos para estimación
export const CORRECTION_FACTOR = 0.85

// Duraciones fijas de segmentos (en segundos)
export const INTRO_DURATION = 12      // Intro con hora + clima
export const OUTRO_DURATION = 8       // Cierre/despedida
export const AD_DURATION = 25         // Publicidad promedio
export const CORTINA_DURATION = 5     // Cortina musical
export const SILENCE_GAP = 1.5        // Silencio entre noticias

// Palabras promedio por noticia humanizada
export const WORDS_PER_NEWS = 100

// WPM por defecto (cuando no hay calibración)
export const DEFAULT_WPM = 175

// Buffer de tolerancia para estimaciones
export const BUFFER_PERCENTAGE = 0.05  // 5%

// Configuración de truncamiento post-humanización
export const TRUNCATION_TOLERANCE = 1.05  // Máximo 5% sobre el objetivo
