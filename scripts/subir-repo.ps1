<#
  Sube el código al repositorio de Azure DevOps (primera vez).
  Uso (desde la carpeta raíz del proyecto):
    powershell -ExecutionPolicy Bypass -File .\scripts\subir-repo.ps1
  La autenticación la gestiona Git Credential Manager (ventana de login de Microsoft), sin tokens manuales.
#>
$ErrorActionPreference = "Stop"
$Remoto = "https://dev.azure.com/grupoarquisocial/Fichajes/_git/Fichajes"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "Instalando Git..." -ForegroundColor Green
  winget install --id Git.Git -e --silent --accept-package-agreements --accept-source-agreements
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}

if (-not (Test-Path ".git")) {
  git init -b main
  git config user.name  "Victor Sumelzo"
  git config user.email "vsumelzo@arquisocial.es"
  git add -A
  git commit -m "Fichajes v1: esquema SQL, API Functions, portal React y pipeline"
}
if (-not ((git remote) -contains "origin")) { git remote add origin $Remoto }
git push -u origin main
git branch develop 2>$null
git push -u origin develop
Write-Host "`nCódigo subido a $Remoto (ramas main y develop)." -ForegroundColor Green
