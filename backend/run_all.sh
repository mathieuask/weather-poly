#!/bin/bash
# Lance le pipeline complet une fois
set -e
cd "$(dirname "$0")"

PYTHON=".venv/bin/python3"

echo "[$(date -u '+%H:%M UTC')] === Pipeline démarré ==="

echo "→ Scanner..."
$PYTHON scanner.py

echo "→ Tracker..."
$PYTHON tracker.py

echo "→ METAR..."
$PYTHON metar.py

echo "→ Calibrate..."
$PYTHON calibrate.py

echo "[$(date -u '+%H:%M UTC')] === Pipeline terminé ==="
