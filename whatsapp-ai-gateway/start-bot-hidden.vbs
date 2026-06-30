Option Explicit
Dim shell, ps, cmd
Set shell = CreateObject("WScript.Shell")
ps = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
cmd = Chr(34) & ps & Chr(34) & " -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\Ld-project\whatsapp-ai-gateway\start-bot.ps1"""
shell.Run cmd, 0, False
