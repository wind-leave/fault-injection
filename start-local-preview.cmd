@echo off
setlocal
cd /d "%~dp0"
node.exe .\serve-dist-local.mjs > vite-preview.out.log 2> vite-preview.err.log
