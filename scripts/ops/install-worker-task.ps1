# Registers (or replaces) the "Job Pilot workers" scheduled task for the current user: at log on
# and every 5 minutes it runs ensure-workers.vbs, which starts any worker supervisor that is not
# running. Remove it with:  Unregister-ScheduledTask -TaskName 'Job Pilot workers' -Confirm:$false
$ErrorActionPreference = 'Stop'
$vbs = Join-Path $PSScriptRoot 'ensure-workers.vbs'
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`""
$atLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$every5 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'Job Pilot workers' -Description 'Keeps the job-pilot search and apply workers running (scripts/ops/ensure-workers.ps1).' -Action $action -Trigger @($atLogon, $every5) -Settings $settings -Principal $principal -Force | Out-Null
Write-Output "Registered 'Job Pilot workers' (at log on + every 5 minutes)."
