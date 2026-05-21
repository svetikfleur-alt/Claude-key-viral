$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$desktopBase = 'C:\Users\Lena\Documents\ComfyUI'
$desktopResources = 'C:\Users\Lena\AppData\Local\Programs\ComfyUI\resources\ComfyUI'
$desktopConfig = 'C:\Users\Lena\AppData\Roaming\ComfyUI'
$pythonExe = Join-Path $desktopBase '.venv\Scripts\python.exe'
$mainPy = Join-Path $desktopResources 'main.py'
$stdoutLog = Join-Path $projectRoot 'logs\comfyui-desktop-safe-stdout.log'
$stderrLog = Join-Path $projectRoot 'logs\comfyui-desktop-safe-stderr.log'

if (!(Test-Path $pythonExe)) {
  throw "Desktop ComfyUI venv not found at $pythonExe"
}

if (!(Test-Path $mainPy)) {
  throw "Desktop ComfyUI main.py not found at $mainPy"
}

# Clear out Electron wrapper processes and any lingering Python backends that keep
# the database or port 8000 locked after a failed Desktop launch.
Get-Process ComfyUI -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }

Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object {
    $_.CommandLine -like '*AppData\Local\Programs\ComfyUI\resources\ComfyUI\main.py*' -or
    $_.ExecutablePath -like '*AppData\Roaming\uv\python*'
  } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Start-Sleep -Seconds 2

if (Test-Path $stdoutLog) { Remove-Item -LiteralPath $stdoutLog -Force }
if (Test-Path $stderrLog) { Remove-Item -LiteralPath $stderrLog -Force }

$args = @(
  $mainPy
  '--user-directory', (Join-Path $desktopBase 'user')
  '--input-directory', (Join-Path $desktopBase 'input')
  '--output-directory', (Join-Path $desktopBase 'output')
  '--front-end-root', (Join-Path $desktopResources 'web_custom_versions\desktop_app')
  '--base-directory', $desktopBase
  '--database-url', 'sqlite:///C:/Users/Lena/Documents/ComfyUI/user/comfyui.db'
  '--extra-model-paths-config', (Join-Path $desktopConfig 'extra_models_config.yaml')
  '--log-stdout'
  '--listen', '127.0.0.1'
  '--port', '8000'
  '--enable-manager'
)

$process = Start-Process -FilePath $pythonExe `
  -ArgumentList $args `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -WindowStyle Hidden `
  -PassThru

Start-Sleep -Seconds 12

$probe = try {
  (Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8000/system_stats' -TimeoutSec 5).StatusCode
} catch {
  $_.Exception.Message
}

if ($probe -eq 200) {
  Start-Process 'http://127.0.0.1:8000' | Out-Null
}

[PSCustomObject]@{
  pid = $process.Id
  hasExited = $process.HasExited
  probe = $probe
  stdoutLog = $stdoutLog
  stderrLog = $stderrLog
} | Format-List
