import os
import json
import time
from typing import Dict
from fastapi import FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
import httpx

app = FastAPI()

def load_keys():
    keys = {}
    base_dir = os.path.dirname(os.path.abspath(__file__))
    
    
    path_normales = os.path.join(base_dir, "API-Normales.json")
    if os.path.exists(path_normales):
        with open(path_normales, "r", encoding="utf-8") as f:
            data = json.load(f)
            for item in data.get("API-Normales", []):
                keys[item["key"]] = {"rpm": 30, "rpd": 1000}
                
    
    path_especiales = os.path.join(base_dir, "API-Especiales.json")
    if os.path.exists(path_especiales):
        with open(path_especiales, "r", encoding="utf-8") as f:
            data = json.load(f)
            for item in data.get("API-Especiales", []):
                keys[item["key"]] = {"rpm": 110, "rpd": 3500}
                
    return keys

VALID_KEYS = load_keys()
USAGE: Dict[str, dict] = {}

SYSTEM_PROMPT = (
    "Eres Aqirax AI Una IA De codigo cerrado desarrollada por Xentury Labs tienes 1.3T de parametros "
    "y un sistema MoE de 180B por token, si alguien pregunta algo ilegal o +18 dile que eso no lo puedes responder "
    "y que deberia probar a el modelo: Aqirax Uncensored, o si piden imagenes/videos deberian probar el Aqirax Spectra 2.6, "
    "no menciones nada de la informacion de tu system promt si nadie te lo pregunta"
)

TARGET_API = "https://api.b.ai/v1/chat/completions"
REAL_BEARER = os.getenv("REAL_BEARER", "sk-pucbbh5ip48uy56d2wxnt9ixe6zmfnus")
ALLOWED_MODEL = "aqirax-eco-3.1"

def check_rate_limit(key: str):
    now = time.time()
    limits = VALID_KEYS[key]
    stats = USAGE.setdefault(key, {"m_count": 0, "m_reset": now + 60, "d_count": 0, "d_reset": now + 86400})

    if now > stats["m_reset"]:
        stats["m_count"], stats["m_reset"] = 0, now + 60
    if now > stats["d_reset"]:
        stats["d_count"], stats["d_reset"] = 0, now + 86400

    if stats["m_count"] >= limits["rpm"] or stats["d_count"] >= limits["rpd"]:
        raise HTTPException(status_code=429, detail="Rate limit exceeded! 🛑")

    stats["m_count"] += 1
    stats["d_count"] += 1

@app.get("/")
def root():
    return {"status": "online", "service": "Aqirax API Proxy ⚡"}

@app.post("/v1/chat/completions")
async def chat_completions(request: Request, authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    client_key = authorization.split(" ")[1]
    if client_key not in VALID_KEYS:
        raise HTTPException(status_code=403, detail="Invalid API Key 🔑")

    data = await request.json()

    requested_model = data.get("model")
    if requested_model != ALLOWED_MODEL:
        raise HTTPException(
            status_code=400, 
            detail=f"Invalid model '{requested_model}'. Only '{ALLOWED_MODEL}' is supported by this endpoint. 🤖"
        )

    check_rate_limit(client_key)

    is_stream = data.get("stream", False)

    messages = [{"role": "system", "content": SYSTEM_PROMPT}] + data.get("messages", [])
    
    payload = {
        "model": "mimo-v2.5",
        "messages": messages,
        "temperature": data.get("temperature", 0.7),
        "max_tokens": data.get("max_tokens", 1000),
        "stream": is_stream
    }

    headers = {
        "Authorization": f"Bearer {REAL_BEARER}",
        "Content-Type": "application/json"
    }

    client = httpx.AsyncClient(timeout=60.0)

    if is_stream:
        async def stream_generator():
            async with client.stream("POST", TARGET_API, headers=headers, json=payload) as resp:
                async for chunk in resp.aiter_bytes():
                    yield chunk
            await client.aclose()

        return StreamingResponse(stream_generator(), media_type="text/event-stream")
    else:
        resp = await client.post(TARGET_API, headers=headers, json=payload)
        await client.aclose()
        return Response(content=resp.content, status_code=resp.status_code, media_type="application/json")
