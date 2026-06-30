' QB Ops Agent — Hidden Launcher
' Runs start.bat completely hidden (no console flash, no taskbar entry)
' Usage: double-click start-hidden.vbs
' Or schedule via Task Scheduler for boot autostart

Dim shell, fso, scriptDir, batPath

Set shell = CreateObject("WScript.Shell")
Set fso   = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
batPath   = scriptDir & "\start.bat"

If Not fso.FileExists(batPath) Then
    ' Silent failure — write to a log instead of popping a dialog
    Dim logFile
    Set logFile = fso.OpenTextFile(scriptDir & "\logs\hidden-start-error.log", 8, True)
    logFile.WriteLine Now() & " [ERROR] start.bat not found at: " & batPath
    logFile.Close
    WScript.Quit 1
End If

' 0 = Hidden window, False = don't wait for completion (fire and forget)
shell.Run """" & batPath & """", 0, False

Set shell = Nothing
Set fso   = Nothing

WScript.Quit 0