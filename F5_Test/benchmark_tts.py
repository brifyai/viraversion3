# -*- coding: utf-8 -*-
"""
Benchmark F5-TTS - Script de pruebas con múltiples configuraciones.

Genera audios con diferentes combinaciones de parámetros para evaluar
calidad, velocidad y estabilidad del motor TTS.

Uso:
    python benchmark_tts.py
"""

import os
import time
import warnings
from datetime import datetime
from dataclasses import dataclass
from typing import List, Tuple, Optional

import numpy as np
import soundfile as sf
from f5_tts.api import F5TTS
from huggingface_hub import hf_hub_download
import torch

# Suprimir advertencias no críticas
warnings.filterwarnings("ignore")


# =============================================================================
# CONFIGURACIÓN DEL BENCHMARK
# =============================================================================

@dataclass
class TestConfig:
    """Configuración para una prueba individual."""
    test_id: str
    nfe_step: int
    sway_sampling: float
    speed: float
    crossfade_ms: int
    description: str


# Voz de referencia a usar
REFERENCE_VOICE = "05612c74-d3d5-441b-bae1-9802dae5afeb_processed.wav"

# Directorio base
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TARGETS_DIR = os.path.join(BASE_DIR, 'targets')
RESULTS_DIR = os.path.join(BASE_DIR, 'benchmark_results')

# Device
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# Sample rate del modelo F5
SAMPLE_RATE = 24000


# =============================================================================
# FRASES DE PRUEBA
# =============================================================================

TEST_PHRASES = {
    "corta": "El presidente anunció nuevas medidas económicas que entrarán en vigencia el próximo lunes.",
    
    "larga": """En un emotivo evento realizado esta mañana en el Palacio de la Moneda, 
el presidente de la República anunció un paquete de medidas económicas 
que buscan reactivar el empleo y ayudar a las pequeñas y medianas 
empresas afectadas por la crisis. El ministro de Hacienda explicó que 
estas medidas incluyen subsidios directos, créditos blandos y exenciones 
tributarias que beneficiarán a más de un millón de familias chilenas.""",
    
    "clima": """Para mañana se esperan temperaturas máximas de 28 grados en Santiago, 
con probabilidad de lluvias de un 15 por ciento en la tarde."""
}


# =============================================================================
# MATRIZ DE CONFIGURACIONES
# =============================================================================

CONFIGS: List[TestConfig] = [
    # Grupo 1: Variando NFE_STEP
    TestConfig("T01", nfe_step=16, sway_sampling=-1.0, speed=1.0, crossfade_ms=75, description="NFE bajo"),
    TestConfig("T02", nfe_step=32, sway_sampling=-1.0, speed=1.0, crossfade_ms=75, description="NFE normal"),
    TestConfig("T03", nfe_step=48, sway_sampling=-1.0, speed=1.0, crossfade_ms=75, description="NFE medio-alto"),
    TestConfig("T04", nfe_step=64, sway_sampling=-1.0, speed=1.0, crossfade_ms=75, description="NFE alto"),
    TestConfig("T05", nfe_step=96, sway_sampling=-1.0, speed=1.0, crossfade_ms=75, description="NFE máximo"),
    
    # Grupo 2: Variando SPEED
    TestConfig("T06", nfe_step=64, sway_sampling=-1.0, speed=0.9, crossfade_ms=75, description="Lento"),
    TestConfig("T07", nfe_step=64, sway_sampling=-1.0, speed=1.0, crossfade_ms=75, description="Normal"),
    TestConfig("T08", nfe_step=64, sway_sampling=-1.0, speed=1.1, crossfade_ms=75, description="Ligero rápido"),
    TestConfig("T09", nfe_step=64, sway_sampling=-1.0, speed=1.2, crossfade_ms=75, description="Rápido"),
    TestConfig("T10", nfe_step=64, sway_sampling=-1.0, speed=1.3, crossfade_ms=75, description="Muy rápido"),
    
    # Grupo 3: Variando SWAY_SAMPLING
    TestConfig("T11", nfe_step=64, sway_sampling=-0.5, speed=1.0, crossfade_ms=75, description="Sway bajo"),
    TestConfig("T12", nfe_step=64, sway_sampling=-1.0, speed=1.0, crossfade_ms=75, description="Sway normal"),
    TestConfig("T13", nfe_step=64, sway_sampling=-1.2, speed=1.0, crossfade_ms=75, description="Sway alto"),
    
    # Grupo 4: Combinaciones "Best Guess"
    TestConfig("T14", nfe_step=48, sway_sampling=-1.0, speed=1.1, crossfade_ms=75, description="Balance"),
    TestConfig("T15", nfe_step=64, sway_sampling=-0.8, speed=1.0, crossfade_ms=100, description="Alta calidad"),
    TestConfig("T16", nfe_step=32, sway_sampling=-1.0, speed=1.0, crossfade_ms=50, description="Producción rápida"),
]


# =============================================================================
# BENCHMARK ENGINE
# =============================================================================

class BenchmarkRunner:
    """Ejecuta el benchmark con múltiples configuraciones."""
    
    def __init__(self):
        self.results = []
        self.model = None
        self.ref_path = os.path.join(TARGETS_DIR, REFERENCE_VOICE)
        self.ref_text = ""  # Se podría agregar transcripción si existe
        
    def load_model(self):
        """Carga el modelo F5-TTS."""
        print("=" * 60)
        print("🚀 Cargando modelo F5-TTS...")
        print("=" * 60)
        
        ckpt_file = hf_hub_download(
            repo_id="jpgallegoar/F5-Spanish", 
            filename="model_1200000.safetensors"
        )
        vocab_file = hf_hub_download(
            repo_id="jpgallegoar/F5-Spanish", 
            filename="vocab.txt"
        )
        
        self.model = F5TTS(
            model_type="F5-TTS",
            ckpt_file=ckpt_file,
            vocab_file=vocab_file,
            device=DEVICE
        )
        
        print(f"✅ Modelo cargado en {DEVICE}")
        print(f"📁 Voz de referencia: {REFERENCE_VOICE}")
        print()
        
    def generate_audio(
        self, 
        text: str, 
        config: TestConfig
    ) -> Tuple[Optional[np.ndarray], float, str]:
        """
        Genera audio con una configuración específica.
        
        Returns:
            tuple: (audio_array, tiempo_procesamiento, status)
        """
        start_time = time.time()
        
        try:
            wav, sr, _ = self.model.infer(
                ref_file=self.ref_path,
                ref_text=self.ref_text,
                gen_text=text,
                remove_silence=True,
                speed=config.speed,
                nfe_step=config.nfe_step,
                sway_sampling_coef=config.sway_sampling,
            )
            
            elapsed = time.time() - start_time
            return wav, elapsed, "OK"
            
        except Exception as e:
            elapsed = time.time() - start_time
            error_msg = str(e)[:50]
            return None, elapsed, f"ERROR: {error_msg}"
    
    def run_single_test(
        self, 
        config: TestConfig, 
        phrase_name: str, 
        phrase_text: str
    ) -> dict:
        """Ejecuta una prueba individual."""
        
        print(f"   📝 Frase: {phrase_name} ({len(phrase_text)} chars)...", end=" ", flush=True)
        
        wav, elapsed, status = self.generate_audio(phrase_text, config)
        
        # Calcular métricas
        duration = 0
        rtf = 0
        
        if wav is not None and len(wav) > 0:
            duration = len(wav) / SAMPLE_RATE
            rtf = elapsed / duration if duration > 0 else 0
            
            # Guardar audio
            filename = f"{config.test_id}_{phrase_name}.wav"
            filepath = os.path.join(RESULTS_DIR, filename)
            sf.write(filepath, wav, SAMPLE_RATE)
            
            print(f"✅ {duration:.1f}s audio, {elapsed:.1f}s proc, RTF={rtf:.2f}")
        else:
            print(f"❌ {status}")
        
        return {
            "test_id": config.test_id,
            "phrase": phrase_name,
            "nfe_step": config.nfe_step,
            "sway": config.sway_sampling,
            "speed": config.speed,
            "crossfade": config.crossfade_ms,
            "text_chars": len(phrase_text),
            "audio_duration": round(duration, 2),
            "processing_time": round(elapsed, 2),
            "rtf": round(rtf, 3),
            "status": status
        }
    
    def run_all_tests(self):
        """Ejecuta todas las pruebas del benchmark."""
        
        total_tests = len(CONFIGS) * len(TEST_PHRASES)
        current = 0
        
        print("=" * 60)
        print(f"🧪 Iniciando Benchmark: {len(CONFIGS)} configs × {len(TEST_PHRASES)} frases = {total_tests} tests")
        print("=" * 60)
        print()
        
        for config in CONFIGS:
            print(f"\n🔧 [{config.test_id}] {config.description}")
            print(f"   NFE={config.nfe_step}, SWAY={config.sway_sampling}, SPEED={config.speed}")
            
            for phrase_name, phrase_text in TEST_PHRASES.items():
                current += 1
                result = self.run_single_test(config, phrase_name, phrase_text)
                self.results.append(result)
        
        print()
        print("=" * 60)
        print(f"✅ Benchmark completado: {len(self.results)} pruebas")
        print("=" * 60)
    
    def generate_report(self):
        """Genera el reporte markdown con los resultados."""
        
        report_path = os.path.join(RESULTS_DIR, "benchmark_report.md")
        
        # Agrupar por status
        ok_tests = [r for r in self.results if r["status"] == "OK"]
        error_tests = [r for r in self.results if r["status"] != "OK"]
        
        # Calcular estadísticas
        if ok_tests:
            avg_rtf = sum(r["rtf"] for r in ok_tests) / len(ok_tests)
            min_rtf = min(r["rtf"] for r in ok_tests)
            max_rtf = max(r["rtf"] for r in ok_tests)
        else:
            avg_rtf = min_rtf = max_rtf = 0
        
        with open(report_path, 'w', encoding='utf-8') as f:
            f.write("# Benchmark F5-TTS - Resultados\n\n")
            f.write(f"**Fecha:** {datetime.now().strftime('%Y-%m-%d %H:%M')}\n\n")
            f.write(f"**Device:** {DEVICE}\n\n")
            f.write(f"**Voz de referencia:** `{REFERENCE_VOICE}`\n\n")
            
            # Resumen
            f.write("## Resumen\n\n")
            f.write(f"- ✅ Tests exitosos: {len(ok_tests)}\n")
            f.write(f"- ❌ Tests con error: {len(error_tests)}\n")
            f.write(f"- ⏱️ RTF promedio: {avg_rtf:.3f} (min: {min_rtf:.3f}, max: {max_rtf:.3f})\n\n")
            
            # Tabla principal
            f.write("## Resultados Detallados\n\n")
            f.write("| Test | Frase | NFE | SWAY | SPEED | Audio (s) | Proc (s) | RTF | Status |\n")
            f.write("|------|-------|-----|------|-------|-----------|----------|-----|--------|\n")
            
            for r in self.results:
                status_icon = "✅" if r["status"] == "OK" else "❌"
                f.write(f"| {r['test_id']} | {r['phrase']} | {r['nfe_step']} | {r['sway']} | ")
                f.write(f"{r['speed']} | {r['audio_duration']} | {r['processing_time']} | ")
                f.write(f"{r['rtf']} | {status_icon} |\n")
            
            # Mejores configuraciones
            f.write("\n## Top 5 Configuraciones (menor RTF)\n\n")
            
            sorted_ok = sorted(ok_tests, key=lambda x: x["rtf"])[:5]
            for i, r in enumerate(sorted_ok, 1):
                f.write(f"{i}. **{r['test_id']}** - RTF: {r['rtf']:.3f}\n")
                f.write(f"   - NFE={r['nfe_step']}, SWAY={r['sway']}, SPEED={r['speed']}\n")
            
            # Errores
            if error_tests:
                f.write("\n## Errores\n\n")
                for r in error_tests:
                    f.write(f"- **{r['test_id']}** ({r['phrase']}): {r['status']}\n")
            
            # Archivos de audio
            f.write("\n## Archivos de Audio Generados\n\n")
            f.write("Los archivos están en la carpeta `benchmark_results/`:\n\n")
            for r in ok_tests:
                filename = f"{r['test_id']}_{r['phrase']}.wav"
                f.write(f"- `{filename}` ({r['audio_duration']}s)\n")
        
        print(f"\n📄 Reporte guardado en: {report_path}")
        return report_path


# =============================================================================
# MAIN
# =============================================================================

def main():
    """Función principal del benchmark."""
    
    print("\n" + "=" * 60)
    print("🎯 F5-TTS BENCHMARK TEST SUITE")
    print("=" * 60 + "\n")
    
    # Crear directorio de resultados
    os.makedirs(RESULTS_DIR, exist_ok=True)
    print(f"📁 Resultados se guardarán en: {RESULTS_DIR}\n")
    
    # Verificar que existe la voz de referencia
    ref_path = os.path.join(TARGETS_DIR, REFERENCE_VOICE)
    if not os.path.exists(ref_path):
        print(f"❌ ERROR: No se encontró la voz de referencia: {ref_path}")
        return
    
    # Crear runner y ejecutar
    runner = BenchmarkRunner()
    runner.load_model()
    runner.run_all_tests()
    runner.generate_report()
    
    print("\n🎉 ¡Benchmark completado!")
    print(f"   Revisa los audios en: {RESULTS_DIR}")
    print(f"   Revisa el reporte en: {RESULTS_DIR}/benchmark_report.md")
    print()


if __name__ == "__main__":
    main()
