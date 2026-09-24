$ErrorActionPreference = "Stop"

$repositoryZip = "https://github.com/matiasSerantes/AyudanteGitGlpimat/archive/refs/heads/main.zip"
$targetDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$workDirectory = Join-Path $env:TEMP ("AyudanteGitGlpimat_update_" + [guid]::NewGuid().ToString("N"))
$zipPath = Join-Path $workDirectory "extension.zip"
$extractDirectory = Join-Path $workDirectory "extract"

try {
    New-Item -ItemType Directory -Path $workDirectory -Force | Out-Null
    Invoke-WebRequest -UseBasicParsing -Uri $repositoryZip -OutFile $zipPath
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDirectory -Force

    $sourceDirectory = Join-Path $extractDirectory "AyudanteGitGlpimat-main"
    $manifestPath = Join-Path $sourceDirectory "manifest.json"
    if (-not (Test-Path -LiteralPath $manifestPath)) {
        throw "La descarga no contiene manifest.json."
    }

    Get-ChildItem -LiteralPath $sourceDirectory -Force |
        Where-Object { $_.Name -ne ".git" } |
        Copy-Item -Destination $targetDirectory -Recurse -Force
}
catch {
    Write-Host ("Error: " + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
finally {
    if (Test-Path -LiteralPath $workDirectory) {
        Remove-Item -LiteralPath $workDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
}

exit 0
