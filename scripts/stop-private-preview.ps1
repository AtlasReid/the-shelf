param([switch]$KeepServer)
$ErrorActionPreference = 'Stop'
$shelfRepo = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$shelfStateFile = Join-Path $shelfRepo '.preview/private-preview.json'
if (!(Test-Path -LiteralPath $shelfStateFile)) { throw 'No saved private-preview state was found in this checkout.' }
$shelfState = Get-Content -LiteralPath $shelfStateFile -Raw | ConvertFrom-Json
$shelfTailscale = Join-Path $env:ProgramFiles 'Tailscale/tailscale.exe'
$shelfConfigText = & $shelfTailscale serve status --json
if ($LASTEXITCODE -ne 0) { throw 'Cannot read Tailscale Serve. Run this script in an Administrator PowerShell.' }
$shelfConfig = $shelfConfigText | ConvertFrom-Json
$shelfUrl = [uri]$shelfState.url
$shelfWebKey = '{0}:{1}' -f $shelfUrl.Host,$shelfUrl.Port
$shelfRoute = $shelfConfig.Web.PSObject.Properties | Where-Object Name -eq $shelfWebKey
$shelfTarget = 'http://127.0.0.1:{0}' -f $shelfState.port
if ($shelfRoute) {
    $shelfHandlers = @($shelfRoute.Value.Handlers.PSObject.Properties)
    if ($shelfHandlers.Count -ne 1 -or $shelfHandlers[0].Name -ne '/' -or $shelfHandlers[0].Value.Proxy -ne $shelfTarget) {
        throw 'This route has changed since preview setup. It has been left intact.'
    }
    & $shelfTailscale serve "--https=$($shelfState.httpsPort)" off
    if ($LASTEXITCODE -ne 0) { throw 'Could not stop the private preview route.' }
}
if (!$KeepServer -and $shelfState.processId) {
    $shelfProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($shelfState.processId)" -ErrorAction SilentlyContinue
    $shelfExpectedServer = Join-Path $shelfRepo 'server.mjs'
    if ($shelfProcess -and $shelfProcess.Name -eq 'node.exe' -and $shelfProcess.CommandLine.IndexOf($shelfExpectedServer,[StringComparison]::OrdinalIgnoreCase) -ge 0) {
        Stop-Process -Id $shelfState.processId
    }
}
Write-Output 'The shelf private preview is stopped. Other Tailscale routes are unchanged.'
