import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import dnlLogo from "./assets/dnl-logo.jpg";

/* =========================================================================
   PB71 DNL DRAFT NIGHT — Live Paddle Auction edition
   Three platforms: Public View, Auctioneer View (phone), Control Room (laptop).
   Players go up one at a time; captains bid live in person with paddles;
   the auctioneer confirms the winning team; Control Room enters the price.
   ========================================================================= */

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const C = {
  bg: "#F0F5EE",
  card: "#FFFFFF",
  ink: "#132D55",
  inkSoft: "#5A6B84",
  navy: "#132D55",
  navyDark: "#0B1B35",
  teal: "#1CA686",
  tealDark: "#128267",
  tealSoft: "#D6F2EA",
  lime: "#A8E305",
  limeDark: "#7FB000",
  limeSoft: "#EEF8D0",
  cyan: "#01D9C0",
  cyanDark: "#00A392",
  cyanSoft: "#D2F7F1",
  pink: "#FE00BC",
  pinkDark: "#C4008F",
  pinkSoft: "#FFDCF3",
  black: "#0A0A0C",
};

const BID_SECONDS = 120; // 2:00 per player
const SOLD_ANIMATION_MS = 2000;

const CATEGORY_DEFS = [
  { id: "c1", name: "Men's Category 1" },
  { id: "c2", name: "Men's Category 2" },
  { id: "c3", name: "Men's Category 3" },
  { id: "c4", name: "Men's Category 4" },
  { id: "c5", name: "Men's Category 5" },
  { id: "c6", name: "Men's Category 6" },
  { id: "c7", name: "Men's Category 7" },
  { id: "c8", name: "Women's Category 1" },
  { id: "c9", name: "Women's Category 2" },
  { id: "c10", name: "Masters — Kings" },
  { id: "c11", name: "Masters — Queens" },
];
const CATEGORY_ORDER = CATEGORY_DEFS.map((c) => c.id);

const DEFAULT_CONFIG = {
  startingWallet: 150000,
  bidRounding: 1000,
  categoryNames: Object.fromEntries(CATEGORY_DEFS.map((c) => [c.id, c.name])),
  categoryReserves: Object.fromEntries(CATEGORY_DEFS.map((c) => [c.id, 5000])),
  categoryOrder: CATEGORY_ORDER,
  adminCode: "DNL2026",
  auctioneerCode: "AUCT2026",
};

const EMPTY_ROUND = {
  categoryId: null,
  categoryQueue: [], // player IDs left to sell in this category, front = current player
  phase: "idle", // idle | bidding | awaiting-price | sold-animation | complete
  timerEndsAt: null,
  confirmedWinnerCaptainId: null,
  categoryPlayersWonIds: [],
  soldAnimationUntil: null,
  soldInfo: null, // { playerId, captainId, price, wasNoBid }
  lastSale: null, // { playerId, captainId, price, categoryId, queueBeforeSale, wasNoBid } - for undo
};

const K = { config: "dnl-config", captains: "dnl-captains", players: "dnl-players", round: "dnl-round", log: "dnl-log" };

/* ---------------------------- storage helpers ---------------------------- */

async function readKey(key, fallback) {
  try {
    const { data, error } = await supabase.from("dnl_kv").select("value").eq("key", key).maybeSingle();
    if (error || !data) return fallback;
    return data.value;
  } catch (e) { return fallback; }
}
async function writeKey(key, value) {
  try {
    if (value === null) { const { error } = await supabase.from("dnl_kv").delete().eq("key", key); return !error; }
    const { error } = await supabase.from("dnl_kv").upsert({ key, value }, { onConflict: "key" });
    return !error;
  } catch (e) { return false; }
}

/* --------------------------------- utils --------------------------------- */

function money(n) { return (n ?? 0).toLocaleString("en-US"); }
function usePoll(fn, deps, intervalMs) {
  useEffect(() => { fn(); const t = setInterval(fn, intervalMs); return () => clearInterval(t); }, deps); // eslint-disable-line
}
function findNextCategoryId(config, players) {
  return config.categoryOrder.find((cid) => players.filter((p) => p.categoryId === cid).some((p) => p.status === "available"));
}
function useNow(intervalMs = 250) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(t); }, [intervalMs]);
  return now;
}

/* ------------------------------ clay styling ------------------------------ */

const shadowCard = "9px 9px 20px rgba(19,45,85,0.12), -7px -7px 16px rgba(255,255,255,0.9)";
const shadowCardSoft = "6px 6px 14px rgba(19,45,85,0.08), -5px -5px 12px rgba(255,255,255,0.9)";
const shadowInset = "inset 4px 4px 8px rgba(19,45,85,0.08), inset -3px -3px 6px rgba(255,255,255,0.8)";
const btnShadow = (dark) => `0 6px 0 ${dark}, 0 12px 22px rgba(19,45,85,0.18)`;

function clayCardStyle(extra = {}) { return { background: C.card, borderRadius: 26, boxShadow: shadowCard, ...extra }; }
function topRibbon(color) { return { height: 9, borderRadius: "26px 26px 0 0", background: color, marginBottom: -1 }; }

const GlobalStyle = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,700&display=swap');
    * { font-family: 'Poppins', sans-serif; box-sizing: border-box; }
    body { margin: 0; }
    @keyframes popin { from { opacity:0; transform: scale(0.9) translateY(6px);} to {opacity:1; transform: scale(1) translateY(0);} }
    @keyframes pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); } }
    @keyframes soldPop { 0% { opacity:0; transform: scale(0.5) rotate(-4deg);} 60% { opacity:1; transform: scale(1.12) rotate(2deg);} 100% { opacity:1; transform: scale(1) rotate(0deg);} }
    .popin { animation: popin 0.3s ease-out both; }
    .pulseUrgent { animation: pulse 0.6s ease-in-out infinite; }
    .soldPop { animation: soldPop 0.5s cubic-bezier(.34,1.56,.64,1) both; }
    input, select, textarea { font-family: 'Poppins', sans-serif; }
  `}</style>
);

function ClayInput(props) {
  return <input {...props} style={{ width: "100%", padding: "13px 16px", borderRadius: 16, border: "none", background: C.bg, color: C.ink, fontSize: 16, outline: "none", boxShadow: shadowInset, ...(props.style || {}) }} />;
}
function ClaySelect({ children, ...props }) {
  return <select {...props} style={{ width: "100%", padding: "13px 16px", borderRadius: 16, border: "none", background: C.bg, color: C.ink, fontSize: 16, outline: "none", boxShadow: shadowInset, ...(props.style || {}) }}>{children}</select>;
}
function ClayButton({ children, color = C.lime, darkShadow = C.limeDark, text = C.black, onClick, disabled, style }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ padding: "16px 20px", borderRadius: 999, border: "none", cursor: disabled ? "default" : "pointer", background: color, color: text, fontWeight: 800, fontSize: 16, boxShadow: disabled ? "none" : btnShadow(darkShadow), opacity: disabled ? 0.45 : 1, transition: "transform 0.08s ease", ...style }}
      onMouseDown={(e) => { if (!disabled) e.currentTarget.style.transform = "translateY(3px)"; }}
      onMouseUp={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}>
      {children}
    </button>
  );
}
function Chip({ children, bg, fg = C.ink }) {
  return <span style={{ background: bg, color: fg, borderRadius: 999, padding: "5px 14px", fontSize: 12, fontWeight: 700, display: "inline-block" }}>{children}</span>;
}
function playerStatsText(p) {
  const parts = [];
  if (p.singlesDupr != null) parts.push(`S ${Number(p.singlesDupr).toFixed(3)}`);
  if (p.doublesDupr != null) parts.push(`D ${Number(p.doublesDupr).toFixed(3)}`);
  if (p.winLoss) parts.push(p.winLoss);
  return parts.join("  ·  ");
}
function PlayerStatChips({ player, size = "normal" }) {
  const pad = size === "small" ? "4px 11px" : "5px 14px";
  const fontSize = size === "small" ? 11 : 12;
  const chips = [];
  if (player.singlesDupr != null) chips.push(<span key="s" style={{ background: C.cyanSoft, color: C.cyanDark, borderRadius: 999, padding: pad, fontSize, fontWeight: 700 }}>Singles {Number(player.singlesDupr).toFixed(3)}</span>);
  if (player.doublesDupr != null) chips.push(<span key="d" style={{ background: C.tealSoft, color: C.tealDark, borderRadius: 999, padding: pad, fontSize, fontWeight: 700 }}>Doubles {Number(player.doublesDupr).toFixed(3)}</span>);
  if (player.winLoss) chips.push(<span key="w" style={{ background: C.limeSoft, color: C.limeDark, borderRadius: 999, padding: pad, fontSize, fontWeight: 700 }}>{player.winLoss} W-L</span>);
  if (chips.length === 0) return null;
  return <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>{chips}</div>;
}
function TextLink({ children, onClick }) {
  return <button onClick={onClick} style={{ background: "none", border: "none", color: C.inkSoft, cursor: "pointer", fontSize: 14, padding: 8, fontWeight: 600 }}>{children}</button>;
}
function UndoButton({ lastSale, teamName, onUndo }) {
  const [confirming, setConfirming] = useState(false);
  if (!lastSale) return null;
  return confirming ? (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 13, color: C.pinkDark, fontWeight: 700 }}>Undo the sale to {teamName(lastSale.captainId)}?</span>
      <button onClick={() => { onUndo(); setConfirming(false); }} style={{ padding: "8px 14px", borderRadius: 999, background: C.pink, color: "#fff", border: "none", cursor: "pointer", fontWeight: 700 }}>Yes, undo</button>
      <button onClick={() => setConfirming(false)} style={{ padding: "8px 14px", borderRadius: 999, background: C.bg, color: C.ink, border: "none", cursor: "pointer", fontWeight: 700 }}>Cancel</button>
    </div>
  ) : (
    <TextLink onClick={() => setConfirming(true)}>↺ Undo last sale ({teamName(lastSale.captainId)})</TextLink>
  );
}

function CountdownRing({ endsAt, total = BID_SECONDS, size = 120 }) {
  const now = useNow();
  const remaining = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const frac = Math.max(0, Math.min(1, (endsAt - now) / (total * 1000)));
  const r = size / 2 - 10;
  const circ = 2 * Math.PI * r;
  const urgent = remaining <= 10;
  return (
    <div className={urgent ? "pulseUrgent" : ""} style={{ position: "relative", width: size, height: size, borderRadius: "50%", background: C.card, boxShadow: shadowCard }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)", position: "absolute", inset: 0 }}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={C.bg} strokeWidth="9" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={urgent ? C.pink : C.teal} strokeWidth="9" fill="none" strokeDasharray={circ} strokeDashoffset={circ * (1 - frac)} strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.25s linear" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.26, fontWeight: 900, color: urgent ? C.pink : C.ink }}>
        {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
      </div>
    </div>
  );
}

const labelStyle = { fontSize: 12, textTransform: "uppercase", letterSpacing: 1, color: C.teal, fontWeight: 700, marginTop: 2 };

/* --------------------------------- App ----------------------------------- */

export default function App() {
  const [role, setRole] = useState(null); // null | public | auctioneer | control
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [captains, setCaptains] = useState([]);
  const [players, setPlayers] = useState([]);
  const [round, setRound] = useState(EMPTY_ROUND);
  const [log, setLog] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const pollAll = useCallback(async () => {
    const [cfg, caps, plys, rnd, lg] = await Promise.all([
      readKey(K.config, DEFAULT_CONFIG), readKey(K.captains, []), readKey(K.players, []), readKey(K.round, EMPTY_ROUND), readKey(K.log, []),
    ]);
    const normalizedRound = { ...EMPTY_ROUND, ...rnd, categoryQueue: rnd.categoryQueue || [], categoryPlayersWonIds: rnd.categoryPlayersWonIds || [] };
    setConfig(cfg); setCaptains(caps); setPlayers(plys); setRound(normalizedRound); setLog(lg); setLoaded(true);
  }, []);
  usePoll(pollAll, [pollAll], 1200);

  const persistConfig = async (v) => { setConfig(v); await writeKey(K.config, v); };
  const persistCaptains = async (v) => { setCaptains(v); await writeKey(K.captains, v); };
  const persistPlayers = async (v) => { setPlayers(v); await writeKey(K.players, v); };
  const persistRound = async (v) => { setRound(v); await writeKey(K.round, v); };
  const persistLog = async (v) => { setLog(v); await writeKey(K.log, v); };

  const teamName = (capId) => { const c = captains.find((x) => x.id === capId); return c ? `${c.teamName} (${c.name})` : "—"; };

  const undoLastSale = async () => {
    const sale = round.lastSale;
    if (!sale) return;
    const newPlayers = players.map((p) => (p.id === sale.playerId ? { ...p, status: "available", winnerCaptainId: null, finalPrice: null } : p));
    const newCaptains = captains.map((c) => (c.id === sale.captainId ? { ...c, wallet: c.wallet + sale.price, roster: (c.roster || []).filter((r) => r.playerId !== sale.playerId) } : c));
    const wonInCategory = newPlayers.filter((p) => p.categoryId === sale.categoryId && p.status === "won").map((p) => p.winnerCaptainId);
    await persistPlayers(newPlayers);
    await persistCaptains(newCaptains);
    await persistLog([...log, { ts: Date.now(), type: "undo", captainId: sale.captainId, playerId: sale.playerId, price: sale.price }]);
    await persistRound({
      ...round, categoryId: sale.categoryId, categoryQueue: sale.queueBeforeSale, phase: "bidding",
      timerEndsAt: Date.now() + BID_SECONDS * 1000, confirmedWinnerCaptainId: null,
      categoryPlayersWonIds: wonInCategory, soldAnimationUntil: null, soldInfo: null, lastSale: null,
    });
  };

  if (!loaded) {
    return <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}><GlobalStyle /><div style={{ color: C.teal, fontSize: 20, fontWeight: 800 }}>Loading DNL auction…</div></div>;
  }
  if (!role) {
    return <RoleSelector config={config} onPublic={() => setRole("public")} onAuctioneer={() => setRole("auctioneer")} onControl={() => setRole("control")} />;
  }
  if (role === "public") {
    return <PublicDisplay config={config} captains={captains} players={players} round={round} teamName={teamName} onExit={() => setRole(null)} />;
  }
  if (role === "auctioneer") {
    return <AuctioneerView config={config} captains={captains} players={players} round={round} persistRound={persistRound} persistPlayers={persistPlayers} persistCaptains={persistCaptains} persistLog={persistLog} log={log} teamName={teamName} undoLastSale={undoLastSale} onExit={() => setRole(null)} />;
  }
  if (role === "control") {
    return <ControlRoom config={config} persistConfig={persistConfig} captains={captains} persistCaptains={persistCaptains} players={players} persistPlayers={persistPlayers} round={round} persistRound={persistRound} log={log} persistLog={persistLog} teamName={teamName} undoLastSale={undoLastSale} onExit={() => setRole(null)} />;
  }
  return null;
}

/* ----------------------------- Role Selector ------------------------------ */

function RoleSelector({ config, onPublic, onAuctioneer, onControl }) {
  const [mode, setMode] = useState(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const tryEnter = (expected, action) => {
    if (code.trim() !== String(expected)) { setError("Wrong code."); return; }
    action();
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg }}>
      <GlobalStyle />
      <div style={{ maxWidth: 440, margin: "0 auto", padding: "36px 20px" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
          <img src={dnlLogo} alt="DNL" style={{ height: 130, borderRadius: 24, boxShadow: shadowCard }} />
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.teal, textAlign: "center", letterSpacing: 1 }}>PB71</div>
        <div style={{ fontSize: 26, fontWeight: 900, color: C.ink, textAlign: "center", marginBottom: 28 }}>DNL Draft Night</div>

        {!mode && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <ClayButton color={C.teal} darkShadow={C.tealDark} text="#fff" onClick={onPublic}>Public View</ClayButton>
            <ClayButton color={C.pink} darkShadow={C.pinkDark} text="#fff" onClick={() => { setMode("auctioneer"); setError(""); }}>Auctioneer View</ClayButton>
            <ClayButton color={C.card} darkShadow="#D8DED4" text={C.ink} onClick={() => { setMode("control"); setError(""); }}>Control Room</ClayButton>
          </div>
        )}
        {mode === "auctioneer" && (
          <div className="popin" style={{ ...clayCardStyle(), padding: 22, display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={labelStyle}>Auctioneer code</label>
            <ClayInput type="password" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Enter code" />
            {error && <div style={{ color: C.pink, fontSize: 13, fontWeight: 600 }}>{error}</div>}
            <ClayButton color={C.lime} darkShadow={C.limeDark} onClick={() => tryEnter(config.auctioneerCode, onAuctioneer)}>Enter</ClayButton>
            <TextLink onClick={() => setMode(null)}>← back</TextLink>
          </div>
        )}
        {mode === "control" && (
          <div className="popin" style={{ ...clayCardStyle(), padding: 22, display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={labelStyle}>Control Room code</label>
            <ClayInput type="password" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Enter code" />
            {error && <div style={{ color: C.pink, fontSize: 13, fontWeight: 600 }}>{error}</div>}
            <ClayButton color={C.lime} darkShadow={C.limeDark} onClick={() => tryEnter(config.adminCode, onControl)}>Enter</ClayButton>
            <TextLink onClick={() => setMode(null)}>← back</TextLink>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ Public View -------------------------------- */

function PublicDisplay({ config, captains, players, round, teamName, onExit }) {
  const catId = round.categoryId;
  const catName = catId ? config.categoryNames[catId] : null;
  const catPlayers = catId ? players.filter((p) => p.categoryId === catId) : [];
  const currentPlayer = catId ? players.find((p) => p.id === (round.categoryQueue || [])[0]) : null;
  const soldCount = (round.categoryPlayersWonIds || []).length;
  const basePrice = catId ? config.categoryReserves[catId] : null;

  return (
    <div style={{ minHeight: "100vh", background: C.bg }}>
      <GlobalStyle />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src={dnlLogo} alt="DNL" style={{ height: 46, borderRadius: 12, boxShadow: shadowCardSoft }} />
          <div style={{ fontWeight: 900, fontSize: 20, color: C.ink }}>PB71 DNL Draft Night</div>
        </div>
        <TextLink onClick={onExit}>exit</TextLink>
      </div>

      <div style={{ padding: "0 28px 10px", textAlign: "center" }}>
        {round.phase === "idle" && (
          <div style={{ padding: "70px 0" }}>
            <div style={{ fontSize: 40, fontWeight: 900, color: C.teal }}>Waiting for the auction to begin</div>
          </div>
        )}
        {round.phase === "complete" && (
          <div style={{ padding: "70px 0" }}>
            <div style={{ fontSize: 44, fontWeight: 900, color: C.tealDark }}>AUCTION COMPLETE</div>
            <div style={{ color: C.inkSoft, marginTop: 8 }}>All 66 players have been drafted.</div>
          </div>
        )}

        {catId && round.phase !== "idle" && round.phase !== "complete" && (
          <>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.teal, letterSpacing: 1, textTransform: "uppercase" }}>{catName}</div>
            {basePrice != null && (
              <div style={{ marginTop: 8 }}><Chip bg={C.navy} fg="#fff">Base Price: {money(basePrice)}</Chip></div>
            )}

            {round.phase === "sold-animation" && round.soldInfo ? (
              <div className="soldPop" style={{ padding: "30px 0" }}>
                <div style={{ fontSize: 64, fontWeight: 900, color: C.pinkDark, letterSpacing: 2 }}>SOLD!</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: C.ink, marginTop: 4 }}>{players.find((p) => p.id === round.soldInfo.playerId)?.name}</div>
                <div style={{ display: "inline-block", marginTop: 16 }}>
                  <Chip bg={C.limeSoft} fg={C.limeDark}>{teamName(round.soldInfo.captainId)}</Chip>
                </div>
                <div style={{ fontSize: 30, fontWeight: 900, color: C.tealDark, marginTop: 12 }}>{money(round.soldInfo.price)}</div>
                {round.soldInfo.wasNoBid && <div style={{ marginTop: 8 }}><Chip bg={C.pinkSoft} fg={C.pinkDark}>No bids — randomly assigned</Chip></div>}
              </div>
            ) : round.phase === "awaiting-price" ? (
              currentPlayer && (
                <div style={{ padding: "24px 0" }}>
                  <div style={{ fontSize: 46, fontWeight: 900, color: C.ink }}>{currentPlayer.name}</div>
                  <div style={{ marginTop: 18 }}><Chip bg={C.pinkSoft} fg={C.pinkDark}>FINALIZING SALE…</Chip></div>
                  <div style={{ fontSize: 13, color: C.inkSoft, marginTop: 10 }}>Player {soldCount + 1} of {catPlayers.length}</div>
                </div>
              )
            ) : (
              currentPlayer && (
                <div style={{ padding: "24px 0" }}>
                  <div style={{ fontSize: 46, fontWeight: 900, color: C.ink }}>{currentPlayer.name}</div>
                  {currentPlayer.duprRating != null && (
                    <div style={{ marginTop: 4 }}><Chip bg={C.cyanSoft} fg={C.cyanDark}>DUPR {Number(currentPlayer.duprRating).toFixed(3)}</Chip></div>
                  )}
                  <div style={{ marginTop: 10 }}><PlayerStatChips player={currentPlayer} /></div>
                  <div style={{ display: "flex", justifyContent: "center", marginTop: 22 }}>
                    <CountdownRing endsAt={round.timerEndsAt} size={130} />
                  </div>
                  <div style={{ fontSize: 13, color: C.inkSoft, marginTop: 10 }}>Player {soldCount + 1} of {catPlayers.length}</div>
                </div>
              )
            )}
          </>
        )}
      </div>

      <Scoreboard captains={captains} players={players} />
    </div>
  );
}

function Scoreboard({ captains, players }) {
  return (
    <div style={{ marginTop: 10, padding: "18px 28px 30px" }}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(captains.length, 1)},1fr)`, gap: 12, alignItems: "start" }}>
        {captains.map((c) => (
          <div key={c.id} style={clayCardStyle({ padding: 12, textAlign: "center" })}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.teal }}>{c.teamName}</div>
            <div style={{ fontSize: 11, color: C.inkSoft }}>{c.name}</div>
            <div style={{ fontSize: 12, color: C.inkSoft, marginTop: 2 }}>{c.roster?.length || 0}/11 players</div>
            <div style={{ fontSize: 15, fontWeight: 900, color: C.ink }}>{money(c.wallet)}</div>
            {(c.roster || []).length > 0 && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.bg}`, textAlign: "left" }}>
                {c.roster.map((r, i) => {
                  const p = players.find((pl) => pl.id === r.playerId);
                  return <div key={i} style={{ fontSize: 10.5, color: C.ink, lineHeight: 1.5 }}>{p?.name || "—"}</div>;
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ----------------------------- Auctioneer View ----------------------------- */

function AuctioneerView({ config, captains, players, round, persistRound, persistPlayers, persistCaptains, persistLog, log, teamName, undoLastSale, onExit }) {
  const [selectedTeam, setSelectedTeam] = useState(null);
  const now = useNow();

  useEffect(() => { setSelectedTeam(null); }, [round.categoryId, round.categoryQueue?.[0]]);

  const catId = round.categoryId;
  const catPlayers = catId ? players.filter((p) => p.categoryId === catId) : [];
  const queue = round.categoryQueue || [];
  const currentPlayer = catId ? players.find((p) => p.id === queue[0]) : null;
  const catName = catId ? config.categoryNames[catId] : null;
  const wonTeamIds = round.categoryPlayersWonIds || [];
  const soldCount = wonTeamIds.length;
  const animationDone = !round.soldAnimationUntil || now >= round.soldAnimationUntil;

  const confirmWinner = async () => {
    if (!selectedTeam) return;
    await persistRound({ ...round, confirmedWinnerCaptainId: selectedTeam, phase: "awaiting-price" });
  };
  const cancelConfirm = async () => {
    await persistRound({ ...round, confirmedWinnerCaptainId: null, phase: "bidding" });
  };
  const skipForNow = async () => {
    if (queue.length <= 1 || !currentPlayer) return; // nothing to requeue behind if only one left
    const requeued = [...queue.slice(1), queue[0]];
    await persistRound({ ...round, categoryQueue: requeued, phase: "bidding", timerEndsAt: Date.now() + BID_SECONDS * 1000, confirmedWinnerCaptainId: null });
  };
  const skipNoBids = async () => {
    const eligible = captains.filter((c) => !wonTeamIds.includes(c.id));
    if (eligible.length === 0 || !currentPlayer) return;
    const winner = eligible[Math.floor(Math.random() * eligible.length)];
    const price = config.categoryReserves[catId] ?? 0;
    const newPlayers = players.map((p) => (p.id === currentPlayer.id ? { ...p, status: "won", winnerCaptainId: winner.id, finalPrice: price } : p));
    const newCaptains = captains.map((c) => (c.id === winner.id ? { ...c, wallet: c.wallet - price, roster: [...(c.roster || []), { playerId: currentPlayer.id, categoryId: catId, price }] } : c));
    await persistPlayers(newPlayers);
    await persistCaptains(newCaptains);
    await persistLog([...log, { ts: Date.now(), type: "no-bid-random", captainId: winner.id, playerId: currentPlayer.id, price }]);
    await persistRound({
      ...round, categoryQueue: queue.slice(1), confirmedWinnerCaptainId: winner.id, categoryPlayersWonIds: [...wonTeamIds, winner.id],
      phase: "sold-animation", soldAnimationUntil: Date.now() + SOLD_ANIMATION_MS,
      soldInfo: { playerId: currentPlayer.id, captainId: winner.id, price, wasNoBid: true },
      lastSale: { playerId: currentPlayer.id, captainId: winner.id, price, categoryId: catId, queueBeforeSale: queue, wasNoBid: true },
    });
  };
  const nextPlayerOrCategory = async () => {
    if (queue.length > 0) {
      await persistRound({ ...round, phase: "bidding", timerEndsAt: Date.now() + BID_SECONDS * 1000, confirmedWinnerCaptainId: null, soldAnimationUntil: null, soldInfo: null });
    } else {
      const nextCat = findNextCategoryId(config, players);
      if (nextCat) {
        const nextQueue = players.filter((p) => p.categoryId === nextCat && p.status === "available").map((p) => p.id);
        await persistRound({ ...round, categoryId: nextCat, categoryQueue: nextQueue, phase: "bidding", timerEndsAt: Date.now() + BID_SECONDS * 1000, confirmedWinnerCaptainId: null, categoryPlayersWonIds: [], soldAnimationUntil: null, soldInfo: null });
      } else {
        await persistRound({ ...round, phase: "complete" });
      }
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg }}>
      <GlobalStyle />
      <div style={{ padding: "14px 18px", ...clayCardStyle(), margin: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 900, fontSize: 17, color: C.ink }}>Auctioneer View</div>
        <TextLink onClick={onExit}>exit</TextLink>
      </div>

      <div style={{ padding: "0 16px 24px", maxWidth: 480, margin: "0 auto" }}>
        {round.phase === "idle" && <div style={{ textAlign: "center", padding: "50px 0", color: C.teal, fontSize: 20, fontWeight: 800 }}>Waiting for Control Room to push the first category…</div>}
        {round.phase === "complete" && <div style={{ textAlign: "center", padding: "50px 0", color: C.tealDark, fontSize: 20, fontWeight: 800 }}>All categories complete!</div>}

        {currentPlayer && round.phase === "bidding" && (
          <div>
            <Chip bg={C.pinkSoft} fg={C.pinkDark}>{catName} — Player {soldCount + 1}/{catPlayers.length}</Chip>
            <div style={{ fontSize: 24, fontWeight: 900, color: C.ink, margin: "10px 0 2px" }}>{currentPlayer.name}</div>
            {currentPlayer.duprRating != null && <div style={{ fontSize: 13, color: C.inkSoft, marginBottom: 10 }}>DUPR {Number(currentPlayer.duprRating).toFixed(3)}</div>}
            {(currentPlayer.singlesDupr != null || currentPlayer.doublesDupr != null) && (
              <div style={{ fontSize: 13, color: C.inkSoft, marginBottom: 10 }}>
                {currentPlayer.singlesDupr != null && <>Singles {Number(currentPlayer.singlesDupr).toFixed(3)}</>}
                {currentPlayer.singlesDupr != null && currentPlayer.doublesDupr != null && "  ·  "}
                {currentPlayer.doublesDupr != null && <>Doubles {Number(currentPlayer.doublesDupr).toFixed(3)}</>}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "center", margin: "12px 0 18px" }}><CountdownRing endsAt={round.timerEndsAt} size={90} /></div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {captains.map((c) => {
                const disabled = wonTeamIds.includes(c.id);
                const selected = selectedTeam === c.id;
                return (
                  <button key={c.id} disabled={disabled} onClick={() => setSelectedTeam(c.id)}
                    style={{ textAlign: "left", padding: "13px 16px", borderRadius: 16, fontSize: 15, fontWeight: 700, cursor: disabled ? "default" : "pointer", border: "none",
                      background: disabled ? "#EDEDE8" : selected ? C.lime : C.card, color: disabled ? C.inkSoft : C.ink, opacity: disabled ? 0.6 : 1,
                      boxShadow: disabled ? "none" : selected ? shadowInset : shadowCardSoft }}>
                    {c.teamName} <span style={{ opacity: 0.7, fontWeight: 500 }}>({c.name})</span>{disabled && "  ✓ already won"}
                  </button>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <ClayButton color={C.lime} darkShadow={C.limeDark} disabled={!selectedTeam} onClick={confirmWinner} style={{ flex: 1 }}>Confirm</ClayButton>
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 10, flexWrap: "wrap" }}>
              {queue.length > 1 && <TextLink onClick={skipForNow}>Skip for now — come back later</TextLink>}
              <TextLink onClick={skipNoBids}>No bids at all — randomly assign</TextLink>
            </div>
          </div>
        )}

        {round.phase === "awaiting-price" && (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.ink }}>Waiting for Control Room</div>
            <div style={{ color: C.inkSoft, marginTop: 6, fontSize: 14 }}>Entering the winning price for<br /><b>{teamName(round.confirmedWinnerCaptainId)}</b></div>
            <div style={{ marginTop: 14 }}><TextLink onClick={cancelConfirm}>Wrong team? Cancel and reselect</TextLink></div>
          </div>
        )}

        {round.phase === "sold-animation" && round.soldInfo && (
          <div style={{ textAlign: "center", padding: "30px 0" }}>
            <div className="soldPop" style={{ fontSize: 34, fontWeight: 900, color: C.pinkDark }}>SOLD!</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.ink, marginTop: 6 }}>{players.find((p) => p.id === round.soldInfo.playerId)?.name}</div>
            <div style={{ display: "inline-block", marginTop: 10 }}>
              <Chip bg={C.limeSoft} fg={C.limeDark}>{teamName(round.soldInfo.captainId)}</Chip>
            </div>
            <div style={{ fontSize: 20, fontWeight: 900, color: C.tealDark, marginTop: 8 }}>{money(round.soldInfo.price)}</div>
            {round.soldInfo.wasNoBid && <div style={{ marginTop: 8 }}><Chip bg={C.pinkSoft} fg={C.pinkDark}>No bids — randomly assigned</Chip></div>}
            <div style={{ marginTop: 18 }}>
              <ClayButton color={C.lime} darkShadow={C.limeDark} disabled={!animationDone} onClick={nextPlayerOrCategory}>
                {queue.length === 0 ? "Next Category" : "Next Player"}
              </ClayButton>
            </div>
          </div>
        )}

        <div style={{ marginTop: 26, textAlign: "center" }}>
          <UndoButton lastSale={round.lastSale} teamName={teamName} onUndo={undoLastSale} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Control Room ------------------------------ */

function ControlRoom(props) {
  const { config, persistConfig, captains, persistCaptains, players, persistPlayers, round, persistRound, log, persistLog, teamName, undoLastSale, onExit } = props;
  const [tab, setTab] = useState("live");

  return (
    <div style={{ minHeight: "100vh", background: C.bg }}>
      <GlobalStyle />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src={dnlLogo} alt="DNL" style={{ height: 38, borderRadius: 10, boxShadow: shadowCardSoft }} />
          <div style={{ fontWeight: 900, fontSize: 18, color: C.ink }}>Control Room</div>
        </div>
        <TextLink onClick={onExit}>exit</TextLink>
      </div>
      <div style={{ display: "flex", gap: 8, padding: "6px 14px 14px", flexWrap: "wrap" }}>
        {["live", "setup", "overview"].map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: "9px 18px", borderRadius: 999, fontSize: 13, fontWeight: 800, cursor: "pointer", border: "none", background: tab === t ? C.navy : C.card, color: tab === t ? "#fff" : C.ink, boxShadow: tab === t ? btnShadow(C.navyDark) : shadowCardSoft }}>
            {t === "live" ? "Live Auction" : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <div style={{ padding: "0 16px 24px", maxWidth: 900, margin: "0 auto" }}>
        {tab === "live" && <LiveAuctionTab config={config} captains={captains} players={players} round={round} persistRound={persistRound} persistPlayers={persistPlayers} persistCaptains={persistCaptains} log={log} persistLog={persistLog} teamName={teamName} undoLastSale={undoLastSale} />}
        {tab === "setup" && <SetupTab config={config} persistConfig={persistConfig} captains={captains} persistCaptains={persistCaptains} players={players} persistPlayers={persistPlayers} />}
        {tab === "overview" && <OverviewTab config={config} captains={captains} players={players} log={log} />}
      </div>
    </div>
  );
}

function LiveAuctionTab({ config, captains, players, round, persistRound, persistPlayers, persistCaptains, log, persistLog, teamName, undoLastSale }) {
  const [priceInput, setPriceInput] = useState("");
  const [manualCat, setManualCat] = useState("");
  const [assignPlayer, setAssignPlayer] = useState("");
  const [assignCaptain, setAssignCaptain] = useState("");
  const [assignPrice, setAssignPrice] = useState("");
  const [walletEditCap, setWalletEditCap] = useState("");
  const [walletEditVal, setWalletEditVal] = useState("");
  const now = useNow();

  const catId = round.categoryId;
  const catName = catId ? config.categoryNames[catId] : null;
  const catPlayers = catId ? players.filter((p) => p.categoryId === catId) : [];
  const queue = round.categoryQueue || [];
  const currentPlayer = catId ? players.find((p) => p.id === queue[0]) : null;
  const wonTeamIds = round.categoryPlayersWonIds || [];
  const animationDone = !round.soldAnimationUntil || now >= round.soldAnimationUntil;

  useEffect(() => { setPriceInput(catId ? String(config.categoryReserves[catId] ?? "") : ""); }, [round.categoryQueue?.[0], round.categoryId, round.phase]); // eslint-disable-line

  const pushCategory = async (categoryId) => {
    if (!categoryId) return;
    const catPlayerIds = players.filter((p) => p.categoryId === categoryId && p.status === "available").map((p) => p.id);
    await persistRound({ ...round, categoryId, categoryQueue: catPlayerIds, phase: "bidding", timerEndsAt: Date.now() + BID_SECONDS * 1000, confirmedWinnerCaptainId: null, categoryPlayersWonIds: [], soldAnimationUntil: null, soldInfo: null });
  };

  const confirmPrice = async () => {
    const price = Number(priceInput);
    if (!price || price <= 0) return alert("Enter a valid price.");
    const capId = round.confirmedWinnerCaptainId;
    const newPlayers = players.map((p) => (p.id === currentPlayer.id ? { ...p, status: "won", winnerCaptainId: capId, finalPrice: price } : p));
    const newCaptains = captains.map((c) => (c.id === capId ? { ...c, wallet: c.wallet - price, roster: [...(c.roster || []), { playerId: currentPlayer.id, categoryId: catId, price }] } : c));
    await persistPlayers(newPlayers);
    await persistCaptains(newCaptains);
    await persistLog([...log, { ts: Date.now(), type: "sale", captainId: capId, playerId: currentPlayer.id, price }]);
    await persistRound({
      ...round, categoryQueue: queue.slice(1), categoryPlayersWonIds: [...wonTeamIds, capId], phase: "sold-animation", soldAnimationUntil: Date.now() + SOLD_ANIMATION_MS,
      soldInfo: { playerId: currentPlayer.id, captainId: capId, price, wasNoBid: false },
      lastSale: { playerId: currentPlayer.id, captainId: capId, price, categoryId: catId, queueBeforeSale: queue, wasNoBid: false },
    });
  };

  const forceAssign = async () => {
    if (!assignPlayer || !assignCaptain) return alert("Pick a player and a captain.");
    const price = Number(assignPrice) || 0;
    const player = players.find((p) => p.id === assignPlayer);
    const newPlayers = players.map((p) => (p.id === assignPlayer ? { ...p, status: "won", winnerCaptainId: assignCaptain, finalPrice: price } : p));
    const newCaptains = captains.map((c) => (c.id === assignCaptain ? { ...c, wallet: c.wallet - price, roster: [...(c.roster || []), { playerId: assignPlayer, categoryId: player.categoryId, price }] } : c));
    await persistPlayers(newPlayers);
    await persistCaptains(newCaptains);
    await persistLog([...log, { ts: Date.now(), type: "manual-assign", captainId: assignCaptain, playerId: assignPlayer, price }]);
    setAssignPlayer(""); setAssignCaptain(""); setAssignPrice("");
  };
  const editWallet = async () => {
    if (!walletEditCap) return;
    const val = Number(walletEditVal);
    await persistCaptains(captains.map((c) => (c.id === walletEditCap ? { ...c, wallet: val } : c)));
    await persistLog([...log, { ts: Date.now(), type: "wallet-edit", captainId: walletEditCap, newWallet: val }]);
    setWalletEditVal("");
  };

  const availablePlayers = players.filter((p) => p.status === "available");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={clayCardStyle({ padding: 18 })}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.teal, letterSpacing: 1 }}>LIVE AUCTION</div>
        {round.phase === "idle" || !catId ? (
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <ClaySelect value={manualCat} onChange={(e) => setManualCat(e.target.value)} style={{ width: "auto", minWidth: 200 }}>
              <option value="">Pick the first category…</option>
              {config.categoryOrder.map((cid) => <option key={cid} value={cid}>{config.categoryNames[cid]}</option>)}
            </ClaySelect>
            <ClayButton color={C.lime} darkShadow={C.limeDark} disabled={!manualCat} onClick={() => pushCategory(manualCat)}>Push to Public View</ClayButton>
          </div>
        ) : round.phase === "complete" ? (
          <div style={{ marginTop: 10, fontSize: 16, fontWeight: 800, color: C.tealDark }}>Auction complete — all 66 players drafted.</div>
        ) : (
          <>
            <div style={{ fontSize: 22, fontWeight: 900, color: C.ink, marginTop: 2 }}>{catName}</div>
            {currentPlayer && (
              <div style={{ fontSize: 15, color: C.inkSoft, marginBottom: 10 }}>
                Player {wonTeamIds.length + 1}/{catPlayers.length}: <b style={{ color: C.ink }}>{currentPlayer.name}</b>
                {currentPlayer.duprRating != null && <span> — DUPR {Number(currentPlayer.duprRating).toFixed(3)}</span>}
                {playerStatsText(currentPlayer) && <span> — {playerStatsText(currentPlayer)}</span>}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 8, marginTop: 8 }}>
              {captains.map((c) => {
                const isWinner = round.phase === "awaiting-price" && round.confirmedWinnerCaptainId === c.id;
                const alreadyWon = wonTeamIds.includes(c.id);
                return (
                  <div key={c.id} style={{ padding: "10px 12px", borderRadius: 14, background: isWinner ? C.limeSoft : alreadyWon ? "#EDEDE8" : C.bg, boxShadow: isWinner ? shadowCard : "none", opacity: alreadyWon && !isWinner ? 0.55 : 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>{c.teamName}</div>
                    <div style={{ fontSize: 11, color: C.inkSoft }}>{c.name}</div>
                    {isWinner && (
                      <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                        <ClayInput type="number" value={priceInput} onChange={(e) => setPriceInput(e.target.value)} style={{ padding: "8px 10px", fontSize: 14 }} />
                      </div>
                    )}
                    {alreadyWon && <div style={{ fontSize: 11, color: C.tealDark, marginTop: 4 }}>✓ won this category</div>}
                  </div>
                );
              })}
            </div>

            {round.phase === "awaiting-price" && (
              <div style={{ marginTop: 14 }}>
                <ClayButton color={C.pink} darkShadow={C.pinkDark} text="#fff" onClick={confirmPrice}>Confirm Price — Mark Sold</ClayButton>
              </div>
            )}
            {round.phase === "sold-animation" && (
              <div style={{ marginTop: 14, fontSize: 14, color: C.inkSoft }}>
                {animationDone ? "Sold animation finished — auctioneer can advance." : "Sold animation playing on Public View…"}
              </div>
            )}

            <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", borderTop: `1px solid ${C.bg}`, paddingTop: 14 }}>
              <span style={{ fontSize: 12, color: C.inkSoft, fontWeight: 700 }}>OVERRIDE — push a different category:</span>
              <ClaySelect value={manualCat} onChange={(e) => setManualCat(e.target.value)} style={{ width: "auto", minWidth: 180 }}>
                <option value="">Pick category…</option>
                {config.categoryOrder.map((cid) => <option key={cid} value={cid}>{config.categoryNames[cid]}</option>)}
              </ClaySelect>
              <button disabled={!manualCat} onClick={() => pushCategory(manualCat)} style={{ padding: "8px 14px", borderRadius: 999, background: C.pinkSoft, color: C.pinkDark, border: "none", cursor: "pointer", fontWeight: 700 }}>Push</button>
            </div>
          </>
        )}
      </div>

      <div style={clayCardStyle({ padding: 18 })}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.teal, letterSpacing: 1, marginBottom: 10 }}>UNDO</div>
        <UndoButton lastSale={round.lastSale} teamName={teamName} onUndo={undoLastSale} />
      </div>

      <div style={clayCardStyle({ padding: 18 })}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.teal, letterSpacing: 1, marginBottom: 10 }}>MANUAL OVERRIDE — FORCE ASSIGN</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <ClaySelect value={assignPlayer} onChange={(e) => setAssignPlayer(e.target.value)} style={{ width: "auto", minWidth: 180 }}>
            <option value="">Player…</option>
            {availablePlayers.map((p) => <option key={p.id} value={p.id}>{p.name} ({config.categoryNames[p.categoryId]}{p.duprRating != null ? `, DUPR ${Number(p.duprRating).toFixed(3)}` : ""}{playerStatsText(p) ? `, ${playerStatsText(p)}` : ""})</option>)}
          </ClaySelect>
          <ClaySelect value={assignCaptain} onChange={(e) => setAssignCaptain(e.target.value)} style={{ width: "auto", minWidth: 140 }}>
            <option value="">Captain…</option>
            {captains.map((c) => <option key={c.id} value={c.id}>{c.teamName}</option>)}
          </ClaySelect>
          <ClayInput placeholder="Price" type="number" value={assignPrice} onChange={(e) => setAssignPrice(e.target.value)} style={{ width: 110 }} />
          <button onClick={forceAssign} style={{ padding: "10px 16px", borderRadius: 999, background: C.lime, color: C.black, border: "none", cursor: "pointer", fontWeight: 700 }}>Assign</button>
        </div>
      </div>

      <div style={clayCardStyle({ padding: 18 })}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.teal, letterSpacing: 1, marginBottom: 10 }}>MANUAL OVERRIDE — EDIT WALLET</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <ClaySelect value={walletEditCap} onChange={(e) => setWalletEditCap(e.target.value)} style={{ width: "auto", minWidth: 200 }}>
            <option value="">Captain…</option>
            {captains.map((c) => <option key={c.id} value={c.id}>{c.teamName} (currently {money(c.wallet)})</option>)}
          </ClaySelect>
          <ClayInput placeholder="New wallet value" type="number" value={walletEditVal} onChange={(e) => setWalletEditVal(e.target.value)} style={{ width: 160 }} />
          <button onClick={editWallet} style={{ padding: "10px 16px", borderRadius: 999, background: C.lime, color: C.black, border: "none", cursor: "pointer", fontWeight: 700 }}>Set</button>
        </div>
      </div>
    </div>
  );
}

function SetupTab({ config, persistConfig, captains, persistCaptains, players, persistPlayers }) {
  const [capName, setCapName] = useState("");
  const [teamName, setTeamName] = useState("");
  const [bulk, setBulk] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [startingWalletInput, setStartingWalletInput] = useState(String(config.startingWallet));

  useEffect(() => { setStartingWalletInput(String(config.startingWallet)); }, [config.startingWallet]);

  const addCaptain = async () => {
    if (!capName || !teamName) return alert("Fill in name and team name.");
    if (captains.length >= 6) return alert("Already have 6 captains.");
    const id = "cap_" + Math.random().toString(36).slice(2, 8);
    await persistCaptains([...captains, { id, name: capName, teamName, wallet: config.startingWallet, roster: [] }]);
    setCapName(""); setTeamName("");
  };
  const removeCaptain = async (id) => persistCaptains(captains.filter((c) => c.id !== id));

  // Fix: changing starting wallet now adjusts every captain's CURRENT wallet by the
  // difference, instead of only affecting captains created afterward.
  const updateStartingWallet = async (newValueRaw) => {
    const newValue = Number(newValueRaw);
    if (isNaN(newValue)) return;
    const delta = newValue - config.startingWallet;
    await persistConfig({ ...config, startingWallet: newValue });
    if (delta !== 0 && captains.length > 0) {
      await persistCaptains(captains.map((c) => ({ ...c, wallet: c.wallet + delta })));
    }
  };

  const importPlayers = async () => {
    const lines = bulk.split("\n").map((l) => l.trim()).filter(Boolean);
    const parseFloatOrNull = (v) => { const n = parseFloat(v); return v !== undefined && v !== "" && !isNaN(n) ? n : null; };
    const newOnes = lines.map((line, i) => {
      const parts = line.split(",").map((s) => s.trim());
      const name = parts[0];
      const catNum = parseInt(parts[1], 10);
      const singlesDupr = parseFloatOrNull(parts[2]);
      const doublesDupr = parseFloatOrNull(parts[3]);
      const winLoss = parts[4] && parts[4] !== "" ? parts[4] : null;
      const categoryId = CATEGORY_ORDER[catNum - 1];
      return categoryId ? { id: "p_" + Date.now().toString(36) + "_" + i, name, categoryId, singlesDupr, doublesDupr, winLoss, status: "available", winnerCaptainId: null, finalPrice: null } : null;
    }).filter(Boolean);
    await persistPlayers([...players, ...newOnes]);
    setBulk("");
  };
  const countByCategory = (cid) => players.filter((p) => p.categoryId === cid).length;

  const resetAuction = async () => {
    await persistCaptains(captains.map((c) => ({ ...c, wallet: config.startingWallet, roster: [] })));
    await persistPlayers(players.map((p) => ({ ...p, status: "available", winnerCaptainId: null, finalPrice: null })));
    await writeKey(K.round, EMPTY_ROUND);
    await writeKey(K.log, []);
    setConfirmReset(false);
  };
  const clearAllPlayers = async () => persistPlayers([]);
  const clearAllCaptains = async () => persistCaptains([]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={clayCardStyle({ padding: 18 })}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.teal, letterSpacing: 1, marginBottom: 10 }}>CONFIG</div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <div>
            <label style={labelStyle}>Starting wallet</label>
            <ClayInput type="number" value={startingWalletInput} onChange={(e) => setStartingWalletInput(e.target.value)} onBlur={(e) => updateStartingWallet(e.target.value)} style={{ width: 150 }} />
            <div style={{ fontSize: 11, color: C.inkSoft, marginTop: 4 }}>Adjusts every captain's current wallet by the difference.</div>
          </div>
          <div>
            <label style={labelStyle}>Bid rounding</label>
            <ClayInput type="number" value={config.bidRounding} onChange={(e) => persistConfig({ ...config, bidRounding: Number(e.target.value) })} style={{ width: 100 }} />
          </div>
          <div>
            <label style={labelStyle}>Control Room code</label>
            <ClayInput value={config.adminCode} onChange={(e) => persistConfig({ ...config, adminCode: e.target.value })} style={{ width: 150 }} />
          </div>
          <div>
            <label style={labelStyle}>Auctioneer code</label>
            <ClayInput value={config.auctioneerCode} onChange={(e) => persistConfig({ ...config, auctioneerCode: e.target.value })} style={{ width: 150 }} />
          </div>
        </div>
      </div>

      <div style={clayCardStyle({ padding: 18 })}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.teal, letterSpacing: 1, marginBottom: 10 }}>CAPTAINS ({captains.length}/6)</div>
        {captains.map((c) => (
          <div key={c.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "7px 0", borderBottom: `1px solid ${C.bg}`, color: C.ink }}>
            <span>{c.teamName} — {c.name} (wallet: {money(c.wallet)})</span>
            <TextLink onClick={() => removeCaptain(c.id)}>remove</TextLink>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <ClayInput placeholder="Captain name" value={capName} onChange={(e) => setCapName(e.target.value)} style={{ width: 160 }} />
          <ClayInput placeholder="Team name" value={teamName} onChange={(e) => setTeamName(e.target.value)} style={{ width: 160 }} />
          <button onClick={addCaptain} style={{ padding: "10px 18px", borderRadius: 999, background: C.lime, color: C.black, border: "none", cursor: "pointer", fontWeight: 700 }}>Add</button>
        </div>
      </div>

      <div style={clayCardStyle({ padding: 18 })}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.teal, letterSpacing: 1, marginBottom: 10 }}>CATEGORIES & BASE (RESERVE) PRICES</div>
        <div style={{ fontSize: 11, color: C.inkSoft, marginBottom: 8 }}>This is also what gets charged when a player goes unsold and is randomly assigned.</div>
        {config.categoryOrder.map((cid) => (
          <div key={cid} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0" }}>
            <ClayInput value={config.categoryNames[cid]} onChange={(e) => persistConfig({ ...config, categoryNames: { ...config.categoryNames, [cid]: e.target.value } })} style={{ flex: 1 }} />
            <ClayInput type="number" value={config.categoryReserves[cid]} onChange={(e) => persistConfig({ ...config, categoryReserves: { ...config.categoryReserves, [cid]: Number(e.target.value) } })} style={{ width: 120 }} />
            <span style={{ fontSize: 12, color: C.inkSoft, minWidth: 70, fontWeight: 600 }}>{countByCategory(cid)}/6</span>
          </div>
        ))}
      </div>

      <div style={clayCardStyle({ padding: 18 })}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.teal, letterSpacing: 1, marginBottom: 10 }}>BULK-IMPORT PLAYERS</div>
        <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 8 }}>One per line: <code>Player Name, Category Number (1-11), Singles DUPR, Doubles DUPR, W-L Record</code> — the last three are optional, leave blank to skip.</div>
        <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={6} style={{ width: "100%", padding: "13px 16px", borderRadius: 16, border: "none", background: C.bg, color: C.ink, fontSize: 13, fontFamily: "monospace", boxShadow: shadowInset, outline: "none" }} placeholder={"Kasun Perera, 1, 4.250, 4.875, 15-3\nNimali Silva, 8, 3.875, , 9-6\n..."} />
        <div style={{ marginTop: 10 }}><button onClick={importPlayers} style={{ padding: "10px 18px", borderRadius: 999, background: C.lime, color: C.black, border: "none", cursor: "pointer", fontWeight: 700 }}>Import</button></div>
        <div style={{ fontSize: 13, marginTop: 10, color: C.inkSoft }}>{players.length} players loaded total.</div>
      </div>

      <div style={{ ...clayCardStyle({ padding: 18 }), border: `2px solid ${C.pinkSoft}` }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.pinkDark, letterSpacing: 1, marginBottom: 10 }}>DANGER ZONE</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <button onClick={clearAllPlayers} style={{ padding: "10px 16px", borderRadius: 999, background: C.pinkSoft, color: C.pinkDark, border: "none", cursor: "pointer", fontWeight: 700 }}>Clear all players</button>
          <button onClick={clearAllCaptains} style={{ padding: "10px 16px", borderRadius: 999, background: C.pinkSoft, color: C.pinkDark, border: "none", cursor: "pointer", fontWeight: 700 }}>Clear all captains</button>
        </div>
        {!confirmReset ? (
          <button onClick={() => setConfirmReset(true)} style={{ padding: "10px 18px", borderRadius: 999, background: C.pinkSoft, color: C.pinkDark, border: "none", cursor: "pointer", fontWeight: 700 }}>Reset stats only (keep rosters intact)</button>
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={resetAuction} style={{ padding: "10px 18px", borderRadius: 999, background: C.pink, color: "#fff", border: "none", cursor: "pointer", fontWeight: 700 }}>Confirm reset</button>
            <button onClick={() => setConfirmReset(false)} style={{ padding: "10px 18px", borderRadius: 999, background: C.bg, color: C.ink, border: "none", cursor: "pointer", fontWeight: 700 }}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}

function OverviewTab({ config, captains, players, log }) {
  const csv = [
    "Team,Captain,Player,Category,Price",
    ...captains.flatMap((c) => (c.roster || []).map((r) => {
      const p = players.find((pl) => pl.id === r.playerId);
      return `${c.teamName},${c.name},${p?.name || ""},${config.categoryNames[r.categoryId] || ""},${r.price}`;
    })),
  ].join("\n");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={clayCardStyle({ padding: 18 })}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.teal, letterSpacing: 1, marginBottom: 12 }}>TEAM ROSTERS</div>
        {captains.map((c) => (
          <div key={c.id} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, color: C.ink }}><span>{c.teamName}</span><span style={{ color: C.tealDark }}>{money(c.wallet)} left</span></div>
            {(c.roster || []).map((r, i) => { const p = players.find((pl) => pl.id === r.playerId); return <div key={i} style={{ fontSize: 13, color: C.inkSoft, display: "flex", justifyContent: "space-between" }}><span>{p?.name}</span><span>{money(r.price)}</span></div>; })}
            {(!c.roster || c.roster.length === 0) && <div style={{ fontSize: 13, color: C.inkSoft }}>No players yet</div>}
          </div>
        ))}
      </div>
      <div style={clayCardStyle({ padding: 18 })}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.teal, letterSpacing: 1, marginBottom: 12 }}>TRANSACTION LOG</div>
        <div style={{ maxHeight: 260, overflowY: "auto", fontSize: 12, fontFamily: "monospace", color: C.inkSoft }}>
          {[...log].reverse().map((l, i) => <div key={i} style={{ padding: "4px 0", borderBottom: `1px solid ${C.bg}` }}>{new Date(l.ts).toLocaleTimeString()} — {l.type} {JSON.stringify(l)}</div>)}
          {log.length === 0 && <div>Nothing logged yet.</div>}
        </div>
      </div>
      <div style={clayCardStyle({ padding: 18 })}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.teal, letterSpacing: 1, marginBottom: 10 }}>EXPORT (for pb71.org sync)</div>
        <textarea readOnly value={csv} rows={6} style={{ width: "100%", padding: "13px 16px", borderRadius: 16, border: "none", background: C.bg, color: C.ink, fontSize: 12, fontFamily: "monospace", boxShadow: shadowInset, outline: "none" }} onFocus={(e) => e.target.select()} />
      </div>
    </div>
  );
}
