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
