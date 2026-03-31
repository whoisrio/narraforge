#!/bin/bash
# Block rm -rf, force push, and reset --hard
INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if echo "$CMD" | grep -qE '(rm\s+-rf|push\s+--force|push\s+-f|reset\s+--hard)'; then
  echo "BLOCKED: Dangerous command detected: $CMD" >&2
  exit 2
fi