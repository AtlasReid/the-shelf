param(
    [ValidateRange(1024,65535)][int]$Port = 4318,
    [ValidateRange(1024,65535)][int]$HttpsPort = 8443
)
$ErrorActionPreference = 'Stop'
$shelfRepo = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$shelfServerFile = Join-Path $shelfRepo 'server.mjs'
$shelfLocalState = Join-Path $shelfRepo '.preview'
$shelfTailscale = Join-Path $env:ProgramFiles 'Tailscale/tailscale.exe'
if (!(Test-Path -LiteralPath $shelfTailscale)) { throw 'Tailscale is not installed. Install and connect it before starting this preview.' }
$shelfNode = (Get-Command node -ErrorAction Stop).Source

# Read before changing anything: port 443 and any unrelated Serve routes stay intact.
$shelfConfigText = & $shelfTailscale serve status --json
if ($LASTEXITCODE -ne 0) { throw 'Cannot read Tailscale Serve. Run this script in an Administrator PowerShell.' }
$shelfConfig = $shelfConfigText | ConvertFrom-Json
$shelfStatusText = & $shelfTailscale status --json
if ($LASTEXITCODE -ne 0) { throw 'Cannot read Tailscale status.' }
$shelfStatus = $shelfStatusText | ConvertFrom-Json
if ($shelfStatus.BackendState -ne 'Running' -or !$shelfStatus.Self.Online) { throw 'Connect this computer to Tailscale first.' }
$shelfDns = $shelfStatus.Self.DNSName.TrimEnd('.')
if (!$shelfDns) { throw 'The connected Tailscale device has no HTTPS/MagicDNS name.' }
$shelfWebKey = '{0}:{1}' -f $shelfDns,$HttpsPort
$shelfTarget = 'http://127.0.0.1:{0}' -f $Port
$shelfLocalUrl = '{0}/the-shelf/' -f $shelfTarget
$shelfPreviewUrl = 'https://{0}:{1}/the-shelf/' -f $shelfDns,$HttpsPort
$shelfExisting = $shelfConfig.Web.PSObject.Properties | Where-Object Name -eq $shelfWebKey
$shelfPortExisting = $shelfConfig.TCP.PSObject.Properties | Where-Object Name -eq ([string]$HttpsPort)
$shelfFunnel = $shelfConfig.AllowFunnel.PSObject.Properties | Where-Object { $_.Name -eq $shelfWebKey -and $_.Value -eq $true }
if ($shelfFunnel) { throw 'This HTTPS port has public Funnel access. Choose a different unused HTTPS port for the private preview.' }
if ($shelfPortExisting -and (!$shelfExisting -or !$shelfPortExisting.Value.HTTPS)) { throw 'This Tailscale port is already used by another service. Choose an unused HTTPS port.' }
if ($shelfExisting) {
    $shelfHandlers = @($shelfExisting.Value.Handlers.PSObject.Properties)
    if ($shelfHandlers.Count -ne 1 -or $shelfHandlers[0].Name -ne '/' -or $shelfHandlers[0].Value.Proxy -ne $shelfTarget) {
        throw 'This HTTPS port already serves something else. Its configuration has been left intact.'
    }
}

New-Item -ItemType Directory -Path $shelfLocalState -Force | Out-Null
$shelfBackup = Join-Path $shelfLocalState ('serve-before-{0}.json' -f $HttpsPort)
if (!(Test-Path -LiteralPath $shelfBackup)) { $shelfConfigText | Set-Content -LiteralPath $shelfBackup -Encoding utf8 }
$shelfProcess = $null
$shelfStarted = $false
$shelfReady = $false
try {
    $shelfProbe = Invoke-WebRequest -Uri $shelfLocalUrl -UseBasicParsing -TimeoutSec 3
    if ($shelfProbe.Headers['X-Shelf-Preview'] -ne 'runtime-only') { throw 'The local port is serving a different preview.' }
    $shelfReady = $true
} catch { $shelfReady = $false }

if (!$shelfReady) {
    $shelfOldPort = $env:PORT
    $shelfOldBase = $env:BASE_PATH
    $shelfOldMode = $env:RUNTIME_ONLY
    try {
        $env:PORT = [string]$Port
        $env:BASE_PATH = '/the-shelf/'
        $env:RUNTIME_ONLY = '1'
        $shelfProcess = Start-Process -FilePath $shelfNode -ArgumentList ('"{0}"' -f $shelfServerFile) -WorkingDirectory $shelfRepo -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $shelfLocalState 'server.stdout.log') -RedirectStandardError (Join-Path $shelfLocalState 'server.stderr.log')
        $shelfStarted = $true
    } finally {
        $env:PORT = $shelfOldPort
        $env:BASE_PATH = $shelfOldBase
        $env:RUNTIME_ONLY = $shelfOldMode
    }
    for ($shelfAttempt = 0; $shelfAttempt -lt 20; $shelfAttempt++) {
        if ($shelfProcess.HasExited) { break }
        try {
            $shelfProbe = Invoke-WebRequest -Uri $shelfLocalUrl -UseBasicParsing -TimeoutSec 2
            if ($shelfProbe.Headers['X-Shelf-Preview'] -eq 'runtime-only') { $shelfReady = $true; break }
        } catch { }
        Start-Sleep -Milliseconds 200
    }
    if (!$shelfReady) {
        if (!$shelfProcess.HasExited) { Stop-Process -Id $shelfProcess.Id }
        throw 'The runtime-only server could not start. The local port may be occupied; inspect .preview/server.stderr.log or choose another -Port.'
    }
}

& $shelfTailscale serve --bg "--https=$HttpsPort" --yes $shelfTarget
if ($LASTEXITCODE -ne 0) {
    if ($shelfStarted -and !$shelfProcess.HasExited) { Stop-Process -Id $shelfProcess.Id }
    throw 'Tailscale could not enable the private preview. No other Serve route was reset.'
}
$shelfAfterText = & $shelfTailscale serve status --json
if ($LASTEXITCODE -ne 0) { throw 'Preview configured, but Tailscale status verification failed.' }
$shelfAfter = $shelfAfterText | ConvertFrom-Json
$shelfAfterWeb = ($shelfAfter.Web.PSObject.Properties | Where-Object Name -eq $shelfWebKey).Value
if ($shelfAfterWeb.Handlers.'/'.Proxy -ne $shelfTarget) { throw 'The resulting preview route did not match its local target.' }
if ($shelfAfter.AllowFunnel.PSObject.Properties | Where-Object { $_.Name -eq $shelfWebKey -and $_.Value -eq $true }) { throw 'Unexpected public Funnel configuration. Inspect Serve before using this preview.' }
$shelfStateFile = Join-Path $shelfLocalState 'private-preview.json'
$shelfProcessId = if ($shelfStarted) { $shelfProcess.Id } elseif (Test-Path -LiteralPath $shelfStateFile) { (Get-Content -LiteralPath $shelfStateFile -Raw | ConvertFrom-Json).processId } else { $null }
@{url=$shelfPreviewUrl;localUrl=$shelfLocalUrl;port=$Port;httpsPort=$HttpsPort;processId=$shelfProcessId;serverFile=$shelfServerFile} | ConvertTo-Json | Set-Content -LiteralPath $shelfStateFile -Encoding utf8
Write-Output "Private phone preview: $shelfPreviewUrl"
Write-Output "Desktop preview: $shelfLocalUrl"
Write-Output 'Keep this computer awake and both devices connected to the same Tailscale network.'
Write-Output 'Only website runtime files are shared. No GitHub push or public Funnel was used.'
