import google.generativeai as genai
import os

genai.configure(api_key=os.environ['GEMINI_API_KEY'])
for m in genai.list_models():
    if 'flash' in m.name.lower():
        print(m.name, '->', m.supported_generation_methods)
