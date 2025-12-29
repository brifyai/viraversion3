require('dotenv').config({ path: '.env' });
const fs = require('fs');
const https = require('https');

const key = process.env.GEMINI_API_KEY;

if (!key) {
    console.error('❌ Error: GEMINI_API_KEY no encontrada en .env');
    process.exit(1);
}

const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;

console.log(`🔑 Probando API Key...`);

https.get(url, (res) => {
    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        if (res.statusCode !== 200) {
            console.error(`❌ Error de API: ${res.statusCode}`);
            fs.writeFileSync('gemini-error.txt', `Status: ${res.statusCode}\nBody: ${data}`);
            return;
        }

        try {
            const json = JSON.parse(data);
            fs.writeFileSync('gemini-models.json', JSON.stringify(json, null, 2));
            console.log('✅ Modelos guardados en gemini-models.json');
        } catch (e) {
            console.error('Error parseando JSON');
        }
    });

}).on('error', (err) => {
    console.error('❌ Error de conexión:', err);
});
