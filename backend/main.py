from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import init_db

app = FastAPI(title=settings.app_name, debug=settings.debug)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    init_db()


@app.get("/")
def root():
    return {"message": "Voice Clone Studio API", "version": "1.0.0"}


@app.get("/health")
def health():
    return {"status": "healthy"}


# Import and include routers
from app.api import clone, tts, timeline, config

app.include_router(clone.router, prefix="/api/clone", tags=["voice-clone"])
app.include_router(tts.router, prefix="/api/tts", tags=["tts"])
app.include_router(timeline.router, prefix="/api/timeline", tags=["timeline"])
app.include_router(config.router, prefix="/api/config", tags=["config"])