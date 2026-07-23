[CmdletBinding()]
param(
    [switch] $InteractiveChild,
    [string] $ClaudePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Set-ClaudeWindowsShell {
    $Current = [string]$env:CLAUDE_CODE_GIT_BASH_PATH
    if (-not [string]::IsNullOrWhiteSpace($Current)) {
        $Current = $Current.Trim().Trim('"')
    }
    $Candidates = @(
        $Current,
        "C:\Program Files\Git\bin\bash.exe",
        "C:\Program Files\Git\usr\bin\bash.exe",
        "C:\Program Files (x86)\Git\bin\bash.exe"
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

    foreach ($Candidate in $Candidates) {
        if (Test-Path -LiteralPath $Candidate -PathType Leaf) {
            $env:CLAUDE_CODE_GIT_BASH_PATH = $Candidate
            return
        }
    }
    throw "Claude Code login requires a verified Git Bash installation on this Windows host."
}

if ($InteractiveChild) {
    try {
        if ([string]::IsNullOrWhiteSpace($ClaudePath) -or -not (Test-Path -LiteralPath $ClaudePath -PathType Leaf)) {
            throw "The verified Claude Code binary path was not supplied to the login window."
        }
        $Claude = (Resolve-Path -LiteralPath $ClaudePath).Path
        if ([System.IO.Path]::GetFileName($Claude) -ne "claude.exe") {
            throw "The supplied Claude Code binary is not the expected native executable."
        }
        Set-ClaudeWindowsShell
        Write-Host "Complete the Claude Code sign-in in this window and the browser it opens."
        Write-Host "No command or token needs to be copied back to ChatGPT."
        & $Claude auth login
        if ($LASTEXITCODE -ne 0) {
            throw "Claude Code login exited with code $LASTEXITCODE."
        }
        & $Claude auth status --text | Out-Host
        if ($LASTEXITCODE -ne 0) {
            throw "Claude Code did not report an authenticated session after login."
        }
        Write-Host "Claude Code authentication verified."
        Start-Sleep -Seconds 2
        exit 0
    } catch {
        Write-Host "Claude Code authentication was not completed: $($_.Exception.Message)"
        [void](Read-Host "Press Enter to close this window")
        exit 1
    }
}

$Node = (Get-Command node.exe -ErrorAction Stop).Source
$Launcher = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "start-claude-login.mjs"
if (-not (Test-Path -LiteralPath $Launcher -PathType Leaf)) {
    throw "The Claude Code login launcher could not be resolved."
}

$ResolvedClaude = (& $Node $Launcher | Select-Object -Last 1)
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($ResolvedClaude)) {
    throw "The verified Claude Code binary could not be resolved."
}
$ResolvedClaude = $ResolvedClaude.Trim()
if (-not (Test-Path -LiteralPath $ResolvedClaude -PathType Leaf)) {
    throw "The resolved Claude Code binary does not exist."
}

$ScriptPath = $MyInvocation.MyCommand.Path
$ChildArguments = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", ('"{0}"' -f $ScriptPath),
    "-InteractiveChild",
    "-ClaudePath", ('"{0}"' -f $ResolvedClaude)
)
Start-Process -FilePath "powershell.exe" -ArgumentList $ChildArguments -WindowStyle Normal
Write-Output "CLAUDE_AUTH_LOGIN_STARTED"
exit 0
