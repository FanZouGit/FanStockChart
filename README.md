# Stock Chart Pro

Full-stack stock chart application with candlestick charts, technical indicators, pattern detection, alerts, and multi-symbol comparison.

## Features

- **Candlestick chart** with EMA, Bollinger Bands, Volume, RSI, MACD
- **Pattern detection** — Doji, Hammer, Engulfing, Morning/Evening Star, MACD crossovers, volume spikes, RSI signals
- **Alerts** — price, RSI, MACD crossover, volume spike triggers
- **Multi-symbol compare** — normalized % return chart for up to 8 symbols
- **Watchlist** — one-click symbol switching
- **Live data** — Yahoo Finance via yfinance (free, no API key needed)

## Project Structure

```
stock-chart-app/
├── backend/
│   ├── main.py            # FastAPI server
│   └── requirements.txt
└── frontend/
    ├── src/
│   │   ├── App.jsx        # Main React app
│   │   └── main.jsx       # Entry point
    ├── index.html
    ├── package.json
    └── vite.config.js
```

## Quick Start

### 1. Backend (Python)

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Start server
uvicorn main:app --reload --port 8000
```

Backend runs at: http://localhost:8000
API docs at: http://localhost:8000/docs

### 2. Frontend (React)

```bash
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

Frontend runs at: http://localhost:5173

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /candles?symbol=AAPL&range=3mo` | OHLCV candle data |
| `GET /indicators?symbol=AAPL&range=3mo` | EMA, MACD, RSI, Bollinger Bands |
| `GET /patterns?symbol=AAPL&range=3mo` | Pattern detection results |
| `GET /compare?symbols=AAPL,MSFT,NVDA&range=1y` | Multi-symbol comparison |
| `GET /quote?symbol=AAPL` | Latest quote + fundamentals |
| `GET /health` | Health check |

## Supported Ranges

`5d` · `1mo` · `3mo` · `6mo` · `1y` · `2y`

## Build for Production

```bash
# Build React frontend
cd frontend
npm run build
# Output in frontend/dist/

# Serve static files from FastAPI
# Add to main.py:
# from fastapi.staticfiles import StaticFiles
# app.mount("/", StaticFiles(directory="../frontend/dist", html=True))
```

## Tech Stack

- **Frontend**: React 18 + Vite + Chart.js (react-chartjs-2)
- **Backend**: FastAPI + yfinance + pandas + numpy
- **Data**: Yahoo Finance (free, no API key required)

## Merge Readiness Checklist (Strict)

### 1) Risk Assessment
- [ ] Change scope is isolated to `frontend/src/App.jsx` (no backend/API contract changes)
- [ ] No new global mutable state or side effects introduced
- [ ] Edge cases validated: empty candles, single candle, resize/re-render cycles, rapid mouse move events
- [ ] Dependency impact reviewed; lockfile changes match `frontend/package.json`

### 2) Test Coverage & Verification
- [ ] Frontend install/build pass (`npm ci` or `npm install`, then `npm run build`)
- [ ] Manual smoke checks:
  - [ ] Fresh load has no `ReferenceError` in browser console
  - [ ] Candlestick chart renders on first load
  - [ ] Hover shows correct candle data
  - [ ] Indicator toggles (EMA/BB/patterns) still render correctly
- [ ] Regression check: no console errors during symbol/timeframe changes
- [ ] Reproducible scenario documented in PR notes with expected result

### 3) Release Impact
- [ ] Classify release as low-risk patch (frontend-only bugfix)
- [ ] No migration, config, or rollout coordination required
- [ ] Release notes/changelog include: “Fix initial-load canvas crash”
- [ ] Rollback plan defined: revert PR if chart render/hover regressions appear
- [ ] Post-merge monitoring assigned for frontend render/canvas exceptions

### 4) Merge Gates
- [ ] At least 1 reviewer approval
- [ ] Required CI checks green (or explicitly documented if none configured)
- [ ] No unresolved review comments
- [ ] PR description includes command output and manual verification evidence

### Reproducible Verification Scenario (Example)
1. Start backend and frontend locally.
2. Open the chart tab on first load.
3. Confirm no `ReferenceError` in browser console.
4. Move mouse over candles and confirm OHLC header updates.
5. Toggle EMA/BB/Patterns and switch symbols/timeframes.
6. Expected: chart remains stable, no console errors, interactions work normally.
