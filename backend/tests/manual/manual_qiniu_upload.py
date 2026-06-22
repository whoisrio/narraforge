from qiniu import Auth, put_file_v2,etag
import qiniu.config
from dotenv import load_dotenv
import os

load_dotenv()
ak = os.getenv("OSS_AK")
sk = os.getenv("OSS_SK")
buck_name = os.getenv("BUCKET_NAME")
file = 'backend/uploads/voices/tts_579cd234-6458-499a-b9e3-9065d5850123.mp3'

key = 'tts_579cd234-6458-499a-b9e3-9065d5850123.mp3'

# 认证
q = Auth(ak,sk)

# 获取token
token = q.upload_token(buck_name,key,3600)

# 执行上传
ret,info = put_file_v2(token,key,file,version='v2')

print(info)

assert ret['key'] == key
assert ret['hash'] == etag(file)


