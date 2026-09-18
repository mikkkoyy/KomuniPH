param(
    [int]$PortPid
)

$process = Get-CimInstance Win32_Process -Filter "ProcessId=$PortPid"
if ($process -and $process.CommandLine -like '*server\index.js*') {
    Write-Output $process.ProcessId
}