$ErrorActionPreference = 'Stop'

Get-Process ComfyUI -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }

$targets = Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object {
    $_.CommandLine -like '*AppData\Local\Programs\ComfyUI\resources\ComfyUI\main.py*' -or
    $_.ExecutablePath -like '*AppData\Roaming\uv\python*'
  }

if (-not $targets) {
  Write-Output 'No Desktop ComfyUI backend process found.'
  exit 0
}

$targets | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

$targets | Select-Object ProcessId, CommandLine | Format-List
