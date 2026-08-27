#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Triggers a SonarQube scan of this repo against the shared SonarQube
    container (project key "bhattumang7-github-io") every time it is run.

.DESCRIPTION
    Runs the dockerized sonar-scanner-cli against the SonarQube instance
    reachable on the "sonarqube_net" Docker network, under the container
    alias "sonarqube" (the same shared instance used by other projects on
    this host). Generates a fresh one-time user token for the scan, then
    submits the analysis and returns immediately -- it does not wait for
    the server to finish processing the report. Check progress at
    http://localhost:9010/dashboard?id=bhattumang7-github-io.

.PARAMETER Password
    SonarQube admin password. Defaults to a hardcoded value below -- this
    script is gitignored (never committed to the repo) precisely so that's
    safe to do. Override with -Password if the admin password changes.
#>

param(
    [string]$Password = 'SonarPassword@1'
)

$ErrorActionPreference = 'Stop'

$repoRoot = $PSScriptRoot
$hostUrl = 'http://localhost:9010'
$networkAlias = 'http://sonarqube:9000'
$network = 'sonarqube_net'
$projectKey = 'bhattumang7-github-io'

$tokenName = "$projectKey-scan-$([DateTimeOffset]::Now.ToUnixTimeSeconds())"
$credentials = [System.Convert]::ToBase64String([System.Text.Encoding]::ASCII.GetBytes("admin:$Password"))
$tokenResponse = Invoke-RestMethod -Method Post `
    -Uri "$hostUrl/api/user_tokens/generate" `
    -Headers @{ Authorization = "Basic $credentials" } `
    -Body @{ name = $tokenName }

if (-not $tokenResponse.token) {
    throw "Failed to generate a SonarQube token. Response: $($tokenResponse | ConvertTo-Json -Compress)"
}

Push-Location $repoRoot
try {
    docker run --rm --network $network `
        -v "${repoRoot}:/usr/src" `
        -e "SONAR_HOST_URL=$networkAlias" `
        -e "SONAR_TOKEN=$($tokenResponse.token)" `
        sonarsource/sonar-scanner-cli

    if ($LASTEXITCODE -ne 0) {
        throw "sonar-scanner-cli exited with code $LASTEXITCODE"
    }

    Write-Host "Scan submitted. Track processing at $hostUrl/dashboard?id=$projectKey"
}
finally {
    Pop-Location
}
