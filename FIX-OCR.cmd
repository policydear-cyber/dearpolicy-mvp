@echo off
setlocal EnableExtensions
title DearPolicy - OCR repair
cd /d "%~dp0"

echo.
echo ============================================================
echo   DearPolicy - installing the missing PDF page renderer
echo ============================================================
echo.
echo OCR was installed without PyMuPDF, which turns PDF pages into
echo images before they are read. This adds it. Nothing else changes.
echo.

set "OCR_PYTHON=%~dp0paddleocr-service\.venv\Scripts\python.exe"

if not exist "%OCR_PYTHON%" (
  echo The OCR environment was not found at:
  echo   %OCR_PYTHON%
  echo.
  echo Run INSTALL-OCR.cmd first, then run this again.
  goto :end_error
)

"%OCR_PYTHON%" -m pip install -r "%~dp0paddleocr-service\requirements.txt"
if errorlevel 1 goto :failed

echo.
echo Checking the PDF page renderer...
"%OCR_PYTHON%" -c "import fitz; print('PDF renderer ready:', fitz.__doc__)"
if errorlevel 1 goto :failed

echo.
echo ============================================================
echo   DONE - close this window.
echo ============================================================
echo.
echo Now go back to DearPolicy, open Documents, and press
echo Re-analyse on the document that stopped.
echo.
pause
exit /b 0

:failed
echo.
echo That did not finish. Take a screenshot of this window and send it.

:end_error
echo.
pause
exit /b 1
