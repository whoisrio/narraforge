import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import re, json

def _extract_json_array(raw):
    if not raw or not raw.strip():
        return None
    text = raw.strip()
    md_match = re.search(r'```(?:json)?\s*(\[.*?\])\s*```', text, re.DOTALL)
    if md_match:
        return md_match.group(1)
    arr_match = re.search(r'\[.*\]', text, re.DOTALL)
    if arr_match:
        candidate = arr_match.group()
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, list):
                return candidate
        except json.JSONDecodeError:
            pass
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return text
    except json.JSONDecodeError:
        pass
    return None

# Test markdown
md_input = '```json\n[{"index": 1}]\n```'
print("Input:", repr(md_input))
result = _extract_json_array(md_input)
print("Result:", repr(result))

# Test with extra text
extra_input = 'Here is the result:\n[{"index": 1}]\nDone.'
print("\nExtra input:", repr(extra_input))
result2 = _extract_json_array(extra_input)
print("Result:", repr(result2))
