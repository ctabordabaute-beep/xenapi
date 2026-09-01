const fs = require('fs');
const express = require('express');
const app = express();

app.use(express.json());

let partnersKeys = {};
let normalKeys = {};

try {
    partnersKeys = JSON.parse(fs.readFileSync('./partnersapik.json', 'utf8'));
} catch (e) { console.log("No se pudo cargar partnersapik.json 🛑"); }

try {
    normalKeys = JSON.parse(fs.readFileSync('./apikeys.json', 'utf8'));
} catch (e) { console.log("No se pudo cargar apikeys.json 🛑"); }

const limites = {
    partner: { rpm: 200, rpd: 3500 },
    normal: { rpm: 50, rpd: 1000 }
};

const usoClientes = {};

function verificarApiKeyYLimites(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        return res.status(401).json({ error: "Falta la API Key de Xentury o está mal formateada. 🛑" });
    }

    const token = authHeader.split(' ')[1];
    let userType = '';

    if (partnersKeys[token]) {
        userType = 'partner';
    } else if (normalKeys[token]) {
        userType = 'normal';
    } else {
        return res.status(403).json({ error: "API Key inválida o no registrada. 🛑" });
    }

    const ahora = Date.now();
    const minutoActual = Math.floor(ahora / 60000);
    const diaActual = Math.floor(ahora / 86400000);

    if (!usoClientes[token]) {
        usoClientes[token] = { rpmCount: 0, rpdCount: 0, lastMinute: minutoActual, lastDay: diaActual };
    }

    const registro = usoClientes[token];

    if (registro.lastMinute !== minutoActual) {
        registro.rpmCount = 0;
        registro.lastMinute = minutoActual;
    }
    if (registro.lastDay !== diaActual) {
        registro.rpdCount = 0;
        registro.lastDay = diaActual;
    }

    const limits = limites[userType];

    if (registro.rpmCount >= limits.rpm) {
        return res.status(429).json({ error: "Límite de peticiones por minuto (RPM) excedido. ⏳" });
    }
    if (registro.rpdCount >= limits.rpd) {
        return res.status(429).json({ error: "Límite de peticiones por día (RPD) excedido. 📅" });
    }

    registro.rpmCount++;
    registro.rpdCount++;

    next();
}

app.post('/v1/chat/completions', verificarApiKeyYLimites, async (req, res) => {
    const { model, messages, stream, temperature, max_tokens } = req.body;

    if (model !== 'aqirax-flash') {
        return res.status(400).json({
            error: "Modelo inválido. El único modelo disponible en Xentury API es 'aqirax-flash'. 🤖❌"
        });
    }

    try {
        const responseB = await fetch('https://api.b.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer sk-qhxdkr7uyvl64f013ez3deiliw0ix3kj',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'deepseek-v4-flash',
                messages: messages || [{ role: 'user', content: 'Hello World' }],
                stream: stream !== undefined ? stream : true,
                temperature: temperature !== undefined ? temperature : 0.7,
                max_tokens: max_tokens !== undefined ? max_tokens : 1000,
            }),
        });

        if (!responseB.ok) {
            const errorText = await responseB.text();
            return res.status(responseB.status).json({
                error: "Error al comunicarse con el proveedor principal.",
                details: errorText
            });
        }

        if (stream || stream === undefined) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            
            responseB.body.pipe(res);
        } else {
            const rawText = await responseB.text();
            let cleanText = rawText.trim();
            if (cleanText.startsWith("data:")) {
                cleanText = cleanText.replace(/^data:\s*/gm, "");
            }
            const data = JSON.parse(cleanText);
            if (data.model) data.model = 'aqirax-flash';
            return res.json(data);
        }

    } catch (error) {
        console.error("Error conectando con la API:", error);
        return res.status(500).json({ error: "Error interno procesando la solicitud con el servidor. ⚠️", details: error.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🔥 API de Xentury corriendo en puerto ${PORT}`);
});
