# -*- coding: utf-8 -*-
"""
Módulo de procesamiento de audio para F5-TTS.

Incluye:
- Preprocesamiento de audio de referencia (para uploads de usuarios)
- Post-procesamiento del audio generado
- Crossfade con curvas exponenciales para unir chunks
"""

import os
import uuid
import tempfile
import numpy as np
import librosa
import soundfile as sf

# Dependencias opcionales para preprocesamiento avanzado
try:
    import noisereduce as nr
    HAS_NOISEREDUCE = True
except ImportError:
    HAS_NOISEREDUCE = False
    print("⚠️ noisereduce no instalado. Preprocesamiento básico.")

try:
    from scipy.signal import butter, sosfilt
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False
    print("⚠️ scipy no instalado. Sin filtro pasa-altos.")


class AudioProcessor:
    """Procesador de audio para F5-TTS."""
    
    def __init__(self, sample_rate: int = 24000):
        self.sr = sample_rate
    
    def preprocess_reference(self, audio_path: str, output_path: str = None) -> tuple:
        """
        Preprocesa audio de referencia para óptima clonación de voz.
        
        NOTA: Simplificado para evitar errores de timestamps.
        Solo aplica: trim de silencios y normalización.
        
        Args:
            audio_path: Ruta al audio original
            output_path: Ruta para guardar el procesado (opcional)
        
        Returns:
            tuple: (audio_array, sample_rate, output_path)
        """
        print(f"🧹 Preprocesando audio: {os.path.basename(audio_path)}")
        
        # 1. Cargar audio (forzar sample rate a 24kHz para F5-TTS)
        y, sr = librosa.load(audio_path, sr=self.sr)
        
        # 2. Trim silencios al inicio y final
        print("   → Eliminando silencios...")
        y, _ = librosa.effects.trim(y, top_db=20)
        
        # 3. Normalizar volumen
        print("   → Normalizando...")
        y = librosa.util.normalize(y) * 0.9
        
        # Guardar si se especificó output
        if output_path is None:
            output_path = os.path.join(
                tempfile.gettempdir(), 
                f"ref_{uuid.uuid4().hex[:8]}.wav"
            )
        
        sf.write(output_path, y, sr)
        print(f"   ✅ Guardado: {os.path.basename(output_path)}")
        
        return y, sr, output_path
    
    def postprocess_generated(self, audio: np.ndarray) -> np.ndarray:
        """
        Post-procesa audio generado para calidad profesional.
        
        Aplica:
        1. Normalización a -3dB
        2. Compresión dinámica suave (simétrica)
        
        Args:
            audio: Array de audio generado
        
        Returns:
            Audio post-procesado
        """
        # Evitar procesar audio vacío
        if len(audio) == 0:
            return audio
        
        # 1. Normalizar a -3dB
        audio = librosa.util.normalize(audio) * 0.7
        
        # 2. Compresión dinámica suave
        # Esto reduce picos manteniendo el volumen general
        threshold = 0.6
        ratio = 1.5
        
        # Trabajar con valores absolutos para compresión simétrica
        sign = np.sign(audio)
        abs_audio = np.abs(audio)
        
        # Aplicar compresión solo donde supera el umbral
        mask = abs_audio > threshold
        if np.any(mask):
            abs_audio[mask] = threshold + (abs_audio[mask] - threshold) / ratio
        
        return abs_audio * sign
    
    def crossfade_segments(self, segments: list, crossfade_ms: int = 150) -> np.ndarray:
        """
        Une múltiples segmentos de audio con crossfade suave.
        
        Usa curvas exponenciales para transiciones más naturales.
        
        Args:
            segments: Lista de arrays de audio
            crossfade_ms: Duración del crossfade en milisegundos
        
        Returns:
            Audio unido
        """
        if not segments:
            return np.array([])
        
        if len(segments) == 1:
            return segments[0]
        
        fade_len = int(self.sr * (crossfade_ms / 1000))
        result = segments[0]
        
        for i, next_seg in enumerate(segments[1:], 1):
            # Verificar longitudes mínimas
            if len(result) < fade_len or len(next_seg) < fade_len:
                # Si algún segmento es muy corto, concatenar sin fade
                result = np.concatenate([result, next_seg])
                continue
            
            # Curvas exponenciales para transición más natural
            # Exponente 0.5 = curva suave (raíz cuadrada)
            fade_out = np.power(np.linspace(1, 0, fade_len), 0.5)
            fade_in = np.power(np.linspace(0, 1, fade_len), 0.5)
            
            # Aplicar fades
            result_end = result[-fade_len:] * fade_out
            next_start = next_seg[:fade_len] * fade_in
            
            # Zona de overlap
            overlap = result_end + next_start
            
            # Unir: [inicio...][overlap][...resto del siguiente]
            result = np.concatenate([
                result[:-fade_len], 
                overlap, 
                next_seg[fade_len:]
            ])
        
        return result
    
    def trim_silence(self, audio: np.ndarray, top_db: int = 25) -> np.ndarray:
        """
        Elimina silencios al inicio y final del audio.
        
        Args:
            audio: Array de audio
            top_db: Umbral en dB para considerar silencio
        
        Returns:
            Audio sin silencios extremos
        """
        trimmed, _ = librosa.effects.trim(audio, top_db=top_db)
        return trimmed
    
    def detect_pauses(self, audio: np.ndarray, threshold_db: int = -40, min_pause_ms: int = 100) -> list:
        """
        Detecta pausas en el audio basándose en energía RMS.
        
        Args:
            audio: Array de audio
            threshold_db: Umbral en dB para considerar silencio
            min_pause_ms: Duración mínima en ms para considerar pausa
        
        Returns:
            Lista de tuplas (start_ms, end_ms, duration_ms) para cada pausa
        """
        # Calcular RMS frame by frame
        frame_length = int(self.sr * 0.025)  # 25ms frames
        hop_length = int(self.sr * 0.010)    # 10ms hop
        
        rms = librosa.feature.rms(y=audio, frame_length=frame_length, hop_length=hop_length)[0]
        
        # Convertir a dB
        rms_db = librosa.amplitude_to_db(rms, ref=np.max)
        
        # Encontrar frames de silencio
        is_silence = rms_db < threshold_db
        
        pauses = []
        in_pause = False
        pause_start = 0
        
        for i, silent in enumerate(is_silence):
            time_ms = int(i * hop_length / self.sr * 1000)
            
            if silent and not in_pause:
                in_pause = True
                pause_start = time_ms
            elif not silent and in_pause:
                in_pause = False
                duration = time_ms - pause_start
                if duration >= min_pause_ms:
                    pauses.append((pause_start, time_ms, duration))
        
        return pauses
    
    def calculate_speech_rate(self, audio: np.ndarray, transcription: str) -> dict:
        """
        Calcula la velocidad de habla basándose en transcripción y duración.
        
        Args:
            audio: Array de audio
            transcription: Texto transcrito del audio
        
        Returns:
            dict: {
                'wpm': float,           # Palabras por minuto
                'tempo': float,         # Estimación de sílabas/segundo
                'avg_pause_ms': int,    # Pausa promedio en ms
                'total_pauses': int,    # Número de pausas detectadas
                'energy_profile': str   # 'calm', 'dynamic', 'mixed'
            }
        """
        if not transcription or len(audio) == 0:
            return {
                'wpm': 150.0,  # Default
                'tempo': 4.0,
                'avg_pause_ms': 400,
                'total_pauses': 0,
                'energy_profile': 'mixed'
            }
        
        # Duración en segundos y minutos
        duration_sec = len(audio) / self.sr
        duration_min = duration_sec / 60.0
        
        # Contar palabras (limpiar puntuación)
        words = transcription.split()
        word_count = len(words)
        
        # WPM (palabras por minuto)
        wpm = word_count / duration_min if duration_min > 0 else 150.0
        
        # Estimar sílabas (aproximación: 1.5 sílabas/palabra en español)
        syllable_count = word_count * 1.5
        tempo = syllable_count / duration_sec if duration_sec > 0 else 4.0
        
        # Detectar pausas
        pauses = self.detect_pauses(audio)
        total_pauses = len(pauses)
        avg_pause_ms = int(sum(p[2] for p in pauses) / total_pauses) if total_pauses > 0 else 400
        
        # Determinar perfil de energía basado en variación de RMS
        rms = librosa.feature.rms(y=audio)[0]
        rms_std = np.std(rms)
        rms_mean = np.mean(rms)
        variation_coef = rms_std / rms_mean if rms_mean > 0 else 0.5
        
        if variation_coef < 0.3:
            energy_profile = 'calm'
        elif variation_coef > 0.6:
            energy_profile = 'dynamic'
        else:
            energy_profile = 'mixed'
        
        print(f"   📊 Voice Stats: WPM={wpm:.1f}, Tempo={tempo:.2f}, AvgPause={avg_pause_ms}ms, Profile={energy_profile}")
        
        return {
            'wpm': round(wpm, 1),
            'tempo': round(tempo, 2),
            'avg_pause_ms': avg_pause_ms,
            'total_pauses': total_pauses,
            'energy_profile': energy_profile
        }

