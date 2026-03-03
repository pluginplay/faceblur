param(
  [Parameter(Mandatory = $true)][string]$TargetDir
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $TargetDir)) {
  throw "TargetDir not found: $TargetDir"
}

$certBase64 = $env:WIN_SIGN_PFX_BASE64
$certPassword = $env:WIN_SIGN_PFX_PASSWORD
$timestampUrl = if ($env:WIN_TIMESTAMP_URL) { $env:WIN_TIMESTAMP_URL } else { "http://timestamp.digicert.com" }

if (-not $certBase64 -or -not $certPassword) {
  throw "WIN_SIGN_PFX_BASE64 and WIN_SIGN_PFX_PASSWORD are required."
}

$tempPfx = Join-Path $env:RUNNER_TEMP "codesign-cert.pfx"
[System.IO.File]::WriteAllBytes($tempPfx, [System.Convert]::FromBase64String($certBase64))

$files = Get-ChildItem -Path $TargetDir -File | Where-Object { $_.Extension -in ".exe", ".dll" }
if ($files.Count -eq 0) {
  throw "No .exe/.dll files found under $TargetDir"
}

foreach ($f in $files) {
  & signtool sign /fd SHA256 /td SHA256 /tr $timestampUrl /f $tempPfx /p $certPassword $f.FullName
  if ($LASTEXITCODE -ne 0) {
    throw "signtool sign failed for $($f.FullName)"
  }

  & signtool verify /pa /v $f.FullName
  if ($LASTEXITCODE -ne 0) {
    throw "signtool verify failed for $($f.FullName)"
  }
}

Write-Host "Signed Windows native payload in $TargetDir"
