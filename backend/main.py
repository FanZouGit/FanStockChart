"""
Stock Chart Pro — Python backend
Run: uvicorn main:app --reload --port 8000
"""

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import yfinance as yf
import pandas as pd
import numpy as np
from datetime import datetime, date, timedelta
from pathlib import Path
import json
import uuid

app = FastAPI(title="Stock Chart Pro API", version="1.0.0")

# ── Portfolio persistence ─────────────────────────────────────────────────────

PORTFOLIO_FILE = Path(__file__).parent / "portfolio.json"

def _load_orders() -> list:
    if not PORTFOLIO_FILE.exists():
        return []
    return json.loads(PORTFOLIO_FILE.read_text())

def _save_orders(orders: list):
    PORTFOLIO_FILE.write_text(json.dumps(orders, indent=2))

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Indicator helpers ────────────────────────────────────────────────────────

def calc_ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()


def calc_macd(series: pd.Series, fast=12, slow=26, signal=9):
    ema_fast = calc_ema(series, fast)
    ema_slow = calc_ema(series, slow)
    macd_line = ema_fast - ema_slow
    signal_line = calc_ema(macd_line, signal)
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def calc_rsi(series: pd.Series, period=14) -> pd.Series:
    delta = series.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = -delta.where(delta < 0, 0.0)
    avg_gain = gain.ewm(com=period - 1, adjust=False).mean()
    avg_loss = loss.ewm(com=period - 1, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def calc_bollinger(series: pd.Series, period=20, std_mult=2):
    mid = series.rolling(period).mean()
    std = series.rolling(period).std()
    upper = mid + std_mult * std
    lower = mid - std_mult * std
    return upper, mid, lower


def detect_patterns(df: pd.DataFrame) -> list:
    patterns = []
    if len(df) < 5:
        return patterns

    last = df.iloc[-1]
    prev = df.iloc[-2]
    p2 = df.iloc[-3]

    body = lambda r: abs(r["Close"] - r["Open"])
    rng = lambda r: r["High"] - r["Low"]
    is_bull = lambda r: r["Close"] > r["Open"]
    is_bear = lambda r: r["Close"] < r["Open"]
    lo_shadow = lambda r: min(r["Open"], r["Close"]) - r["Low"]
    hi_shadow = lambda r: r["High"] - max(r["Open"], r["Close"])

    # Single candle
    if body(last) < rng(last) * 0.1:
        patterns.append({"name": "Doji", "type": "neut", "desc": "Indecision — reversal possible"})
    if is_bull(last) and body(last) > rng(last) * 0.8 and body(last) > body(prev) * 2:
        patterns.append({"name": "Bullish Marubozu", "type": "bull", "desc": "Strong buying pressure"})
    if is_bear(last) and body(last) > rng(last) * 0.8 and body(last) > body(prev) * 2:
        patterns.append({"name": "Bearish Marubozu", "type": "bear", "desc": "Strong selling pressure"})
    if lo_shadow(last) > body(last) * 2 and hi_shadow(last) < body(last) * 0.5:
        patterns.append({"name": "Hammer", "type": "bull", "desc": "Bullish reversal signal"})
    if hi_shadow(last) > body(last) * 2 and lo_shadow(last) < body(last) * 0.5:
        patterns.append({"name": "Shooting Star", "type": "bear", "desc": "Bearish reversal signal"})

    # Two candle
    if is_bull(prev) and is_bear(last) and last["Open"] > prev["Close"] and last["Close"] < (prev["Open"] + prev["Close"]) / 2:
        patterns.append({"name": "Bearish Engulfing", "type": "bear", "desc": "Bears took control"})
    if is_bear(prev) and is_bull(last) and last["Open"] < prev["Close"] and last["Close"] > (prev["Open"] + prev["Close"]) / 2:
        patterns.append({"name": "Bullish Engulfing", "type": "bull", "desc": "Bulls took control"})

    # Three candle
    if is_bear(p2) and body(prev) < body(p2) * 0.5 and is_bull(last) and last["Close"] > p2["Open"]:
        patterns.append({"name": "Morning Star", "type": "bull", "desc": "3-candle bullish reversal"})
    if is_bull(p2) and body(prev) < body(p2) * 0.5 and is_bear(last) and last["Close"] < p2["Open"]:
        patterns.append({"name": "Evening Star", "type": "bear", "desc": "3-candle bearish reversal"})

    # RSI
    rsi = calc_rsi(df["Close"])
    last_rsi = rsi.iloc[-1]
    if not np.isnan(last_rsi):
        if last_rsi > 70:
            patterns.append({"name": f"RSI Overbought ({last_rsi:.0f})", "type": "bear", "desc": "RSI > 70"})
        elif last_rsi < 30:
            patterns.append({"name": f"RSI Oversold ({last_rsi:.0f})", "type": "bull", "desc": "RSI < 30"})

    # MACD crossover
    macd_line, signal_line, _ = calc_macd(df["Close"])
    if len(macd_line) >= 2:
        if macd_line.iloc[-2] < signal_line.iloc[-2] and macd_line.iloc[-1] >= signal_line.iloc[-1]:
            patterns.append({"name": "MACD Cross Up", "type": "bull", "desc": "Bullish momentum signal"})
        elif macd_line.iloc[-2] > signal_line.iloc[-2] and macd_line.iloc[-1] <= signal_line.iloc[-1]:
            patterns.append({"name": "MACD Cross Down", "type": "bear", "desc": "Bearish momentum signal"})

    # Volume spike
    avg_vol = df["Volume"].iloc[-20:-1].mean()
    if avg_vol > 0 and last["Volume"] > avg_vol * 2:
        patterns.append({"name": "Volume Spike", "type": "bull" if is_bull(last) else "bear", "desc": f"{last['Volume'] / avg_vol:.1f}x avg volume"})

    # 20D high/low
    highs_20 = df["High"].iloc[-20:]
    lows_20 = df["Low"].iloc[-20:]
    if last["High"] >= highs_20.max() * 0.999:
        patterns.append({"name": "20D High", "type": "bull", "desc": "Price at 20-day high"})
    if last["Low"] <= lows_20.min() * 1.001:
        patterns.append({"name": "20D Low", "type": "bear", "desc": "Price at 20-day low"})

    return patterns


# ── Routes ───────────────────────────────────────────────────────────────────

@app.get("/candles")
def get_candles(
    symbol: str = Query(..., description="Ticker symbol e.g. AAPL"),
    range: str = Query("3mo", description="Range: 5d, 1mo, 3mo, 6mo, 1y, 2y"),
    interval: str = Query("1d", description="Bar interval: 15m, 1h, 1d, 1wk"),
):
    interval_map = {"5d": "15m", "1mo": "1d", "3mo": "1d", "6mo": "1d", "1y": "1d", "2y": "1wk"}
    bar_interval = interval_map.get(range, "1d")

    try:
        ticker = yf.Ticker(symbol)
        df = ticker.history(period=range, interval=bar_interval)
        if df.empty:
            raise HTTPException(status_code=404, detail=f"No data for {symbol}")

        df = df.dropna(subset=["Open", "High", "Low", "Close"])
        info = ticker.info
        currency = info.get("currency", "USD")
        long_name = info.get("longName", symbol)

        candles = []
        for ts, row in df.iterrows():
            candles.append({
                "t": int(ts.timestamp() * 1000),
                "o": round(float(row["Open"]), 4),
                "h": round(float(row["High"]), 4),
                "l": round(float(row["Low"]), 4),
                "c": round(float(row["Close"]), 4),
                "v": int(row["Volume"]),
            })

        return {"symbol": symbol, "currency": currency, "name": long_name, "candles": candles}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/indicators")
def get_indicators(
    symbol: str = Query(...),
    range: str = Query("3mo"),
):
    interval_map = {"5d": "15m", "1mo": "1d", "3mo": "1d", "6mo": "1d", "1y": "1d", "2y": "1wk"}
    bar_interval = interval_map.get(range, "1d")

    try:
        ticker = yf.Ticker(symbol)
        df = ticker.history(period=range, interval=bar_interval).dropna()

        closes = df["Close"]

        ema20 = calc_ema(closes, 20)
        ema50 = calc_ema(closes, 50)
        macd_line, signal_line, histogram = calc_macd(closes)
        rsi = calc_rsi(closes)
        bb_upper, bb_mid, bb_lower = calc_bollinger(closes)

        def to_list(s):
            return [round(v, 4) if not np.isnan(v) else None for v in s]

        return {
            "ema20": to_list(ema20),
            "ema50": to_list(ema50),
            "macd": {"line": to_list(macd_line), "signal": to_list(signal_line), "histogram": to_list(histogram)},
            "rsi": to_list(rsi),
            "bollinger": {"upper": to_list(bb_upper), "mid": to_list(bb_mid), "lower": to_list(bb_lower)},
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/patterns")
def get_patterns(
    symbol: str = Query(...),
    range: str = Query("3mo"),
):
    interval_map = {"5d": "15m", "1mo": "1d", "3mo": "1d", "6mo": "1d", "1y": "1d", "2y": "1wk"}
    bar_interval = interval_map.get(range, "1d")

    try:
        ticker = yf.Ticker(symbol)
        df = ticker.history(period=range, interval=bar_interval).dropna()
        patterns = detect_patterns(df)
        last = df.iloc[-1]
        rsi = calc_rsi(df["Close"])
        macd_line, signal_line, histogram = calc_macd(df["Close"])

        return {
            "symbol": symbol,
            "last_close": round(float(last["Close"]), 2),
            "last_rsi": round(float(rsi.iloc[-1]), 1) if not np.isnan(rsi.iloc[-1]) else None,
            "last_macd": round(float(macd_line.iloc[-1]), 4) if not np.isnan(macd_line.iloc[-1]) else None,
            "last_signal": round(float(signal_line.iloc[-1]), 4) if not np.isnan(signal_line.iloc[-1]) else None,
            "patterns": patterns,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/compare")
def compare_symbols(
    symbols: str = Query(..., description="Comma-separated symbols e.g. AAPL,MSFT,NVDA"),
    range: str = Query("1y"),
):
    interval_map = {"3mo": "1d", "6mo": "1d", "1y": "1d", "2y": "1wk"}
    bar_interval = interval_map.get(range, "1d")
    sym_list = [s.strip().upper() for s in symbols.split(",") if s.strip()][:8]

    results = {}
    for sym in sym_list:
        try:
            df = yf.Ticker(sym).history(period=range, interval=bar_interval).dropna()
            if df.empty:
                continue
            base = float(df["Close"].iloc[0])
            results[sym] = {
                "dates": [int(ts.timestamp() * 1000) for ts in df.index],
                "closes": [round(float(v), 4) for v in df["Close"]],
                "returns_pct": [round((float(v) / base - 1) * 100, 2) for v in df["Close"]],
                "total_return_pct": round((float(df["Close"].iloc[-1]) / base - 1) * 100, 2),
                "last_price": round(float(df["Close"].iloc[-1]), 2),
            }
        except Exception:
            continue

    return {"symbols": sym_list, "range": range, "data": results}


@app.get("/quote")
def get_quote(symbol: str = Query(...)):
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info
        fast_info = ticker.fast_info
        return {
            "symbol": symbol,
            "name": info.get("longName", symbol),
            "price": round(float(fast_info.last_price), 2),
            "change": round(float(fast_info.last_price - fast_info.previous_close), 2),
            "change_pct": round(float((fast_info.last_price - fast_info.previous_close) / fast_info.previous_close * 100), 2),
            "volume": int(fast_info.three_month_average_volume or 0),
            "market_cap": info.get("marketCap"),
            "pe_ratio": info.get("trailingPE"),
            "52w_high": info.get("fiftyTwoWeekHigh"),
            "52w_low": info.get("fiftyTwoWeekLow"),
            "currency": info.get("currency", "USD"),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
def health():
    return {"status": "ok", "version": "1.0.0"}


# ── Portfolio endpoints ───────────────────────────────────────────────────────

@app.get("/orders")
def get_orders():
    return _load_orders()


@app.post("/orders")
def add_order(
    symbol: str = Query(...),
    buy_date: str = Query(...),
    buy_price: float = Query(...),
    shares: float = Query(...),
):
    orders = _load_orders()
    order = {
        "id": str(uuid.uuid4()),
        "symbol": symbol.upper(),
        "buy_date": buy_date,
        "buy_price": round(buy_price, 4),
        "shares": shares,
    }
    orders.append(order)
    _save_orders(orders)
    return order


@app.delete("/orders/{order_id}")
def delete_order(order_id: str):
    orders = [o for o in _load_orders() if o["id"] != order_id]
    _save_orders(orders)
    return {"ok": True}


@app.get("/gain-loss")
def gain_loss(
    id: str = Query(...),
    eval_date: str = Query(None),
):
    orders = _load_orders()
    order = next((o for o in orders if o["id"] == id), None)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    sym = order["symbol"]
    ticker = yf.Ticker(sym)
    if eval_date:
        end = (date.fromisoformat(eval_date) + timedelta(days=5)).isoformat()
        hist = ticker.history(start=eval_date, end=end)
        if hist.empty:
            raise HTTPException(status_code=400, detail=f"No price data for {sym} at {eval_date}")
        eval_price = round(float(hist["Close"].iloc[0]), 4)
    else:
        eval_price = round(float(ticker.fast_info.last_price), 4)
    bp, shares = order["buy_price"], order["shares"]
    gl_dollar = round((eval_price - bp) * shares, 2)
    gl_pct = round((eval_price - bp) / bp * 100, 2)
    return {
        "eval_price": eval_price,
        "gain_loss_dollar": gl_dollar,
        "gain_loss_pct": gl_pct,
        "total_value": round(eval_price * shares, 2),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
