const express = require('express');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const app = express();

app.use(express.json());


const limiterRPM = rateLimit({
    windowMs: 60 * 1000,
    max: 50,
    message: { error: 'Epa, te pasaste del límite de 50 RPM. Calma el papel.' }
});

const limiterRPD = rateLimit({
    windowMs: 24 * 60 * 60 * 1000,
    max: 700,
    message: { error: 'Te acabaste las 700 peticiones diarias (RPD). Vuelve mañana.' }
});

// Función para cargar las API Keys desde el apik.json
function getValidApiKeys() {
    try {
        const data = fs.readFileSync('./apik.json', 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('No se pudo leer el archivo apik.json:', error);
        return {};
    }
}

// Ruta principal del proxy
app.post('/v1/chat/completions', limiterRPM, limiterRPD, async (req, res) => {
    try {
        // A. Validar la API Key contra el archivo apik.json
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Falta la API Key de Xentury o está mal formateada.' });
        }

        const userApiKey = authHeader.split(' ')[1];
        const validApiKeys = getValidApiKeys();

        if (!validApiKeys[userApiKey]) {
            return res.status(403).json({ error: 'API Key inválida o pirata.' });
        }

        // B. Extraer datos del body
        const { model, messages, stream, temperature, max_tokens } = req.body;

        // C. System Prompt oculto
        const systemPrompt = {
            role: 'system',
            content: 'Eres Aqirax, un asistente avanzado, directo y de confianza dentro de Xentury.'
        };

        const finalMessages = [systemPrompt, ...(messages || [])];

        // D. Petición oculta a la API real (DeepSeek)
        const aiResponse = await fetch('https://api.b.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer sk-m9feruxgn4oc15ypa723zajp95tu90zk',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'deepseek-v4-flash',
                messages: finalMessages,
                stream: stream || false,
                temperature: temperature ?? 0.7,
                max_tokens: max_tokens ?? 1000,
            }),
        });

        if (!aiResponse.ok) {
            const errorText = await aiResponse.text();
            return res.status(aiResponse.status).json({ error: 'Error en la API oculta', details: errorText });
        }

        // E. Manejo de streaming o JSON normal
        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            for await (const chunk of aiResponse.body) {
                res.write(chunk);
            }
            res.end();
        } else {
            const data = await aiResponse.json();
            res.json(data);
        }

    } catch (error) {
        console.error('Epa, se cayó la pasarela:', error);
        res.status(500).json({ error: 'Error interno en la fake API de Xentury.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🔥 API de Xentury con apik.json corriendo en http://localhost:${PORT}`);
});