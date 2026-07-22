[CmdletBinding()]
param(
    [ValidateSet("Install", "Uninstall", "Start", "Stop", "Status")]
    [string]$Action = "Install",
    [string]$RepoPath,
    [string]$TaskName = "GPT Repo MCP Runtime",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RepoPath)) {
    $RepoPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
} else {
    $RepoPath = (Resolve-Path $RepoPath).Path
}

$supervisorPath = Join-Path $RepoPath "scripts\runtime-supervisor.mjs"
$launcherPath = Join-Path $RepoPath "scripts\start-runtime-supervisor.ps1"
$configPath = Join-Path $RepoPath "config.local.json"
$serverPath = Join-Path $RepoPath "dist\server.js"

function Get-CurrentTask {
    Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

function Show-TaskStatus {
    $task = Get-CurrentTask
    if ($null -eq $task) {
        Write-Host "Windows runtime task is not installed: $TaskName"
        return
    }
    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    Write-Host "Task: $TaskName"
    Write-Host "State: $($task.State)"
    Write-Host "Last run: $($info.LastRunTime)"
    Write-Host "Last result: $($info.LastTaskResult)"
    Write-Host "Next run: $($info.NextRunTime)"
}

if ($Action -eq "Status") {
    Show-TaskStatus
    exit 0
}

if ($Action -eq "Stop") {
    if ($null -ne (Get-CurrentTask)) {
        Stop-ScheduledTask -TaskName $TaskName
        Write-Host "Stopped $TaskName."
    } else {
        Write-Host "Task is not installed: $TaskName"
    }
    exit 0
}

if ($Action -eq "Start") {
    if ($null -eq (Get-CurrentTask)) {
        throw "Task is not installed: $TaskName"
    }
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Started $TaskName."
    exit 0
}

if ($Action -eq "Uninstall") {
    if ($null -ne (Get-CurrentTask)) {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Removed $TaskName."
    } else {
        Write-Host "Task is not installed: $TaskName"
    }
    exit 0
}

foreach ($required in @($supervisorPath, $launcherPath, $configPath, $serverPath)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Required runtime file is missing: $required"
    }
}

$nodeCommand = Get-Command node.exe -ErrorAction Stop
$nodePath = $nodeCommand.Source
$powershellPath = (Get-Command powershell.exe -ErrorAction Stop).Source
$npmCli = $env:npm_execpath
if ([string]::IsNullOrWhiteSpace($npmCli) -or -not (Test-Path -LiteralPath $npmCli -PathType Leaf)) {
    throw "npm_execpath is unavailable. Run this installer through: npm run install:windows-runtime"
}

$existingTask = Get-CurrentTask
if ($null -ne $existingTask -and -not $Force) {
    throw "The scheduled task already exists. Re-run with -Force to replace it."
}
if ($null -ne $existingTask) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$arguments = @(
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-WindowStyle", "Hidden",
    "-File", ('"{0}"' -f $launcherPath),
    "-RepoPath", ('"{0}"' -f $RepoPath),
    "-NodePath", ('"{0}"' -f $nodePath),
    "-NpmCli", ('"{0}"' -f $npmCli)
) -join " "
$taskAction = New-ScheduledTaskAction -Execute $powershellPath -Argument $arguments -WorkingDirectory $RepoPath
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -RestartCount 99 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Description "Keeps GPT Repo MCP and its ngrok tunnel running and accepts bounded restart requests." `
    -Action $taskAction `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings | Out-Null

$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$repo = $config.repos | Where-Object { $_.repo_id -eq "gpt-repo-mcp" } | Select-Object -First 1
if ($null -eq $repo) {
    throw "config.local.json does not contain repo_id gpt-repo-mcp."
}
if ($null -eq $repo.operations) {
    throw "gpt-repo-mcp does not have operations policy configured."
}
if ($null -eq $repo.operations.allowed_scripts) {
    $repo.operations | Add-Member -MemberType NoteProperty -Name allowed_scripts -Value ([pscustomobject]@{})
}

$statusScript = [pscustomobject]@{
    command = $nodePath
    args = @("scripts/runtime-control.mjs", "status")
    timeout_ms = 10000
    max_output_bytes = 32768
    inherit_env = @("GPT_REPO_RUNTIME_DIR")
}
$restartScript = [pscustomobject]@{
    command = $nodePath
    args = @("scripts/runtime-control.mjs", "restart-mcp")
    timeout_ms = 10000
    max_output_bytes = 32768
    inherit_env = @("GPT_REPO_RUNTIME_DIR")
}
$repo.operations.allowed_scripts | Add-Member -MemberType NoteProperty -Name "mcp.runtime.status" -Value $statusScript -Force
$repo.operations.allowed_scripts | Add-Member -MemberType NoteProperty -Name "mcp.runtime.restart" -Value $restartScript -Force
$configPayload = ($config | ConvertTo-Json -Depth 100) + "`n"
$utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($configPath, $configPayload, $utf8WithoutBom)

Start-ScheduledTask -TaskName $TaskName
Write-Host "Installed and started $TaskName."
Write-Host "The supervisor will keep MCP and ngrok running without an interactive console window."
Write-Host "The local config now allowlists mcp.runtime.status and mcp.runtime.restart."
Write-Host "Close the old Start GPT Repo MCP window once, then use npm run runtime:status to verify the supervised runtime."
