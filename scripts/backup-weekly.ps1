# Backup mingguan TaktikFPL ke folder lokal (dipanggil Windows Task Scheduler).
# Koneksi produksi dibaca dari .env.backup di root repo; folder tujuan dari BACKUP_DIR.
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$env:Path = [Environment]::GetEnvironmentVariable("Path", "User") + ";" + [Environment]::GetEnvironmentVariable("Path", "Machine")
Push-Location (Join-Path $repo "services\worker")
try {
    uv run python -m app.backup --keep 8
    if ($LASTEXITCODE -ne 0) { throw "backup gagal (exit $LASTEXITCODE)" }
}
finally {
    Pop-Location
}
