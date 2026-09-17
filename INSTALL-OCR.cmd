@echo off
setlocal EnableExtensions
title DearPolicy OCR Installer
cd /d "%~dp0"

echo.
echo ============================================================
echo   DearPolicy - One-click PaddleOCR installer
echo ============================================================
echo.
echo This creates a private OCR installation inside DearPolicy.
echo It does not change Qwen, Ollama, PostgreSQL or your policies.
echo The download can take a while. Please keep this window open.
echo.

set "PYTHON_EXE="
for /f "delims=" %%P in ('py -3.12 -c "import sys; print(sys.executable)" 2^>nul') do set "PYTHON_EXE=%%P"

if not defined PYTHON_EXE (
  where winget >nul 2>nul
  if errorlevel 1 goto :python_help
  echo Python 3.12 is not installed. DearPolicy will install it now...
  winget install --exact --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
  if errorlevel 1 goto :failed
  for /f "delims=" %%P in ('py -3.12 -c "import sys; print(sys.executable)" 2^>nul') do set "PYTHON_EXE=%%P"
)

if not defined PYTHON_EXE goto :python_restart

echo [1/5] Creating DearPolicy's private OCR environment...
"%PYTHON_EXE%" -m venv "%~dp0paddleocr-service\.venv"
if errorlevel 1 goto :failed

set "OCR_PYTHON=%~dp0paddleocr-service\.venv\Scripts\python.exe"

echo [2/5] Preparing the installer...
"%OCR_PYTHON%" -m pip install --upgrade pip setuptools wheel
if errorlevel 1 goto :failed

echo [3/5] Installing the RTX 5060 GPU engine...
"%OCR_PYTHON%" -m pip install paddlepaddle-gpu==3.2.1 -i https://www.paddlepaddle.org.cn/packages/stable/cu129/
if errorlevel 1 goto :failed

echo [4/5] Installing PaddleOCR-VL 1.6 document reading...
"%OCR_PYTHON%" -m pip install -r "%~dp0paddleocr-service\requirements.txt"
if errorlevel 1 goto :failed

echo Checking the document export component...
"%OCR_PYTHON%" -c "import docx; print('Word export component:', docx.__version__)"
if errorlevel 1 goto :failed

echo Checking the PDF page renderer...
"%OCR_PYTHON%" -c "import fitz; print('PDF renderer:', fitz.__doc__)"
if errorlevel 1 goto :failed

echo.
echo Checking the installation and RTX GPU...
"%OCR_PYTHON%" -c "import paddle; print('Paddle version:', paddle.__version__); print('CUDA enabled:', paddle.device.is_compiled_with_cuda()); print('Device:', paddle.device.get_device()); paddle.utils.run_check()"
if errorlevel 1 goto :failed

echo.
echo [5/5] Downloading the OCR models and reading a test document...
echo This is the longest step and may appear quiet for several minutes.
echo A previous incomplete attempt will reuse its downloaded GPU files and models.
ollama stop qwen3.5:9b >nul 2>nul
ollama stop qwen3:8b >nul 2>nul
ollama stop bge-m3 >nul 2>nul
"%~dp0paddleocr-service\.venv\Scripts\paddleocr.exe" doc_parser -i https://paddle-model-ecology.bj.bcebos.com/paddlex/imgs/demo_image/paddleocr_vl_demo.png --save_path "%~dp0paddleocr-service\output"
if errorlevel 1 goto :failed

echo.
echo ============================================================
echo   SUCCESS - DearPolicy OCR is installed.
echo ============================================================
echo.
echo You can close this window and start DearPolicy normally.
echo PaddleOCR and its models have been downloaded and tested.
echo DearPolicy will now use them automatically for scanned pages.
echo.
pause
exit /b 0

:python_help
echo Python 3.12 and Windows Package Manager were not found.
echo Install Python 3.12 from https://www.python.org/downloads/windows/
echo Select "Add python.exe to PATH", then run INSTALL-OCR.cmd again.
goto :end_error

:python_restart
echo Python was installed, but this window cannot see it yet.
echo Close this window and double-click INSTALL-OCR.cmd one more time.
goto :end_error

:failed
echo.
echo Installation stopped because one step failed.
echo Take a screenshot of this window and send it for help.

:end_error
echo.
pause
exit /b 1
