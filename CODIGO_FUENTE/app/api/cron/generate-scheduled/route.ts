import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Función para calcular próxima ejecución desde expresión cron
// Función para calcular próxima ejecución
function calculateNextExecution(currentDate: Date, frequency: string, time: string): string {
    const [hours, minutes] = time.split(':').map(Number);
    const next = new Date(currentDate);
    next.setHours(hours, minutes, 0, 0);

    // Si la hora ya pasó hoy, empezar a buscar desde mañana
    if (next <= currentDate) {
        next.setDate(next.getDate() + 1);
    }

    // Lógica según frecuencia
    if (frequency === 'daily') {
        // Ya sumamos 1 día si pasó la hora, o es hoy si no ha pasado.
        // Si era hoy y no pasó, next > currentDate, ok.
        // Si era hoy y pasó, next es mañana, ok.
    } else if (frequency === 'weekdays') { // Lunes a Viernes
        // Si cae Sábado (6), sumar 2 días -> Lunes
        // Si cae Domingo (0), sumar 1 día -> Lunes
        while (next.getDay() === 0 || next.getDay() === 6) {
            next.setDate(next.getDate() + 1);
        }
    } else if (frequency === 'monday-to-saturday') { // Lunes a Sábado
        // Si cae Domingo (0), sumar 1 día -> Lunes
        if (next.getDay() === 0) {
            next.setDate(next.getDate() + 1);
        }
    } else if (frequency.includes('custom')) {
        // Formato esperado en frecuencia: "Lunes, Miércoles a las 09:00" (texto)
        // Ojo: El frontend guarda "Lunes, Miércoles a las 09:00" en el campo 'frecuencia' 
        // pero la hora real está en 'hora_generacion'.
        // Aquí necesitamos saber QUÉ DÍAS son válidos.
        // Como el backend recibe la frecuencia como texto legible, es difícil parsear.
        // MEJORA: Deberíamos guardar los días seleccionados en una columna separada o JSON.
        // POR AHORA: Intentaremos parsear los días del string de frecuencia o asumir diario si falla.

        const dayMap: { [key: string]: number } = {
            'Lunes': 1, 'Martes': 2, 'Miércoles': 3, 'Jueves': 4, 'Viernes': 5, 'Sábado': 6, 'Domingo': 0
        };

        const validDays: number[] = [];
        Object.keys(dayMap).forEach(dayName => {
            if (frequency.includes(dayName)) validDays.push(dayMap[dayName]);
        });

        if (validDays.length > 0) {
            // Buscar el siguiente día válido
            while (!validDays.includes(next.getDay())) {
                next.setDate(next.getDate() + 1);
            }
        }
    }

    return next.toISOString();
}

export async function GET(request: NextRequest) {
    try {
        // Verificar autenticación de Vercel Cron
        const authHeader = request.headers.get('authorization');
        const cronSecret = process.env.CRON_SECRET;

        if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
            console.error('❌ Unauthorized cron request');
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('🕐 Iniciando generación programada de noticieros...');
        const startTime = Date.now();

        // Obtener tareas programadas activas que deben ejecutarse
        const { data: scheduledTasks, error: fetchError } = await supabase
            .from('programados')
            .select('*')
            .eq('esta_activo', true)
            .eq('tipo', 'noticiero')
            .lte('proxima_ejecucion', new Date().toISOString());

        if (fetchError) {
            throw new Error(`Error fetching scheduled tasks: ${fetchError.message}`);
        }

        if (!scheduledTasks || scheduledTasks.length === 0) {
            console.log('ℹ️ No hay tareas programadas para ejecutar en este momento');
            return NextResponse.json({
                success: true,
                message: 'No hay tareas programadas para ejecutar',
                tasksExecuted: 0
            });
        }

        console.log(`📋 ${scheduledTasks.length} tareas programadas encontradas`);

        const results = {
            success: true,
            timestamp: new Date().toISOString(),
            tasksExecuted: 0,
            tasksSuccessful: 0,
            tasksFailed: 0,
            errors: [] as string[],
            details: [] as any[]
        };

        // Ejecutar cada tarea programada
        for (const task of scheduledTasks) {
            try {
                console.log(`🎙️ Ejecutando tarea: ${task.nombre}`);

                // Resolver userId si no está en la tarea
                let userId = task.user_id;
                if (!userId && task.usuario) {
                    // Intentar buscar usuario por email usando la API de administración de Auth
                    console.log(`🔍 Buscando usuario por email: '${task.usuario}'`);
                    const { data: { users }, error: userError } = await supabase.auth.admin.listUsers();

                    if (userError) {
                        console.error(`❌ Error listando usuarios de Auth:`, userError);
                    } else if (users) {
                        console.log(`👥 Total usuarios encontrados en Auth: ${users.length}`);
                        const foundUser = users.find(u => u.email === task.usuario);

                        if (foundUser) {
                            userId = foundUser.id;
                            console.log(`✅ UserId resuelto para ${task.usuario}: ${userId}`);
                        } else {
                            console.warn(`⚠️ Usuario no encontrado en Auth para email: '${task.usuario}'`);
                            // Log de emails disponibles para depuración
                            console.log('📧 Emails disponibles:', users.map(u => u.email).join(', '));
                        }
                    }
                }

                // Generar noticiero usando la configuración de la tarea
                const generateResponse = await fetch(
                    `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/generate-newscast`,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${process.env.CRON_SECRET}`
                        },
                        body: JSON.stringify({
                            ...task.configuracion,
                            generateAudioNow: true, // Generar audio automáticamente
                            scheduledTaskId: task.id,
                            userId: userId // Pasar userId explícitamente para bypass de auth
                        })
                    }
                );

                if (!generateResponse.ok) {
                    throw new Error(`HTTP ${generateResponse.status}: ${await generateResponse.text()}`);
                }

                const generateResult = await generateResponse.json();

                if (generateResult.success) {
                    results.tasksExecuted++;
                    results.tasksSuccessful++;
                    results.details.push({
                        taskId: task.id,
                        taskName: task.nombre,
                        noticieroId: generateResult.newscastId,
                        status: 'success',
                        duration: generateResult.duration
                    });

                    console.log(`✅ Tarea "${task.nombre}" ejecutada exitosamente`);
                    console.log(`📰 Noticiero generado: ${generateResult.newscastId}`);

                    // Actualizar tarea programada
                    await supabase
                        .from('programados')
                        .update({
                            ultima_ejecucion: new Date().toISOString(),
                            proxima_ejecucion: calculateNextExecution(new Date(), task.configuracion?.frecuencia || 'daily', task.configuracion?.hora_generacion || '09:00'),
                            total_ejecuciones: (task.total_ejecuciones || 0) + 1,
                            ejecuciones_exitosas: (task.ejecuciones_exitosas || 0) + 1
                        })
                        .eq('id', task.id);

                    // Registrar log exitoso
                    await supabase.from('logs_procesamiento').insert({
                        tipo_proceso: 'generacion_programada',
                        estado: 'completado',
                        inicio: new Date().toISOString(),
                        fin: new Date().toISOString(),
                        metadata: {
                            task_id: task.id,
                            task_name: task.nombre,
                            noticiero_id: generateResult.noticieroId,
                            scheduled: true
                        }
                    });

                } else {
                    throw new Error(generateResult.error || 'Unknown error');
                }

            } catch (error) {
                const errorMsg = `Error en tarea "${task.nombre}": ${error instanceof Error ? error.message : 'Unknown'}`;
                console.error(`❌ ${errorMsg}`);

                results.tasksExecuted++;
                results.tasksFailed++;
                results.errors.push(errorMsg);
                results.details.push({
                    taskId: task.id,
                    taskName: task.nombre,
                    status: 'error',
                    error: errorMsg
                });

                // Actualizar tarea con error
                await supabase
                    .from('programados')
                    .update({
                        ultima_ejecucion: new Date().toISOString(),
                        proxima_ejecucion: calculateNextExecution(new Date(), task.configuracion?.frecuencia || 'daily', task.configuracion?.hora_generacion || '09:00'),
                        total_ejecuciones: (task.total_ejecuciones || 0) + 1
                    })
                    .eq('id', task.id);

                // Registrar log de error
                await supabase.from('logs_procesamiento').insert({
                    tipo_proceso: 'generacion_programada',
                    estado: 'fallido',
                    inicio: new Date().toISOString(),
                    fin: new Date().toISOString(),
                    mensaje_error: errorMsg,
                    metadata: {
                        task_id: task.id,
                        task_name: task.nombre,
                        scheduled: true
                    }
                });
            }

            // Pausa entre tareas
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        const processingTime = Date.now() - startTime;

        console.log(`✅ Generación programada completada en ${processingTime}ms`);
        console.log(`📊 Ejecutadas: ${results.tasksExecuted}, Exitosas: ${results.tasksSuccessful}, Fallidas: ${results.tasksFailed}`);

        return NextResponse.json({
            ...results,
            processingTime: `${processingTime}ms`,
            message: `Generación programada completada: ${results.tasksSuccessful}/${results.tasksExecuted} exitosas`
        });

    } catch (error) {
        console.error('❌ Error fatal en generación programada:', error);

        return NextResponse.json(
            {
                success: false,
                error: 'Error interno del servidor',
                details: error instanceof Error ? error.message : 'Unknown error'
            },
            { status: 500 }
        );
    }
}
