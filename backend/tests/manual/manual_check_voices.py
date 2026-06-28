import sys
sys.path.insert(0, '.')
from app.core.database import SessionLocal
from app.models.voice_profile import VoiceProfile
import os

db = SessionLocal()
voices = db.query(VoiceProfile).all()

print(f'数据库中有 {len(voices)} 个声音:\n')
for v in voices:
    ext = v.source_audio_path.split('.')[-1] if v.source_audio_path else 'N/A'
    src_exists = os.path.isfile(v.source_audio_path) if v.source_audio_path else False
    preview_exists = os.path.isfile(v.cloned_preview_path) if v.cloned_preview_path else False
    print(f'ID:            {v.id}')
    print(f'名称:          {v.name}')
    print(f'clone_engine:  {v.clone_engine}')
    print(f'engine_type:   {v.engine_type}')
    print(f'engine_sub:    {v.engine_sub_type}')
    print(f'engine_params: {v.engine_params}')
    print(f'source_audio:  {v.source_audio_path} (exists={src_exists})')
    print(f'clone_preview: {v.cloned_preview_path} (exists={preview_exists})')
    print(f'is_cloned:     {v.is_cloned}')
    print(f'project_id:    {v.project_id}')
    print('---')

db.close()
