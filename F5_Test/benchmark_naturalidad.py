# -*- coding: utf-8 -*-
"""
Benchmark F5-TTS v2 - Enfocado en NATURALIDAD

Pruebas basadas en T03 y T14 (favoritos del benchmark anterior).
Objetivo: Encontrar la configuración más natural sin sonar como IA.

Configuraciones base:
- T03: NFE=48, SWAY=-1.0, SPEED=1.0 (NFE medio-alto)
- T14: NFE=48, SWAY=-1.0, SPEED=1.1 (Balance)
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

warnings.filterwarnings("ignore")


# =============================================================================
# CONFIGURACIÓN
# =============================================================================

@dataclass
class TestConfig:
    """Configuración para una prueba."""
    test_id: str
    nfe_step: int
    sway_sampling: float
    speed: float
    crossfade_ms: int
    description: str


# Voz de referencia
REFERENCE_VOICE = "05612c74-d3d5-441b-bae1-9802dae5afeb_processed.wav"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TARGETS_DIR = os.path.join(BASE_DIR, 'targets')
RESULTS_DIR = os.path.join(BASE_DIR, 'benchmark_naturalidad')

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
SAMPLE_RATE = 24000


# =============================================================================
# CONFIGURACIONES FAVORITAS (REFERENCIA)
# =============================================================================

BASELINE_CONFIGS = """
╔═══════════════════════════════════════════════════════════════╗
║  CONFIGURACIONES BASE (Favoritas del Benchmark v1)           ║
╠═══════════════════════════════════════════════════════════════╣
║  T03: NFE=48, SWAY=-1.0, SPEED=1.0, CROSSFADE=75             ║
║       → "NFE medio-alto" - Buena calidad, natural            ║
║                                                               ║
║  T14: NFE=48, SWAY=-1.0, SPEED=1.1, CROSSFADE=75             ║
║       → "Balance" - Ligeramente más rápido, dinámico         ║
╚═══════════════════════════════════════════════════════════════╝
"""


# =============================================================================
# NUEVAS CONFIGURACIONES (Variaciones para Naturalidad)
# =============================================================================

CONFIGS: List[TestConfig] = [
    # === CONFIGURACIONES BASE (para comparación) ===
    TestConfig("BASE_T03", nfe_step=48, sway_sampling=-1.0, speed=1.0, crossfade_ms=75, 
               description="[REFERENCIA] T03 original"),
    TestConfig("BASE_T14", nfe_step=48, sway_sampling=-1.0, speed=1.1, crossfade_ms=75, 
               description="[REFERENCIA] T14 original"),
    
    # === GRUPO A: Variando SWAY (más libertad = más natural?) ===
    TestConfig("A1_sway08", nfe_step=48, sway_sampling=-0.8, speed=1.0, crossfade_ms=75,
               description="Sway más libre (-0.8)"),
    TestConfig("A2_sway09", nfe_step=48, sway_sampling=-0.9, speed=1.0, crossfade_ms=75,
               description="Sway medio (-0.9)"),
    TestConfig("A3_sway07", nfe_step=48, sway_sampling=-0.7, speed=1.0, crossfade_ms=75,
               description="Sway muy libre (-0.7)"),
    
    # === GRUPO B: Variando SPEED (ritmo más natural) ===
    TestConfig("B1_speed095", nfe_step=48, sway_sampling=-1.0, speed=0.95, crossfade_ms=75,
               description="Velocidad pausada (0.95)"),
    TestConfig("B2_speed105", nfe_step=48, sway_sampling=-1.0, speed=1.05, crossfade_ms=75,
               description="Velocidad natural (1.05)"),
    TestConfig("B3_speed098", nfe_step=48, sway_sampling=-1.0, speed=0.98, crossfade_ms=75,
               description="Velocidad lenta-natural (0.98)"),
    
    # === GRUPO C: Variando CROSSFADE (transiciones más suaves) ===
    TestConfig("C1_cf100", nfe_step=48, sway_sampling=-1.0, speed=1.0, crossfade_ms=100,
               description="Crossfade largo (100ms)"),
    TestConfig("C2_cf125", nfe_step=48, sway_sampling=-1.0, speed=1.0, crossfade_ms=125,
               description="Crossfade muy largo (125ms)"),
    TestConfig("C3_cf50", nfe_step=48, sway_sampling=-1.0, speed=1.0, crossfade_ms=50,
               description="Crossfade corto (50ms)"),
    
    # === GRUPO D: NFE ligeramente diferente ===
    TestConfig("D1_nfe52", nfe_step=52, sway_sampling=-1.0, speed=1.0, crossfade_ms=75,
               description="NFE=52 (un poco más calidad)"),
    TestConfig("D2_nfe44", nfe_step=44, sway_sampling=-1.0, speed=1.0, crossfade_ms=75,
               description="NFE=44 (un poco más rápido)"),
    
    # === GRUPO E: COMBINACIONES "BEST GUESS" para naturalidad ===
    TestConfig("E1_natural1", nfe_step=48, sway_sampling=-0.85, speed=1.02, crossfade_ms=100,
               description="Combo Natural #1"),
    TestConfig("E2_natural2", nfe_step=52, sway_sampling=-0.9, speed=0.98, crossfade_ms=100,
               description="Combo Natural #2 (pausado)"),
    TestConfig("E3_natural3", nfe_step=48, sway_sampling=-0.8, speed=1.05, crossfade_ms=90,
               description="Combo Natural #3 (dinámico)"),
    TestConfig("E4_natural4", nfe_step=50, sway_sampling=-0.85, speed=1.0, crossfade_ms=110,
               description="Combo Natural #4 (equilibrado)"),
]


# =============================================================================
# FRASES DE PRUEBA (con pausas naturales)
# =============================================================================

TEST_PHRASES = {
    "noticia": """El ministro de Hacienda anunció esta mañana un nuevo paquete 
de medidas económicas, que incluye subsidios directos para las familias 
más afectadas por la crisis. Se espera que los beneficios lleguen 
durante las próximas semanas.""",
    
    "clima": """Para mañana se esperan temperaturas máximas de veintiocho grados 
en la capital. Durante la tarde, existe una probabilidad moderada de 
lluvias aisladas en los sectores precordilleranos.""",
    
    "conversacion": """Buenas tardes a todos los televidentes. Hoy vamos a hablar 
sobre un tema muy importante para nuestra comunidad. Les invito a 
quedarse con nosotros durante los próximos minutos.""",
}


# =============================================================================
# BENCHMARK ENGINE
# =============================================================================

class NaturalnessBenchmark:
    """Benchmark enfocado en naturalidad."""
    
    def __init__(self):
        self.results = []
        self.model = None
        self.ref_path = os.path.join(TARGETS_DIR, REFERENCE_VOICE)
        self.ref_text = ""
        
    def load_model(self):
        """Carga el modelo F5-TTS."""
        print(BASELINE_CONFIGS)
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
        
    def generate_audio(self, text: str, config: TestConfig) -> Tuple[Optional[np.ndarray], float, str]:
        """Genera audio con configuración específica."""
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
            return None, elapsed, f"ERROR: {str(e)[:40]}"
    
    def run_single_test(self, config: TestConfig, phrase_name: str, phrase_text: str) -> dict:
        """Ejecuta una prueba individual."""
        print(f"   📝 {phrase_name}...", end=" ", flush=True)
        
        wav, elapsed, status = self.generate_audio(phrase_text, config)
        
        duration = 0
        rtf = 0
        
        if wav is not None and len(wav) > 0:
            duration = len(wav) / SAMPLE_RATE
            rtf = elapsed / duration if duration > 0 else 0
            
            filename = f"{config.test_id}_{phrase_name}.wav"
            filepath = os.path.join(RESULTS_DIR, filename)
            sf.write(filepath, wav, SAMPLE_RATE)
            
            print(f"✅ {duration:.1f}s")
        else:
            print(f"❌ {status}")
        
        return {
            "test_id": config.test_id,
            "phrase": phrase_name,
            "nfe": config.nfe_step,
            "sway": config.sway_sampling,
            "speed": config.speed,
            "crossfade": config.crossfade_ms,
            "duration": round(duration, 2),
            "proc_time": round(elapsed, 2),
            "rtf": round(rtf, 3),
            "status": status,
            "description": config.description
        }
    
    def run_all_tests(self):
        """Ejecuta todas las pruebas."""
        total = len(CONFIGS) * len(TEST_PHRASES)
        
        print("\n" + "=" * 60)
        print(f"🧪 BENCHMARK NATURALIDAD v2")
        print(f"   {len(CONFIGS)} configuraciones × {len(TEST_PHRASES)} frases = {total} tests")
        print("=" * 60)
        
        for config in CONFIGS:
            print(f"\n🔧 [{config.test_id}] {config.description}")
            print(f"   NFE={config.nfe_step}, SWAY={config.sway_sampling}, SPEED={config.speed}, CF={config.crossfade_ms}")
            
            for phrase_name, phrase_text in TEST_PHRASES.items():
                result = self.run_single_test(config, phrase_name, phrase_text)
                self.results.append(result)
        
        print("\n" + "=" * 60)
        print(f"✅ Benchmark completado: {len(self.results)} pruebas")
        print("=" * 60)
    
    def generate_report(self):
        """Genera reporte markdown."""
        report_path = os.path.join(RESULTS_DIR, "benchmark_naturalidad_report.md")
        
        ok_tests = [r for r in self.results if r["status"] == "OK"]
        error_tests = [r for r in self.results if r["status"] != "OK"]
        
        with open(report_path, 'w', encoding='utf-8') as f:
            f.write("# Benchmark Naturalidad F5-TTS v2\n\n")
            f.write(f"**Fecha:** {datetime.now().strftime('%Y-%m-%d %H:%M')}\n\n")
            
            # Configuraciones base documentadas
            f.write("## Configuraciones Base (Referencia)\n\n")
            f.write("| Config | NFE | SWAY | SPEED | CF | Descripción |\n")
            f.write("|--------|-----|------|-------|----|--------------|\n")
            f.write("| **T03** | 48 | -1.0 | 1.0 | 75 | NFE medio-alto, favorito |\n")
            f.write("| **T14** | 48 | -1.0 | 1.1 | 75 | Balance, ligeramente rápido |\n\n")
            
            # Resumen
            f.write("## Resumen\n\n")
            f.write(f"- ✅ Tests OK: {len(ok_tests)}\n")
            f.write(f"- ❌ Tests con error: {len(error_tests)}\n\n")
            
            # Tabla por grupos
            f.write("## Resultados por Grupo\n\n")
            
            groups = {}
            for r in self.results:
                group = r["test_id"].split("_")[0]
                if group not in groups:
                    groups[group] = []
                groups[group].append(r)
            
            for group_name, group_results in groups.items():
                f.write(f"### Grupo {group_name}\n\n")
                f.write("| Test | NFE | SWAY | SPEED | CF | Duración | Status | Descripción |\n")
                f.write("|------|-----|------|-------|-----|----------|--------|-------------|\n")
                
                for r in group_results:
                    if r["phrase"] == "noticia":  # Solo mostrar una frase por config
                        icon = "✅" if r["status"] == "OK" else "❌"
                        f.write(f"| {r['test_id']} | {r['nfe']} | {r['sway']} | {r['speed']} | ")
                        f.write(f"{r['crossfade']} | {r['duration']}s | {icon} | {r['description']} |\n")
                f.write("\n")
            
            # Archivos generados
            f.write("## Archivos de Audio\n\n")
            f.write("Los archivos están en `benchmark_naturalidad/`\n\n")
            
            for r in ok_tests:
                filename = f"{r['test_id']}_{r['phrase']}.wav"
                f.write(f"- `{filename}`\n")
        
        print(f"\n📄 Reporte: {report_path}")
        return report_path


# =============================================================================
# MAIN
# =============================================================================

def main():
    print("\n" + "=" * 60)
    print("🎯 F5-TTS BENCHMARK NATURALIDAD v2")
    print("   Basado en T03 y T14 (favoritos)")
    print("=" * 60 + "\n")
    
    os.makedirs(RESULTS_DIR, exist_ok=True)
    print(f"📁 Resultados: {RESULTS_DIR}\n")
    
    ref_path = os.path.join(TARGETS_DIR, REFERENCE_VOICE)
    if not os.path.exists(ref_path):
        print(f"❌ ERROR: No existe {ref_path}")
        return
    
    runner = NaturalnessBenchmark()
    runner.load_model()
    runner.run_all_tests()
    runner.generate_report()
    
    print("\n🎉 ¡Benchmark completado!")
    print(f"   📁 Audios en: {RESULTS_DIR}")
    print(f"   📄 Reporte: {RESULTS_DIR}/benchmark_naturalidad_report.md")
    print("\n💡 Escucha los audios y elige tus favoritos!")


if __name__ == "__main__":
    main()
