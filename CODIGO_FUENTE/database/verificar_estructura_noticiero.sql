-- Verificar estructura de datos del noticiero generado
SELECT 
    id,
    titulo,
    estado,
    duracion_segundos,
    jsonb_typeof(datos_timeline) as tipo_datos,
    jsonb_array_length(datos_timeline) as cantidad_items,
    datos_timeline->0 as primer_item
FROM noticieros
WHERE id = 'feaca425-19f1-4d6a-86ee-dab2f060b04f';

-- Ver estructura completa
SELECT datos_timeline
FROM noticieros
WHERE id = 'feaca425-19f1-4d6a-86ee-dab2f060b04f';
