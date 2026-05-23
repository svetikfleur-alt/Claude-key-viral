$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$textPath = Join-Path $projectRoot 'public\audio\voiceover.txt'
$outPath = Join-Path $projectRoot 'public\audio\voiceover.wav'

if (!(Test-Path $textPath)) {
  throw "voiceover.txt not found at $textPath"
}

$text = Get-Content -LiteralPath $textPath -Raw
if ([string]::IsNullOrWhiteSpace($text)) {
  throw "voiceover.txt is empty"
}

Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer

# Ensure voices are available (some locked-down environments expose none).
try {
  $voices = $synth.GetInstalledVoices()
  if (-not $voices -or $voices.Count -eq 0) {
    throw "No voices returned."
  }
} catch {
  $synth.Dispose()
  Write-Error "No SAPI voices are available in this environment. Install a Windows speech voice pack (Settings -> Time & language -> Speech -> Add voices) or provide your own voiceover.wav at public\\audio\\voiceover.wav."
  exit 2
}

# Optional: pick a specific installed voice by name via env var VOICE_NAME.
$voiceName = $env:VOICE_NAME
if ($voiceName) {
  try {
    $synth.SelectVoice($voiceName)
  } catch {
    Write-Output "Warning: could not select voice '$voiceName'. Using default voice."
  }
}

$synth.Rate = 0
$synth.Volume = 100
$synth.SetOutputToWaveFile($outPath)
$synth.Speak($text)
$synth.SetOutputToDefaultAudioDevice()
$synth.Dispose()

Write-Output $outPath
