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

// Middleware de autenticación y control de límites
function verificarApiKeyYLimites(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        return res.status(401).json({ error: "Falta la API Key de Xentury o está mal formateada. " });
    }

    const token = authHeader.split(' ')[1];
    let userData = null;
    let userType = '';

    if (partnersKeys[token]) {
        userData = partnersKeys[token];
        userType = 'partner';
    } else if (normalKeys[token]) {
        userData = normalKeys[token];
        userType = 'normal';
    } else {
        return res.status(403).json({ error: "API Key inválida o no registrada. " });
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
        return res.status(429).json({ error: "Límite de peticiones por minuto (RPM) excedido. " });
    }
    if (registro.rpdCount >= limits.rpd) {
        return res.status(429).json({ error: "Límite de peticiones por día (RPD) excedido. " });
    }

    registro.rpmCount++;
    registro.rpdCount++;

    req.user = userData;
    req.userType = userType;
    next();
}

// Endpoint de chat con validación estricta del modelo aqirax-flash
app.post('/v1/chat/completions', verificarApiKeyYLimites, (req, res) => {
    const { model, messages } = req.body;

    // Validación estricta del modelo
    if (model !== 'aqirax-flash') {
        return res.status(400).json({
            error: "Modelo inválido. El único modelo disponible en Xentury API es 'aqirax-flash'"
        });
    }

    res.json({
        success: true,
        tier: req.userType,
        limits_applied: limites[req.userType],
        user_info: req.user,
        message: `Petición procesada con éxito para el modelo ${model}`,
        response: {
            role: "assistant",
            content: `¡Hola pana! Saludos desde Xentury API con ${model} (${req.userType.toUpperCase()}). Todo en orden. `
        }
    });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(` API de Xentury corriendo en puerto ${PORT}`);
});
