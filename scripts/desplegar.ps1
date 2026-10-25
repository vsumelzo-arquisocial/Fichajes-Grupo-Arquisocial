<#
  Fichajes - Grupo Arquisocial
  Configura y despliega la app en Azure Static Web Apps desde tu PC (Windows).

  Uso (PowerShell, desde la carpeta raíz del proyecto, donde está README.md):
    powershell -ExecutionPolicy Bypass -File .\scripts\desplegar.ps1 -Entorno test
    powershell -ExecutionPolicy Bypass -File .\scripts\desplegar.ps1 -Entorno prod

  Parámetros opcionales:
    -SoloDesplegar      No toca la configuración, solo compila y publica.
    -QuitarSetupKey     Elimina SETUP_KEY tras crear el primer administrador.
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet("test", "prod")][string]$Entorno,
  [switch]$SoloDesplegar,
  [switch]$QuitarSetupKey
)

$ErrorActionPreference = "Stop"
$Suscripcion = "d073337c-cdd3-425f-897d-07fda627c5fd"
$Cfg = @{
  test = @{ Rg = "rg-fichajes-test"; Swa = "swa-fichajes-test"; Sql = "sql-fichajes-test-neu"; Bd = "sqldb-fichajes-test" }
  prod = @{ Rg = "rg-fichajes-prod"; Swa = "swa-fichajes-prod"; Sql = "sql-fichajes-prod-neu"; Bd = "sqldb-fichajes-prod" }
}[$Entorno]

function Paso($t) { Write-Host "`n==> $t" -ForegroundColor Green }

function Asegurar-Herramienta($comando, $wingetId) {
  if (-not (Get-Command $comando -ErrorAction SilentlyContinue)) {
    Paso "Instalando $wingetId"
    winget install --id $wingetId -e --silent --accept-package-agreements --accept-source-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    if (-not (Get-Command $comando -ErrorAction SilentlyContinue)) {
      throw "No se encuentra '$comando' tras instalar. Cierra y vuelve a abrir PowerShell y repite."
    }
  }
}

function Nuevo-Secreto([int]$bytes) {
  $b = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return ([Convert]::ToBase64String($b) -replace '[+/=]', '')
}

if (-not (Test-Path ".\web\package.json") -or -not (Test-Path ".\api\package.json")) {
  throw "Ejecuta el script desde la carpeta raíz del proyecto (donde están 'web' y 'api')."
}

Paso "Comprobando herramientas"
Asegurar-Herramienta "node" "OpenJS.NodeJS.LTS"
Asegurar-Herramienta "az"   "Microsoft.AzureCLI"

Paso "Iniciando sesión en Azure (se abrirá el navegador)"
$cuenta = az account show 2>$null | ConvertFrom-Json
if (-not $cuenta) { az login --only-show-errors | Out-Null }
az account set --subscription $Suscripcion

if (-not $SoloDesplegar) {
  if ($QuitarSetupKey) {
    Paso "Eliminando SETUP_KEY de $($Cfg.Swa)"
    az staticwebapp appsettings delete -n $Cfg.Swa -g $Cfg.Rg --setting-names SETUP_KEY --yes --only-show-errors | Out-Null
    Write-Host "SETUP_KEY eliminada." -ForegroundColor Yellow
    exit 0
  }

  Paso "Configurando variables de $($Cfg.Swa)"
  $pwSegura = Read-Host "Contraseña de app_fichajes en $($Cfg.Bd)" -AsSecureString
  $pw = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pwSegura))
  if ($pw -match '[;&|^%!"<>]') {
    throw "La contraseña contiene caracteres problemáticos para la cadena de conexión o la CLI ( ; & | ^ % ! "" < > ). Cámbiala en SQL (ALTER USER app_fichajes WITH PASSWORD = '...') y repite."
  }

  $cs = "Server=tcp:$($Cfg.Sql).database.windows.net,1433;Database=$($Cfg.Bd);User ID=app_fichajes;Password=$pw;Encrypt=true;TrustServerCertificate=false;Connection Timeout=60;"
  $jwt = Nuevo-Secreto 64
  $setupKey = Nuevo-Secreto 18

  az staticwebapp appsettings set -n $Cfg.Swa -g $Cfg.Rg --only-show-errors --setting-names `
    "SQL_CONNECTION_STRING=$cs" "JWT_SECRET=$jwt" "SETUP_KEY=$setupKey" "TZ_APP=Europe/Madrid" | Out-Null
  $pw = $null; $cs = $null; $jwt = $null

  Write-Host "`nVariables configuradas." -ForegroundColor Green
  Write-Host "CLAVE DE CONFIGURACIÓN INICIAL (cópiala ahora, la necesitarás en /setup):" -ForegroundColor Yellow
  Write-Host "    $setupKey" -ForegroundColor Cyan
}

Paso "Compilando la API"
Push-Location api
npm ci --no-audit --no-fund
npm run build
npm test
npm prune --omit=dev --no-audit --no-fund
Pop-Location

Paso "Compilando el portal"
Push-Location web
npm ci --no-audit --no-fund
npm run build
Pop-Location

Paso "Obteniendo token de despliegue"
$token = az staticwebapp secrets list -n $Cfg.Swa -g $Cfg.Rg --query "properties.apiKey" -o tsv

Paso "Publicando en $($Cfg.Swa)"
npx --yes @azure/static-web-apps-cli@2 deploy ./web/dist `
  --api-location ./api --api-language node --api-version 20 `
  --env production --deployment-token $token --no-use-keychain
$token = $null

$url = az staticwebapp show -n $Cfg.Swa -g $Cfg.Rg --query "defaultHostname" -o tsv
Write-Host "`nListo: https://$url" -ForegroundColor Green
if (-not $SoloDesplegar) {
  Write-Host "Primer acceso: https://$url/setup  (usa la clave de configuración mostrada arriba)" -ForegroundColor Yellow
  Write-Host "Después ejecuta:  .\scripts\desplegar.ps1 -Entorno $Entorno -QuitarSetupKey" -ForegroundColor Yellow
}
