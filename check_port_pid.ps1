param(
    [int]$PortPid
)

$process = Get-CimInstance Win32_Process -Filter "ProcessId=$PortPid"

# No such process (or already exited): not KomuniPH.
if (-not $process) {
    exit 0
}

# KomuniPH runs as: node.exe with "server/index.js" (forward slashes) or
# "server\index.js" (backslashes) on the command line. Normalize all slashes
# to backslashes before matching so both launch styles are recognized.
# A process that is merely "node.exe" does NOT qualify, and an empty or
# inaccessible command line is treated as NOT KomuniPH (safe default).
$commandLine = [string]$process.CommandLine
if (-not $commandLine) {
    exit 0
}

$normalized = $commandLine -replace '/', '\'
if ($normalized -like '*server\index.js*') {
    Write-Output $process.ProcessId
}
