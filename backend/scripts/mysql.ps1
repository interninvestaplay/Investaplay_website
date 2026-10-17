$ErrorActionPreference = 'Stop'
$backendRoot = Split-Path -Parent $PSScriptRoot
$sharedRoot = (Resolve-Path (Join-Path $backendRoot '..\..\..')).Path
$mysql = Join-Path $sharedRoot '.local\mysql-8.4.9-winx64\bin\mysql.exe'
$clientConfig = Join-Path $backendRoot '.local\mysql-client.cnf'

if (-not (Test-Path -LiteralPath $mysql) -or -not (Test-Path -LiteralPath $clientConfig)) {
  throw 'Run .\scripts\setup-local-mysql.ps1 first.'
}

& $mysql "--defaults-extra-file=$clientConfig" quizgame_local @args
exit $LASTEXITCODE
