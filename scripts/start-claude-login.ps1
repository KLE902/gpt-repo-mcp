[CmdletBinding()]
param(
    [switch] $InteractiveChild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-ClaudeBinary {
    $Node = (Get-Command node.exe -ErrorAction Stop).Source
    $NpmCli = [string]$env:npm_execpath
    if ([string]::IsNullOrWhiteSpace($NpmCli) -or -not (Test-Path -LiteralPath $NpmCli -PathType Leaf)) {
        $NpmCli = Join-Path (Split-Path -Parent $Node) "node_modules\npm\bin\npm-cli.js"
    }
    if (-not (Test-Path -LiteralPath $NpmCli -PathType Leaf)) {
        throw "The npm CLI could not be resolved for the Claude Code login launcher."
    }

    $GlobalRoot = (& $Node $NpmCli root -g | Select-Object -First 1)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($GlobalRoot)) {
        throw "The global npm package root could not be resolved."
    }
    $GlobalRoot = $GlobalRoot.Trim()
    $Architecture = if ([string]$env:PROCESSOR_ARCHITECTURE -match "ARM64") { "arm64" } else { "x64" }
    $NativePackage = "claude-code-win32-$Architecture"
    $Candidates = @(
        (Join-Path $GlobalRoot "@anthropic-ai\$NativePackage\claude.exe"),
        (Join-Path $GlobalRoot "@anthropic-ai\claude-code\node_modules\@anthropic-ai\$NativePackage\claude.exe"),
        (Join-Path $env:USERPROFILE ".local\bin\claude.exe")
    )

    foreach ($Candidate in $Candidates) {
        if (Test-Path -LiteralPath $Candidate -PathType Leaf) {
            return $Candidate
        }
    }
    throw "No verified Claude Code native binary was found."
}

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
        $Claude = Resolve-ClaudeBinary
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

$ScriptPath = $MyInvocation.MyCommand.Path
$ChildArguments = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $ScriptPath,
    "-InteractiveChild"
)
[void](Start-Process -FilePath "powershell.exe" `
    -ArgumentList $ChildArguments `
    -WorkingDirectory $env:USERPROFILE `
    -WindowStyle Normal `
    -PassThru)

Write-Output "CLAUDE_AUTH_LOGIN_STARTED"
