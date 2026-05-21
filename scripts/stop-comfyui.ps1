$ErrorActionPreference = 'Stop'

$targets = Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object { $_.CommandLine -like '*comfyui-local*main.py*' }

if (-not $targets) {
  Write-Output 'No local ComfyUI process found.'
  exit 0
}

$targets | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

$targets | Select-Object ProcessId, CommandLine | Format-List
