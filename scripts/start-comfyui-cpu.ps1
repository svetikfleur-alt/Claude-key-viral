$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$comfyRoot = Join-Path $projectRoot 'comfyui-local'
$pythonExe = Join-Path $comfyRoot '.venv\Scripts\python.exe'
$stdoutLog = Join-Path $projectRoot 'logs\comfyui-stdout.log'
$stderrLog = Join-Path $projectRoot 'logs\comfyui-stderr.log'

if (!(Test-Path $pythonExe)) {
  throw "ComfyUI venv not found at $pythonExe"
}

Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object { $_.CommandLine -like '*comfyui-local*main.py*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

if (Test-Path $stdoutLog) { Remove-Item -LiteralPath $stdoutLog -Force }
if (Test-Path $stderrLog) { Remove-Item -LiteralPath $stderrLog -Force }

$process = Start-Process -FilePath $pythonExe `
  -ArgumentList @('main.py', '--cpu', '--listen', '127.0.0.1', '--port', '8188') `
  -WorkingDirectory $comfyRoot `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -WindowStyle Hidden `
  -PassThru

Start-Sleep -Seconds 10

$probe = try {
  (Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8188/history' -TimeoutSec 5).StatusCode
} catch {
  $_.Exception.Message
}

[PSCustomObject]@{
  pid = $process.Id
  hasExited = $process.HasExited
  probe = $probe
  stdoutLog = $stdoutLog
  stderrLog = $stderrLog
} | Format-List
