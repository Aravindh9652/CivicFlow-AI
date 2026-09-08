# Small check script to verify which google genai package is available in the venv
try:
    import google.genai as genai
    print('google.genai: OK')
except Exception as e:
    print('google.genai: FAILED ->', e)

try:
    import google.generativeai as ggen
    print('google.generativeai: OK')
except Exception as e:
    print('google.generativeai: FAILED ->', e)
