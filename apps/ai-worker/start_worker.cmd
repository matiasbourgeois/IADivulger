@echo off
cd /d "C:\Users\BOURGEOIS\Desktop\IADivulger\apps\ai-worker"
"C:\Users\BOURGEOIS\Desktop\IADivulger\apps\ai-worker\.venv\Scripts\python.exe" -m uvicorn app:app --host 0.0.0.0 --port 8000
