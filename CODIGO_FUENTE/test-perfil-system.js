// TEST DEL SISTEMA DE PERFIL VIRA
// Este script verifica qué funciona y qué no en la página de perfil

const { createClient } = require('@supabase/supabase-js');

// Configuración de Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'your-anon-key';

if (!supabaseUrl || !supabaseKey || supabaseUrl === 'https://your-project.supabase.co') {
  console.error('❌ ERROR: Configura las variables de entorno de Supabase');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🔍 INICIANDO TEST DEL SISTEMA DE PERFIL VIRA\n');

// Función helper para testear tablas
async function testTable(tableName, description) {
  try {
    console.log(`📋 Testeando tabla: ${tableName} (${description})`);
    const { data, error } = await supabase.from(tableName).select('*').limit(1);

    if (error) {
      console.log(`   ❌ ERROR: ${error.message}`);
      console.log(`   📝 Código: ${error.code || 'N/A'}`);
      return { exists: false, error: error.message };
    } else {
      console.log(`   ✅ TABLA EXISTE y es accesible`);
      console.log(`   📊 Estructura: ${Object.keys(data[0] || {}).join(', ') || 'Sin datos'}`);
      return { exists: true, structure: data[0] ? Object.keys(data[0]) : [] };
    }
  } catch (err) {
    console.log(`   ❌ ERROR CRÍTICO: ${err.message}`);
    return { exists: false, error: err.message };
  }
}

// Función helper para testear endpoints
async function testEndpoint(endpoint, method = 'GET', body = null) {
  try {
    console.log(`🌐 Testeando endpoint: ${method} ${endpoint}`);

    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`http://localhost:3000${endpoint}`, options);
    const data = await response.json();

    console.log(`   📊 Status: ${response.status}`);
    console.log(`   ✅ RESPONDE: ${data.success !== false ? 'Sí' : 'No'}`);

    if (data.error) {
      console.log(`   ❌ Error: ${data.error}`);
    }

    return {
      exists: true,
      status: response.status,
      success: data.success !== false,
      error: data.error
    };
  } catch (err) {
    console.log(`   ❌ ERROR CRÍTICO: ${err.message}`);
    return { exists: false, error: err.message };
  }
}

// Test principal
async function runTests() {
  console.log('='.repeat(60));
  console.log('📊 ANÁLISIS DE TABLAS UTILIZADAS EN LA PÁGINA DE PERFIL');
  console.log('='.repeat(60));

  // Tablas que la página de perfil utiliza
  const tables = [
    { name: 'users', description: 'Datos de usuarios' },
    { name: 'facturacion', description: 'Datos de facturación (NO EXISTE en schema)' },
    { name: 'invoices', description: 'Facturas (existe en schema)' },
    { name: 'token_usage', description: 'Uso de tokens y costos' },
    { name: 'news_reports', description: 'Reportes de noticias' },
    { name: 'newscast_templates', description: 'Plantillas de noticieros' },
    { name: 'audio_library', description: 'Biblioteca de audio' }
  ];

  const tableResults = {};

  for (const table of tables) {
    tableResults[table.name] = await testTable(table.name, table.description);
    console.log('');
  }

  console.log('='.repeat(60));
  console.log('🌐 ANÁLISIS DE ENDPOINTS UTILIZADOS EN LA PÁGINA DE PERFIL');
  console.log('='.repeat(60));

  // Endpoints que la página de perfil debería utilizar
  const endpoints = [
    { path: '/api/users', method: 'GET', description: 'Obtener usuarios' },
    { path: '/api/users', method: 'POST', body: { name: 'Test', email: 'test@test.com', role: 'user' }, description: 'Crear usuario' },
    { path: '/api/payments/history', method: 'GET', description: 'Historial de pagos' },
    { path: '/api/invoices/test', method: 'GET', description: 'Endpoint de facturas (NO EXISTE)' },
    { path: '/api/billing', method: 'GET', description: 'Endpoint de billing (NO EXISTE)' }
  ];

  const endpointResults = {};

  for (const endpoint of endpoints) {
    endpointResults[endpoint.path] = await testEndpoint(endpoint.path, endpoint.method, endpoint.body);
    console.log('');
  }

  console.log('='.repeat(60));
  console.log('🔍 ANÁLISIS ESPECÍFICO DE LA PÁGINA DE PERFIL');
  console.log('='.repeat(60));

  // Test específico de consulta de usuarios por email (como lo hace la página)
  console.log('📧 Testeando consulta de usuarios por email (como en la página):');
  try {
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('email', 'admin@vira.cl')
      .maybeSingle();

    if (userError) {
      console.log('   ❌ ERROR en consulta por email:', userError.message);
    } else if (userData) {
      console.log('   ✅ Usuario encontrado:', userData.email);
      console.log('   👤 Rol:', userData.role);
      console.log('   🏢 Empresa:', userData.company);
      console.log('   📋 Campos disponibles:', Object.keys(userData).join(', '));
    } else {
      console.log('   ⚠️  No se encontró el usuario admin@vira.cl');
    }
  } catch (err) {
    console.log('   ❌ ERROR CRÍTICO:', err.message);
  }

  console.log('');

  // Test de consulta de facturación (como lo hace la página)
  console.log('💰 Testeando consulta de facturación (como en la página):');
  try {
    const filtroJSON = JSON.stringify([{ "Correo": "admin@vira.cl" }]);
    const { data: factData, error: factError } = await supabase
      .from('facturacion')
      .select('*')
      .contains('integrantes', filtroJSON);

    if (factError) {
      console.log('   ❌ ERROR en consulta de facturación:', factError.message);
      console.log('   🚨 ESTE ERROR ES ESPERADO - La tabla "facturacion" NO EXISTE en el schema');
    } else {
      console.log('   ✅ Datos de facturación encontrados:', factData.length, 'registros');
    }
  } catch (err) {
    console.log('   ❌ ERROR CRÍTICO:', err.message);
  }

  console.log('');

  // Test de la tabla invoices que sí existe
  console.log('🧾 Testeando tabla invoices (que sí existe en schema):');
  try {
    const { data: invoiceData, error: invoiceError } = await supabase
      .from('invoices')
      .select('*')
      .limit(5);

    if (invoiceError) {
      console.log('   ❌ ERROR en consulta de invoices:', invoiceError.message);
    } else {
      console.log('   ✅ Facturas encontradas:', invoiceData.length, 'registros');
      if (invoiceData.length > 0) {
        console.log('   📋 Campos disponibles:', Object.keys(invoiceData[0]).join(', '));
      }
    }
  } catch (err) {
    console.log('   ❌ ERROR CRÍTICO:', err.message);
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('📋 RESUMEN DE PROBLEMAS ENCONTRADOS');
  console.log('='.repeat(60));

  const problems = [];

  // Verificar tabla facturacion
  if (!tableResults.facturacion.exists) {
    problems.push({
      severity: 'CRITICAL',
      issue: 'La tabla "facturacion" NO EXISTE',
      impact: 'La página de perfil no puede cargar datos de facturación',
      solution: 'Crear la tabla facturacion o modificar la página para usar "invoices"'
    });
  }

  // Verificar endpoints
  if (!endpointResults['/api/billing'].exists) {
    problems.push({
      severity: 'HIGH',
      issue: 'Endpoint /api/billing NO EXISTE',
      impact: 'No se pueden gestionar datos de facturación vía API',
      solution: 'Crear endpoint /api/billing o integrar con /api/payments/history'
    });
  }

  if (!endpointResults['/api/invoices/test'].exists) {
    problems.push({
      severity: 'MEDIUM',
      issue: 'Endpoints de facturas individuales NO EXISTEN',
      impact: 'No se pueden descargar facturas individuales',
      solution: 'Crear endpoints dinámicos /api/invoices/[id]'
    });
  }

  // Mostrar problemas
  if (problems.length === 0) {
    console.log('✅ No se encontraron problemas críticos');
  } else {
    problems.forEach((problem, index) => {
      console.log(`\n${index + 1}. ${problem.severity}: ${problem.issue}`);
      console.log(`   💥 Impacto: ${problem.impact}`);
      console.log(`   💡 Solución: ${problem.solution}`);
    });
  }

  console.log('\n' + '='.repeat(60));
  console.log('🎯 RECOMENDACIONES PARA LA PÁGINA DE PERFIL');
  console.log('='.repeat(60));

  console.log('\n1. 🔄 CAMBIAR "facturacion" por "invoices":');
  console.log('   - La página consulta la tabla "facturacion" que no existe');
  console.log('   - Debe usar la tabla "invoices" que sí está en el schema');

  console.log('\n2. 📊 CREAR ENDPOINTS DE FACTURACIÓN:');
  console.log('   - /api/billing para gestión de datos de facturación');
  console.log('   - /api/invoices/[id] para facturas individuales');

  console.log('\n3. 🔧 CORREGIR CAMPOS DE USUARIO:');
  console.log('   - La página usa campos que no existen: "contraseña", "telefono", etc.');
  console.log('   - Debe usar los campos correctos del schema: "password_hash", "phone", etc.');

  console.log('\n4. 💾 IMPLEMENTAR GUARDADO DE FACTURACIÓN:');
  console.log('   - El botón "Guardar Datos de Facturación" no funciona');
  console.log('   - Debe crear el endpoint correspondiente');

  console.log('\n5. 🔄 MEJORAR GESTIÓN DE USUARIOS:');
  console.log('   - La creación de usuarios funciona parcialmente');
  console.log('   - Debe integrarse mejor con Supabase Auth');

  console.log('\n✅ TEST COMPLETADO');
}

// Ejecutar tests
runTests().catch(console.error);