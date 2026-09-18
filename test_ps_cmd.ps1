cd "D:\FILES\project\KomuniPH"
$proc = Start-Process -FilePath "node" -ArgumentList "server\index.js" -WorkingDirectory "D:\FILES\project\KomuniPH" -PassThru
Write-Output $proc.Id