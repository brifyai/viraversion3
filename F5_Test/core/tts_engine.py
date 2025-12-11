# -*- coding: utf-8 -*-
"""
Motor TTS con F5-TTS optimizado para calidad.

Wrapper que encapsula la lógica de generación de audio
con parámetros configurables y thread-safety.
"""

import threading
import numpy as np
from f5_tts.api import F5TTS
from huggingface_hub import hf_hub_download

from .audio_processor import AudioProcessor


class TTSEngine:
    """
    Motor de síntesis de voz usando F5-TTS.
    
    Características:
    - Thread-safe con lock para peticiones concurrentes
    - Parámetros optimizados para calidad
    - Generación por chunks con crossfade
    - Post-procesamiento automático
    """
    
    def __init__(self, config, audio_processor: AudioProcessor = None):
        """
        Inicializa el motor TTS.
        
        Args:
            config: Objeto Config con parámetros
            audio_processor: Instancia de AudioProcessor (opcional)
        """
        self.config = config
        self.processor = audio_processor or AudioProcessor(config.SAMPLE_RATE)
        self.lock = threading.Lock()
        
        # Cargar modelo F5-TTS
        print(f"\n🎙️ Cargando modelo F5-TTS en {config.DEVICE}...")
        print(f"   Repo: {config.REPO_ID}")
        
        ckpt_file = hf_hub_download(
            repo_id=config.REPO_ID, 
            filename="model_1200000.safetensors"
        )
        vocab_file = hf_hub_download(
            repo_id=config.REPO_ID, 
            filename="vocab.txt"
        )
        
        self.model = F5TTS(
            model_type="F5-TTS",
            ckpt_file=ckpt_file,
            vocab_file=vocab_file,
            device=config.DEVICE
        )
        
        print(f"   ✅ Modelo cargado")
        print(f"   📊 Parámetros: nfe_step={config.NFE_STEP}, sway={config.SWAY_SAMPLING}, speed={config.SPEED}")
    
    def generate_chunk(
        self, 
        text: str, 
        ref_path: str, 
        ref_text: str = ""
    ) -> tuple:
        """
        Genera audio para un chunk de texto.
        
        Args:
            text: Texto a sintetizar
            ref_path: Ruta al audio de referencia
            ref_text: Transcripción del audio de referencia
        
        Returns:
            tuple: (wav_array, sample_rate)
        """
        with self.lock:
            wav, sr, _ = self.model.infer(
                ref_file=ref_path,
                ref_text=ref_text,
                gen_text=text,
                remove_silence=self.config.REMOVE_SILENCE,
                speed=self.config.SPEED,
                nfe_step=self.config.NFE_STEP,
                sway_sampling_coef=self.config.SWAY_SAMPLING,
            )
        
        return wav, sr
    
    def generate(
        self, 
        text: str, 
        ref_path: str, 
        ref_text: str = "",
        chunks: list = None
    ) -> tuple:
        """
        Genera audio completo, opcionalmente por chunks.
        
        Si se proporcionan chunks, genera cada uno por separado
        y los une con crossfade. Si no, genera el texto completo.
        
        Args:
            text: Texto completo (usado si chunks es None)
            ref_path: Ruta al audio de referencia
            ref_text: Transcripción del audio de referencia
            chunks: Lista de chunks de texto (opcional)
        
        Returns:
            tuple: (audio_final, sample_rate)
        """
        # Si no hay chunks, usar texto completo
        if chunks is None or len(chunks) <= 1:
            chunks = [text]
        
        segments = []
        total_chunks = len(chunks)
        
        print(f"\n🔊 Generando {total_chunks} segmento(s)...")
        
        for i, chunk in enumerate(chunks, 1):
            preview = chunk[:40] + "..." if len(chunk) > 40 else chunk
            print(f"   [{i}/{total_chunks}] \"{preview}\"")
            
            try:
                wav, sr = self.generate_chunk(chunk, ref_path, ref_text)
                
                # Trim silencio de cada chunk
                wav = self.processor.trim_silence(wav, top_db=25)
                
                # Solo agregar si tiene contenido
                if len(wav) > 0:
                    segments.append(wav)
                    duration = len(wav) / sr
                    print(f"            → {duration:.2f}s")
                    
            except Exception as e:
                print(f"   ⚠️ Error en chunk {i}: {e}")
                continue
        
        if not segments:
            print("   ❌ No se generó ningún segmento")
            return np.array([]), self.config.SAMPLE_RATE
        
        # Unir segmentos con crossfade
        if len(segments) > 1:
            print(f"\n🔗 Uniendo {len(segments)} segmentos con crossfade...")
            final = self.processor.crossfade_segments(
                segments, 
                self.config.CROSSFADE_MS
            )
        else:
            final = segments[0]
        
        # Post-procesar audio final
        print("🎨 Aplicando post-procesamiento...")
        final = self.processor.postprocess_generated(final)
        
        duration = len(final) / self.config.SAMPLE_RATE
        print(f"\n✅ Audio final: {duration:.2f}s")
        
        return final, self.config.SAMPLE_RATE
    
    def get_info(self) -> dict:
        """
        Retorna información del motor TTS.
        
        Returns:
            dict con parámetros actuales
        """
        return {
            "model": self.config.REPO_ID,
            "device": self.config.DEVICE,
            "nfe_step": self.config.NFE_STEP,
            "sway_sampling": self.config.SWAY_SAMPLING,
            "speed": self.config.SPEED,
            "sample_rate": self.config.SAMPLE_RATE,
            "crossfade_ms": self.config.CROSSFADE_MS
        }
