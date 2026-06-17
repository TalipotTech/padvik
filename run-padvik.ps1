<#
.SYNOPSIS
    Padvik launcher — runs each process in the CURRENT Cursor terminal tab
    instead of spawning external PowerShell windows.

.DESCRIPTION
    Cursor's integrated terminal lets you open multiple tabs/splits. The
    recommended flow is one tab per role:

        Tab 1:  ./run-padvik.ps1 web        # Next.js dev server (foreground)
        Tab 2:  ./run-padvik.ps1 workers    # BullMQ workers     (foreground)

    Use Cursor's terminal tab title (set automatically by this script) to
    tell tabs apart, even though the global command history pools all
    terminals together.

    If you really want both in one tab, use `both` — output streams are
    merged and prefixed with [WEB] / [WRK] so you can tell them apart.

.PARAMETER Mode
    web       Next.js dev server in this tab (default if no other tab is running it).
    workers   BullMQ workers in this tab.
    both      Run web + workers in this single tab, merged output with prefixes.
    studio    Drizzle Studio (DB explorer on :4983).
    build     Production build.
    start     Production start (after build).
    stop      Kill any node/pnpm processes from the project root.
    help      Show usage.

.EXAMPLE
    ./run-padvik.ps1 web
    ./run-padvik.ps1 workers
    ./run-padvik.ps1 both
    ./run-padvik.ps1 stop

.NOTES
    If you get a script-execution error, allow local scripts for this
    session only:
        Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#>

[CmdletBinding()]
param(
    [ValidateSet('web', 'workers', 'both', 'studio', 'build', 'start', 'stop', 'help')]
    [string]$Mode = 'help'
)

$ErrorActionPreference = 'Stop'

# Resolve project root from this script's location.
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "[Padvik] pnpm not found on PATH. Install Node + pnpm first:" -ForegroundColor Red
    Write-Host "         npm install -g pnpm@9.15.0" -ForegroundColor Yellow
    exit 1
}

function Set-TabTitle {
    param([string]$Title)
    # Set both the host RawUI title and the OSC-2 escape so Cursor's tab
    # label updates in addition to the underlying console title.
    try { $Host.UI.RawUI.WindowTitle = $Title } catch { }
    $esc = [char]27
    Write-Host ("$esc]0;$Title$esc\")
}

function Write-Banner {
    param(
        [string]$Title,
        [string]$Color = 'Green'
    )
    Write-Host ''
    Write-Host '================================================================' -ForegroundColor $Color
    Write-Host "  $Title" -ForegroundColor $Color
    Write-Host "  $ProjectRoot" -ForegroundColor DarkGray
    Write-Host '================================================================' -ForegroundColor $Color
    Write-Host ''
}

function Show-Help {
    Write-Host ''
    Write-Host 'Padvik launcher — runs in the current Cursor terminal tab.' -ForegroundColor Cyan
    Write-Host ''
    Write-Host '  ./run-padvik.ps1 web        Next.js dev server (open one tab for this)'
    Write-Host '  ./run-padvik.ps1 workers    BullMQ workers     (open another tab for this)'
    Write-Host '  ./run-padvik.ps1 both       Run both in THIS tab, merged output'
    Write-Host '  ./run-padvik.ps1 studio     Drizzle Studio at http://localhost:4983'
    Write-Host '  ./run-padvik.ps1 build      Production build'
    Write-Host '  ./run-padvik.ps1 start      Production start (after build)'
    Write-Host '  ./run-padvik.ps1 stop       Kill all node/pnpm processes (use sparingly)'
    Write-Host ''
    Write-Host 'Recommended: open two Cursor terminal tabs (Ctrl+Shift+`) and run' -ForegroundColor DarkGray
    Write-Host '             web in one and workers in the other.' -ForegroundColor DarkGray
    Write-Host ''
}

function Start-Both {
    # Run pnpm workers as a background process whose stdout/stderr we pipe
    # back into THIS terminal with a [WRK] prefix. pnpm dev runs in the
    # foreground with a [WEB] prefix. Ctrl+C stops both.

    Set-TabTitle 'PADVIK - WEB + WORKERS'
    Write-Banner 'PADVIK • WEB + WORKERS (merged output)' 'Cyan'
    Write-Host '[Padvik] [WEB] = Next.js dev   [WRK] = BullMQ workers' -ForegroundColor DarkGray
    Write-Host '[Padvik] Press Ctrl+C to stop both.' -ForegroundColor DarkGray
    Write-Host ''

    $workersInfo = New-Object System.Diagnostics.ProcessStartInfo
    $workersInfo.FileName = 'pnpm.cmd'
    $workersInfo.Arguments = 'workers'
    $workersInfo.WorkingDirectory = $ProjectRoot
    $workersInfo.RedirectStandardOutput = $true
    $workersInfo.RedirectStandardError = $true
    $workersInfo.UseShellExecute = $false
    $workersInfo.CreateNoWindow = $true

    $workers = [System.Diagnostics.Process]::Start($workersInfo)

    $outHandler = {
        if ($EventArgs.Data) {
            Write-Host "[WRK] $($EventArgs.Data)" -ForegroundColor Magenta
        }
    }
    $errHandler = {
        if ($EventArgs.Data) {
            Write-Host "[WRK] $($EventArgs.Data)" -ForegroundColor Red
        }
    }
    Register-ObjectEvent -InputObject $workers -EventName 'OutputDataReceived' -Action $outHandler | Out-Null
    Register-ObjectEvent -InputObject $workers -EventName 'ErrorDataReceived'  -Action $errHandler | Out-Null
    $workers.BeginOutputReadLine()
    $workers.BeginErrorReadLine()

    try {
        # Foreground: pnpm dev. We pipe its output through ForEach-Object so
        # we can prefix each line. This blocks until pnpm dev exits or Ctrl+C.
        & pnpm.cmd dev 2>&1 | ForEach-Object {
            Write-Host "[WEB] $_" -ForegroundColor Green
        }
    } finally {
        Write-Host ''
        Write-Host '[Padvik] Stopping workers...' -ForegroundColor Yellow
        if ($workers -and -not $workers.HasExited) {
            try { $workers.Kill($true) } catch { try { $workers.Kill() } catch { } }
        }
        Get-EventSubscriber | Where-Object { $_.SourceObject -eq $workers } |
            ForEach-Object { Unregister-Event -SubscriptionId $_.SubscriptionId -ErrorAction SilentlyContinue }
        Write-Host '[Padvik] Done.' -ForegroundColor DarkGray
    }
}

function Stop-AllPadvik {
    Write-Host '[Padvik] Killing node and pnpm processes for this project...' -ForegroundColor Cyan

    $killed = 0
    $candidates = Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='pnpm.exe' OR Name='pnpm.cmd'" -ErrorAction SilentlyContinue

    foreach ($p in $candidates) {
        $cmd = $p.CommandLine
        if (-not $cmd) { continue }
        # Match processes whose command line references this project root, or
        # the workers / next-dev entry points.
        $rootMatch = $cmd -like "*$ProjectRoot*"
        $entryMatch = ($cmd -match 'start-workers\.ts') -or ($cmd -match 'next(\.js)?\s+dev') -or ($cmd -match 'pnpm.*(dev|workers|start)')
        if ($rootMatch -or $entryMatch) {
            try {
                Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
                Write-Host "  killed PID $($p.ProcessId)  ($($p.Name))" -ForegroundColor Yellow
                $killed++
            } catch {
                Write-Host "  failed to kill PID $($p.ProcessId): $_" -ForegroundColor Red
            }
        }
    }

    if ($killed -eq 0) {
        Write-Host '[Padvik] Nothing to stop.' -ForegroundColor DarkGray
    } else {
        Write-Host "[Padvik] Stopped $killed process(es)." -ForegroundColor Green
    }
}

switch ($Mode) {
    'web' {
        Set-TabTitle 'PADVIK - WEB (Next.js :3000)'
        Write-Banner 'PADVIK • WEB (Next.js :3000)' 'Green'
        & pnpm dev
    }

    'workers' {
        Set-TabTitle 'PADVIK - WORKERS (BullMQ)'
        Write-Banner 'PADVIK • WORKERS (BullMQ)' 'Magenta'
        & pnpm workers
    }

    'both' {
        Start-Both
    }

    'studio' {
        Set-TabTitle 'PADVIK - DRIZZLE STUDIO (:4983)'
        Write-Banner 'PADVIK • DRIZZLE STUDIO (:4983)' 'Yellow'
        & pnpm db:studio
    }

    'build' {
        Set-TabTitle 'PADVIK - BUILD'
        Write-Banner 'PADVIK • BUILD' 'Cyan'
        & pnpm build
    }

    'start' {
        Set-TabTitle 'PADVIK - PROD (next start :3000)'
        Write-Banner 'PADVIK • PROD (next start :3000)' 'Blue'
        & pnpm start
    }

    'stop' {
        Stop-AllPadvik
    }

    default {
        Show-Help
    }
}
