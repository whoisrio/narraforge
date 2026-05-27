"""
更新数据库 Schema - 添加 clone_engine 字段到 voice_profiles 表
"""
from sqlalchemy import create_engine, text, inspect
from app.core.database import Base, engine
from app.core.config import settings

# 检查数据库是否存在
inspector = inspect(engine)
tables = inspector.get_table_names()

print(f"Found tables: {tables}")

if 'voice_profiles' in tables:
    # 检查 clone_engine 列是否存在
    columns = [col['name'] for col in inspector.get_columns('voice_profiles')]
    print(f"voice_profiles columns: {columns}")
    
    if 'clone_engine' not in columns:
        print("Adding clone_engine column...")
        with engine.connect() as conn:
            conn.execute(text(
                "ALTER TABLE voice_profiles ADD COLUMN clone_engine VARCHAR"
            ))
            conn.commit()
        print("[SUCCESS] clone_engine column added!")
    else:
        print("[INFO] clone_engine column already exists")
else:
    print("[WARNING] voice_profiles table not found. Creating all tables...")
    Base.metadata.create_all(bind=engine)
    print("[SUCCESS] All tables created!")
