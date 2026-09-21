param(
    [string]$WorkingDirectory = "D:\FILES\project\KomuniPH",
    [string]$ScriptPath = "server\index.js"
)

# Launch with an absolute script path so the running process identifies
# itself on the command line (find_komuniph.ps1 / check_port_pid.ps1
# recognize KomuniPH by its server\index.js command line).
$scriptFull = Join-Path $WorkingDirectory $ScriptPath
$proc = Start-Process -FilePath "node" -ArgumentList $scriptFull -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -PassThru
Write-Output $proc.Id
