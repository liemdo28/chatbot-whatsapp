@echo off
echo VALIDATION > C:\Ld-project\dd-val.txt
curl -s http://localhost:3001/ >> C:\Ld-project\dd-val.txt
echo. >> C:\Ld-project\dd-val.txt
curl -s http://localhost:3001/health >> C:\Ld-project\dd-val.txt
echo. >> C:\Ld-project\dd-val.txt
curl -s http://localhost:3001/api/status >> C:\Ld-project\dd-val.txt
echo. >> C:\Ld-project\dd-val.txt
curl -s http://localhost:3001/api/stores >> C:\Ld-project\dd-val.txt
echo. >> C:\Ld-project\dd-val.txt
echo DONE >> C:\Ld-project\dd-val.txt