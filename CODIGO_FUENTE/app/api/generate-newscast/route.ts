import { logTokenUsage, calculateChutesAICost } from '@/lib/usage-logger'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseSession, supabaseAdmin } from '@/lib/supabase-server'
// getCurrentUser y getResourceOwnerId ya no se usan - usamos userId cacheado al inicio
import { getWeather } from '@/lib/weather'
import { fetchWithRetry } from '@/lib/utils'
import { CHUTES_CONFIG, getChutesHeaders } from '@/lib/chutes-config'
import { applyIntelligentAudioPlacement, TimelineItem } from '@/lib/audio-placement'
import { humanizeText, TransitionContext, sanitizeForTTS } from '@/lib/humanize-text'
import { planificarNoticiero, calcularImportancia, PlanNoticiero } from '@/lib/director-ai'
import { buildFullScript, NewsForScript, ScriptSegment, getTransitionsForNews } from '@/lib/script-builder'

// Cliente Supabase
const supabase = supabaseAdmin

// Función para normalizar la región
async function normalizeRegion(inputRegion: string): Promise<string> {
  if (!inputRegion) return 'Nacional'

  // 1. Buscar coincidencia exacta (case insensitive)
  const { data, error } = await supabase
    .from('configuraciones_regiones')
    .select('region')
    .ilike('region', inputRegion)
    .maybeSingle()

  if (data) return data.region

  // 2. Si no encuentra, intentar buscar por coincidencia parcial
  const { data: partialData } = await supabase
    .from('configuraciones_regiones')
    .select('region')
    .ilike('region', `%${inputRegion}%`)
    .limit(1)
    .maybeSingle()

  if (partialData) return partialData.region

  console.warn(`⚠️ Región '${inputRegion}' no encontrada en configuraciones, usando 'Nacional'`)
  return 'Nacional'
}

// Función para obtener noticias de la DB (solo últimas 24-48 horas)
async function getNewsFromDB(region: string, limit: number = 20, maxHoursOld: number = 24) {
  // ✅ Calcular fecha límite (por defecto 24 horas atrás)
  const cutoffDate = new Date()
  cutoffDate.setHours(cutoffDate.getHours() - maxHoursOld)

  const { data, error } = await supabase
    .from('noticias_scrapeadas')
    .select('*')
    .eq('region', region)
    .gte('fecha_scraping', cutoffDate.toISOString())  // ✅ Solo noticias recientes
    .order('fecha_scraping', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('Error obteniendo noticias:', error)
    return []
  }

  console.log(`📰 ${data?.length || 0} noticias encontradas de las últimas ${maxHoursOld} horas para ${region}`)
  return data || []
}


// Contexto para transiciones naturales entre noticias
// sanitizeForTTS y humanizeText se importan desde @/lib/humanize-text

// Función para generar audio con TTS
async function generateAudio(text: string, voice?: string): Promise<{ audioUrl: string; duration: number; s3Key: string } | null> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/text-to-speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        provider: 'auto',
        voice
      })
    })

    if (!response.ok) {
      console.error('Error generando audio:', await response.text())
      return null
    }

    const result = await response.json()

    if (result.success) {
      return {
        audioUrl: result.audioUrl,
        duration: result.duration,
        s3Key: result.s3Key || result.metadata?.localPath
      }
    }

    return null
  } catch (error) {
    console.error('Error en generateAudio:', error)
    return null
  }
}

export async function POST(request: NextRequest) {
  try {
    const config = await request.json()

    // Autenticación: Intentar sesión de usuario o CRON_SECRET o userId del body
    const session = await getSupabaseSession();
    let userId = session?.user?.id;
    let authMethod = 'session'

    // Si no hay sesión, verificar CRON_SECRET
    if (!userId) {
      const authHeader = request.headers.get('authorization');
      const cronSecret = process.env.CRON_SECRET;

      if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
        // Si es una llamada autenticada por cron, el userId debe venir en el body
        if (config.userId) {
          userId = config.userId;
          authMethod = 'cron'
          console.log(`🤖 Acceso autorizado por CRON_SECRET para usuario: ${userId}`);
        } else {
          console.warn('⚠️ Llamada CRON sin userId en el body');
        }
      }
    }

    // ✅ FALLBACK: Si la sesión expiró pero el frontend envió userId, verificar en DB
    // Esto ocurre después de scraping largo donde el token expira
    if (!userId && config.userId) {
      console.log('⚠️ Sesión expirada, intentando fallback con userId del body...')

      // Verificar que el usuario existe en la DB
      const { data: userCheck, error: userError } = await supabase
        .from('users')
        .select('id, email, role')
        .eq('id', config.userId)
        .single()

      if (userCheck && !userError) {
        userId = config.userId
        authMethod = 'fallback'
        console.log(`✅ Fallback exitoso: Usuario verificado ${userCheck.email} (${userCheck.role})`)
      } else {
        console.error('❌ Fallback fallido: userId no encontrado en DB')
      }
    }

    if (!userId) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    console.log(`🔐 Autenticación exitosa via ${authMethod}: ${userId}`)

    // ✅ MEJORA: Cachear email al inicio para evitar revalidación posterior
    const cachedUserEmail = session?.user?.email || 'system@local'

    // Extraer resto de configuración (ya leímos el body arriba)
    let {
      region,
      radioName,  // ✅ NUEVO: Nombre de la radio para usar en intro
      categories = [],
      categoryConfig, // Configuración detallada de conteos
      specificNewsUrls, // URLs específicas (Prioridad máxima)
      targetDuration = 900, // 15 min default
      frecuencia_anuncios = 2, // Insertar anuncio cada N noticias
      plantilla_id,
      generateAudioNow = false, // Si es true, genera audio de cada segmento
      adCount, // Cantidad total de anuncios a distribuir
      voiceModel, // Modelo de voz seleccionado
      voiceWPM = 150, // Palabras por minuto de la voz seleccionada
      timeStrategy = 'auto', // auto, scheduled, none
      includeWeather = true, // incluir reporte del clima
      hora_generacion, // Hora programada (si existe)
      // Configuración de audio personalizado
      audioConfig = {
        cortinas_enabled: false,
        cortinas_frequency: 3,
        cortina_default_id: null,
        cortina_default_url: null,
        background_music_enabled: false,
        background_music_id: null,
        background_music_url: null,
        background_music_volume: 0.2
      }
    } = config

    // Usar WPM real para cálculos precisos de duración
    const effectiveWPM = voiceWPM || 150
    console.log(`🎤 Usando WPM: ${effectiveWPM} para estimaciones de duración`)

    // Normalizar región antes de usarla
    const normalizedRegion = await normalizeRegion(region)
    console.log(`🌍 Región normalizada: '${region}' -> '${normalizedRegion}'`)
    console.log(`📻 Nombre de radio recibido: '${radioName || 'NO RECIBIDO'}'`)  // ✅ DEBUG
    region = normalizedRegion // Actualizar variable local

    console.log(`🎙️ Generando noticiero para ${region} (${targetDuration}s)`)
    console.log(`📋 Categorías solicitadas:`, categories)

    // Si viene plantilla_id, cargar configuración
    if (plantilla_id) {
      const { data: plantilla } = await supabase
        .from('plantillas')
        .select('*')
        .eq('id', plantilla_id)
        .single()

      if (plantilla) {
        console.log('📝 Aplicando plantilla:', plantilla.nombre)
        // Sobrescribir config con valores de plantilla
        config.region = plantilla.region
        config.categories = plantilla.categorias
        config.targetDuration = plantilla.duracion_minutos * 60
        config.frecuencia_anuncios = plantilla.frecuencia_anuncios
        config.timeStrategy = plantilla.configuration?.timeStrategy || (plantilla.incluir_hora ? 'auto' : 'none')
        config.includeWeather = plantilla.incluir_clima !== undefined ? plantilla.incluir_clima : true

        // Cargar configuración de audio si existe
        if (plantilla.audio_config) {
          audioConfig = { ...audioConfig, ...plantilla.audio_config }
          console.log('🎵 Configuración de audio cargada:', audioConfig)
        }
      }
    }

    // 1. Obtener noticias de la DB (máximo 24 horas de antigüedad)
    let newsItems = await getNewsFromDB(region, 150, 24)

    // Si no hay suficientes noticias recientes, expandir a 48 horas
    if (newsItems.length < 10) {
      console.log('⚠️ Pocas noticias de 24h, expandiendo a 48 horas...')
      newsItems = await getNewsFromDB(region, 150, 48)
    }

    if (newsItems.length === 0) {
      console.log('⚠️ No se encontraron noticias en DB para la región:', region)
      // Intentar obtener noticias globales como fallback (últimas 24h)
      console.log('🔄 Intentando obtener noticias nacionales de las últimas 24h...')
      newsItems = await getNewsFromDB('Nacional', 50, 24)

      // Si aún no hay, expandir a 48h
      if (newsItems.length < 5) {
        console.log('🔄 Expandiendo a noticias nacionales de 48h...')
        newsItems = await getNewsFromDB('Nacional', 50, 48)
      }

      if (newsItems.length === 0) {
        // Verificar si hubo error de conexión antes
        const { error } = await supabase.from('noticias_scrapeadas').select('count', { count: 'exact', head: true });
        if (error) {
          return NextResponse.json({
            error: 'Error de conexión con base de datos',
            details: error
          }, { status: 500 })
        }

        return NextResponse.json({
          error: 'No hay noticias recientes disponibles (últimas 48 horas). Por favor ejecuta el scraping primero.',
          action: 'POST /api/scraping'
        }, { status: 404 })
      }
    }

    console.log(`📰 ${newsItems.length} noticias encontradas en DB`)

    // 2. Selección de noticias (Manual vs Automática)
    let selectedNews: any[] = []

    if (specificNewsUrls && specificNewsUrls.length > 0) {
      console.log(`🎯 Usando ${specificNewsUrls.length} URLs específicas`)

      const { data: specificNews, error: specificError } = await supabase
        .from('noticias_scrapeadas')
        .select('*')
        .in('url', specificNewsUrls)

      if (specificError) {
        console.error('Error fetching specific news:', specificError)
      }

      selectedNews = specificNews || []

      if (selectedNews.length < specificNewsUrls.length) {
        console.warn(`⚠️ Solicitadas ${specificNewsUrls.length} noticias específicas, pero solo se encontraron ${selectedNews.length} en DB`)
      }

      console.log(`✅ Selección por URL completada: ${selectedNews.length} noticias`)

    } else if (categoryConfig && Object.keys(categoryConfig).length > 0) {
      console.log('🎯 Usando configuración manual de categorías:', categoryConfig)

      for (const [catName, count] of Object.entries(categoryConfig)) {
        // Filtrar noticias de esta categoría (case insensitve)
        const catNews = newsItems.filter(n => n.categoria?.toLowerCase().trim() === catName.toLowerCase().trim())

        const toTake = Number(count)
        if (catNews.length < toTake) {
          console.warn(`⚠️ Solicitadas ${toTake} de '${catName}', solo encontradas ${catNews.length}`)
        }

        selectedNews.push(...catNews.slice(0, toTake))
      }

      // Eliminar duplicados
      const seenIds = new Set()
      selectedNews = selectedNews.filter(n => {
        if (seenIds.has(n.id)) return false
        seenIds.add(n.id)
        return true
      })

      console.log(`✅ Selección manual completada: ${selectedNews.length} noticias`)

    } else {
      // Lógica automática basada en duración
      let filteredNews = newsItems
      if (categories && categories.length > 0) {
        filteredNews = newsItems.filter(news =>
          categories.some((cat: string) =>
            news.categoria?.toLowerCase().includes(cat.toLowerCase())
          )
        )
        console.log(`✅ Filtradas ${filteredNews.length} noticias de categorías: ${categories.join(', ')}`)
      }

      if (filteredNews.length === 0) {
        console.log('⚠️ No hay noticias de las categorías solicitadas, usando todas')
        filteredNews = newsItems
      }

      // Estimamos ~100 palabras promedio por noticia humanizada
      const avgWordsPerNews = 100
      const secondsPerNews = (avgWordsPerNews / effectiveWPM) * 60
      const reservedTime = 30 + (adCount || 0) * 30
      const availableNewsTime = targetDuration - reservedTime
      const maxNews = Math.max(5, Math.ceil(availableNewsTime / secondsPerNews))
      selectedNews = filteredNews.slice(0, maxNews)

      console.log(`📰 Seleccionadas ${selectedNews.length} noticias automáticamente (estimando ${Math.round(secondsPerNews)}s/noticia)`)
    }

    // ✅ UNIVERSAL: Verificar y limitar noticias para TODOS los métodos de selección
    // Esto aplica tanto a URLs específicas como a selección por categorías
    {
      const avgSecondsPerNews = (100 / effectiveWPM) * 60  // ~40s a 150 WPM
      const reservedTime = 30 + (adCount || 0) * 30  // Intro/outro + anuncios
      const availableNewsTime = targetDuration - reservedTime
      const maxNewsForDuration = Math.floor(availableNewsTime / avgSecondsPerNews)

      console.log(`📏 === VERIFICACIÓN DE DURACIÓN ===`)
      console.log(`   🎯 Tiempo objetivo: ${Math.round(targetDuration / 60)} min (${targetDuration}s)`)
      console.log(`   📰 Noticias seleccionadas: ${selectedNews.length}`)
      console.log(`   📊 Máximo que cabe: ${maxNewsForDuration} noticias`)

      if (selectedNews.length > maxNewsForDuration && maxNewsForDuration > 0) {
        console.warn(`   ⚠️ EXCESO: ${selectedNews.length - maxNewsForDuration} noticias de más`)
        console.warn(`   ✂️ Limitando a ${maxNewsForDuration} noticias para respetar duración`)
        selectedNews = selectedNews.slice(0, maxNewsForDuration)
      } else {
        console.log(`   ✅ OK: Las noticias caben en el tiempo objetivo`)
      }
      console.log(`   ===============================`)
    }
    // ✅ MEJORA: Usar userId ya validado al inicio (evita re-validación que causa "Already Used")
    // Anteriormente llamaba a getCurrentUser() aquí, pero después de 2+ min de scraping el token expiraba
    const resourceOwnerId = userId

    const { data: campaignsRaw } = await supabase
      .from('campanas_publicitarias')
      .select('*')
      .eq('user_id', resourceOwnerId) // ✅ Usa resourceOwnerId para multi-tenant
      .eq('esta_activo', true)
      .gte('fecha_fin', new Date().toISOString())
      .lte('fecha_inicio', new Date().toISOString())

    // Shuffle inicial: mezclar campañas para variar el orden cada generación
    const shuffleArray = <T>(array: T[]): T[] => {
      const shuffled = [...array]
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
          ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
      }
      return shuffled
    }
    const campaigns = campaignsRaw ? shuffleArray(campaignsRaw) : []

    console.log(`📢 ${campaigns?.length || 0} campañas publicitarias activas (orden aleatorio)`)

    // 5. Procesar noticias (Humanizar) y armar Timeline
    const timeline: any[] = []
    let currentDuration = 0
    let totalCost = 0
    let totalTokens = 0
    let adRotationIndex = 0 // Índice para rotar publicidades (sobre array mezclado)

    // 🎬 IA DIRECTORA: Planificar estructura del noticiero
    const directorInput = {
      noticias: selectedNews.map(n => ({
        id: n.id,
        titulo: n.titulo,
        categoria: n.categoria || 'general',
        longitud_contenido: (n.contenido || n.resumen || '').length,
        importancia: calcularImportancia(n.titulo, n.categoria || 'general')
      })),
      duracion_objetivo_segundos: targetDuration,
      publicidades: campaigns.map((c: any) => ({
        id: c.id,
        nombre: c.nombre,
        duracion_segundos: 25
      })),
      cortinas_enabled: audioConfig?.cortinas_enabled || false,
      wpm: effectiveWPM
    }

    const plan: PlanNoticiero = await planificarNoticiero(directorInput, userId)

    // Reordenar noticias según el plan de la IA
    const noticiasOrdenadas = plan.noticias
      .sort((a, b) => a.orden - b.orden)
      .map(planItem => {
        const noticia = selectedNews.find(n => n.id === planItem.id)
        return {
          ...noticia,
          palabras_objetivo: planItem.palabras_objetivo,
          segundos_asignados: planItem.segundos_asignados,
          es_destacada: planItem.es_destacada
        }
      })
      .filter(n => n && n.id)

    console.log(`📏 === PLAN DEL DIRECTOR ===`)
    console.log(`   🎯 Duración objetivo: ${targetDuration}s (${Math.round(targetDuration / 60)} min)`)
    console.log(`   📰 Noticias ordenadas: ${noticiasOrdenadas.length}`)
    console.log(`   🎵 Cortinas: ${plan.inserciones.filter(i => i.tipo === 'cortina').length}`)
    console.log(`   📢 Publicidades: ${plan.inserciones.filter(i => i.tipo === 'publicidad').length}`)
    console.log(`   ⏱️ Duración estimada: ${plan.duracion_total_estimada}s`)
    console.log(`   =============================`)

    // A. Intro simple
    // A. Intro dinámica con variedad
    // Función para convertir hora a lenguaje natural
    const formatTimeNatural = (date: Date): string => {
      const hour = date.getHours()
      const minutes = date.getMinutes()

      // Determinar período del día
      let periodo = ''
      if (hour >= 5 && hour < 12) periodo = 'de la mañana'
      else if (hour >= 12 && hour < 14) periodo = 'del mediodía'
      else if (hour >= 14 && hour < 20) periodo = 'de la tarde'
      else periodo = 'de la noche'

      // Convertir hora a formato 12h
      const hora12 = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour)

      // Formatear minutos
      let minutosText = ''
      if (minutes === 0) {
        minutosText = ''
      } else if (minutes === 15) {
        minutosText = ' y cuarto'
      } else if (minutes === 30) {
        minutosText = ' y media'
      } else if (minutes === 45) {
        minutosText = ' y cuarenta y cinco'
      } else if (minutes < 10) {
        minutosText = ` con ${minutes} minutos`
      } else {
        minutosText = ` y ${minutes}`
      }

      return `Son las ${hora12}${minutosText} ${periodo}`
    }

    // Variantes de intro para no sonar repetitivo
    // Usamos radioName si está disponible, si no usamos region
    const displayName = radioName || region
    const introVariants = [
      (time: string, name: string, weather: string) =>
        `${time}. Bienvenidos al informativo de ${name}.${weather} Estos son los principales titulares.`,
      (time: string, name: string, weather: string) =>
        `${time}. Les damos la bienvenida al noticiero de ${name}.${weather} Comenzamos con las noticias.`,
      (time: string, name: string, weather: string) =>
        `${time}. Buen día. Estas son las noticias de ${name}.${weather} Aquí los titulares más importantes.`,
      (time: string, name: string, weather: string) =>
        `${time}. Iniciamos el informativo de ${name}.${weather} Vamos con las noticias.`,
      (time: string, name: string, weather: string) =>
        `${time}. Bienvenidos a su noticiero de ${name}.${weather} Empezamos con lo más destacado.`,
    ]

    let timeText = ''
    if (timeStrategy === 'auto') {
      timeText = formatTimeNatural(new Date())
    } else if (timeStrategy === 'scheduled' && hora_generacion) {
      // Parsear hora programada y convertir
      const [h, m] = hora_generacion.split(':').map(Number)
      const scheduledDate = new Date()
      scheduledDate.setHours(h, m)
      timeText = formatTimeNatural(scheduledDate)
    }

    let weatherText = ''
    if (includeWeather) {
      const weather = await getWeather(region)
      if (weather) {
        weatherText = ` El clima en ${region}, ${weather}.`
      }
    }

    // Seleccionar variante aleatoria
    const randomVariant = introVariants[Math.floor(Math.random() * introVariants.length)]
    const introText = randomVariant(timeText, displayName, weatherText)

    const introItem: any = {
      id: 'intro',
      type: 'intro',
      title: 'Intro',
      content: introText,
      duration: 15,
      isHumanized: true,
      voiceId: voiceModel || 'default'
    }

    // Generar audio de intro si se solicita
    if (generateAudioNow) {
      console.log('🎤 Generando audio de intro...')
      const introAudio = await generateAudio(introText, voiceModel)
      if (introAudio) {
        introItem.audioUrl = introAudio.audioUrl
        introItem.s3Key = introAudio.s3Key
        introItem.duration = introAudio.duration
      }
    }

    timeline.push(introItem)
    currentDuration += introItem.duration

    // ✅ MEJORA: Filtrar noticias con contenido muy corto
    const MIN_CONTENT_LENGTH = 400
    const noticiasValidas = noticiasOrdenadas.filter((n: any) => {
      const contentLength = (n.contenido || n.resumen || '').length
      if (contentLength < MIN_CONTENT_LENGTH) {
        console.log(`⚠️ Noticia excluida (muy corta: ${contentLength} chars): ${n.titulo?.substring(0, 50)}...`)
        return false
      }
      return true
    })

    if (noticiasValidas.length < noticiasOrdenadas.length) {
      console.log(`📋 Filtradas ${noticiasOrdenadas.length - noticiasValidas.length} noticias por contenido insuficiente`)
    }

    // ✅ MEJORA: Recalcular palabras objetivo si se filtraron noticias
    const palabrasExtra = noticiasValidas.length < noticiasOrdenadas.length
      ? Math.round((targetDuration - currentDuration) / 60 * effectiveWPM / noticiasValidas.length)
      : 0

    // ✅ MEJORA: Variables para compensación dinámica
    let deficitAcumulado = 0

    // 🎬 SCRIPT BUILDER: Generar estructura natural del noticiero
    const scriptInput = {
      noticias: noticiasValidas.map((n: any) => ({
        id: n.id,
        titulo: n.titulo,
        categoria: n.categoria || 'general',
        contenido: n.contenido || n.resumen || '',
        palabras_objetivo: n.palabras_objetivo || 200,
        segundos_asignados: n.segundos_asignados || 40,
        es_destacada: n.es_destacada || false
      })) as NewsForScript[],
      duracionObjetivoSegundos: targetDuration,
      wpm: effectiveWPM,
      incluirComentarios: true,
      incluirPreguntasRetoricas: true,
      region
    }

    const builtScript = buildFullScript(scriptInput)

    // 🎬 Obtener transiciones para integrar en el contenido de cada noticia
    const newsTransitions = getTransitionsForNews(builtScript)

    // B. Noticias con publicidad/cortinas intercaladas según plan del Director
    for (let i = 0; i < noticiasValidas.length; i++) {
      const news = noticiasValidas[i] as any

      if (currentDuration >= targetDuration) break

      // ✅ MEJORA: Agregar déficit acumulado + 20% buffer para evitar contenido corto
      const palabrasBase = Math.ceil((news.palabras_objetivo || 200) * 1.2) // +20% buffer
      const palabrasConCompensacion = palabrasBase + Math.round(deficitAcumulado / 60 * effectiveWPM)

      // 🎬 Obtener transiciones para esta noticia
      const transitions = newsTransitions.get(news.id) || { preText: '', postText: '' }
      if (transitions.preText) {
        console.log(`   🎬 Transición: "${transitions.preText.substring(0, 40)}..."`)
      }

      console.log(`🧠 Procesando noticia ${i + 1}/${noticiasValidas.length}: ${news.titulo}`)
      console.log(`   📝 Palabras objetivo: ${palabrasConCompensacion}${deficitAcumulado > 0 ? ` (+${Math.round(deficitAcumulado)}s compensación)` : ''}`)

      // CRITICAL: Sanitize text BEFORE humanization to prevent CUDA errors with raw metadata
      const rawContent = news.contenido || news.resumen || '';
      const sanitizedContent = sanitizeForTTS(rawContent);

      // Contexto para transiciones naturales
      const previousCategory = i > 0 ? (noticiasValidas[i - 1] as any).categoria : null
      const transitionContext: TransitionContext = {
        index: i,
        total: noticiasValidas.length,
        category: news.categoria || 'general',
        previousCategory
      }

      // Pasar objetivo de palabras con compensación
      const humanizedResult = await humanizeText(
        sanitizedContent,
        region,
        userId,
        transitionContext,
        { targetWordCount: palabrasConCompensacion }
      )

      // 🎬 INTEGRAR transiciones en el contenido (NO como items separados)
      let finalContent = humanizedResult.content
      if (transitions.preText) {
        finalContent = transitions.preText + ' ' + finalContent
      }
      if (transitions.postText) {
        finalContent = finalContent + ' ' + transitions.postText
      }

      // ✅ MEJORA: Delay aumentado a 2.5s + backoff progresivo para evitar rate limiting (429)
      const baseDelay = 2500
      const progressiveDelay = baseDelay + (i * 300) // Cada noticia espera 300ms más
      await new Promise(resolve => setTimeout(resolve, progressiveDelay))

      // Actualizar contadores de tokens y costos
      totalTokens += humanizedResult.tokensUsed
      totalCost += humanizedResult.cost

      // Estimar duración usando el WPM real de la voz seleccionada
      const wordCount = finalContent.split(' ').length
      const estimatedDuration = Math.ceil((wordCount / effectiveWPM) * 60)

      // ✅ MEJORA: Calcular déficit para compensar en siguiente noticia
      const duracionObjetivo = news.segundos_asignados || Math.round(palabrasConCompensacion / effectiveWPM * 60)
      if (estimatedDuration < duracionObjetivo * 0.8) {
        deficitAcumulado += (duracionObjetivo - estimatedDuration)
        console.log(`   ⚠️ Déficit: ${Math.round(duracionObjetivo - estimatedDuration)}s → Compensando en siguiente`)
      } else {
        deficitAcumulado = 0 // Resetear si esta noticia cumplió
      }

      console.log(`   📊 Palabras generadas: ${wordCount} | Duración: ${Math.round(estimatedDuration)}s`)

      const newsItem: any = {
        id: news.id,
        type: 'news',
        title: news.titulo,
        originalContent: news.contenido,
        content: finalContent,  // ✅ Contenido con transiciones integradas
        duration: estimatedDuration,
        source: news.fuente,
        category: news.categoria,
        isHumanized: true,
        newsId: news.id,
        voiceId: voiceModel || 'default',
        hasTransition: !!transitions.preText,  // Indicador para UI
        hasComment: !!transitions.postText     // Indicador para UI
      }

      // Generar audio de noticia si se solicita
      if (generateAudioNow) {
        console.log(`🎤 Generando audio de noticia ${i + 1}...`)
        const newsAudio = await generateAudio(humanizedResult.content, voiceModel)
        if (newsAudio) {
          newsItem.audioUrl = newsAudio.audioUrl
          newsItem.s3Key = newsAudio.s3Key
          newsItem.duration = newsAudio.duration
        }
      }

      timeline.push(newsItem)
      currentDuration += newsItem.duration

      // 🎬 Insertar cortina/publicidad según plan del Director
      const ordenActual = i + 1
      const insercionesAqui = plan.inserciones.filter(ins => ins.despues_de_orden === ordenActual)

      for (const insercion of insercionesAqui) {
        if (insercion.tipo === 'cortina') {
          console.log(`🎵 Insertando cortina después de noticia ${ordenActual}`)
          timeline.push({
            id: `cortina-${ordenActual}`,
            type: 'cortina',
            title: 'Cortina musical',
            content: '',
            duration: insercion.duracion_segundos || 5
          })
          currentDuration += insercion.duracion_segundos || 5
        } else if (insercion.tipo === 'publicidad' && campaigns && campaigns.length > 0) {
          // Buscar la publicidad específica o usar rotación
          let currentAd = campaigns.find((c: any) => c.id === insercion.publicidad_id)
          if (!currentAd) {
            currentAd = campaigns[adRotationIndex % campaigns.length]
            adRotationIndex++
          }

          console.log(`📢 Insertando publicidad (${timeline.filter(t => t.type === 'advertisement').length + 1}/${adCount}): ${currentAd.nombre}`)

          timeline.push({
            id: `ad-${ordenActual}`,
            type: 'advertisement',
            title: currentAd.nombre,
            content: currentAd.descripcion || '',
            audioUrl: currentAd.url_audio,
            s3Key: currentAd.s3_key,
            duration: currentAd.duracion_segundos || 25,
            adCampaignId: currentAd.id
          })

          currentDuration += currentAd.duracion_segundos || 25

          // Actualizar contador de reproducciones
          await supabase
            .from('campanas_publicitarias')
            .update({ reproducciones: (currentAd.reproducciones || 0) + 1 })
            .eq('id', currentAd.id)
        }
      }

      // Cortinas ahora manejadas por el plan del Director
    }

    // C.1 Aplicar colocación inteligente de audio (si está habilitado)
    // Esto usa IA para decidir dónde colocar intro, outro, cortinas y efectos
    // basándose en las descripciones que el usuario agregó a cada audio
    // ✅ MEJORA: Usar email cacheado al inicio (evita error de token expirado)
    const userEmail = cachedUserEmail
    if (audioConfig.cortinas_enabled && userEmail && userEmail !== 'system@local') {
      console.log('🤖 Aplicando colocación inteligente de audio...')

      // Convertir timeline a formato compatible con audio-placement
      const timelineForPlacement: TimelineItem[] = timeline.map(item => ({
        id: item.id,
        type: item.type as any,
        title: item.title,
        category: item.category,
        content: item.content
      }))

      const enhancedTimeline = await applyIntelligentAudioPlacement(
        timelineForPlacement,
        userEmail,
        session?.user?.id,
        {
          cortinas_enabled: audioConfig.cortinas_enabled,
          tipos_audio: ['cortina', 'intro', 'outro', 'jingle', 'efecto']
        }
      )

      // Si IA agregó audios, actualizar el timeline
      if (enhancedTimeline.length > timeline.length) {
        console.log(`✅ IA agregó ${enhancedTimeline.length - timeline.length} audios al timeline`)

        // Insertar los nuevos items de audio en el timeline principal
        const newAudioItems = enhancedTimeline.filter(item => item.type === 'audio')
        for (const audioItem of newAudioItems) {
          // Encontrar la posición donde debería ir
          const pos = enhancedTimeline.indexOf(audioItem)
          timeline.splice(pos, 0, {
            id: audioItem.id,
            type: 'cortina', // Para que el sistema lo reconozca
            title: audioItem.audioName || 'Audio',
            content: audioItem.audioName || 'Audio insertado por IA',
            audioUrl: audioItem.audioUrl,
            duration: 5,
            insertedBy: 'ai-intelligent',
            audioLibraryId: audioItem.audioId
          })
        }
      }
    }

    // C. Outro - ✅ MEJORA: Cierre extendido si falta tiempo
    const tiempoActual = timeline.reduce((sum, item) => sum + (item.duration || 0), 0)
    const tiempoFaltante = targetDuration - tiempoActual - 15 // 15s para outro normal

    let outroText = ''

    if (tiempoFaltante > 30) {
      // ✅ Generar cierre extendido para compensar tiempo faltante
      const palabrasCierre = Math.round((tiempoFaltante / 60) * effectiveWPM)
      console.log(`⏱️ Tiempo faltante: ${Math.round(tiempoFaltante)}s → Generando cierre extendido (${palabrasCierre} palabras)`)

      // Obtener resumen de las noticias del día
      const titulares = noticiasValidas.slice(0, 5).map((n: any) => n.titulo).join(', ')

      const cierreExtendido = `
        Y así llegamos al cierre de nuestro informativo. 
        Hoy les trajimos las noticias más relevantes de ${region}, incluyendo ${titulares}.
        Recuerde mantenerse informado con nuestra programación habitual.
        El tiempo para hoy se presenta ${['despejado', 'nublado', 'con posibles lluvias', 'agradable'][Math.floor(Math.random() * 4)]}.
        Gracias por acompañarnos en Radio ${region}.
        Estas fueron las noticias. Siga en nuestra sintonía.
      `.replace(/\s+/g, ' ').trim()

      outroText = cierreExtendido

      // Agregar segmento de cierre extendido antes del outro
      const cierreItem: any = {
        id: 'cierre-extendido',
        type: 'closing',
        title: 'Cierre Extendido',
        content: cierreExtendido,
        duration: Math.round(tiempoFaltante * 0.8), // 80% del tiempo faltante
        isHumanized: true,
        voiceId: voiceModel || 'default'
      }

      if (generateAudioNow) {
        console.log('🎤 Generando audio de cierre extendido...')
        const cierreAudio = await generateAudio(cierreExtendido, voiceModel)
        if (cierreAudio) {
          cierreItem.audioUrl = cierreAudio.audioUrl
          cierreItem.s3Key = cierreAudio.s3Key
          cierreItem.duration = cierreAudio.duration
        }
      }

      timeline.push(cierreItem)
      currentDuration += cierreItem.duration

      // Outro corto después del cierre extendido
      outroText = `Siga en nuestra sintonía. Hasta la próxima.`
    } else {
      // Outro normal
      outroText = `Estas fueron las noticias en Radio ${region}. Siga en nuestra sintonía.`
    }

    const outroItem: any = {
      id: 'outro',
      type: 'outro',
      title: 'Cierre',
      content: outroText,
      duration: 15,
      isHumanized: true,
      voiceId: voiceModel || 'default'
    }

    // Generar audio de outro si se solicita
    if (generateAudioNow) {
      console.log('🎤 Generando audio de outro...')
      const outroAudio = await generateAudio(outroText, voiceModel)
      if (outroAudio) {
        outroItem.audioUrl = outroAudio.audioUrl
        outroItem.s3Key = outroAudio.s3Key
        outroItem.duration = outroAudio.duration
      }
    }

    timeline.push(outroItem)

    // 7. Guardar Noticiero en DB
    const { data: noticiero, error: dbError } = await supabase
      .from('noticieros')
      .insert({
        titulo: `Noticiero ${region} - ${new Date().toLocaleDateString('es-CL')}`,
        contenido: timeline.map(t => t.content).join('\n\n'),
        datos_timeline: timeline,
        duracion_segundos: currentDuration,
        estado: generateAudioNow ? 'procesando' : 'generado',
        region: region, // Guardar región normalizada
        user_id: userId,
        costo_generacion: totalCost,
        total_tokens: totalTokens,
        plantilla_id: plantilla_id || null,
        metadata: {
          region,
          categories,
          config,
          news_count: selectedNews.length,
          ads_count: timeline.filter(t => t.type === 'advertisement').length
        }
      })
      .select()
      .single()

    if (dbError) {
      console.error('Error guardando noticiero:', dbError)
      throw new Error('Error al guardar el noticiero en base de datos')
    }

    // 8. Registrar log de procesamiento
    await supabase.from('logs_procesamiento').insert({
      user_id: userId,
      noticiero_id: noticiero.id,
      tipo_proceso: 'procesamiento',
      estado: 'completado',
      inicio: new Date().toISOString(),
      fin: new Date().toISOString(),
      tokens_usados: totalTokens,
      costo: totalCost,
      metadata: {
        news_processed: selectedNews.length,
        audio_generated: generateAudioNow,
        categories_used: categories
      }
    })

    return NextResponse.json({
      success: true,
      newscastId: noticiero.id,
      timeline,
      duration: currentDuration
    })

  } catch (error: any) {
    console.error('Error en generación de noticiero:', error)
    return NextResponse.json(
      { error: error.message || 'Error interno del servidor' },
      { status: 500 }
    )
  }
}
