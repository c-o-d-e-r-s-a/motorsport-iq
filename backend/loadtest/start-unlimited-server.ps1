# Starts a load-test backend with fallback caps effectively disabled.
# Uses port 4001 so your normal dev server on 4000 is untouched.
$env:PORT = '4001'
$env:MAX_ACTIVE_LOBBIES = '1000000'
$env:MAX_PLAYERS_PER_LOBBY = '100000'
$env:SIMULATION_ENABLED = 'true'
$env:SIMULATION_SPEED = '10'
Set-Location $PSScriptRoot\..
Write-Host "Load-test server on http://localhost:4001 (unlimited caps)"
npm run dev
