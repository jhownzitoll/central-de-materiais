param()
$ErrorActionPreference="Stop"
$root=Split-Path -Parent $MyInvocation.MyCommand.Path
$private=Join-Path $root "nexus_autopilot_private.env"
$envFile=Join-Path $root ".env"
if(!(Test-Path $envFile)){
 if(!(Test-Path $private)){throw "Arquivo privado ausente. Copie nexus_autopilot_private.env para esta pasta, ao lado do instalador."}
 Copy-Item -LiteralPath $private -Destination $envFile
}
if(!(Get-Command node -ErrorAction SilentlyContinue)){throw "Instale Node.js LTS no PC antes de executar. https://nodejs.org/"}
if(!(Get-Command npm -ErrorAction SilentlyContinue)){throw "npm nao encontrado (instale Node.js LTS)."}
Set-Location $root
& npm install --no-audit --no-fund
if($LASTEXITCODE -ne 0){throw "npm install falhou. Nao foi configurado o autostart."}
& npx playwright install chromium
if($LASTEXITCODE -ne 0){throw "Playwright Chromium nao instalado."}
$run=Join-Path $root "supervise-windows.ps1"
$startup=[Environment]::GetFolderPath("Startup")
$shortcut=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $startup "iBuild Nexus Autopilot.lnk"))
$shortcut.TargetPath=(Get-Command powershell.exe).Source
$shortcut.Arguments='-NoProfile -ExecutionPolicy Bypass -File "'+$run+'"'
$shortcut.WorkingDirectory=$root
$shortcut.WindowStyle=7
$shortcut.Description="Reinicia somente o Nexus Autopilot da iBuild depois de login no Windows"
$shortcut.Save()
Write-Host "Instalado. O Chromium da iBuild sera iniciado e pedira login no ChatGPT normal uma unica vez."
Write-Host "O supervisor do Windows reinicia o processo se ele terminar; funcao depende do PC ligado e sessao Windows iniciada."
Start-Process -FilePath (Get-Command powershell.exe).Source -ArgumentList @("-NoProfile","-ExecutionPolicy","Bypass","-File",$run) -WorkingDirectory $root
