param()
$ErrorActionPreference = 'Continue'
$root=Split-Path -Parent $MyInvocation.MyCommand.Path
$watch=Join-Path $root "watch.mjs"
$log=Join-Path $root "nexus-autopilot.log"
$guard=[System.Threading.Mutex]::new($false,'Local\IBuildNexusAutopilotV1')
$owner=$false
try {
 $owner=$guard.WaitOne(0)
 if(-not $owner){ Write-Host "Autopilot ja em execucao. Saindo."; exit 0 }
 Set-Location $root
 while($true){
   try {
     $now=Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
     Add-Content -Path $log -Value "$now iniciando processo Nexus Autopilot"
     & node $watch *>> $log
     Add-Content -Path $log -Value "Runner encerrado, reiniciando apos 15 segundos"
   } catch {
     Add-Content -Path $log -Value "Runner terminou com falha (sem repetir prompts); reinicio do processo em 15 segundos."
   }
   Start-Sleep -Seconds 15
 }
} finally {
 if($owner){ $guard.ReleaseMutex() }
 $guard.Dispose()
}
