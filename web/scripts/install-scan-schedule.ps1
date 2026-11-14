param(
  # node.exe to run the scans with. Defaults to the node on PATH in this shell.
  [string]$NodePath
)

$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$taskName = 'career-ops recurring scan'
$candidate = if ($NodePath) { $NodePath } else { (Get-Command node.exe -ErrorAction Stop).Source }
$script = Join-Path $PSScriptRoot 'scheduled-jobs-runner.mjs'

if (-not (Test-Path -LiteralPath $script)) {
  throw "Scheduled job runner not found: $script"
}

# The real binary, not the path this shell reached it by: fnm (and nvm-windows,
# volta) put a per-shell link on PATH that is deleted when the shell closes, and
# the task outlives it.
$node = & $candidate -e "process.stdout.write(require('fs').realpathSync(process.execPath))"
if ($LASTEXITCODE -ne 0 -or -not $node) { throw "Could not run node at $candidate" }

# Same range as "engines" in package.json: ^22.13.0 || >=23.4.0. An older node
# on PATH (a leftover system install, say) would fail every scheduled scan.
$version = & $node -e "process.stdout.write(process.versions.node)"
$major, $minor = $version.Split('.')[0..1] | ForEach-Object { [int]$_ }
$supported = ($major -eq 22 -and $minor -ge 13) -or ($major -eq 23 -and $minor -ge 4) -or ($major -ge 24)
if (-not $supported) {
  throw "Node $version at $node is too old for career-ops (needs 22.13+ or 23.4+). Run this from a shell where 'node -v' shows a supported version, or pass -NodePath <path to node.exe>."
}

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$script`"" -WorkingDirectory $root
$start = (Get-Date).AddMinutes(1)
$trigger = New-ScheduledTaskTrigger -Once -At $start -RepetitionInterval (New-TimeSpan -Minutes 15)
# 7 hours: longer than the longest run the runner allows (SCHEDULED_RUN_LIMIT_MS
# in web/src/lib/scan-depth.mjs, three attempts at two hours), so Windows never
# stops a deep scan the runner would have let finish.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 7)
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Career Ops scheduled-jobs queue worker every 15 minutes (local-only, zero-token; current user must be logged in)' -Force | Out-Null
$registered = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
$actual = $registered.Principal
if ($actual.UserId -ne $principal.UserId -or $actual.LogonType.ToString() -notin @('Interactive', 'InteractiveToken') -or $actual.RunLevel.ToString() -ne 'Limited') {
  throw "Scheduled task '$taskName' has an unexpected security context (UserId=$($actual.UserId), LogonType=$($actual.LogonType), RunLevel=$($actual.RunLevel)); refusing to continue."
}
Write-Output "Installed '$taskName' for $($principal.UserId) with Node $version ($node) (interactive; the user must be logged in)."
