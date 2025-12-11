#!/bin/bash

# Colores para output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuración
API_URL="http://localhost:3000"
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Función para imprimir con color
print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
} 

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# Función para ejecutar test
run_test() {
    local test_name=$1
    local command=$2
    local expected_pattern=$3
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    echo ""
    print_info "Test $TOTAL_TESTS: $test_name"
    
    result=$(eval $command 2>&1)
    
    if echo "$result" | grep -q "$expected_pattern"; then
        PASSED_TESTS=$((PASSED_TESTS + 1))
        print_success "PASSED"
    else
        FAILED_TESTS=$((FAILED_TESTS + 1))
        print_error "FAILED"
        echo "Expected pattern: $expected_pattern"
        echo "Got: $result"
    fi
}

echo "======================================"
echo "🧪 VIRA System - Test Suite"
echo "======================================"
echo ""

# ============================================
# 1. TESTS DE SCRAPING
# ============================================
echo "📡 1. TESTS DE SCRAPING"
echo "--------------------------------------"

run_test "Scraping básico" \
    "curl -s -X POST $API_URL/api/scraping -H 'Content-Type: application/json' -d '{\"region\": \"Nacional\"}'" \
    "success.*true"

run_test "Scraping con región específica" \
    "curl -s -X POST $API_URL/api/scraping -H 'Content-Type: application/json' -d '{\"region\": \"Metropolitana de Santiago\"}'" \
    "newsScraped"

# ============================================
# 2. TESTS DE GENERACIÓN DE NOTICIEROS
# ============================================
echo ""
echo "📰 2. TESTS DE GENERACIÓN DE NOTICIEROS"
echo "--------------------------------------"

run_test "Generación básica sin audio" \
    "curl -s -X POST $API_URL/api/generate-newscast -H 'Content-Type: application/json' -d '{\"region\": \"Nacional\", \"targetDuration\": 180, \"generateAudioNow\": false}'" \
    "noticieroId"

run_test "Generación con filtro de categorías" \
    "curl -s -X POST $API_URL/api/generate-newscast -H 'Content-Type: application/json' -d '{\"region\": \"Nacional\", \"categories\": [\"política\"], \"targetDuration\": 180}'" \
    "success.*true"

run_test "Generación con publicidad" \
    "curl -s -X POST $API_URL/api/generate-newscast -H 'Content-Type: application/json' -d '{\"region\": \"Nacional\", \"targetDuration\": 300, \"frecuencia_anuncios\": 2}'" \
    "adsCount"

# ============================================
# 3. TESTS DE TTS
# ============================================
echo ""
echo "🎤 3. TESTS DE TEXT-TO-SPEECH"
echo "--------------------------------------"

run_test "Health check TTS local" \
    "curl -s http://localhost:5000/health" \
    "status.*healthy"

run_test "Generación de audio simple" \
    "curl -s -X POST $API_URL/api/text-to-speech -H 'Content-Type: application/json' -d '{\"text\": \"Prueba de audio\", \"provider\": \"auto\"}'" \
    "audioUrl"

# ============================================
# 4. TESTS DE ENSAMBLAJE
# ============================================
echo ""
echo "🎵 4. TESTS DE ENSAMBLAJE DE AUDIO"
echo "--------------------------------------"

print_info "Generando noticiero de prueba para ensamblaje..."
GEN_RESULT=$(curl -s -X POST $API_URL/api/generate-newscast \
  -H 'Content-Type: application/json' \
  -d '{"region": "Nacional", "targetDuration": 120, "generateAudioNow": true}')

NOTICIERO_ID=$(echo $GEN_RESULT | jq -r '.noticieroId')

if [ "$NOTICIERO_ID" != "null" ] && [ -n "$NOTICIERO_ID" ]; then
    print_success "Noticiero generado: $NOTICIERO_ID"
    
    print_info "Esperando generación de audios (20s)..."
    sleep 20
    
    run_test "Finalización de noticiero" \
        "curl -s -X POST $API_URL/api/finalize-newscast -H 'Content-Type: application/json' -d '{\"noticieroId\": \"$NOTICIERO_ID\"}'" \
        "success.*true"
else
    print_error "No se pudo generar noticiero de prueba"
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi

# ============================================
# 5. TESTS DE AUTOMATIZACIÓN
# ============================================
echo ""
echo "⏰ 5. TESTS DE AUTOMATIZACIÓN"
echo "--------------------------------------"

run_test "Scraping programado" \
    "curl -s -X GET $API_URL/api/cron/scrape-news -H 'Authorization: Bearer test-secret'" \
    "regionsProcessed"

run_test "Generación programada" \
    "curl -s -X GET $API_URL/api/cron/generate-scheduled -H 'Authorization: Bearer test-secret'" \
    "tasksExecuted"

# ============================================
# 6. TESTS DE ARCHIVOS
# ============================================
echo ""
echo "📁 6. TESTS DE ARCHIVOS GENERADOS"
echo "--------------------------------------"

if [ -d "public/generated-audio" ]; then
    AUDIO_COUNT=$(ls -1 public/generated-audio/*.mp3 2>/dev/null | wc -l)
    if [ $AUDIO_COUNT -gt 0 ]; then
        print_success "Archivos de audio encontrados: $AUDIO_COUNT"
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        print_error "No se encontraron archivos de audio"
        FAILED_TESTS=$((FAILED_TESTS + 1))
    fi
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
else
    print_error "Directorio de audio no existe"
    FAILED_TESTS=$((FAILED_TESTS + 1))
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
fi

# ============================================
# RESUMEN
# ============================================
echo ""
echo "======================================"
echo "📊 RESUMEN DE TESTS"
echo "======================================"
echo "Total de tests: $TOTAL_TESTS"
print_success "Pasados: $PASSED_TESTS"
print_error "Fallidos: $FAILED_TESTS"
echo ""

if [ $FAILED_TESTS -eq 0 ]; then
    print_success "¡Todos los tests pasaron! 🎉"
    exit 0
else
    print_error "Algunos tests fallaron. Revisa los logs arriba."
    exit 1
fi
