# 刻意保持为空：本包不得在包级 import 任何子模块。
# speech_to_text / voxcpm 间接 import faster_whisper/torch，
# workers（Pyodide）部署模式连 import 都不能发生；
# 包级 eager import 会让 `from app.api import clone` 之类的语句
# 在任何模式下都触发这些重依赖的加载。子模块按需显式 import 即可。
