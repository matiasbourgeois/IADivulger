# ╔══════════════════════════════════════════════════════════════════════╗
# ║              IADivulger — System Startup Script                      ║
# ║  Starts all microservices in separate windows with health checks     ║
# ║  Usage: .\start.ps1                                                  ║
# ╚══════════════════════════════════════════════════════════════════════╝

$ROOT = $PSScriptRoot
$COMFYUI_PORT  = 8189
$AIWORKER_PORT = 8000
$TTS_PORT      = 9000
$BACKEND_PORT  = 3001
$DASHBOARD_PORT= 3000

function Write-Header { Write-Host "`n$('='*60)" -ForegroundColor Cyan }
function Write-OK  ($msg) { Write-Host "  [OK]  $msg" -ForegroundColor Green }
function Write-FAIL($msg) { Write-Host "  [!!]  $msg" -ForegroundColor Red }
function Write-INFO($msg) { Write-Host "  [..]  $msg" -ForegroundColor Yellow }

function Start-Service($name, $dir, $cmd, $port) {
    Write-INFO "Starting $name (port $port)..."
    $fullDir = Join-Path $ROOT $dir
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$fullDir'; $cmd" -WindowStyle Normal
}

function Wait-ForPort($port, $name, $maxSec=90) {
    $elapsed = 0
    $interval = 3
    while ($elapsed -lt $maxSec) {
        try {
            $conn = New-Object System.Net.Sockets.TcpClient
            $conn.Connect("127.0.0.1", $port)
            $conn.Close()
            Write-OK "$name is ready (port $port)"
            return $true
        } catch {
            Start-Sleep -Seconds $interval
            $elapsed += $interval
            Write-Host "    ...waiting for $name ($elapsed/$maxSec s)" -ForegroundColor DarkGray
        }
    }
    Write-FAIL "$name did NOT start in time (port $port)"
    return $false
}

# ── LAUNCH ORDER ─────────────────────────────────────────────────────────────

Write-Header
Write-Host "  IADivulger — Starting all services" -ForegroundColor Cyan
Write-Header

# 1. ComfyUI (takes longest to load — start first)
Start-Service "ComfyUI" "apps\comfyui" ".venv\Scripts\python.exe main.py --port $COMFYUI_PORT --listen 0.0.0.0" $COMFYUI_PORT
Start-Sleep -Seconds 2

# 2. AI Worker
Start-Service "AI Worker" "apps\ai-worker" ".venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port $AIWORKER_PORT" $AIWORKER_PORT
Start-Sleep -Seconds 2

# 3. TTS Server (Qwen3-TTS)
Start-Service "TTS Server" "apps\tts-server" ".venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port $TTS_PORT" $TTS_PORT
Start-Sleep -Seconds 2

# 4. AI Worker (FastAPI — video + audio generation)
Start-Service "AI Worker" "apps\ai-worker" ".venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port $AIWORKER_PORT" $AIWORKER_PORT
Start-Sleep -Seconds 2

# 5. Backend (Node.js)
Start-Service "Backend" "." "npx tsx apps\backend\src\server.ts" $BACKEND_PORT
Start-Sleep -Seconds 2

# 5. Dashboard (Next.js/Vite dev server)
Start-Service "Dashboard" "apps\dashboard" "npm run dev" $DASHBOARD_PORT

# ── HEALTH CHECKS ────────────────────────────────────────────────────────────

Write-Header
Write-Host "  Waiting for services to be ready..." -ForegroundColor Cyan
Write-Header

$comfy   = Wait-ForPort $COMFYUI_PORT  "ComfyUI"     120
$worker  = Wait-ForPort $AIWORKER_PORT "AI Worker"    60
$tts     = Wait-ForPort $TTS_PORT      "TTS Server"   90
$backend = Wait-ForPort $BACKEND_PORT  "Backend"      60
$dash    = Wait-ForPort $DASHBOARD_PORT "Dashboard"   60

# ── SUMMARY ──────────────────────────────────────────────────────────────────

Write-Header
Write-Host "`n  IA DIVULGER — SYSTEM STATUS`n" -ForegroundColor Cyan

$statusTable = @(
    @{ Name="ComfyUI    (port $COMFYUI_PORT)";  OK=$comfy  },
    @{ Name="AI Worker  (port $AIWORKER_PORT)"; OK=$worker },
    @{ Name="TTS Server (port $TTS_PORT)";      OK=$tts    },
    @{ Name="Backend    (port $BACKEND_PORT)";  OK=$backend},
    @{ Name="Dashboard  (port $DASHBOARD_PORT)";OK=$dash   }
)

foreach ($s in $statusTable) {
    if ($s.OK) { Write-OK $s.Name } else { Write-FAIL $s.Name }
}

Write-Host ""

if ($backend -and $dash) {
    Write-Host "  Dashboard → http://localhost:$DASHBOARD_PORT" -ForegroundColor Green
    Write-Host "  Backend   → http://localhost:$BACKEND_PORT/api/health" -ForegroundColor Green
    Write-Host "`n  Listo para generar videos!" -ForegroundColor Green
} else {
    Write-Host "  Algunos servicios fallaron. Revisa las ventanas de consola." -ForegroundColor Red
}

Write-Header
Write-Host ""
