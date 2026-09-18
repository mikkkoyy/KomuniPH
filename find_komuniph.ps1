$processes = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*server\index.js*' }
foreach ($proc in $processes) {
    Write-Output $proc.ProcessId
}