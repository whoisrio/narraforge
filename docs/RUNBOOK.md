# Voice Clone Studio - Runbook

## Quick Start

### Development Environment

```bash
# Terminal 1 - Backend (port 8002)
cd backend
source .venv/Scripts/activate
python -m uvicorn main:app --host 127.0.0.1 --port 8002

# Terminal 2 - Frontend
cd frontend
npm run dev
```

### Access Points

- Frontend: http://localhost:5173
- Backend API: http://127.0.0.1:8002
- API Docs: http://127.0.0.1:8002/docs

## Health Checks

| Endpoint | Purpose | Expected Response |
|----------|---------|-------------------|
| `GET /health` | Service health | `{"status": "ok"}` |
| `GET /` | Root endpoint | HTML page |

## Common Issues

### Backend Won't Start

1. **Port in use**: Change port to 8002
   ```bash
   python -m uvicorn main:app --host 127.0.0.1 --port 8002
   ```

2. **Missing dependencies**: Reinstall
   ```bash
   pip install -r requirements.txt
   ```

3. **Database locked**: Delete and recreate
   ```bash
   rm backend/voice_clone.db
   ```

### Frontend Can't Connect to Backend

Check `frontend/vite.config.ts` proxy configuration points to correct port (8002).

### API Errors

1. Check backend console for error messages
2. Verify `.env` has valid `QWEN_API_KEY`
3. Ensure database file exists (`voice_clone.db`)

## API Testing Workflow

1. **Upload audio** → `POST /api/clone/upload`
2. **Create clone** → `POST /api/clone/create-clone`
3. **List voices** → `GET /api/clone/list`
4. **Synthesize** → `POST /api/clone/synthesize`

## Database Reset

```bash
cd backend
rm voice_clone.db
# Restart backend - database recreates automatically
```

## File Storage

- Uploaded audio: `backend/uploads/`
- Synthesized audio: `backend/uploads/cloned/`
- Database: `backend/voice_clone.db`

## Production Deployment

1. Set `DEBUG=false` in `.env`
2. Use production database (PostgreSQL recommended)
3. Configure reverse proxy (nginx)
4. Set up proper CORS origins