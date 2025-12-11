# VIRA System - Test Suite (PowerShell)
# ======================================

$API_URL = "http://localhost:3000"
$TOTAL_TESTS = 0
$PASSED_TESTS = 0
$FAILED_TESTS = 0

# Funciones de utilidad
function Print-Success {
    param($Message)
    Write-Host "✅ $Message" -ForegroundColor Green
}

function Print-Error {
    param($Message)
    Write-Host "❌ $Message" -ForegroundColor Red
}

function Print-Info {
    param($Message)
    Write-Host "ℹ️  $Message" -ForegroundColor Cyan
}

function Print-Warning {
    param($Message)
    Write-Host "⚠️  $Message" -ForegroundColor Yellow
}

function Run-Test {
    param(
        [string]$TestName,
        [scriptblock]$TestCommand,
        [string]$ExpectedPattern
    )
    
    $script:TOTAL_TESTS++
    Write-Host ""
    Print-Info "Test $script:TOTAL_TESTS: $TestName"
    
    try {
        $result = & $TestCommand
        $resultString = $result | ConvertTo-Json -Compress
        
        if ($resultString -match $ExpectedPattern) {
            $script:PASSED_TESTS++
            Print-Success "PASSED"
        } else {
            $script:FAILED_TESTS++
            Print-Error "FAILED"
            Write-Host "Expected pattern: $ExpectedPattern"
            Write-Host "Got: $resultString"
        }
    } catch {
        $script:FAILED_TESTS++
        Print-Error "FAILED with exception: $_"
    }
}

Write-Host "======================================"
Write-Host "🧪 VIRA System - Test Suite"
Write-Host "======================================"
Write-Host ""

# ============================================
# 1. TESTS DE SCRAPING
# ============================================
Write-Host "📡 1. TESTS DE SCRAPING"
Write-Host "--------------------------------------"

Run-Test -TestName "Scraping básico" -TestCommand {
    Invoke-RestMethod -Uri "$API_URL/api/scraping" `
        -Method POST `
        -ContentType "application/json" `
        -Body '{"region": "Nacional"}'
} -ExpectedPattern "success.*true"

Run-Test -TestName "Scraping con región específica" -TestCommand {
    Invoke-RestMethod -Uri "$API_URL/api/scraping" `
        -Method POST `
        -ContentType "application/json" `
        -Body '{"region": "Metropolitana de Santiago"}'
} -ExpectedPattern "newsScraped"

# ============================================
# 2. TESTS DE GENERACIÓN DE NOTICIEROS
# ============================================
Write-Host ""
Write-Host "📰 2. TESTS DE GENERACIÓN DE NOTICIEROS"
Write-Host "--------------------------------------"

Run-Test -TestName "Generación básica sin audio" -TestCommand {
    Invoke-RestMethod -Uri "$API_URL/api/generate-newscast" `
        -Method POST `
        -ContentType "application/json" `
        -Body '{"region": "Nacional", "targetDuration": 180, "generateAudioNow": false}'
} -ExpectedPattern "noticieroId"

Run-Test -TestName "Generación con filtro de categorías" -TestCommand {
    Invoke-RestMethod -Uri "$API_URL/api/generate-newscast" `
        -Method POST `
        -ContentType "application/json" `
        -Body '{"region": "Nacional", "categories": ["política"], "targetDuration": 180}'
} -ExpectedPattern "success.*true"

Run-Test -TestName "Generación con publicidad" -TestCommand {
    Invoke-RestMethod -Uri "$API_URL/api/generate-newscast" `
        -Method POST `
        -ContentType "application/json" `
        -Body '{"region": "Nacional", "targetDuration": 300, "frecuencia_anuncios": 2}'
} -ExpectedPattern "adsCount"

# ============================================
# 3. TESTS DE TTS
# ============================================
Write-Host ""
Write-Host "🎤 3. TESTS DE TEXT-TO-SPEECH"
Write-Host "--------------------------------------"

Run-Test -TestName "Health check TTS local" -TestCommand {
    Invoke-RestMethod -Uri "http://localhost:5000/health"
} -ExpectedPattern "status.*healthy"

Run-Test -TestName "Generación de audio simple" -TestCommand {
    Invoke-RestMethod -Uri "$API_URL/api/text-to-speech" `
        -Method POST `
        -ContentType "application/json" `
        -Body '{"text": "Prueba de audio", "provider": "auto"}'
} -ExpectedPattern "audioUrl"

# ============================================
# 4. TESTS DE ENSAMBLAJE
# ============================================
Write-Host ""
Write-Host "🎵 4. TESTS DE ENSAMBLAJE DE AUDIO"
Write-Host "--------------------------------------"

Print-Info "Generando noticiero de prueba para ensamblaje..."
try {
    $genResult = Invoke-RestMethod -Uri "$API_URL/api/generate-newscast" `
        -Method POST `
        -ContentType "application/json" `
        -Body '{"region": "Nacional", "targetDuration": 120, "generateAudioNow": true}'
    
    $noticieroId = $genResult.noticieroId
    
    if ($noticieroId) {
        Print-Success "Noticiero generado: $noticieroId"
        
        Print-Info "Esperando generación de audios (20s)..."
        Start-Sleep -Seconds 20
        
        Run-Test -TestName "Finalización de noticiero" -TestCommand {
            Invoke-RestMethod -Uri "$API_URL/api/finalize-newscast" `
                -Method POST `
                -ContentType "application/json" `
                -Body "{`"noticieroId`": `"$noticieroId`"}"
        } -ExpectedPattern "success.*true"
    } else {
        Print-Error "No se pudo generar noticiero de prueba"
        $FAILED_TESTS++
    }
} catch {
    Print-Error "Error generando noticiero: $_"
    $FAILED_TESTS++
}

# ============================================
# 5. TESTS DE AUTOMATIZACIÓN
# ============================================
Write-Host ""
Write-Host "⏰ 5. TESTS DE AUTOMATIZACIÓN"
Write-Host "--------------------------------------"

Run-Test -TestName "Scraping programado" -TestCommand {
    $headers = @{
        "Authorization" = "Bearer test-secret"
    }
    Invoke-RestMethod -Uri "$API_URL/api/cron/scrape-news" `
        -Method GET `
        -Headers $headers
} -ExpectedPattern "regionsProcessed"

Run-Test -TestName "Generación programada" -TestCommand {
    $headers = @{
        "Authorization" = "Bearer test-secret"
    }
    Invoke-RestMethod -Uri "$API_URL/api/cron/generate-scheduled" `
        -Method GET `
        -Headers $headers
} -ExpectedPattern "tasksExecuted"

# ============================================
# 6. TESTS DE ARCHIVOS
# ============================================
Write-Host ""
Write-Host "📁 6. TESTS DE ARCHIVOS GENERADOS"
Write-Host "--------------------------------------"

$TOTAL_TESTS++
if (Test-Path "public\generated-audio") {
    $audioFiles = Get-ChildItem "public\generated-audio\*.mp3" -ErrorAction SilentlyContinue
    if ($audioFiles.Count -gt 0) {
        Print-Success "Archivos de audio encontrados: $($audioFiles.Count)"
        $PASSED_TESTS++
    } else {
        Print-Error "No se encontraron archivos de audio"
        $FAILED_TESTS++
    }
} else {
    Print-Error "Directorio de audio no existe"
    $FAILED_TESTS++
}

# ============================================
# RESUMEN
# ============================================
Write-Host ""
Write-Host "======================================"
Write-Host "📊 RESUMEN DE TESTS"
Write-Host "======================================"
Write-Host "Total de tests: $TOTAL_TESTS"
Print-Success "Pasados: $PASSED_TESTS"
Print-Error "Fallidos: $FAILED_TESTS"
Write-Host ""

if ($FAILED_TESTS -eq 0) {
    Print-Success "¡Todos los tests pasaron! 🎉"
    exit 0
} else {
    Print-Error "Algunos tests fallaron. Revisa los logs arriba."
    exit 1
}
