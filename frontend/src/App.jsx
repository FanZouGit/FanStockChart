import { useState, useEffect, useRef, useCallback } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend);

const API_BASE = "http://localhost:8000";
const UP = "#1D9E75", DN = "#D85A30";
const CMP_COLORS = ["#378ADD","#1D9E75","#EF9F27","#D85A30","#7F77DD","#D4537E","#639922","#BA7517"];

const WATCHLIST = [
  { s: "SPY", n: "S&P 500 ETF" }, { s: "QQQ", n: "Nasdaq ETF" },
  { s: "AAPL", n: "Apple" }, { s: "MSFT", n: "Microsoft" },
  { s: "NVDA", n: "NVIDIA" }, { s: "GOOGL", n: "Alphabet" },
  { s: "AMZN", n: "Amazon" }, { s: "TSLA", n: "Tesla" },
  { s: "META", n: "Meta" }, { s: "BTC-USD", n: "Bitcoin" },
];

// ── Indicator math ──────────────────────────────────────────────────────────
function calcEMA(data, p) {
  const k = 2 / (p + 1), out = new Array(data.length).fill(null);
  let e = null;
  for (let i = 0; i < data.length; i++) {
    if (data[i] == null) continue;
    e = e === null ? data[i] : data[i] * k + e * (1 - k);
    if (i >= p - 1) out[i] = e;
  }
  return out;
}

function calcMACD(data, f = 12, s = 26, sig = 9) {
  const ef = calcEMA(data, f), es = calcEMA(data, s);
  const line = data.map((_, i) => ef[i] != null && es[i] != null ? ef[i] - es[i] : null);
  const signal = calcEMA(line, sig);
  const hist = line.map((v, i) => v != null && signal[i] != null ? v - signal[i] : null);
  return { line, signal, hist };
}

function calcBB(data, p = 20, m = 2) {
  const mid = calcEMA(data, p), upper = [], lower = [];
  for (let i = 0; i < data.length; i++) {
    if (i < p - 1 || mid[i] == null) { upper.push(null); lower.push(null); continue; }
    const sl = data.slice(i - p + 1, i + 1).filter(x => x != null);
    const mn = sl.reduce((a, b) => a + b, 0) / sl.length;
    const sd = Math.sqrt(sl.reduce((a, b) => a + (b - mn) ** 2, 0) / sl.length);
    upper.push(mid[i] + m * sd); lower.push(mid[i] - m * sd);
  }
  return { upper, mid, lower };
}

function calcRSI(data, p = 14) {
  const out = new Array(data.length).fill(null);
  let G = 0, L = 0;
  for (let i = 1; i <= p && i < data.length; i++) {
    const d = data[i] - data[i - 1]; if (d > 0) G += d; else L += Math.abs(d);
  }
  if (p < data.length) {
    let ag = G / p, al = L / p;
    out[p] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    for (let i = p + 1; i < data.length; i++) {
      const d = data[i] - data[i - 1], g = d > 0 ? d : 0, l = d < 0 ? Math.abs(d) : 0;
      ag = (ag * (p - 1) + g) / p; al = (al * (p - 1) + l) / p;
      out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    }
  }
  return out;
}

function detectPatterns(candles) {
  const pats = [], n = candles.length;
  if (n < 5) return pats;
  const last = candles[n - 1], prev = candles[n - 2], p2 = candles[n - 3];
  const body = c => Math.abs(c.c - c.o), rng = c => c.h - c.l;
  const isBull = c => c.c > c.o, isBear = c => c.c < c.o;
  const lo = c => Math.min(c.o, c.c) - c.l, hi = c => c.h - Math.max(c.o, c.c);

  if (body(last) < rng(last) * 0.1) pats.push({ name: "Doji", type: "neut", desc: "Indecision" });
  if (isBull(last) && body(last) > rng(last) * 0.8 && body(last) > body(prev) * 2) pats.push({ name: "Bullish Marubozu", type: "bull", desc: "Strong buying" });
  if (isBear(last) && body(last) > rng(last) * 0.8 && body(last) > body(prev) * 2) pats.push({ name: "Bearish Marubozu", type: "bear", desc: "Strong selling" });
  if (lo(last) > body(last) * 2 && hi(last) < body(last) * 0.5) pats.push({ name: "Hammer", type: "bull", desc: "Bullish reversal" });
  if (hi(last) > body(last) * 2 && lo(last) < body(last) * 0.5) pats.push({ name: "Shooting Star", type: "bear", desc: "Bearish reversal" });
  if (isBull(prev) && isBear(last) && last.o > prev.c && last.c < (prev.o + prev.c) / 2) pats.push({ name: "Bearish Engulfing", type: "bear", desc: "Bears took control" });
  if (isBear(prev) && isBull(last) && last.o < prev.c && last.c > (prev.o + prev.c) / 2) pats.push({ name: "Bullish Engulfing", type: "bull", desc: "Bulls took control" });
  if (isBear(p2) && body(prev) < body(p2) * 0.5 && isBull(last) && last.c > p2.o) pats.push({ name: "Morning Star", type: "bull", desc: "3-candle bullish reversal" });
  if (isBull(p2) && body(prev) < body(p2) * 0.5 && isBear(last) && last.c < p2.o) pats.push({ name: "Evening Star", type: "bear", desc: "3-candle bearish reversal" });

  const closes = candles.map(c => c.c);
  const rsi = calcRSI(closes), lastRSI = rsi[n - 1];
  if (lastRSI != null && lastRSI > 70) pats.push({ name: `RSI Overbought (${lastRSI.toFixed(0)})`, type: "bear", desc: "RSI > 70" });
  if (lastRSI != null && lastRSI < 30) pats.push({ name: `RSI Oversold (${lastRSI.toFixed(0)})`, type: "bull", desc: "RSI < 30" });

  const { line, signal } = calcMACD(closes);
  if (n >= 2 && line[n - 2] != null && signal[n - 2] != null) {
    if (line[n - 2] < signal[n - 2] && line[n - 1] >= signal[n - 1]) pats.push({ name: "MACD Cross Up", type: "bull", desc: "Bullish momentum" });
    if (line[n - 2] > signal[n - 2] && line[n - 1] <= signal[n - 1]) pats.push({ name: "MACD Cross Down", type: "bear", desc: "Bearish momentum" });
  }

  const vols = candles.map(c => c.v);
  const avgVol = vols.slice(-20, -1).reduce((a, b) => a + b, 0) / 19;
  if (last.v > avgVol * 2) pats.push({ name: "Volume Spike", type: last.c > last.o ? "bull" : "bear", desc: `${(last.v / avgVol).toFixed(1)}x avg` });
  const highs = candles.slice(-20).map(c => c.h), lows = candles.slice(-20).map(c => c.l);
  if (last.h >= Math.max(...highs) * 0.999) pats.push({ name: "20D High", type: "bull", desc: "At 20-day high" });
  if (last.l <= Math.min(...lows) * 1.001) pats.push({ name: "20D Low", type: "bear", desc: "At 20-day low" });
  return pats;
}

// ── Canvas chart helpers ─────────────────────────────────────────────────────
function useCanvas(drawFn, deps) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    const canvas = ref.current;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth, h = canvas.offsetHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);
    drawFn(ctx, w, h);
  }, deps);
  return ref;
}

function CandleCanvas({ candles, indicators, patterns, onHover }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !candles.length) return;
    const canvas = canvasRef.current;
    const w = canvas.offsetWidth, h = canvas.offsetHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);
    const chartMeta = drawCandles(ctx, w, h, candles, indicators, patterns);
    if (chartMeta) canvas._chart = chartMeta;
  }, [candles, indicators, patterns]);

  function drawCandles(ctx, W, H, candles, indicators, patterns) {
    ctx.clearRect(0, 0, W, H);
    const PL = 56, PR = 12, PT = 18, PB = 26;
    const closes = candles.map(c => c.c);
    const e20 = calcEMA(closes, 20);
    const bb = indicators.bb ? calcBB(closes) : null;
    let yMn = Math.min(...candles.map(c => c.l)), yMx = Math.max(...candles.map(c => c.h));
    if (bb) {
      const u = bb.upper.filter(x => x != null), l = bb.lower.filter(x => x != null);
      if (u.length) yMx = Math.max(yMx, ...u);
      if (l.length) yMn = Math.min(yMn, ...l);
    }
    const yp = (yMx - yMn) * 0.05; yMn -= yp; yMx += yp;
    const CW = W - PL - PR, CH = H - PT - PB, n = candles.length;
    const cw = CW / n, bw = Math.max(1, cw * 0.6);
    const xo = i => PL + (i + 0.5) * cw, yo = v => PT + CH - (v - yMn) / (yMx - yMn) * CH;

    ctx.strokeStyle = "rgba(128,128,128,0.1)"; ctx.lineWidth = 0.5;
    for (let i = 0; i <= 5; i++) {
      const y = PT + i * (CH / 5), v = yMx - i * (yMx - yMn) / 5;
      ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(W - PR, y); ctx.stroke();
      ctx.fillStyle = "rgba(100,100,100,0.7)"; ctx.font = "10px monospace"; ctx.textAlign = "right";
      ctx.fillText(v.toFixed(2), PL - 4, y + 3);
    }
    const step = Math.max(1, Math.floor(n / 6));
    ctx.fillStyle = "rgba(100,100,100,0.7)"; ctx.font = "10px monospace"; ctx.textAlign = "center";
    for (let i = 0; i < n; i += step) {
      const d = new Date(candles[i].t);
      ctx.fillText(d.toLocaleDateString("en-US", { month: "short", day: "numeric" }), xo(i), H - 7);
    }

    if (bb) {
      ctx.beginPath(); let s = false;
      for (let i = 0; i < n; i++) { if (bb.upper[i] == null) continue; if (!s) { ctx.moveTo(xo(i), yo(bb.upper[i])); s = true; } else ctx.lineTo(xo(i), yo(bb.upper[i])); }
      for (let i = n - 1; i >= 0; i--) { if (bb.lower[i] == null) continue; ctx.lineTo(xo(i), yo(bb.lower[i])); }
      ctx.closePath(); ctx.fillStyle = "rgba(53,74,183,0.07)"; ctx.fill();
      ["upper", "mid", "lower"].forEach(k => {
        ctx.beginPath(); let ss = false;
        for (let i = 0; i < n; i++) { if (bb[k][i] == null) continue; if (!ss) { ctx.moveTo(xo(i), yo(bb[k][i])); ss = true; } else ctx.lineTo(xo(i), yo(bb[k][i])); }
        ctx.strokeStyle = k === "mid" ? "rgba(127,119,221,0.5)" : "rgba(127,119,221,0.3)";
        ctx.lineWidth = k === "mid" ? 1 : 0.6; ctx.setLineDash(k === "mid" ? [3, 3] : []); ctx.stroke(); ctx.setLineDash([]);
      });
    }

    for (let i = 0; i < n; i++) {
      const c = candles[i], x = xo(i), up = c.c >= c.o;
      ctx.strokeStyle = up ? UP : DN; ctx.fillStyle = up ? "rgba(29,158,117,0.15)" : "rgba(216,90,48,0.15)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, yo(c.h)); ctx.lineTo(x, yo(c.l)); ctx.stroke();
      const top = Math.max(c.o, c.c), bot = Math.min(c.o, c.c), rh = Math.max(1, yo(bot) - yo(top));
      ctx.fillRect(x - bw / 2, yo(top), bw, rh); ctx.strokeRect(x - bw / 2, yo(top), bw, rh);
    }

    if (indicators.ema) {
      ctx.beginPath(); let s = false;
      for (let i = 0; i < n; i++) { if (e20[i] == null) continue; if (!s) { ctx.moveTo(xo(i), yo(e20[i])); s = true; } else ctx.lineTo(xo(i), yo(e20[i])); }
      ctx.strokeStyle = "#EF9F27"; ctx.lineWidth = 1.5; ctx.stroke();
    }

    if (indicators.pat && patterns) {
      if (patterns.some(p => p.type === "bull")) { ctx.fillStyle = UP; ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center"; ctx.fillText("▲", xo(n - 1), yo(candles[n - 1].l) - 6); }
      if (patterns.some(p => p.type === "bear")) { ctx.fillStyle = DN; ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center"; ctx.fillText("▼", xo(n - 1), yo(candles[n - 1].h) + 14); }
    }

    if (ctx?.canvas) {
      ctx.canvas._chart = { xo, yo, cw, PL, PR, PT, PB, yMn, yMx };
    }
    return { xo, yo, cw, PL, PR, PT, PB, yMn, yMx };
  }

  function handleMouseMove(e) {
    if (!canvasRef.current || !candles.length) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const W = canvasRef.current.offsetWidth;
    const PL = 56, PR = 12, CW = W - PL - PR, n = candles.length, cw = CW / n;
    const idx = Math.round((mx - PL) / cw - 0.5);
    if (idx >= 0 && idx < n) onHover(candles[idx], idx);
  }

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: 300 }}>
      <canvas ref={canvasRef} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
        onMouseMove={handleMouseMove} onMouseLeave={() => onHover(null)} />
    </div>
  );
}

function VolumeCanvas({ candles }) {
  const ref = useCanvas((ctx, W, H) => {
    if (!candles.length) return;
    ctx.clearRect(0, 0, W, H);
    const PL = 56, PR = 12, PT = 4, PB = 12, CW = W - PL - PR, CH = H - PT - PB, n = candles.length;
    const cw = CW / n, bw = Math.max(1, cw * 0.6), mx = Math.max(...candles.map(c => c.v));
    const xo = i => PL + (i + 0.5) * cw;
    const fv = v => v >= 1e9 ? (v / 1e9).toFixed(1) + "B" : v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? (v / 1e3).toFixed(0) + "K" : v;
    ctx.fillStyle = "rgba(100,100,100,0.6)"; ctx.font = "9px monospace"; ctx.textAlign = "right"; ctx.fillText(fv(mx), PL - 3, PT + 9);
    for (let i = 0; i < n; i++) {
      const c = candles[i], x = xo(i), bh = Math.max(1, (c.v / mx) * CH);
      ctx.fillStyle = c.c >= c.o ? "rgba(29,158,117,0.5)" : "rgba(216,90,48,0.5)";
      ctx.fillRect(x - bw / 2, PT + CH - bh, bw, bh);
    }
  }, [candles]);
  return <canvas ref={ref} style={{ display: "block", width: "100%", height: 60 }} />;
}

function RSICanvas({ candles }) {
  const ref = useCanvas((ctx, W, H) => {
    if (!candles.length) return;
    ctx.clearRect(0, 0, W, H);
    const PL = 56, PR = 12, PT = 4, PB = 12, CW = W - PL - PR, CH = H - PT - PB, n = candles.length;
    const rsi = calcRSI(candles.map(c => c.c));
    const xo = i => PL + (i + 0.5) * (CW / n), yo = v => PT + CH - (v / 100) * CH;
    [30, 50, 70].forEach(lvl => {
      ctx.strokeStyle = lvl === 50 ? "rgba(128,128,128,0.1)" : "rgba(216,90,48,0.2)"; ctx.lineWidth = 0.5; ctx.setLineDash(lvl === 50 ? [] : [3, 3]);
      ctx.beginPath(); ctx.moveTo(PL, yo(lvl)); ctx.lineTo(W - PR, yo(lvl)); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "rgba(100,100,100,0.6)"; ctx.font = "9px monospace"; ctx.textAlign = "right"; ctx.fillText(lvl, PL - 3, yo(lvl) + 3);
    });
    ctx.beginPath(); let s = false;
    for (let i = 0; i < n; i++) { if (rsi[i] == null) continue; if (!s) { ctx.moveTo(xo(i), yo(rsi[i])); s = true; } else ctx.lineTo(xo(i), yo(rsi[i])); }
    ctx.strokeStyle = "#7F77DD"; ctx.lineWidth = 1.5; ctx.stroke();
  }, [candles]);
  return <canvas ref={ref} style={{ display: "block", width: "100%", height: 80 }} />;
}

function MACDCanvas({ candles }) {
  const ref = useCanvas((ctx, W, H) => {
    if (!candles.length) return;
    ctx.clearRect(0, 0, W, H);
    const PL = 56, PR = 12, PT = 6, PB = 14, CW = W - PL - PR, CH = H - PT - PB, n = candles.length;
    const { line, signal, hist } = calcMACD(candles.map(c => c.c));
    const vals = [...hist, ...line, ...signal].filter(x => x != null);
    if (!vals.length) return;
    let yMn = Math.min(...vals), yMx = Math.max(...vals);
    const yp = (yMx - yMn) * 0.1; yMn -= yp; yMx += yp;
    const xo = i => PL + (i + 0.5) * (CW / n), yo = v => PT + CH - (v - yMn) / (yMx - yMn) * CH;
    const y0 = yo(0);
    ctx.strokeStyle = "rgba(128,128,128,0.1)"; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(PL, y0); ctx.lineTo(W - PR, y0); ctx.stroke();
    const absMax = Math.max(Math.abs(yMx), Math.abs(yMn));
    [absMax * 0.6, 0, -absMax * 0.6].forEach(lvl => {
      ctx.fillStyle = "rgba(100,100,100,0.6)"; ctx.font = "9px monospace"; ctx.textAlign = "right"; ctx.fillText(lvl.toFixed(2), PL - 3, yo(lvl) + 3);
    });
    const cw2 = CW / n, bw = Math.max(1, cw2 * 0.55);
    for (let i = 0; i < n; i++) {
      if (hist[i] == null) continue;
      const x = xo(i), hv = hist[i], top = Math.min(yo(hv), y0), bh = Math.abs(yo(hv) - y0) || 1;
      ctx.fillStyle = hv >= 0 ? "rgba(29,158,117,0.55)" : "rgba(216,90,48,0.55)"; ctx.fillRect(x - bw / 2, top, bw, bh);
    }
    const dl = (arr, col, lw, dash = []) => {
      ctx.beginPath(); let s = false;
      for (let i = 0; i < n; i++) { if (arr[i] == null) continue; if (!s) { ctx.moveTo(xo(i), yo(arr[i])); s = true; } else ctx.lineTo(xo(i), yo(arr[i])); }
      ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]);
    };
    dl(line, "#378ADD", 1.5); dl(signal, "#D85A30", 1, [3, 3]);
    ctx.fillStyle = "rgba(100,100,100,0.6)"; ctx.font = "9px monospace"; ctx.textAlign = "left";
    ctx.fillStyle = "#378ADD"; ctx.fillRect(PL, PT + 4, 8, 2);
    ctx.fillStyle = "rgba(100,100,100,0.7)"; ctx.fillText("MACD", PL + 10, PT + 8);
    ctx.setLineDash([3, 3]); ctx.strokeStyle = "#D85A30"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PL + 54, PT + 5); ctx.lineTo(PL + 62, PT + 5); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillText("Signal", PL + 64, PT + 8);
  }, [candles]);
  return <canvas ref={ref} style={{ display: "block", width: "100%", height: 90 }} />;
}

// ── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("chart");
  const [sym, setSym] = useState("SPY");
  const [inputSym, setInputSym] = useState("SPY");
  const [range, setRange] = useState("3mo");
  const [candles, setCandles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("Enter symbol and click Load");
  const [indicators, setIndicators] = useState({ ema: true, bb: false, vol: true, rsi: true, macd: true, pat: true });
  const [patterns, setPatterns] = useState([]);
  const [hoverCandle, setHoverCandle] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [alertForm, setAlertForm] = useState({ sym: "", cond: "above", val: "" });
  const [cmpSyms, setCmpSyms] = useState(["SPY", "QQQ", "AAPL"]);
  const [cmpInput, setCmpInput] = useState("");
  const [cmpRange, setCmpRange] = useState("1y");
  const [cmpData, setCmpData] = useState({});
  const [cmpLoading, setCmpLoading] = useState(false);

  const fetchCandles = useCallback(async (s, r) => {
    const res = await fetch(`${API_BASE}/candles?symbol=${s}&range=${r}`);
    if (!res.ok) throw new Error("Symbol not found");
    return res.json();
  }, []);

  const load = useCallback(async (s = sym, r = range) => {
    setLoading(true); setStatus("Fetching...");
    try {
      const data = await fetchCandles(s, r);
      setCandles(data.candles);
      setPatterns(detectPatterns(data.candles));
      const last = data.candles[data.candles.length - 1];
      setStatus(`${data.candles.length} bars · ${data.currency} · ${detectPatterns(data.candles).length} patterns`);
      checkAlerts(s, data.candles);
    } catch (e) { setStatus("Error: " + e.message); }
    setLoading(false);
  }, [sym, range, fetchCandles]);

  useEffect(() => { load("SPY", "3mo"); }, []);

  const checkAlerts = (s, cs) => {
    if (!cs.length) return;
    const last = cs[cs.length - 1];
    const closes = cs.map(c => c.c);
    const rsi = calcRSI(closes), lastRSI = rsi[rsi.length - 1];
    const { line, signal } = calcMACD(closes), n = cs.length;
    const vols = cs.map(c => c.v);
    const avgVol = vols.slice(-20, -1).reduce((a, b) => a + b, 0) / Math.max(1, vols.slice(-20, -1).length);
    setAlerts(prev => prev.map(a => {
      if (a.sym !== s || a.fired) return a;
      let fired = false;
      if (a.cond === "above" && last.c > +a.val) fired = true;
      else if (a.cond === "below" && last.c < +a.val) fired = true;
      else if (a.cond === "rsi-ob" && lastRSI != null && lastRSI > +a.val) fired = true;
      else if (a.cond === "rsi-os" && lastRSI != null && lastRSI < +a.val) fired = true;
      else if (a.cond === "macd-cross-up" && n >= 2 && line[n - 2] != null && line[n - 2] < signal[n - 2] && line[n - 1] >= signal[n - 1]) fired = true;
      else if (a.cond === "macd-cross-dn" && n >= 2 && line[n - 2] != null && line[n - 2] > signal[n - 2] && line[n - 1] <= signal[n - 1]) fired = true;
      else if (a.cond === "vol-spike" && last.v > avgVol * +a.val) fired = true;
      return fired ? { ...a, fired: true, firedPrice: last.c } : a;
    }));
  };

  const loadCompare = useCallback(async () => {
    setCmpLoading(true);
    const needed = cmpSyms.filter(s => !cmpData[s]);
    const results = await Promise.all(needed.map(async s => {
      try { const d = await fetchCandles(s, cmpRange); return [s, d.candles]; }
      catch { return [s, null]; }
    }));
    setCmpData(prev => {
      const next = { ...prev };
      results.forEach(([s, cs]) => { if (cs) next[s] = cs; });
      return next;
    });
    setCmpLoading(false);
  }, [cmpSyms, cmpRange, fetchCandles]);

  useEffect(() => { if (tab === "compare") loadCompare(); }, [tab, cmpRange, cmpSyms]);

  const last = candles.length ? candles[candles.length - 1] : null;
  const first = candles.length ? candles[0] : null;
  const chg = last && first ? last.c - first.o : 0;
  const pct = first ? (chg / first.o) * 100 : 0;
  const displayCandle = hoverCandle || last;

  const cmpChartData = {
    labels: cmpSyms[0] && cmpData[cmpSyms[0]] ? cmpData[cmpSyms[0]].map(c => new Date(c.t).toLocaleDateString("en-US", { month: "short", day: "numeric" })) : [],
    datasets: cmpSyms.map((s, i) => {
      const cs = cmpData[s]; if (!cs || !cs.length) return null;
      const base = cs[0].c;
      return { label: s, data: cs.map(c => +((c.c / base - 1) * 100).toFixed(2)), borderColor: CMP_COLORS[i % CMP_COLORS.length], backgroundColor: "transparent", borderWidth: 2, pointRadius: 0, tension: 0.2 };
    }).filter(Boolean)
  };

  return (
    <div style={{ fontFamily: "monospace", maxWidth: 1000, margin: "0 auto", border: "1px solid #e0e0e0", borderRadius: 8, overflow: "hidden", background: "#fff" }}>
      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #e0e0e0" }}>
        {["chart", "alerts", "compare"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "10px 18px", fontSize: 12, border: "none", borderBottom: tab === t ? "2px solid #222" : "2px solid transparent", background: "transparent", color: tab === t ? "#222" : "#888", cursor: "pointer", textTransform: "capitalize" }}>{t}</button>
        ))}
      </div>

      {/* Chart Tab */}
      {tab === "chart" && (
        <>
          {/* Toolbar */}
          <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", borderBottom: "1px solid #f0f0f0", flexWrap: "wrap" }}>
            <input value={inputSym} onChange={e => setInputSym(e.target.value.toUpperCase())} onKeyDown={e => e.key === "Enter" && (setSym(inputSym), load(inputSym, range))}
              style={{ width: 70, fontSize: 12, fontWeight: 600, padding: "4px 7px", border: "1px solid #ddd", borderRadius: 6, fontFamily: "monospace", textTransform: "uppercase" }} />
            {["5d","1mo","3mo","6mo","1y","2y"].map(r => (
              <button key={r} onClick={() => { setRange(r); load(sym, r); }}
                style={{ fontSize: 10, padding: "3px 8px", border: "1px solid #ddd", borderRadius: 6, background: range === r ? "#f0f0f0" : "transparent", color: range === r ? "#222" : "#888", cursor: "pointer" }}>{r.toUpperCase()}</button>
            ))}
            <span style={{ width: 1, height: 16, background: "#ddd", margin: "0 2px" }} />
            {Object.entries({ ema: "EMA", bb: "BB", vol: "Vol", rsi: "RSI", macd: "MACD", pat: "Patterns" }).map(([k, label]) => (
              <button key={k} onClick={() => setIndicators(prev => ({ ...prev, [k]: !prev[k] }))}
                style={{ fontSize: 9, padding: "3px 6px", border: "1px solid #ddd", borderRadius: 6, background: indicators[k] ? "#e8f4fd" : "transparent", color: indicators[k] ? "#185FA5" : "#aaa", cursor: "pointer" }}>{label}</button>
            ))}
            <button onClick={() => { setSym(inputSym); load(inputSym, range); }}
              style={{ marginLeft: "auto", fontSize: 11, padding: "4px 12px", border: "1px solid #ddd", borderRadius: 6, background: "#f5f5f5", cursor: "pointer" }}>{loading ? "..." : "Load"}</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 120px" }}>
            <div>
              {/* Price header */}
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "8px 12px 2px" }}>
                <span style={{ fontSize: 11, color: "#888" }}>{sym}</span>
                <span style={{ fontSize: 20, fontWeight: 600 }}>{last ? "$" + last.c.toFixed(2) : "—"}</span>
                <span style={{ fontSize: 11, color: chg >= 0 ? UP : DN }}>{last ? `${chg >= 0 ? "+" : ""}${chg.toFixed(2)} (${pct.toFixed(2)}%)` : ""}</span>
              </div>
              {displayCandle && (
                <div style={{ display: "flex", gap: 10, padding: "0 12px 4px", fontSize: 9, color: "#999" }}>
                  <span>O <b style={{ color: "#555" }}>{displayCandle.o?.toFixed(2)}</b></span>
                  <span>H <b style={{ color: UP }}>{displayCandle.h?.toFixed(2)}</b></span>
                  <span>L <b style={{ color: DN }}>{displayCandle.l?.toFixed(2)}</b></span>
                  <span>C <b style={{ color: "#555" }}>{displayCandle.c?.toFixed(2)}</b></span>
                </div>
              )}
              <div style={{ fontSize: 9, color: "#aaa", padding: "2px 12px" }}>{status}</div>

              <CandleCanvas candles={candles} indicators={indicators} patterns={patterns} onHover={setHoverCandle} />

              {/* Patterns */}
              {indicators.pat && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "6px 12px", borderTop: "1px solid #f5f5f5", minHeight: 32 }}>
                  {patterns.length === 0 && <span style={{ fontSize: 9, color: "#ccc" }}>No patterns detected</span>}
                  {patterns.map((p, i) => (
                    <span key={i} title={p.desc} style={{ fontSize: 9, padding: "2px 7px", borderRadius: 6, border: "1px solid", background: p.type === "bull" ? "rgba(29,158,117,0.1)" : p.type === "bear" ? "rgba(216,90,48,0.1)" : "#f5f5f5", color: p.type === "bull" ? UP : p.type === "bear" ? DN : "#888", borderColor: p.type === "bull" ? "rgba(29,158,117,0.3)" : p.type === "bear" ? "rgba(216,90,48,0.3)" : "#e0e0e0", cursor: "default" }}>{p.name}</span>
                  ))}
                </div>
              )}
              {indicators.vol && <div style={{ padding: "0 12px 4px" }}><div style={{ fontSize: 8, color: "#bbb", marginBottom: 2 }}>Volume</div><VolumeCanvas candles={candles} /></div>}
              {indicators.rsi && <div style={{ padding: "0 12px 4px" }}><div style={{ fontSize: 8, color: "#bbb", marginBottom: 2 }}>RSI(14)</div><RSICanvas candles={candles} /></div>}
              {indicators.macd && <div style={{ padding: "0 12px 4px" }}><div style={{ fontSize: 8, color: "#bbb", marginBottom: 2 }}>MACD(12,26,9)</div><MACDCanvas candles={candles} /></div>}
            </div>

            {/* Watchlist */}
            <div style={{ borderLeft: "1px solid #f0f0f0", overflowY: "auto", maxHeight: 700 }}>
              {WATCHLIST.map(item => (
                <div key={item.s} onClick={() => { setInputSym(item.s); setSym(item.s); load(item.s, range); }}
                  style={{ padding: "6px 8px", borderBottom: "1px solid #f5f5f5", cursor: "pointer", background: sym === item.s ? "#f8f8f8" : "transparent" }}>
                  <div style={{ fontSize: 10, fontWeight: 600 }}>{item.s}</div>
                  <div style={{ fontSize: 8, color: "#bbb" }}>{item.n}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Alerts Tab */}
      {tab === "alerts" && (
        <div style={{ padding: 16 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
            <input placeholder="Symbol" value={alertForm.sym} onChange={e => setAlertForm(p => ({ ...p, sym: e.target.value.toUpperCase() }))}
              style={{ width: 70, fontSize: 11, padding: "4px 7px", border: "1px solid #ddd", borderRadius: 6, fontFamily: "monospace" }} />
            <select value={alertForm.cond} onChange={e => setAlertForm(p => ({ ...p, cond: e.target.value }))}
              style={{ fontSize: 11, padding: "4px 7px", border: "1px solid #ddd", borderRadius: 6 }}>
              <option value="above">Price above</option>
              <option value="below">Price below</option>
              <option value="rsi-ob">RSI overbought &gt;</option>
              <option value="rsi-os">RSI oversold &lt;</option>
              <option value="macd-cross-up">MACD cross up</option>
              <option value="macd-cross-dn">MACD cross dn</option>
              <option value="vol-spike">Volume spike &gt;x</option>
            </select>
            <input type="number" placeholder="Value" value={alertForm.val} onChange={e => setAlertForm(p => ({ ...p, val: e.target.value }))}
              style={{ width: 80, fontSize: 11, padding: "4px 7px", border: "1px solid #ddd", borderRadius: 6 }} />
            <button onClick={() => {
              if (!alertForm.sym) return;
              setAlerts(prev => [...prev, { id: Date.now(), ...alertForm, fired: false, firedPrice: null }]);
              setAlertForm(p => ({ ...p, sym: "", val: "" }));
            }} style={{ fontSize: 11, padding: "4px 12px", border: "1px solid #ddd", borderRadius: 6, background: "#f5f5f5", cursor: "pointer" }}>+ Add Alert</button>
          </div>
          {alerts.length === 0 && <div style={{ fontSize: 12, color: "#bbb" }}>No alerts set. Add one above.</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {alerts.map(a => {
              const condLabel = { above: `Price > $${a.val}`, below: `Price < $${a.val}`, "rsi-ob": `RSI > ${a.val}`, "rsi-os": `RSI < ${a.val}`, "macd-cross-up": "MACD cross up", "macd-cross-dn": "MACD cross dn", "vol-spike": `Vol spike > ${a.val}x` }[a.cond];
              return (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", border: `1px solid ${a.fired ? "rgba(29,158,117,0.3)" : "#eee"}`, borderRadius: 8, fontSize: 11, background: a.fired ? "rgba(29,158,117,0.05)" : "transparent" }}>
                  <span style={{ fontWeight: 600, minWidth: 44 }}>{a.sym}</span>
                  <span style={{ flex: 1, color: "#666" }}>{condLabel}</span>
                  <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 10, background: a.fired ? "rgba(29,158,117,0.15)" : "#eef4ff", color: a.fired ? UP : "#185FA5" }}>{a.fired ? `FIRED @ $${a.firedPrice?.toFixed(2)}` : "Active"}</span>
                  <span onClick={() => setAlerts(prev => prev.filter(x => x.id !== a.id))} style={{ cursor: "pointer", color: "#ccc", fontSize: 14 }}>×</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Compare Tab */}
      {tab === "compare" && (
        <div style={{ padding: 16 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <input value={cmpInput} onChange={e => setCmpInput(e.target.value.toUpperCase())} placeholder="Add symbol"
              onKeyDown={e => { if (e.key === "Enter" && cmpInput && !cmpSyms.includes(cmpInput) && cmpSyms.length < 8) { setCmpSyms(p => [...p, cmpInput]); setCmpInput(""); } }}
              style={{ width: 90, fontSize: 12, padding: "4px 7px", border: "1px solid #ddd", borderRadius: 6, fontFamily: "monospace" }} />
            <button onClick={() => { if (cmpInput && !cmpSyms.includes(cmpInput) && cmpSyms.length < 8) { setCmpSyms(p => [...p, cmpInput]); setCmpInput(""); } }}
              style={{ fontSize: 11, padding: "4px 10px", border: "1px solid #ddd", borderRadius: 6, background: "#f5f5f5", cursor: "pointer" }}>+ Add</button>
            <span style={{ width: 1, height: 16, background: "#e0e0e0" }} />
            {["3mo","6mo","1y","2y"].map(r => (
              <button key={r} onClick={() => { setCmpRange(r); setCmpData({}); }}
                style={{ fontSize: 10, padding: "3px 8px", border: "1px solid #ddd", borderRadius: 6, background: cmpRange === r ? "#f0f0f0" : "transparent", color: cmpRange === r ? "#222" : "#888", cursor: "pointer" }}>{r.toUpperCase()}</button>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
            {cmpSyms.map((s, i) => (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, padding: "3px 8px", borderRadius: 20, border: `1px solid ${CMP_COLORS[i % CMP_COLORS.length]}`, color: CMP_COLORS[i % CMP_COLORS.length] }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: CMP_COLORS[i % CMP_COLORS.length], display: "inline-block" }} />
                {s}
                <span onClick={() => { setCmpSyms(p => p.filter(x => x !== s)); setCmpData(p => { const n = { ...p }; delete n[s]; return n; }); }} style={{ cursor: "pointer", color: "#ccc", marginLeft: 2 }}>×</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 9, color: "#bbb", marginBottom: 8 }}>% return from start of period (normalized to 0%)</div>
          {cmpLoading && <div style={{ fontSize: 11, color: "#aaa", padding: "20px 0" }}>Loading...</div>}
          <div style={{ position: "relative", height: 300 }}>
            <Line data={cmpChartData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y >= 0 ? "+" : ""}${ctx.parsed.y.toFixed(2)}%` } } }, scales: { x: { grid: { color: "rgba(0,0,0,0.04)" }, ticks: { font: { size: 9 }, maxTicksLimit: 8 } }, y: { grid: { color: "rgba(0,0,0,0.04)" }, ticks: { font: { size: 9 }, callback: v => (v >= 0 ? "+" : "") + v + "%" } } } }} />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {cmpSyms.map((s, i) => {
              const cs = cmpData[s]; if (!cs || !cs.length) return null;
              const ret = ((cs[cs.length - 1].c / cs[0].c - 1) * 100).toFixed(2);
              return (
                <div key={s} style={{ padding: "6px 12px", border: "1px solid #eee", borderRadius: 8, minWidth: 80 }}>
                  <div style={{ fontSize: 9, fontWeight: 600, color: CMP_COLORS[i % CMP_COLORS.length] }}>{s}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: +ret >= 0 ? UP : DN }}>{+ret >= 0 ? "+" : ""}{ret}%</div>
                  <div style={{ fontSize: 8, color: "#aaa" }}>${cs[cs.length - 1].c.toFixed(2)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
