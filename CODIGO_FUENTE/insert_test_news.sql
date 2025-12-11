-- Insertar noticias de prueba directamente
-- Ejecutar en Supabase SQL Editor

INSERT INTO "noticias_scrapeadas" (
  titulo,
  contenido,
  resumen,
  fuente,
  url,
  categoria,
  region,
  fecha_publicacion,
  fecha_scraping
) VALUES
  (
    'Gobierno anuncia nuevas medidas económicas para impulsar el crecimiento',
    'El gobierno chileno anunció hoy un ambicioso paquete de medidas económicas destinadas a impulsar el crecimiento y controlar la inflación en el país.',
    'Nuevas medidas económicas anunciadas por el gobierno',
    'Emol',
    'https://www.emol.com/economia/medidas-test.html',
    'economía',
    'Nacional',
    NOW(),
    NOW()
  ),
  (
    'Santiago registra récord de temperatura más alta del año',
    'La Región Metropolitana de Santiago registró hoy la temperatura más alta del año, alcanzando los 35 grados Celsius.',
    'Récord de temperatura en la capital',
    'La Tercera',
    'https://www.latercera.com/clima/record-test.html',
    'clima',
    'Metropolitana de Santiago',
    NOW(),
    NOW()
  ),
  (
    'Congreso aprueba nueva ley de educación con amplio respaldo',
    'El Congreso Nacional aprobó hoy una nueva ley de educación que busca mejorar la calidad de la enseñanza.',
    'Congreso aprueba nueva ley de educación',
    'BioBioChile',
    'https://www.biobiochile.cl/educacion/ley-test.html',
    'política',
    'Nacional',
    NOW(),
    NOW()
  ),
  (
    'Chile lidera innovación tecnológica en América Latina',
    'Un nuevo estudio internacional posiciona a Chile como líder en innovación tecnológica en América Latina.',
    'Chile lidera innovación tecnológica regional',
    'Emol',
    'https://www.emol.com/tecnologia/innovacion-test.html',
    'tecnología',
    'Nacional',
    NOW(),
    NOW()
  ),
  (
    'Selección chilena se prepara para partido clasificatorio',
    'La selección chilena de fútbol intensifica entrenamientos para el crucial partido clasificatorio del fin de semana.',
    'La Roja se prepara para partido clave',
    'La Tercera',
    'https://www.latercera.com/deportes/seleccion-test.html',
    'deportes',
    'Nacional',
    NOW(),
    NOW()
  );

-- Verificar que se insertaron
SELECT COUNT(*) as total_noticias FROM "noticias_scrapeadas";

-- Ver las últimas 5 noticias
SELECT id, titulo, categoria, region, fecha_scraping 
FROM "noticias_scrapeadas" 
ORDER BY fecha_scraping DESC 
LIMIT 5;
