[CmdletBinding()]
param(
    [string]$RepoPath,
    [switch]$Force
)

if ([string]::IsNullOrWhiteSpace($RepoPath)) {
    $RepoPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath (Join-Path $RepoPath "package.json") -PathType Leaf)) {
    throw "The resolved repository path does not contain package.json: $RepoPath"
}

if ($RepoPath.Contains("%") -or $RepoPath.Contains("`r") -or $RepoPath.Contains("`n")) {
    throw "The repository path contains characters that cannot be represented safely in the generated command file."
}

$desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
if ([string]::IsNullOrWhiteSpace($desktop)) {
    throw "Windows did not return a Desktop directory for the current user."
}

$launcherPath = Join-Path $desktop "Start GPT Repo MCP.cmd"
if ((Test-Path -LiteralPath $launcherPath) -and -not $Force) {
    throw "The desktop launcher already exists: $launcherPath`nRun npm run install:desktop-launcher -- -Force to replace it."
}

$template = @'
@echo off
setlocal
title GPT Repo MCP
cd /d "__REPO_PATH__" || (
  echo Could not open the GPT Repo MCP repository.
  echo Expected path: __REPO_PATH__
  pause
  exit /b 1
)
call npm.cmd run connect
set "GPT_REPO_EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%GPT_REPO_EXIT_CODE%"=="0" echo GPT Repo MCP stopped with exit code %GPT_REPO_EXIT_CODE%.
pause
exit /b %GPT_REPO_EXIT_CODE%
'@

$launcher = $template.Replace("__REPO_PATH__", $RepoPath)
$utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($launcherPath, $launcher, $utf8WithoutBom)

Write-Host "Created desktop launcher: $launcherPath"
Write-Host "Double-click it after Windows starts. Keep the window open while ChatGPT uses the connector."
