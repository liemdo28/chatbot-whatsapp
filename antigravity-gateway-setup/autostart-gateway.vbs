Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\Ld-project\antigravity-gateway-setup\start-gateway-protected.ps1""", 0, False
