# One-click development environment startup script
# Starts backend service
#
# Usage:
#   .\backend\scripts\start-dev.ps1
#
# Options:
#   -NoReload  Disable auto-reload on file changes

param(
    [int]$Port = 8002,
    [switch]$NoReload
)

$ErrorActionPreference = "Stop"

# Refresh PATH to include newly installed applications
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# Color output functions
function Write-Info { Write-Host "[INFO] $args" -ForegroundColor Cyan }
function Write-Success { Write-Host "[SUCCESS] $args" -ForegroundColor Green }
function Write-Error_ { Write-Host "[ERROR] $args" -ForegroundColor Red }

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Split-Path -Parent $scriptDir

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Voice Clone Studio - Backend Service" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check virtual environment
$venvPython = Join-Path $backendDir ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    Write-Error_ "Virtual environment not found: $venvPython"
    Write-Host ""
    Write-Host "Please create virtual environment:"
    Write-Host "  cd backend"
    Write-Host "  python -m venv .venv"
    Write-Host "  .\.venv\Scripts\activate"
    Write-Host "  pip install -r requirements.txt"
    exit 1
}

Write-Success "Using Python: $venvPython"

# Build uvicorn arguments
$uvicornArgs = @(
    "-m", "uvicorn", "main:app",
    "--host", "127.0.0.1",
    "--port", $Port.ToString()
)

if (-not $NoReload) {
    $uvicornArgs += "--reload"
}

Write-Info "Starting backend service..."
Write-Host ""
Write-Host "API available at: http://127.0.0.1:$Port" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

# Start backend
try {
    $processInfo = New-Object System.Diagnostics.ProcessStartInfo
    $processInfo.FileName = $venvPython
    $processInfo.Arguments = $uvicornArgs -join " "
    $processInfo.UseShellExecute = $false
    $processInfo.RedirectStandardOutput = $true
    $processInfo.RedirectStandardError = $true
    $processInfo.CreateNoWindow = $false

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $processInfo
    $process.Start() | Out-Null

    # Wait for process to exit
    $process.WaitForExit()
    
} catch {
    Write-Error_ "Failed to start backend: $_"
    exit 1
}
