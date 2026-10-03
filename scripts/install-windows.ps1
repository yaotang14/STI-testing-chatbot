# Install STI-testing-chat from a local Windows NSIS installer produced by
# `npm run build:installer` on a Windows machine.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/install-windows.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/install-windows.ps1 -InstallerPath C:\path\STI-testing-chat-setup.exe

[CmdletBinding()]
param(
  [string]$InstallerPath = ""
)

$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
  Write-Error "This script is for Windows. On macOS run: scripts/install-macos.sh. A .dmg or .deb will not install STI-testing-chat on Windows."
}

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$NsisDir = Join-Path $Root "src-tauri\target\release\bundle\nsis"

function Find-NsisInstaller {
  param([string]$Explicit)
  if ($Explicit) {
    if (-not (Test-Path -LiteralPath $Explicit)) {
      throw "Installer not found: $Explicit"
    }
    return (Resolve-Path -LiteralPath $Explicit).Path
  }
  if (Test-Path -LiteralPath $NsisDir) {
    $found = Get-ChildItem -LiteralPath $NsisDir -Filter "*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($found) {
      return $found.FullName
    }
  }
  return $null
}

$exe = Find-NsisInstaller -Explicit $InstallerPath

if (-not $exe) {
  Write-Host "No Windows installer (NSIS .exe) found." -ForegroundColor Yellow
  Write-Host "Build on Windows first (needs Node.js, Rust/cargo, and Tauri prerequisites)."
  Write-Host "  cd `"$Root`""
  Write-Host "  npm install"
  Write-Host "  npm run build:installer"
  Write-Host "Then re-run: powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1"
  Write-Host "Or pass the setup exe: -InstallerPath path\to\STI-testing-chat-setup.exe"
  Write-Host "A macOS .dmg or Linux .deb will not install on Windows."
  exit 1
}

Write-Host "Installing STI-testing-chat from: $exe"
# NSIS is configured for current-user install in tauri.conf.json.
Start-Process -FilePath $exe -Wait
Write-Host "Installer finished. Launch STI-testing-chat from the Start menu if the wizard completed."
