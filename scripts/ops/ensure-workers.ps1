# Starts the search and apply worker supervisors of THIS install when they are not running. Safe to
# run any time: a role whose supervisor is alive is left alone. scripts/ensure-workers.mjs runs it on
# `npm run dev` and the dev server runs it every 5 minutes, so the workers come back after a crash
# or a Windows restart.
#
# Only supervisors started from this folder count (the command line holds the absolute path of
# scripts/workers.mjs), so a second copy of the app on the same machine never blocks or replaces
# these workers. Supervisors are created through WMI (Win32_Process Create), so they never belong to
# a terminal's process tree and survive when it closes.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$logDir = Join-Path $root 'storage\logs'
$lockDir = Join-Path $root 'storage\locks'
New-Item -ItemType Directory -Force $logDir, $lockDir | Out-Null
$log = Join-Path $logDir 'ensure-workers.log'
function Say($msg) { Add-Content -Path $log -Value ("{0:u} {1}" -f (Get-Date).ToUniversalTime(), $msg) }

# NODE_EXE wins; otherwise node from PATH (a scheduled task's PATH can be stale, so set NODE_EXE there).
$node = $env:NODE_EXE
if (-not $node -or -not (Test-Path $node)) { $node = (Get-Command node -ErrorAction SilentlyContinue).Source }
if (-not $node) { Say 'node.exe not found; nothing started'; exit 1 }

$script = Join-Path $root 'scripts\workers.mjs'
$pattern = [regex]::Escape($script)
$supervisors = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine -match $pattern })
foreach ($role in 'search', 'apply') {
  $running = $supervisors | Where-Object { $_.CommandLine -match "$pattern`"?\s+$role\b" }
  if ($running) { continue }
  # After a reboot the old pid in the lock file can belong to another program, and the supervisor
  # would then refuse to start ("already runs"). No live supervisor means the lock is stale.
  $lock = Join-Path $lockDir "worker-$role.pid"
  if (Test-Path $lock) { Remove-Item $lock -Force }
  $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = "`"$node`" `"$script`" $role"; CurrentDirectory = $root }
  Say ("started {0} supervisor: pid {1} (return {2})" -f $role, $r.ProcessId, $r.ReturnValue)
}
