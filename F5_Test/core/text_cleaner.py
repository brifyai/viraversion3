# -*- coding: utf-8 -*-
"""
Limpieza y normalización de texto para TTS.

Convierte texto a un formato óptimo para síntesis de voz:
- Reemplaza abreviaciones por palabras completas
- Convierte números a palabras
- Elimina símbolos problemáticos
- Divide en chunks por oraciones
"""

import re

try:
    from num2words import num2words
    HAS_NUM2WORDS = True
except ImportError:
    HAS_NUM2WORDS = False
    print("⚠️ num2words no instalado. Números no se convertirán.")


class TextCleaner:
    """Limpiador de texto para TTS."""
    
    # Reemplazos de abreviaciones y símbolos
    REPLACEMENTS = {
        # Títulos
        "Sr.": "señor",
        "Sra.": "señora",
        "Srta.": "señorita",
        "Dr.": "doctor",
        "Dra.": "doctora",
        "Ing.": "ingeniero",
        "Lic.": "licenciado",
        "Prof.": "profesor",
        
        # Lugares
        "EE.UU.": "Estados Unidos",
        "UU.": "Unidos",
        
        # Abreviaciones comunes
        "Ud.": "usted",
        "Uds.": "ustedes",
        "etc.": "etcétera",
        "vs.": "versus",
        "aprox.": "aproximadamente",
        "tel.": "teléfono",
        "núm.": "número",
        "pág.": "página",
        
        # Símbolos
        "%": " por ciento",
        "$": " dólares ",
        "€": " euros ",
        "£": " libras ",
        "&": " y ",
        "@": " arroba ",
        "#": " número ",
        
        # Puntuación problemática
        "...": ", ",
        "..": ", ",
        " - ": ", ",
        " – ": ", ",
        " — ": ", ",
        '"': "",
        "'": "",
        "(": ", ",
        ")": ", ",
        "[": ", ",
        "]": ", ",
        "{": ", ",
        "}": ", ",
    }
    
    # Reemplazos fonéticos para caracteres que F5-TTS no pronuncia bien
    # Ñ al inicio de palabra no se pronuncia, usamos aproximación fonética
    PHONETIC_FIXES = {
        "Ñuble": "Niuble",      # Región de Chile
        "Ñuñoa": "Niuñoa",      # Comuna de Santiago
        "Ñoño": "Nioño",        # Palabra común
        "Ñoquis": "Nioquis",    # Comida
        "Ñandú": "Niandú",      # Ave
        "Ñato": "Niato",        # Nariz chata
    }
    
    @staticmethod
    def convert_numbers(text: str) -> str:
        """
        Convierte números a palabras en español.
        
        Ejemplos:
            "123" -> "ciento veintitrés"
            "2024" -> "dos mil veinticuatro"
        """
        if not HAS_NUM2WORDS:
            return text
        
        def replace_number(match):
            try:
                num = int(match.group())
                # Limitar a números razonables
                if num > 999999999:
                    return match.group()
                return num2words(num, lang='es')
            except (ValueError, OverflowError):
                return match.group()
        
        # Reemplazar números (1 o más dígitos)
        return re.sub(r'\d+', replace_number, text)
    
    @staticmethod
    def convert_times(text: str) -> str:
        """
        Convierte formatos de hora a texto natural.
        
        Ejemplos:
            "8:00" -> "las ocho"
            "14:30" -> "las catorce treinta"
        """
        if not HAS_NUM2WORDS:
            return text
        
        def replace_time(match):
            try:
                hour = int(match.group(1))
                minute = int(match.group(2)) if match.group(2) else 0
                
                hour_word = num2words(hour, lang='es')
                
                if minute == 0:
                    return f"las {hour_word}"
                else:
                    minute_word = num2words(minute, lang='es')
                    return f"las {hour_word} {minute_word}"
            except:
                return match.group()
        
        # Patrón: HH:MM o H:MM
        return re.sub(r'(\d{1,2}):(\d{2})', replace_time, text)
    
    @classmethod
    def clean(cls, text: str) -> str:
        """
        Limpia y normaliza texto para TTS.
        
        Args:
            text: Texto original
        
        Returns:
            Texto limpio y normalizado
        """
        if not text:
            return ""
        
        # 0. Aplicar fixes fonéticos PRIMERO (para Ñ que F5-TTS no pronuncia)
        for old, new in cls.PHONETIC_FIXES.items():
            text = text.replace(old, new)
        
        # 1. Reemplazos especiales (abreviaciones, símbolos)
        for old, new in cls.REPLACEMENTS.items():
            text = text.replace(old, new)
        
        # 2. Convertir horas antes de números
        text = cls.convert_times(text)
        
        # 3. Convertir números a palabras
        text = cls.convert_numbers(text)
        
        # 4. Limpiar espacios múltiples
        text = re.sub(r'\s+', ' ', text)
        
        # 5. Limpiar comas múltiples
        text = re.sub(r',\s*,', ',', text)
        
        # 6. Eliminar espacios antes de puntuación
        text = re.sub(r'\s+([.,!?])', r'\1', text)
        
        return text.strip()
    
    @staticmethod
    def split_chunks(text: str, max_chars: int = 200) -> list:
        """
        Divide texto en chunks respetando límites de oraciones.
        
        Args:
            text: Texto a dividir
            max_chars: Máximo caracteres por chunk
        
        Returns:
            Lista de chunks
        """
        if not text:
            return []
        
        if len(text) <= max_chars:
            return [text]
        
        # Dividir por oraciones (. ! ?)
        sentences = re.split(r'(?<=[.!?])\s+', text)
        
        chunks = []
        current_chunk = ""
        
        for sentence in sentences:
            # Si la oración sola es muy larga, dividir por comas
            if len(sentence) > max_chars:
                if current_chunk:
                    chunks.append(current_chunk.strip())
                    current_chunk = ""
                
                # Dividir oración larga por comas
                parts = sentence.split(', ')
                for part in parts:
                    if len(current_chunk) + len(part) < max_chars:
                        current_chunk += part + ", "
                    else:
                        if current_chunk:
                            chunks.append(current_chunk.strip().rstrip(','))
                        current_chunk = part + ", "
            
            # Si cabe en el chunk actual
            elif len(current_chunk) + len(sentence) < max_chars:
                current_chunk += " " + sentence
            
            # Si no cabe, crear nuevo chunk
            else:
                if current_chunk.strip():
                    chunks.append(current_chunk.strip())
                current_chunk = sentence
        
        # Agregar último chunk
        if current_chunk.strip():
            chunks.append(current_chunk.strip().rstrip(','))
        
        return chunks if chunks else [text]
