# -*- coding: utf-8 -*-
"""
Gestión de voces de referencia con transcripción automática.

Incluye:
- Cache de voces procesadas
- Transcripción automática con Whisper
- Manejo de uploads de usuarios
- Selección inteligente de segmentos de referencia
"""

import os
import hashlib
import gc
import torch

from .audio_processor import AudioProcessor


class VoiceManager:
    """
    Gestor de voces de referencia para F5-TTS.
    
    Mantiene un cache de voces procesadas con sus transcripciones
    para evitar reprocesar cada vez.
    """
    
    def __init__(
        self, 
        targets_dir: str, 
        whisper_model: str = "small",
        device: str = "cuda",
        sample_rate: int = 24000
    ):
        self.targets_dir = targets_dir
        self.device = device
        self.sample_rate = sample_rate
        
        # Cache: {voice_id: {'path': str, 'text': str}}
        self.cache = {}
        
        # Procesador de audio
        self.processor = AudioProcessor(sample_rate)
        
        # Whisper se carga bajo demanda
        self._whisper = None
        self._whisper_model = whisper_model
        
        # Crear directorio si no existe
        if not os.path.exists(targets_dir):
            os.makedirs(targets_dir)
    
    @property
    def whisper(self):
        """Carga Whisper solo cuando se necesita (lazy loading)."""
        if self._whisper is None:
            print(f"🎤 Cargando Whisper ({self._whisper_model}) en {self.device}...")
            import whisper
            self._whisper = whisper.load_model(self._whisper_model, device=self.device)
            print("   ✅ Whisper cargado")
        return self._whisper
    
    def unload_whisper(self):
        """Libera memoria de Whisper cuando no se necesita."""
        if self._whisper is not None:
            del self._whisper
            self._whisper = None
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            gc.collect()
            print("🗑️ Whisper descargado de memoria")
    
    def transcribe(self, audio_path: str) -> str:
        """
        Transcribe audio con Whisper.
        
        Args:
            audio_path: Ruta al archivo de audio
        
        Returns:
            Texto transcrito
        """
        print(f"📝 Transcribiendo: {os.path.basename(audio_path)}")
        result = self.whisper.transcribe(audio_path, language="es")
        text = result["text"].strip()
        print(f"   → \"{text[:60]}...\"" if len(text) > 60 else f"   → \"{text}\"")
        return text
    
    def get_best_segment(
        self, 
        audio_path: str, 
        min_duration: float = 5.0, 
        max_duration: float = 10.0
    ) -> dict:
        """
        Encuentra el mejor segmento del audio para usar como referencia.
        
        Usa scoring inteligente basado en:
        - Duración ideal (7-8 segundos)
        - Longitud de texto (40-80 caracteres)
        - Número de palabras (mínimo 5)
        - Confianza de Whisper
        
        Args:
            audio_path: Ruta al audio
            min_duration: Duración mínima del segmento
            max_duration: Duración máxima del segmento
        
        Returns:
            Diccionario con info del mejor segmento
        """
        print(f"🔍 Buscando mejor segmento en: {os.path.basename(audio_path)}")
        
        result = self.whisper.transcribe(audio_path, language="es")
        segments = result.get("segments", [])
        
        if not segments:
            return None
        
        best = None
        best_score = -100
        
        for seg in segments:
            duration = seg["end"] - seg["start"]
            text = seg["text"].strip()
            
            # Solo considerar segmentos en el rango de duración
            if not (min_duration <= duration <= max_duration):
                continue
            
            score = 0
            
            # Bonificar duración ideal (7-8 segundos)
            if 7.0 <= duration <= 8.0:
                score += 50
            elif 6.0 <= duration < 7.0 or 8.0 < duration <= 9.0:
                score += 30
            else:
                score += 10
            
            # Bonificar longitud de texto ideal (40-80 chars)
            if 40 <= len(text) <= 80:
                score += 30
            elif 25 <= len(text) < 40 or 80 < len(text) <= 100:
                score += 15
            
            # Penalizar frases muy cortas (mala articulación)
            if len(text.split()) < 5:
                score -= 20
            
            # Bonificar alta confianza de Whisper
            if seg.get("no_speech_prob", 1.0) < 0.1:
                score += 20
            
            if score > best_score:
                best_score = score
                best = {
                    "start": seg["start"],
                    "end": seg["end"],
                    "text": text,
                    "score": score
                }
        
        # Fallback al primer segmento si no hay ideal
        if best is None and segments:
            seg = segments[0]
            best = {
                "start": seg["start"],
                "end": seg["end"],
                "text": seg["text"].strip(),
                "score": 0
            }
        
        if best:
            print(f"   ✅ Seleccionado (score={best['score']}): {best['start']:.1f}s-{best['end']:.1f}s")
            print(f"   → \"{best['text'][:50]}...\"" if len(best['text']) > 50 else f"   → \"{best['text']}\"")
        
        return best
    
    def process_user_upload(self, audio_path: str, voice_id: str = None) -> tuple:
        """
        Procesa un audio subido por usuario.
        
        1. Preprocesa el audio (normalización)
        2. Extrae el MEJOR SEGMENTO de 5-10 segundos usando Whisper
        3. Guarda solo ese segmento como referencia
        4. Usa la transcripción de ese segmento específico
        
        Args:
            audio_path: Ruta al audio original
            voice_id: ID opcional para la voz (se genera si no se proporciona)
        
        Returns:
            tuple: (processed_path, transcription, voice_id)
        """
        import librosa
        import soundfile as sf_lib
        
        # Generar ID si no se proporciona (sin extensión)
        if voice_id is None:
            with open(audio_path, 'rb') as f:
                voice_id = hashlib.md5(f.read()).hexdigest()[:16]
        
        # Limpiar voice_id de extensiones
        voice_id = voice_id.replace('.mp3', '').replace('.wav', '').replace('.m4a', '').replace('.flac', '')
        
        print(f"\n🎙️ Procesando voz: {voice_id}")
        
        # 1. Preprocesar audio completo primero (normalización básica)
        temp_processed = os.path.join(self.targets_dir, f"{voice_id}_temp.wav")
        self.processor.preprocess_reference(audio_path, temp_processed)
        
        # 2. Cargar audio y verificar duración
        y, sr = librosa.load(temp_processed, sr=self.sample_rate)
        duration = len(y) / sr
        print(f"   📏 Duración del audio: {duration:.1f}s")
        
        # Ruta final del archivo procesado
        output_path = os.path.join(self.targets_dir, f"{voice_id}_processed.wav")
        
        # 3. Si el audio es largo (>10s), extraer mejor segmento
        if duration > 10.0:
            print(f"   🔍 Audio largo, buscando mejor segmento de 5-10s...")
            best_seg = self.get_best_segment(temp_processed, min_duration=5.0, max_duration=10.0)
            
            if best_seg:
                # Extraer solo el segmento seleccionado
                start_sample = int(best_seg["start"] * sr)
                end_sample = int(best_seg["end"] * sr)
                y_segment = y[start_sample:end_sample]
                
                # Guardar segmento
                sf_lib.write(output_path, y_segment, sr)
                transcription = best_seg["text"]
                
                segment_duration = len(y_segment) / sr
                print(f"   ✂️ Segmento extraído: {best_seg['start']:.1f}s - {best_seg['end']:.1f}s ({segment_duration:.1f}s)")
            else:
                # Fallback: usar primeros 10 segundos
                print(f"   ⚠️ No se encontró segmento ideal, usando primeros 10s")
                y_segment = y[:int(10 * sr)]
                sf_lib.write(output_path, y_segment, sr)
                transcription = self.transcribe(output_path)
        else:
            # Audio corto: usar completo
            print(f"   ✅ Audio corto, usando completo")
            sf_lib.write(output_path, y, sr)
            transcription = self.transcribe(output_path)
        
        # Limpiar archivo temporal
        try:
            os.remove(temp_processed)
        except:
            pass
        
        # 4. Cargar audio final y analizar características
        y_final, _ = librosa.load(output_path, sr=self.sample_rate)
        final_duration = len(y_final) / self.sample_rate
        
        print(f"   📊 Analizando características de la voz...")
        voice_stats = self.processor.calculate_speech_rate(y_final, transcription)
        
        # 5. Cachear con stats
        self.cache[voice_id] = {
            'path': output_path,
            'text': transcription,
            'voice_stats': voice_stats
        }
        
        print(f"   ✅ Voz '{voice_id}' lista para usar")
        print(f"   📏 Duración final: {final_duration:.1f}s")
        print(f"   📝 Ref text: \"{transcription[:60]}...\"" if len(transcription) > 60 else f"   📝 Ref text: \"{transcription}\"")
        
        return output_path, transcription, voice_id, voice_stats
    
    def get_voice(self, voice_id: str) -> dict:
        """
        Obtiene voz del cache o la procesa si no existe.
        
        Args:
            voice_id: ID de la voz (con o sin extensión)
        
        Returns:
            dict: {'path': str, 'text': str} o None si no existe
        """
        if not voice_id:
            return None
        
        # Limpiar voice_id de extensiones ANTES de buscar en cache
        clean_id = voice_id.replace('.mp3', '').replace('.wav', '').replace('.m4a', '').replace('.flac', '')
        
        # DEBUG: Mostrar IDs
        print(f"🔎 get_voice: original='{voice_id}' → clean='{clean_id}'")
        print(f"   Cache keys: {list(self.cache.keys())}")
        
        # Verificar cache primero con el ID limpio
        if clean_id in self.cache:
            print(f"   ✅ Encontrado en cache")
            return self.cache[clean_id]
        
        print(f"   ⚠️ No en cache, buscando archivo...")
        
        # Buscar archivo en targets
        for ext in ['', '.wav', '.mp3', '.m4a', '.flac', '_processed.wav']:
            path = os.path.join(self.targets_dir, clean_id + ext)
            if os.path.exists(path):
                print(f"   📂 Archivo encontrado: {path}")
                # Procesar y cachear
                processed, text, _ = self.process_user_upload(path, clean_id)
                return self.cache.get(clean_id)
        
        print(f"   ❌ Archivo no encontrado para '{clean_id}'")
        return None
    
    def preload_all_voices(self):
        """
        Pre-carga y procesa todas las voces al iniciar el servidor.
        
        Esto evita latencia en la primera solicitud de cada voz.
        """
        if not os.path.exists(self.targets_dir):
            return
        
        count = 0
        errors = 0
        
        print(f"\n📂 Pre-cargando voces desde: {self.targets_dir}")
        
        for filename in os.listdir(self.targets_dir):
            # Solo procesar archivos de audio (no los ya procesados)
            if filename.endswith(('.wav', '.mp3', '.m4a', '.flac')):
                # Evitar reprocesar archivos ya procesados
                if '_processed.wav' in filename:
                    continue
                
                voice_id = os.path.splitext(filename)[0]
                
                # Verificar si ya está cacheado (por un _processed.wav existente)
                if voice_id in self.cache:
                    continue
                
                try:
                    self.get_voice(voice_id)
                    count += 1
                except Exception as e:
                    print(f"   ⚠️ Error procesando {filename}: {e}")
                    errors += 1
        
        if count > 0:
            print(f"\n✅ {count} voces pre-cargadas en cache")
        if errors > 0:
            print(f"⚠️ {errors} voces con errores")
        
        # Liberar Whisper después de pre-cargar
        self.unload_whisper()
    
    def list_voices(self) -> list:
        """
        Lista todas las voces disponibles.
        
        Returns:
            Lista de diccionarios con info de cada voz
        """
        voices = []
        
        for vid, data in self.cache.items():
            voices.append({
                "id": vid,
                "name": vid.replace('_', ' ').replace('-', ' ').title(),
                "has_transcription": bool(data.get('text')),
                "transcription_preview": data.get('text', '')[:50] + "..." if len(data.get('text', '')) > 50 else data.get('text', '')
            })
        
        return voices
