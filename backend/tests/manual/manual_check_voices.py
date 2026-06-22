import sys
sys.path.insert(0, '.')
from app.core.database import SessionLocal
from app.models.voice_profile import VoiceProfile

db = SessionLocal()
voices = db.query(VoiceProfile).all()

print(f'数据库中有 {len(voices)} 个声音:')
for v in voices:
    ext = v.audio_path.split('.')[-1] if v.audio_path else 'N/A'
    print(f'- ID: {v.id}, 名称：{v.name}, 路径：{v.audio_path}, 格式：{ext}')

db.close()
