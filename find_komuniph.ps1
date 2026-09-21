# Find running KomuniPH server processes.
# KomuniPH runs as: node.exe with "server/index.js" (forward slashes)
# or "server\index.js" (backslashes) on the command line. Normalize all
# slashes to backslashes before matching so both launch styles are
# recognized. A node.exe process without server/index.js is NOT KomuniPH.
$processes = Get-CimInstance Win32_Process -Filter "Name='node.exe'"
foreach ($proc in $processes) {
    $commandLine = [string]$proc.CommandLine
    if (-not $commandLine) {
        continue
    }
    $normalized = $commandLine -replace '/', '\'
    if ($normalized -like '*server\index.js*') {
        Write-Output $proc.ProcessId
    }
}
