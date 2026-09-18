param(
    [string]$WorkingDirectory = "D:\FILES\project\KomuniPH",
    [string]$ScriptPath = "server\index.js"
)

$proc = Start-Process -FilePath "node" -ArgumentList $ScriptPath -WorkingDirectory $WorkingDirectory -PassThru
Write-Output $proc.Id