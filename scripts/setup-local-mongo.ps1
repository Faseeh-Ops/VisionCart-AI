$ErrorActionPreference = 'Stop'
$billingIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$billingPrincipal = New-Object Security.Principal.WindowsPrincipal($billingIdentity)
if (-not $billingPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Open PowerShell as Administrator, then run this script again.'
}
$billingConfigPath = 'C:\Program Files\MongoDB\Server\9.0\bin\mongod.cfg'
$billingConfig = Get-Content -LiteralPath $billingConfigPath -Raw
if ($billingConfig -notmatch '(?m)^replication:') {
    $billingBackupPath = $billingConfigPath + '.aspire-backup'
    if (-not (Test-Path -LiteralPath $billingBackupPath)) {
        Copy-Item -LiteralPath $billingConfigPath -Destination $billingBackupPath
    }
    $billingConfig = $billingConfig.Replace('#replication:', "replication:`r`n  replSetName: aspire-rs")
    if ($billingConfig -notmatch '(?m)^replication:') { throw 'Unexpected MongoDB configuration; no changes written.' }
    Set-Content -LiteralPath $billingConfigPath -Value $billingConfig
    Restart-Service -Name MongoDB
}
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    node scripts/init-local-mongo.js
    if ($LASTEXITCODE -ne 0) { throw 'Replica set initialization failed.' }
    $billingEnvPath = Join-Path (Get-Location) '.env'
    $billingEnv = Get-Content -LiteralPath $billingEnvPath -Raw
    $billingEnv = $billingEnv -replace '(?m)^MONGODB_URI=.*$', 'MONGODB_URI=mongodb://127.0.0.1:27017/aspire_billing?replicaSet=aspire-rs'
    Set-Content -LiteralPath $billingEnvPath -Value $billingEnv
    Write-Host 'MongoDB is ready. Restart the Aspire backend. Compass URI: mongodb://127.0.0.1:27017/?replicaSet=aspire-rs'
} finally { Pop-Location }
