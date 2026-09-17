@echo off
setlocal EnableExtensions
title DearPolicy - read my documents
cd /d "%~dp0"

echo.
echo ============================================================
echo   DearPolicy - reading your documents once, properly
echo ============================================================
echo.
echo This reads every uploaded document page by page and stores what
echo each one pays. Afterwards questions are answered instantly from
echo that table instead of re-reading the documents every time.
echo.
echo It is slow on purpose and safe to run again at any time. It never
echo changes your documents, your uploaded proof, your confirmed cover,
echo or any benefit you have corrected yourself.
echo.

call npm run policies:index
if errorlevel 1 goto :failed

echo.
echo ============================================================
echo   DONE - close this window.
echo ============================================================
echo.
echo Open DearPolicy and click Benefits in the sidebar to see
echo everything it has read. Then ask your question again.
echo.
pause
exit /b 0

:failed
echo.
echo That did not finish.
echo If it says it cannot connect, start the database first
echo (Docker Desktop, then npm run db:start) and run this again.
echo Otherwise take a screenshot of this window and send it.
echo.
pause
exit /b 1
