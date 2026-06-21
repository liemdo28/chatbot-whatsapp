@echo off
powershell -ExecutionPolicy Bypass -NoProfile -Command "Set-Location '%~dp0'; & { & '.\build_release.ps1' }"
