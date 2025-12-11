import { logTokenUsage, calculateChutesAICost } from '@/lib/usage-logger'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseSession, supabaseAdmin } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/supabase-auth'
import { getResourceOwnerId } from '@/lib/resource-owner'
import { getWeather } from '@/lib/weather'
import { fetchWithRetry } from '@/lib/utils'
import { CHUTES_CONFIG, getChutesHeaders } from '@/lib/chutes-config'
import { applyIntelligentAudioPlacement, TimelineItem } from '@/lib/audio-placement'
import { humanizeText, TransitionContext } from '@/lib/humanize-text'

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

// Función para obtener noticias de la DB
async function getNewsFromDB(region: string, limit: number = 20) {
  const { data, error } = await supabase
    .from('noticias_scrapeadas')
    .select('*')
    .eq('region', region)
    .order('fecha_publicacion', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('Error obteniendo noticias:', error)
    return []
  }

  return data || []
}


// Función para limpiar texto RAW antes de humanizar (evita errores CUDA)
function sanitizeTextForTTS(text: string): string {
  if (!text) return '';
  // 1. Eliminar timestamps al inicio (ej: "08:10 | ", "12:30 hrs |")
  let clean = text.replace(/^\d{1,2}:\d{2}\s*(hrs|horas|pm|am)?\s*[|•-]\s*/i, '');
  // 2. Eliminar prefijos comunes
  clean = clean.replace(/^(URGENTE|AHORA|ÚLTIMO MINUTO)\s*[|•-]\s*/i, '');
  // 3. Reemplazar pipes por puntos
  clean = clean.replace(/\s+\|\s+/g, '. ');
  return clean;
}

// Contexto para transiciones naturales entre noticias
// humanizeText ahora se importa desde @/lib/humanize-text

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

    // Autenticación: Intentar sesión de usuario o CRON_SECRET
    const session = await getSupabaseSession();
    let userId = session?.user?.id;

    // Si no hay sesión, verificar CRON_SECRET
    if (!userId) {
      const authHeader = request.headers.get('authorization');
      const cronSecret = process.env.CRON_SECRET;

      if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
        // Si es una llamada autenticada por cron, el userId debe venir en el body
        if (config.userId) {
          userId = config.userId;
          console.log(`🤖 Acceso autorizado por CRON_SECRET para usuario: ${userId}`);
        } else {
          console.warn('⚠️ Llamada CRON sin userId en el body');
          // Opcional: Usar un ID de sistema o fallar
          // return NextResponse.json({ error: 'UserId requerido para ejecución cron' }, { status: 400 });
        }
      }
    }

    if (!userId) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    // Extraer resto de configuración (ya leímos el body arriba)
    let {
      region,
      categories = [],
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

    // 1. Obtener noticias de la DB
    let newsItems = await getNewsFromDB(region, 50)

    if (newsItems.length === 0) {
      console.log('⚠️ No se encontraron noticias en DB para la región:', region)
      // Intentar obtener noticias globales como fallback
      console.log('🔄 Intentando obtener noticias globales...')
      newsItems = await getNewsFromDB('Nacional', 20)

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
          error: 'No hay noticias disponibles. Por favor ejecuta el scraping primero.',
          action: 'POST /api/scraping'
        }, { status: 404 })
      }
    }

    console.log(`📰 ${newsItems.length} noticias encontradas en DB`)

    // 2. Filtrar por categorías si se especificaron
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

    // 3. Calcular cuántas noticias necesitamos basado en WPM real
    // Estimamos ~100 palabras promedio por noticia humanizada
    const avgWordsPerNews = 100
    const secondsPerNews = (avgWordsPerNews / effectiveWPM) * 60
    // Reservar tiempo para intro (15s), outro (15s), y publicidades (30s cada una)
    const reservedTime = 30 + (adCount || 0) * 30
    const availableNewsTime = targetDuration - reservedTime
    const maxNews = Math.max(5, Math.ceil(availableNewsTime / secondsPerNews))
    const selectedNews = filteredNews.slice(0, maxNews)

    console.log(`📰 Seleccionadas ${selectedNews.length} noticias (estimando ${Math.round(secondsPerNews)}s/noticia a ${effectiveWPM} WPM)`)

    // 4. Obtener campañas publicitarias activas (multi-tenant)
    const currentUser = await getCurrentUser()
    const resourceOwnerId = currentUser ? getResourceOwnerId(currentUser) : userId

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
    const timeline = []
    let currentDuration = 0
    let totalCost = 0
    let totalTokens = 0
    let adRotationIndex = 0 // Índice para rotar publicidades (sobre array mezclado)

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
    const introVariants = [
      (time: string, region: string, weather: string) =>
        `${time}. Bienvenidos al informativo de ${region}.${weather} Estos son los principales titulares.`,
      (time: string, region: string, weather: string) =>
        `${time}. Les damos la bienvenida al noticiero de ${region}.${weather} Comenzamos con las noticias.`,
      (time: string, region: string, weather: string) =>
        `${time}. Buen día. Estas son las noticias de ${region}.${weather} Aquí los titulares más importantes.`,
      (time: string, region: string, weather: string) =>
        `${time}. Iniciamos el informativo regional de ${region}.${weather} Vamos con las noticias.`,
      (time: string, region: string, weather: string) =>
        `${time}. Bienvenidos a su noticiero de ${region}.${weather} Empezamos con lo más destacado.`,
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
    const introText = randomVariant(timeText, region, weatherText)

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

    // B. Noticias con publicidad intercalada
    for (let i = 0; i < selectedNews.length; i++) {
      const news = selectedNews[i]

      if (currentDuration >= targetDuration) break



      console.log(`🧠 Procesando noticia ${i + 1}/${selectedNews.length}: ${news.titulo}`)
      // CRITICAL: Sanitize text BEFORE humanization to prevent CUDA errors with raw metadata
      const rawContent = news.contenido || news.resumen || '';
      const sanitizedContent = sanitizeTextForTTS(rawContent);

      // Contexto para transiciones naturales
      const previousCategory = i > 0 ? selectedNews[i - 1].categoria : null
      const transitionContext: TransitionContext = {
        index: i,
        total: selectedNews.length,
        category: news.categoria || 'general',
        previousCategory
      }

      const humanizedResult = await humanizeText(sanitizedContent, region, userId, transitionContext)

      // Actualizar contadores de tokens y costos
      totalTokens += humanizedResult.tokensUsed
      totalCost += humanizedResult.cost

      // Estimar duración usando el WPM real de la voz seleccionada
      const wordCount = humanizedResult.content.split(' ').length
      const estimatedDuration = Math.ceil((wordCount / effectiveWPM) * 60)

      const newsItem: any = {
        id: news.id,
        type: 'news',
        title: news.titulo,
        originalContent: news.contenido,
        content: humanizedResult.content,
        duration: estimatedDuration,
        source: news.fuente,
        category: news.categoria,
        isHumanized: true,
        newsId: news.id,
        voiceId: voiceModel || 'default'
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

      // Insertar publicidad
      let shouldInsertAd = false

      if (typeof adCount === 'number' && adCount > 0) {
        // Lógica basada en cantidad total (distribución equitativa)
        // Calcular índices de inserción: k * (total / (ads + 1))
        const step = selectedNews.length / (adCount + 1)
        // Verificar si el índice actual (i + 1) corresponde a un punto de inserción
        // Usamos una tolerancia pequeña para manejar redondeos si fuera necesario, 
        // pero mejor pre-calculamos o verificamos si "toca" aquí.
        // Estrategia: Verificar si Math.floor(k * step) === i + 1 para algún k

        // Optimización: Calcular si este índice es uno de los puntos
        // i va de 0 a length-1. i+1 es la posición 1-based.
        // Queremos insertar DESPUÉS de la noticia i+1.

        // Enfoque inverso: ¿Cuántos anuncios deberíamos llevar insertados hasta ahora?
        const targetAdsSoFar = Math.floor((i + 1) / step)
        const adsInsertedSoFar = timeline.filter(t => t.type === 'advertisement').length

        if (adsInsertedSoFar < targetAdsSoFar && adsInsertedSoFar < adCount) {
          shouldInsertAd = true
        }

      } else {
        // Fallback: Lógica antigua por frecuencia
        if ((i + 1) % frecuencia_anuncios === 0) {
          shouldInsertAd = true
        }
      }

      if (shouldInsertAd && campaigns && campaigns.length > 0) {
        // Usar rotación en vez de random para alternar publicidades
        const currentAd = campaigns[adRotationIndex % campaigns.length]
        adRotationIndex++ // Incrementar para la siguiente publicidad

        console.log(`📢 Insertando publicidad (${timeline.filter(t => t.type === 'advertisement').length + 1}/${adCount}): ${currentAd.nombre}`)

        timeline.push({
          id: `ad-${i}`,
          type: 'advertisement',
          title: currentAd.nombre,
          content: currentAd.descripcion || '',
          audioUrl: currentAd.url_audio,
          s3Key: currentAd.s3_key,
          duration: currentAd.duracion_segundos || 30,
          adCampaignId: currentAd.id
        })

        currentDuration += currentAd.duracion_segundos || 30

        // Actualizar contador de reproducciones
        await supabase
          .from('campanas_publicitarias')
          .update({ reproducciones: (currentAd.reproducciones || 0) + 1 })
          .eq('id', currentAd.id)
      }

      // Insertar cortina automáticamente si está habilitado
      if (audioConfig.cortinas_enabled && audioConfig.cortina_default_url) {
        const cortinasInserted = timeline.filter(t => t.type === 'cortina').length
        const shouldInsertCortina = (i + 1) % (audioConfig.cortinas_frequency || 3) === 0

        if (shouldInsertCortina) {
          console.log(`🎵 Insertando cortina automática después de noticia ${i + 1}`)

          timeline.push({
            id: `cortina-${i}`,
            type: 'cortina',
            title: 'Cortina',
            content: 'Cortina de radio',
            audioUrl: audioConfig.cortina_default_url,
            duration: 5, // Duración típica de cortina
            insertedBy: 'ai',
            audioLibraryId: audioConfig.cortina_default_id
          })

          currentDuration += 5
        }
      }
    }

    // C.1 Aplicar colocación inteligente de audio (si está habilitado)
    // Esto usa IA para decidir dónde colocar intro, outro, cortinas y efectos
    // basándose en las descripciones que el usuario agregó a cada audio
    const userEmail = session?.user?.email
    if (audioConfig.cortinas_enabled && userEmail) {
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

    // C. Outro
    const outroText = `Estas fueron las noticias en Radio ${region}. Siga en nuestra sintonía.`

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
