# -*- coding: utf-8 -*-
"""
Servidor F5-TTS para VIRA.
Versión modular optimizada para calidad máxima.

Endpoints:
- GET  /health         - Estado del servidor
- GET  /voices         - Lista de voces disponibles
- POST /upload_voice   - Subir nueva voz de referencia
- POST /tts            - Generar audio (textos cortos)
- POST /tts_batch      - Generar audio (alias, mismo comportamiento)
"""

import os
import io
import base64
import tempfile
import warnings

import soundfile as sf
from flask import Flask, request, jsonify, send_file, after_this_request
from flask_cors import CORS

# Suprimir advertencias no críticas
warnings.filterwarnings("ignore")

# Importar módulos propios
from config import Config
from core.audio_processor import AudioProcessor
from core.voice_manager import VoiceManager
from core.tts_engine import TTSEngine
from core.text_cleaner import TextCleaner


# =============================================================================
# INICIALIZACIÓN
# =============================================================================

app = Flask(__name__)
CORS(app)

print("=" * 60)
print("🚀 Iniciando F5-TTS Server (Modular)")
print("=" * 60)

# Configuración
print(f"\n📊 Configuración:")
print(f"   Device: {Config.DEVICE}")
print(f"   NFE Step: {Config.NFE_STEP}")
print(f"   Sway Sampling: {Config.SWAY_SAMPLING}")
print(f"   Speed: {Config.SPEED}")
print(f"   Whisper Model: {Config.WHISPER_MODEL}")

# Componentes
processor = AudioProcessor(Config.SAMPLE_RATE)
voice_manager = VoiceManager(
    Config.TARGETS_DIR, 
    Config.WHISPER_MODEL, 
    Config.DEVICE,
    Config.SAMPLE_RATE
)
tts_engine = TTSEngine(Config, processor)

# Pre-cargar voces existentes (esto ejecuta Whisper para transcribir)
print("\n" + "=" * 60)
voice_manager.preload_all_voices()
print("=" * 60)


# =============================================================================
# ENDPOINTS
# =============================================================================

@app.route('/health', methods=['GET'])
def health():
    """Estado del servidor."""
    return jsonify({
        "status": "healthy",
        "device": Config.DEVICE,
        "model": Config.REPO_ID,
        "voices_cached": len(voice_manager.cache),
        "config": {
            "nfe_step": Config.NFE_STEP,
            "sway_sampling": Config.SWAY_SAMPLING,
            "speed": Config.SPEED
        }
    })


@app.route('/voices', methods=['GET'])
def list_voices():
    """Lista todas las voces disponibles."""
    try:
        voices = voice_manager.list_voices()
        
        # Formato compatible con frontend
        formatted = []
        for v in voices:
            formatted.append({
                "id": v["id"],
                "name": v["name"],
                "language": "es",
                "type": "local",
                "has_transcription": v["has_transcription"]
            })
        
        return jsonify({
            "voices": formatted,
            "count": len(formatted)
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/upload_voice', methods=['POST'])
def upload_voice():
    """
    Sube y procesa nueva voz de referencia.
    
    Form data:
    - audio: Archivo de audio (wav, mp3, m4a)
    - voice_id: ID opcional para la voz
    
    Returns:
    - voice_id: ID asignado
    - transcription: Transcripción del audio
    """
    try:
        if 'audio' not in request.files:
            return jsonify({"error": "No audio file provided"}), 400
        
        audio_file = request.files['audio']
        voice_id = request.form.get('voice_id')
        
        # Guardar temporalmente
        temp_path = os.path.join(tempfile.gettempdir(), f"upload_{audio_file.filename}")
        audio_file.save(temp_path)
        
        print(f"\n📤 Upload recibido: {audio_file.filename}")
        
        # Procesar con VoiceManager (ahora retorna 4 valores incluyendo voice_stats)
        processed_path, transcription, vid, voice_stats = voice_manager.process_user_upload(
            temp_path, 
            voice_id
        )
        
        # Limpiar archivo temporal
        try:
            os.remove(temp_path)
        except:
            pass
        
        return jsonify({
            "success": True,
            "voice_id": vid,
            "transcription": transcription,
            "voice_stats": voice_stats,  # NEW: WPM, tempo, pausas
            "message": f"Voz '{vid}' procesada y lista para usar"
        })
        
    except Exception as e:
        print(f"❌ Error en upload: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route('/tts', methods=['POST'])
@app.route('/tts_batch', methods=['POST'])
def text_to_speech():
    """
    Endpoint unificado de Text-to-Speech.
    
    JSON body:
    - text: Texto a sintetizar (requerido)
    - voice_id o voice: ID de la voz a usar (requerido)
    - format: 'base64' (default) o 'file'
    - speed: Velocidad (opcional, usa config por defecto)
    
    Returns:
    - success: bool
    - audio_base64: Audio en base64 (si format=base64)
    - duration: Duración en segundos
    - sample_rate: Tasa de muestreo
    """
    try:
        data = request.get_json()
        
        # Parámetros
        raw_text = data.get('text')
        voice_id = data.get('voice_id') or data.get('voice')
        return_format = data.get('format', 'base64')
        
        # Validaciones
        if not raw_text:
            return jsonify({"error": "No text provided"}), 400
        
        if not voice_id:
            return jsonify({"error": "No voice_id provided"}), 400
        
        # Obtener voz del cache
        voice = voice_manager.get_voice(voice_id)
        if not voice:
            # Listar voces disponibles para el error
            available = list(voice_manager.cache.keys())
            return jsonify({
                "error": f"Voice '{voice_id}' not found",
                "available_voices": available[:5]  # Mostrar primeras 5
            }), 400
        
        # Limpiar texto
        clean_text = TextCleaner.clean(raw_text)
        
        # Dividir en chunks si es largo
        chunks = TextCleaner.split_chunks(clean_text, Config.MAX_CHUNK_CHARS)
        
        print(f"\n{'='*50}")
        print(f"🎙️ TTS Request")
        print(f"   Voz: {voice_id}")
        print(f"   Texto: {len(raw_text)} chars → {len(clean_text)} limpio")
        print(f"   Chunks: {len(chunks)}")
        print(f"   Parámetros: nfe_step={Config.NFE_STEP}, speed={Config.SPEED}")
        print(f"{'='*50}")
        
        # Generar audio
        audio, sr = tts_engine.generate(
            text=clean_text,
            ref_path=voice['path'],
            ref_text=voice.get('text', ''),
            chunks=chunks if len(chunks) > 1 else None
        )
        
        # Calcular duración
        duration = len(audio) / sr if len(audio) > 0 else 0
        
        print(f"\n✅ Generación completada: {duration:.2f}s")
        
        # Verificar que hay audio
        if len(audio) == 0:
            return jsonify({"error": "No audio generated"}), 500
        
        # Responder según formato
        if return_format == 'base64':
            buffer = io.BytesIO()
            sf.write(buffer, audio, sr, format='WAV')
            audio_bytes = buffer.getvalue()
            audio_b64 = base64.b64encode(audio_bytes).decode('utf-8')
            
            return jsonify({
                "success": True,
                "audio_base64": audio_b64,
                "stitched_audio_base64": audio_b64,  # Compatibilidad con frontend
                "duration": duration,
                "sample_rate": sr
            })
        
        else:
            # Devolver como archivo
            buffer = io.BytesIO()
            sf.write(buffer, audio, sr, format='WAV')
            buffer.seek(0)
            
            return send_file(
                buffer,
                mimetype='audio/wav',
                as_attachment=True,
                download_name=f"tts_{voice_id}.wav"
            )
    
    except Exception as e:
        print(f"\n❌ Error en TTS: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


# =============================================================================
# MAIN
# =============================================================================

if __name__ == '__main__':
    print("\n" + "=" * 60)
    print(f"🚀 Servidor F5-TTS listo en http://0.0.0.0:5000")
    print(f"   Calidad: nfe_step={Config.NFE_STEP}")
    print(f"   Voces cargadas: {len(voice_manager.cache)}")
    print("=" * 60 + "\n")
    
    app.run(host='0.0.0.0', port=5000, threaded=True)