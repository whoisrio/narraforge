"""Spike entrypoint: FastAPI on Cloudflare Workers Python (Pyodide)."""
from workers import WorkerEntrypoint
from fastapi import FastAPI
import asgi

app = FastAPI(title="narraforge-cf-spike")


@app.get("/")
async def root():
    return {"message": "hello from FastAPI on Workers Python", "cp2": "ok"}


@app.get("/httpx")
async def httpx_check():
    """CP3: httpx outbound HTTPS from Pyodide (no key -> expect 401/403)."""
    import httpx

    async with httpx.AsyncClient(timeout=20) as client:
        try:
            r = await client.get("https://api.xiaomimimo.com/v1/models")
            return {
                "url": str(r.url),
                "status": r.status_code,
                "body_head": r.text[:300],
            }
        except Exception as e:  # noqa: BLE001 - spike: report any failure verbatim
            return {"error": f"{type(e).__name__}: {e}"}


@app.get("/supabase")
async def supabase_check():
    """CP4: Supabase REST (PostgREST) reachability via plain HTTPS.

    No project/key needed: api.supabase.com is Supabase's own API gateway;
    an unauthenticated request must return 401 JSON, proving TLS+REST works.
    """
    import httpx

    async with httpx.AsyncClient(timeout=20) as client:
        try:
            r = await client.get("https://api.supabase.com/v1/projects")
            return {
                "url": str(r.url),
                "status": r.status_code,
                "body_head": r.text[:300],
            }
        except Exception as e:  # noqa: BLE001
            return {"error": f"{type(e).__name__}: {e}"}


@app.get("/edge-tts")
async def edge_tts_check():
    """CP1 (decisive): real edge-tts synthesis over WebSocket from Pyodide."""
    import base64
    import hashlib as hl

    import edge_tts_ws

    text = "你好,这是 NarraForge 在 Cloudflare Workers Python 上的语音合成测试。"
    try:
        result = await edge_tts_ws.synthesize(text)
    except Exception as e:  # noqa: BLE001 - spike: surface verbatim
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}
    if "error" in result:
        return {"ok": False, **result}

    audio = result["audio"]
    return {
        "ok": True,
        "audio_bytes": len(audio),
        "is_mp3": edge_tts_ws.is_mp3(audio),
        "head_hex": audio[:16].hex(),
        "sha256": hl.sha256(audio).hexdigest(),
        "audio_base64": base64.b64encode(audio).decode(),
        "log": result["log"],
    }


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        return await asgi.fetch(app, request, self.env)
