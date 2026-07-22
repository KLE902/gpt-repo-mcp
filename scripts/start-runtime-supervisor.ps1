[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$RepoPath,
    [Parameter(Mandatory = $true)]
    [string]$NodePath,
    [Parameter(Mandatory = $true)]
    [string]$NpmCli
)

$ErrorActionPreference = "Stop"

$RepoPath = (Resolve-Path $RepoPath).Path
$supervisorPath = Join-Path $RepoPath "scripts\runtime-supervisor.mjs"

foreach ($required in @($NodePath, $NpmCli, $supervisorPath)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Required supervised runtime file is missing: $required"
    }
}

$arguments = @(
    $supervisorPath,
    "--repo", $RepoPath,
    "--npm-cli", $NpmCli
)

& $NodePath @arguments
if ($null -eq $LASTEXITCODE) {
    exit 1
}
exit $LASTEXITCODE
