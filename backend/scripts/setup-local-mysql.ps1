$ErrorActionPreference = 'Stop'

$backendRoot = Split-Path -Parent $PSScriptRoot
$sharedRoot = (Resolve-Path (Join-Path $backendRoot '..\..\..')).Path
$startScript = Join-Path $sharedRoot 'scripts\start-local-mysql.ps1'
$mysql = Join-Path $sharedRoot '.local\mysql-8.4.9-winx64\bin\mysql.exe'
$rootConfig = Join-Path $sharedRoot '.local\mysql-root.cnf'
$envFile = Join-Path $backendRoot '.env'
$clientConfigDir = Join-Path $backendRoot '.local'
$clientConfig = Join-Path $clientConfigDir 'mysql-client.cnf'
$database = 'quizgame_local'
$user = 'quizgame_local'

foreach ($path in @($startScript, $mysql, $rootConfig)) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Required local MySQL file is missing: $path"
  }
}

& $startScript | Out-Host

function New-RandomHex([int]$byteCount) {
  $bytes = New-Object byte[] $byteCount
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
}

if (Test-Path -LiteralPath $envFile) {
  $settings = @{}
  foreach ($line in (Get-Content -LiteralPath $envFile)) {
    if ($line -match '^([A-Z_]+)=(.*)$') { $settings[$matches[1]] = $matches[2] }
  }
  if ($settings.DB_NAME -ne $database -or $settings.DB_USER -ne $user -or
      $settings.DB_HOST -ne '127.0.0.1' -or $settings.DB_PORT -ne '3307' -or
      -not $settings.DB_PASSWORD) {
    throw 'Existing .env has different database settings. Check it before changing this local setup.'
  }
  $password = $settings.DB_PASSWORD
} else {
  $password = New-RandomHex 24
  $accessSecret = New-RandomHex 32
  $refreshSecret = New-RandomHex 32
}

# Values are generated hex or fixed identifiers, so they are safe in SQL literals.
$sql = @"
CREATE DATABASE IF NOT EXISTS quizgame_local CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$user'@'127.0.0.1' IDENTIFIED BY '$password';
ALTER USER '$user'@'127.0.0.1' IDENTIFIED BY '$password';
GRANT ALL PRIVILEGES ON quizgame_local.* TO '$user'@'127.0.0.1';
"@
$sql | & $mysql "--defaults-extra-file=$rootConfig" --batch --silent
if ($LASTEXITCODE -ne 0) { throw 'Could not create the quiz database and user.' }

if (-not (Test-Path -LiteralPath $envFile)) {
  $envText = @"
NODE_ENV=development
PORT=4000
DB_HOST=127.0.0.1
DB_PORT=3307
DB_USER=$user
DB_PASSWORD=$password
DB_NAME=$database
JWT_ACCESS_SECRET=$accessSecret
JWT_REFRESH_SECRET=$refreshSecret
CLIENT_ORIGIN=http://localhost:8081,http://localhost:8082,http://localhost:19006
"@
  [IO.File]::WriteAllText($envFile, $envText + [Environment]::NewLine)
}

if (-not (Test-Path -LiteralPath $clientConfigDir)) {
  New-Item -ItemType Directory -Path $clientConfigDir | Out-Null
}
$clientText = @"
[client]
host=127.0.0.1
port=3307
protocol=tcp
user=$user
password=$password
"@
[IO.File]::WriteAllText($clientConfig, $clientText + [Environment]::NewLine)

Push-Location $backendRoot
try {
  node -e "require('dotenv').config(); const mysql=require('mysql2/promise'); const e=process.env; mysql.createConnection({host:e.DB_HOST,port:Number(e.DB_PORT),user:e.DB_USER,password:e.DB_PASSWORD,database:e.DB_NAME}).then(async c=>{const [rows]=await c.query('SELECT VERSION() AS version, DATABASE() AS db'); console.log('Quiz MySQL ready: '+rows[0].db+' on '+e.DB_HOST+':'+e.DB_PORT+' (MySQL '+rows[0].version+')'); await c.end()}).catch(err=>{console.error(err.code||err.message);process.exitCode=1})"
  if ($LASTEXITCODE -ne 0) { throw 'Quiz database connection test failed.' }
} finally {
  Pop-Location
}
