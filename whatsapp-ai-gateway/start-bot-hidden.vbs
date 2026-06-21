Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\Ld-project\whatsapp-ai-gateway\start-bot.ps1""", 0, False
