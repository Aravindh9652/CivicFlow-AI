import google.generativeai as genai
print('module:', genai)
print('has Client?', hasattr(genai, 'Client'))
print('has configure?', hasattr(genai, 'configure'))
print('dir snippet:', [n for n in dir(genai) if 'model' in n.lower() or 'chat' in n.lower() or 'client' in n.lower()][:50])
