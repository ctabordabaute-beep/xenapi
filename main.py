import os
import json
import time
from typing import Dict, List, Optional
from fastapi import FastAPI, Header, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel
import httpx

app = FastAPI(title="Aqirax API Wrapper ⚡")
security = HTTPBearer()

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

# Modelo Pydantic para el Body en Swagger
class ChatCompletionRequest(BaseModel):
    model: str = "aqirax-eco-3.1"
    messages: List[dict]
    stream: Optional[bool] = False
    temperature: Optional[float] = 0.7
    max_tokens: Optional[int] = 1000

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
async def chat_completions(
    body: ChatCompletionRequest,
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    client_key = credentials.credentials
    if client_key not in VALID_KEYS:
        raise HTTPException(status_code=403, detail="Invalid API Key 🔑")

    if body.model != ALLOWED_MODEL:
        raise HTTPException(
            status_code=400, 
            detail=f"Invalid model '{body.model}'. Only '{ALLOWED_MODEL}' is supported. 🤖"
        )

    check_rate_limit(client_key)

    messages = [{"role": "system", "content": SYSTEM_PROMPT}] + body.messages
    
    payload = {
        "model": "mimo-v2.5",
        "messages": messages,
        "temperature": body.temperature,
        "max_tokens": body.max_tokens,
        "stream": body.stream
    }

    headers = {
        "Authorization": f"Bearer {REAL_BEARER}",
        "Content-Type": "application/json"
    }

    client = httpx.AsyncClient(timeout=60.0)

    if body.stream:
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
