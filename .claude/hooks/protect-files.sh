#!/bin/bash
# .claude/hooks/protect-files.sh
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
# 转小写匹配（macOS APFS 大小写不敏感）
BASENAME=$(basename "$FILE_PATH" | tr '[:upper:]' '[:lower:]')

PROTECTED=(".env" ".env.local")
GLOBS=(".env.*" "*.key" "*.pem" "credentials.json")

# 精确匹配
for file in "${PROTECTED[@]}"; do
  if [[ "$BASENAME" == "$file" ]]; then
    jq -nc --arg r "Protected file: $FILE_PATH" \
      '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
    exit 0
  fi
done

# glob 模式匹配
for pattern in "${GLOBS[@]}"; do
  if [[ "$BASENAME" == $pattern ]]; then
    jq -nc --arg r "Protected file: $FILE_PATH" \
      '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
    exit 0
  fi
done
echo '{}' && exit 0