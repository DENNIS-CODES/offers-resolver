<#
setup-offers.ps1
- Resets postgres password by temporarily enabling localhost trust auth for user postgres only
- Creates DB named "offers"
- Updates .env DATABASE_URL
- Fixes Yoga dependency if needed
- Runs yarn + prisma migrate/generate/push

Run as Administrator:
  powershell -ExecutionPolicy Bypass -File .\setup-offers.ps1 -NewPassword "YourNewPassHere"

Optional:
  -RepoRoot "C:\Users\Admin\Downloads\offers-resolver"
  -PgBin "C:\Program Files\PostgreSQL\18\bin"
  -PgData "C:\Program Files\PostgreSQL\18\data"
  -ServiceName "postgresql-x64-18"
  -Port 5432
#>

param(
  [Parameter(Mandatory=$true)]
  [string]$NewPassword,

  [string]$RepoRoot = (Get-Location).Path,

  [string]$PgBin = "C:\Program Files\PostgreSQL\18\bin",
  [string]$PgData = "C:\Program Files\PostgreSQL\18\data",
  [string]$ServiceName = "postgresql-x64-18",
  [int]$Port = 5432,

  [string]$DbName = "offers",
  [string]$DbUser = "postgres",
  [string]$HostIPv4 = "127.0.0.1"
)

$ErrorActionPreference = "Stop"

function Assert-Exists($path, $label) {
  if (-not (Test-Path $path)) {
    throw "$label not found: $path"
  }
}

function Write-Info($msg) {
  Write-Host "[INFO] $msg" -ForegroundColor Cyan
}

function Write-Warn($msg) {
  Write-Host "[WARN] $msg" -ForegroundColor Yellow
}

function Write-Ok($msg) {
  Write-Host "[OK]   $msg" -ForegroundColor Green
}

# Paths
$psql = Join-Path $PgBin "psql.exe"
$createdb = Join-Path $PgBin "createdb.exe"
$pg_hba = Join-Path $PgData "pg_hba.conf"
$envFile = Join-Path $RepoRoot ".env"
$envExample = Join-Path $RepoRoot ".env.example"

Assert-Exists $psql "psql.exe"
Assert-Exists $createdb "createdb.exe"
Assert-Exists $pg_hba "pg_hba.conf"
Assert-Exists $RepoRoot "Repo root"

Write-Info "RepoRoot: $RepoRoot"
Write-Info "Postgres bin: $PgBin"
Write-Info "Postgres data: $PgData"
Write-Info "pg_hba.conf: $pg_hba"
Write-Info "Service: $ServiceName"
Write-Info "Host: $HostIPv4  Port: $Port"
Write-Info "Target DB: $DbName"

# --- 0) Ensure .env exists (copy from example if missing) ---
if (-not (Test-Path $envFile)) {
  if (Test-Path $envExample) {
    Copy-Item $envExample $envFile
    Write-Ok "Created .env from .env.example"
  } else {
    New-Item -Path $envFile -ItemType File | Out-Null
    Write-Warn "Created empty .env (no .env.example found)"
  }
}

# --- 1) Patch Yoga dependency (fixes Yarn 'No candidates found' error) ---
# Replace @graphql-yoga/node -> graphql-yoga, and update import
$apiPkg = Join-Path $RepoRoot "apps\api\package.json"
$apiIndex = Join-Path $RepoRoot "apps\api\src\index.ts"

if (Test-Path $apiPkg) {
  $pkgJson = Get-Content $apiPkg -Raw
  if ($pkgJson -match '"@graphql-yoga/node"\s*:\s*"\^') {
    Write-Info "Patching apps/api/package.json: @graphql-yoga/node -> graphql-yoga"
    $pkgJson = $pkgJson -replace '"@graphql-yoga/node"\s*:\s*"\^([^"]+)"', '"graphql-yoga": "^5.18.0"'
    Set-Content -Path $apiPkg -Value $pkgJson -Encoding UTF8
    Write-Ok "Patched apps/api/package.json"
  } else {
    Write-Info "apps/api/package.json: no @graphql-yoga/node entry found (skip patch)"
  }
} else {
  Write-Warn "apps/api/package.json not found (skip Yoga patch)"
}

if (Test-Path $apiIndex) {
  $idx = Get-Content $apiIndex -Raw
  if ($idx -match 'from\s+"@graphql-yoga/node"') {
    Write-Info 'Patching apps/api/src/index.ts: import from "@graphql-yoga/node" -> "graphql-yoga"'
    $idx = $idx -replace 'from\s+"@graphql-yoga/node"', 'from "graphql-yoga"'
    Set-Content -Path $apiIndex -Value $idx -Encoding UTF8
    Write-Ok "Patched apps/api/src/index.ts"
  } else {
    Write-Info "apps/api/src/index.ts: no Yoga node import found (skip patch)"
  }
}

# --- 2) Backup pg_hba.conf ---
$backup = "$pg_hba.bak.$(Get-Date -Format 'yyyyMMddHHmmss')"
Copy-Item $pg_hba $backup
Write-Ok "Backed up pg_hba.conf -> $backup"

# Trust lines (postgres only, localhost only)
$trustLines = @(
  "host    all             postgres        127.0.0.1/32            trust",
  "host    all             postgres        ::1/128                 trust"
)

function Add-TrustLinesToPgHba {
  $content = Get-Content $pg_hba

  $already = $false
  foreach ($line in $trustLines) {
    if ($content -contains $line) { $already = $true }
  }

  if ($already) {
    Write-Warn "Trust lines already present in pg_hba.conf (skip add)"
    return
  }

  # Insert trust lines right before the existing IPv4 scram line if possible
  $insertBefore = "host    all             all             127.0.0.1/32            scram-sha-256"
  $idx = [Array]::IndexOf($content, $insertBefore)

  if ($idx -ge 0) {
    $newContent = @()
    $newContent += $content[0..($idx-1)]
    $newContent += "# TEMP (remove after reset) - allow postgres locally without password"
    $newContent += $trustLines
    $newContent += $content[$idx..($content.Length-1)]
    Set-Content -Path $pg_hba -Value $newContent -Encoding ASCII
    Write-Ok "Inserted trust lines into pg_hba.conf (before scram localhost rule)"
  } else {
    # Fallback: add at very top (still works)
    $newContent = @()
    $newContent += "# TEMP (remove after reset) - allow postgres locally without password"
    $newContent += $trustLines
    $newContent += ""
    $newContent += $content
    Set-Content -Path $pg_hba -Value $newContent -Encoding ASCII
    Write-Warn "Could not find scram localhost rule; inserted trust lines at top"
  }
}

function Remove-TrustLinesFromPgHba {
  $content = Get-Content $pg_hba

  $filtered = $content | Where-Object {
    ($_ -ne $trustLines[0]) -and
    ($_ -ne $trustLines[1]) -and
    ($_ -ne "# TEMP (remove after reset) - allow postgres locally without password")
  }

  Set-Content -Path $pg_hba -Value $filtered -Encoding ASCII
  Write-Ok "Removed trust lines from pg_hba.conf"
}

function Restart-PostgresService {
  Write-Info "Restarting service: $ServiceName"
  Restart-Service $ServiceName
  Start-Sleep -Seconds 2
  Write-Ok "Service restarted"
}

function Run-Psql($database, $sql) {
  & $psql -h $HostIPv4 -p $Port -U $DbUser -d $database -c $sql
  if ($LASTEXITCODE -ne 0) {
    throw "psql failed (db=$database) SQL: $sql"
  }
}

function Update-EnvDatabaseUrl {
  $dbUrl = "postgresql://${DbUser}:${NewPassword}@${HostIPv4}:$Port/${DbName}?schema=public"

  $envText = Get-Content $envFile -Raw
  if ($envText -match "DATABASE_URL=") {
    $envText = [Regex]::Replace($envText, 'DATABASE_URL\s*=\s*".*?"', "DATABASE_URL=`"$dbUrl`"")
    $envText = [Regex]::Replace($envText, "DATABASE_URL\s*=\s*'.*?'", "DATABASE_URL=`"$dbUrl`"")
    $envText = [Regex]::Replace($envText, "DATABASE_URL\s*=\s*.*", "DATABASE_URL=`"$dbUrl`"")
  } else {
    $envText = $envText.TrimEnd() + "`r`nDATABASE_URL=`"$dbUrl`"`r`n"
  }
  Set-Content -Path $envFile -Value $envText -Encoding UTF8
  Write-Ok "Updated .env DATABASE_URL -> $dbUrl"
}

# --- 3) Main flow with safety restore ---
try {
  Write-Info "Step 1/4: Enable localhost trust for postgres user (temporary)"
  Add-TrustLinesToPgHba
  Restart-PostgresService

  Write-Info "Step 2/4: Reset postgres password"
  # No password required due to trust; run ALTER USER
  Run-Psql "postgres" "ALTER USER postgres WITH PASSWORD '$NewPassword';"
  Write-Ok "Password reset complete"

  Write-Info "Step 3/4: Restore secure auth (remove trust lines)"
  Remove-TrustLinesFromPgHba
  Restart-PostgresService

  Write-Info "Step 4/4: Create DB '$DbName' (if it doesn't exist)"
  $env:PGPASSWORD = $NewPassword

 # Create DB only if missing (robust against null output)
$existsRaw = & $psql -h $HostIPv4 -p $Port -U $DbUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DbName';" 2>$null
$exists = if ($null -eq $existsRaw) { "" } else { ($existsRaw | Out-String).Trim() }

if ($exists -eq "1") {
  Write-Warn "Database '$DbName' already exists (skip create)"
} else {
  & $createdb -h $HostIPv4 -p $Port -U $DbUser $DbName
  if ($LASTEXITCODE -ne 0) { throw "createdb failed" }
  Write-Ok "Database '$DbName' created"
}


  # Update .env DATABASE_URL
  Update-EnvDatabaseUrl

  # Yarn + Prisma
  Write-Info "Running yarn install..."
  Push-Location $RepoRoot
  try {
    yarn
    if ($LASTEXITCODE -ne 0) { throw "yarn install failed" }

    Write-Info "Running Prisma migration + generate + push..."
    yarn db:migrate
    if ($LASTEXITCODE -ne 0) { throw "yarn db:migrate failed" }

    yarn db:generate
    if ($LASTEXITCODE -ne 0) { throw "yarn db:generate failed" }

    yarn db:push
    if ($LASTEXITCODE -ne 0) { throw "yarn db:push failed" }

    Write-Ok "All done. You can now run: yarn dev"
  } finally {
    Pop-Location
  }
}
catch {
  Write-Host "`n[ERROR] $($_.Exception.Message)" -ForegroundColor Red
  Write-Warn "If something failed mid-way, your original pg_hba.conf backup is at:"
  Write-Host "  $backup" -ForegroundColor Yellow
  throw
}
finally {
  # Cleanup env var so it doesn't linger in the session
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}
