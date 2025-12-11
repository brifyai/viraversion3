
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

// Cargar variables de entorno
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Error: Faltan variables de entorno (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function testTemplatesAPI() {
    console.log('🚀 Iniciando prueba de API de Plantillas (Simulación directa con Supabase)')
    console.log('-----------------------------------------------------------------------')

    // 1. Crear una plantilla de prueba
    const testTemplate = {
        nombre: 'Plantilla Test Automático',
        region: 'Valparaíso',
        radio_station: 'Radio Festival',
        duracion_minutos: 10,
        voz_proveedor: 'openai',
        voz_id: 'alloy',
        incluir_clima: true,
        incluir_hora: true,
        frecuencia_anuncios: 2,
        categorias: ['Deportes', 'Tecnología'],
        configuracion: {
            cantidad_fuentes: [
                { nombre_fuente: 'BioBioChile', cantidad: 5 },
                { nombre_fuente: 'Emol', cantidad: 3 }
            ]
        },
        // Usamos un ID de usuario de prueba (Admin)
        user_id: 'b97e393f-7410-42be-9c4b-f69887beb9c8'
    }

    console.log('📝 Creando plantilla de prueba...')
    const { data: created, error: createError } = await supabase
        .from('plantillas')
        .insert(testTemplate)
        .select()
        .single()

    if (createError) {
        console.error('❌ Error al crear plantilla:', createError.message)
        return
    }

    console.log('✅ Plantilla creada exitosamente:', created.id)

    // 2. Leer la plantilla
    console.log('📖 Leyendo plantilla...')
    const { data: read, error: readError } = await supabase
        .from('plantillas')
        .select('*')
        .eq('id', created.id)
        .single()

    if (readError) {
        console.error('❌ Error al leer plantilla:', readError.message)
    } else {
        console.log('✅ Plantilla leída correctamente:', read.nombre)
        if (read.configuracion?.cantidad_fuentes?.length === 2) {
            console.log('✅ Configuración de fuentes verificada correctamenta')
        } else {
            console.error('❌ Error: La configuración de fuentes no coincide')
        }
    }

    // 3. Limpiar (Eliminar plantilla de prueba)
    console.log('🧹 Limpiando datos de prueba...')
    const { error: deleteError } = await supabase
        .from('plantillas')
        .delete()
        .eq('id', created.id)

    if (deleteError) {
        console.error('❌ Error al eliminar plantilla de prueba:', deleteError.message)
    } else {
        console.log('✅ Plantilla de prueba eliminada')
    }

    console.log('-----------------------------------------------------------------------')
    console.log('🎉 Prueba completada')
}

testTemplatesAPI().catch(console.error)
