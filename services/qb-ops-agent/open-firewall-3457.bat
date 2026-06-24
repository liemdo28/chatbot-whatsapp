@echo off
REM Open Windows Firewall for QBWC SOAP Agent on port 3457
REM Run this as Administrator on Laptop1

echo =============================================
echo  Opening Firewall for Port 3457
echo =============================================
echo.

netsh advfirewall firewall add rule name="QB SOAP Agent (3457)" dir=in action=allow protocol=TCP localport=3457
netsh advfirewall firewall add rule name="QB SOAP Agent (3457) OUT" dir=out action=allow protocol=TCP localport=3457

echo.
echo [OK] Firewall rules added for port 3457 (TCP in + out)
echo mi-core-primary should now be able to reach this server via Tailscale.
echo.
echo Verify: curl http://localhost:3457/api/status
echo Verify remote: curl http://<tailscale-ip>:3457/api/status
pause
