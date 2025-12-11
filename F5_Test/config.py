# -*- coding: utf-8 -*-
"""
Configuración centralizada para F5-TTS Server.
Optimizado para CALIDAD MÁXIMA.
"""

import os
import torch


class Config:
    # === MODELO ===
    REPO_ID = "jpgallegoar/F5-Spanish"
    DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
    
    # === INFERENCIA (CONFIGURACIÓN B3_speed098 - MÁS NATURAL) ===
    # Configuración seleccionada del benchmark de naturalidad v2
    # B3_speed098: "Velocidad lenta-natural (0.98)"
    # Suena más pausado y humano, menos robótico
    #
    # nfe_step: 48 = buen balance calidad/velocidad
    # Valores probados: 16, 32, 44, 48, 52, 64, 96
    NFE_STEP = 48
    
    # sway_sampling_coef: -1.0 = estilo fiel a la voz de referencia
    # Valores probados: -0.7, -0.8, -0.85, -0.9, -1.0
    # ⚠️ Valores < -1.0 causan "t must be strictly increasing" error
    SWAY_SAMPLING = -1.0
    
    # speed: 0.98 = ligeramente más lento, suena natural y pausado
    # Valores probados: 0.95, 0.98, 1.0, 1.02, 1.05, 1.1
    # 0.98 fue elegido por su naturalidad (benchmark B3)
    SPEED = 0.98
    
    # Eliminar silencios automáticamente
    REMOVE_SILENCE = True
    
    # === AUDIO ===
    SAMPLE_RATE = 24000
    CROSSFADE_MS = 75  # Milisegundos de crossfade entre chunks
    MAX_CHUNK_CHARS = 140  # Máximo caracteres por chunk
    
    # === WHISPER (para transcripción de referencia) ===
    # "tiny" = rápido, menos preciso
    # "small" = balance (recomendado)
    # "medium" = más preciso, más lento
    WHISPER_MODEL = "medium"
    
    # === DIRECTORIOS ===
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    TARGETS_DIR = os.path.join(BASE_DIR, 'targets')
    
    # === HUGGING FACE ===
    HF_TOKEN = os.getenv("HF_TOKEN", "")
