#!/usr/bin/env pwsh
# Windows / PowerShell launcher (mirror of run.sh).
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

if (-not (Test-Path -Path 'node_modules')) {
  Write-Host 'Installing dependencies...'
  npm install
}

npm run dev
