# Daftarkan backup mingguan di Windows Task Scheduler (akun pengguna sendiri, tanpa admin).
# Default: setiap Minggu 10:00 waktu laptop. Jika laptop mati saat jadwal, dijalankan saat menyala.
param(
    [string]$Day = "Sunday",
    [string]$At = "10:00"
)
$script = Join-Path $PSScriptRoot "backup-weekly.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Day -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName "TaktikFPL Backup Mingguan" -Action $action -Trigger $trigger `
    -Settings $settings -Description "Backup DB + cermin arsip TaktikFPL ke folder lokal" -Force
Write-Output "Terdaftar: TaktikFPL Backup Mingguan ($Day $At). Hapus: Unregister-ScheduledTask -TaskName 'TaktikFPL Backup Mingguan'"
