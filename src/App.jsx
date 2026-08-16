import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import dnlLogo from "./assets/dnl-logo.jpg";

/* =========================================================================
   PB71 DNL DRAFT NIGHT — self-hosted edition
   Same auction logic and UI as the Claude artifact version. Only the
   storage layer changed: Claude's window.storage -> Supabase.
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

const BID_SECONDS = 45;

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
};

const EMPTY_ROUND = {
  categoryId: null,
  phase: "idle",
  timerEndsAt: null,
  winners: null,
  orderedLosers: null,
  leftoverPool: null,
  pickIndex: 0,
};

const K = {
  config: "dnl-config",
  captains: "dnl-captains",
  players: "dnl-players",
  round: "dnl-round",
  log: "dnl-log",
  bid: (catId, capId) => `dnl-bid-${catId}-${capId}`,
  pick: (catId, capId) => `dnl-pick-${catId}-${capId}`,
};

/* ---------------------------- storage helpers ---------------------------
   Same readKey/writeKey signatures as the Claude artifact version, backed
   by a single key/value table in Supabase instead of window.storage.
   Nothing else in this file needed to change because of that. */

async function readKey(key, fallback) {
  try {
    const { data, error } = await supabase
      .from("dnl_kv")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    if (error || !data) return fallback;
    return data.value;
  } catch (e) {
    return fallback;
  }
}
async function writeKey(key, value) {
  try {
    if (value === null) {
      const { error } = await supabase.from("dnl_kv").delete().eq("key", key);
      return !error;
    }
    const { error } = await supabase
      .from("dnl_kv")
      .upsert({ key, value }, { onConflict: "key" });
    return !error;
  } catch (e) {
    return false;
  }
}

/* ------------------------------ resolution ------------------------------ */

function computeResolution(categoryPlayers, bidsArr, captainIds) {
  const byPlayer = {};
  bidsArr.forEach((b) => {
    (byPlayer[b.playerId] = byPlayer[b.playerId] || []).push(b);
  });
  const winners = {};
  const losers = [];
  const biddingCaptainIds = new Set(bidsArr.map((b) => b.captainId));

  Object.entries(byPlayer).forEach(([playerId, arr]) => {
    const sorted = [...arr].sort(
      (a, b) => b.price - a.price || a.submittedAt - b.submittedAt
    );
    winners[playerId] = { captainId: sorted[0].captainId, price: sorted[0].price };
    sorted.slice(1).forEach((l) => losers.push({ captainId: l.captainId, price: l.price }));
  });

  captainIds.forEach((id) => {
    if (!biddingCaptainIds.has(id)) losers.push({ captainId: id, price: -1 });
  });

  const wonPlayerIds = new Set(Object.keys(winners));
  const leftoverPlayerIds = categoryPlayers.map((p) => p.id).filter((id) => !wonPlayerIds.has(id));
  const orderedLosers = [...losers].sort((a, b) => b.price - a.price);

  return { winners, orderedLosers, leftoverPlayerIds };
}

/* --------------------------------- utils --------------------------------- */

function money(n) {
  return (n ?? 0).toLocaleString("en-US");
}
function usePoll(fn, deps, intervalMs) {
  useEffect(() => {
    fn();
    const t = setInterval(fn, intervalMs);
    return () => clearInterval(t);
    // eslint-disable-next-line
  }, deps);
}

/* ------------------------------ clay styling ------------------------------ */

const shadowCard = "9px 9px 20px rgba(19,45,85,0.12), -7px -7px 16px rgba(255,255,255,0.9)";
const shadowCardSoft = "6px 6px 14px rgba(19,45,85,0.08), -5px -5px 12px rgba(255,255,255,0.9)";
const shadowInset = "inset 4px 4px 8px rgba(19,45,85,0.08), inset -3px -3px 6px rgba(255,255,255,0.8)";
const btnShadow = (dark) => `0 6px 0 ${dark}, 0 12px 22px rgba(19,45,85,0.18)`;

function clayCardStyle(extra = {}) {
  return { background: C.card, borderRadius: 26, boxShadow: shadowCard, ...extra };
}
function topRibbon(color) {
  return { height: 9, borderRadius: "26px 26px 0 0", background: color, marginBottom: -1 };
}

const GlobalStyle = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,700&display=swap');
    * { font-family: 'Poppins', sans-serif; box-sizing: border-box; }
    body { margin: 0; }
    @keyframes popin { from { opacity:0; transform: scale(0.9) translateY(6px);} to {opacity:1; transform: scale(1) translateY(0);} }
    .popin { animation: popin 0.3s ease-out both; }
    input, select, textarea { font-family: 'Poppins', sans-serif; }
  `}</style>
);

function ClayInput(props) {
  return (
    <input
      {...props}
      style={{
        width: "100%", padding: "13px 16px", borderRadius: 16, border: "none",
        background: C.bg, color: C.ink, fontSize: 16, outline: "none",
        boxShadow: shadowInset, ...(props.style || {}),
      }}
    />
  );
}
function ClaySelect({ children, ...props }) {
  return (
    <select
      {...props}
      style={{
        width: "100%", padding: "13px 16px", borderRadius: 16, border: "none",
        background: C.bg, color: C.ink, fontSize: 16, outline: "none",
        boxShadow: shadowInset, ...(props.style || {}),
      }}
    >
      {children}
    </select>
  );
}
function ClayButton({ children, color = C.lime, darkShadow = C.limeDark, text = C.black, onClick, disabled, style }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "16px 20px", borderRadius: 999, border: "none", cursor: disabled ? "default" : "pointer",
        background: color, color: text, fontWeight: 800, fontSize: 16,
        boxShadow: disabled ? "none" : btnShadow(darkShadow),
        opacity: disabled ? 0.45 : 1,
        transition: "transform 0.08s ease",
        ...style,
      }}
      onMouseDown={(e) => { if (!disabled) e.currentTarget.style.transform = "translateY(3px)"; }}
      onMouseUp={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
    >
      {children}
    </button>
  );
}
function Chip({ children, bg, fg = C.ink }) {
  return (
    <span style={{ background: bg, color: fg, borderRadius: 999, padding: "5px 14px", fontSize: 12, fontWeight: 700, display: "inline-block" }}>
      {children}
    </span>
  );
}
function TextLink({ children, onClick }) {
  return (
    <button onClick={onClick} style={{ background: "none", border: "none", color: C.inkSoft, cursor: "pointer", fontSize: 14, padding: 8, fontWeight: 600 }}>
      {children}
    </button>
  );
}

function CountdownRing({ endsAt, total = BID_SECONDS, size = 120 }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const remaining = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const frac = Math.max(0, Math.min(1, (endsAt - now) / (total * 1000)));
  const r = size / 2 - 10;
  const circ = 2 * Math.PI * r;
  const urgent = remaining <= 10;
  return (
    <div style={{ position: "relative", width: size, height: size, borderRadius: "50%", background: C.card, boxShadow: shadowCard }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)", position: "absolute", inset: 0 }}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={C.bg} strokeWidth="9" fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={urgent ? C.pink : C.teal} strokeWidth="9" fill="none"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - frac)} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.25s linear" }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.3, fontWeight: 900, color: urgent ? C.pink : C.ink }}>
        {remaining}
      </div>
    </div>
  );
}

/* --------------------------------- App ----------------------------------- */

export default function App() {
  const [role, setRole] = useState(null);
  const [captainSession, setCaptainSession] = useState(null);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [captains, setCaptains] = useState([]);
  const [players, setPlayers] = useState([]);
  const [round, setRound] = useState(EMPTY_ROUND);
  const [log, setLog] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const pollAll = useCallback(async () => {
    const [cfg, caps, plys, rnd, lg] = await Promise.all([
      readKey(K.config, DEFAULT_CONFIG),
      readKey(K.captains, []),
      readKey(K.players, []),
      readKey(K.round, EMPTY_ROUND),
      readKey(K.log, []),
    ]);
    setConfig(cfg);
    setCaptains(caps);
    setPlayers(plys);
    setRound(rnd);
    setLog(lg);
    setLoaded(true);
  }, []);

  usePoll(pollAll, [pollAll], 1500);

  const persistConfig = async (v) => { setConfig(v); await writeKey(K.config, v); };
  const persistCaptains = async (v) => { setCaptains(v); await writeKey(K.captains, v); };
  const persistPlayers = async (v) => { setPlayers(v); await writeKey(K.players, v); };
  const persistRound = async (v) => { setRound(v); await writeKey(K.round, v); };
  const persistLog = async (v) => { setLog(v); await writeKey(K.log, v); };

  if (!loaded) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <GlobalStyle />
        <div style={{ color: C.teal, fontSize: 20, fontWeight: 800 }}>Loading DNL auction…</div>
      </div>
    );
  }

  if (!role) {
    return (
      <RoleSelector
        config={config}
        captains={captains}
        onPublic={() => setRole("public")}
        onAdmin={() => setRole("admin")}
        onCaptain={(cap) => { setCaptainSession(cap); setRole("captain"); }}
      />
    );
  }

  if (role === "public") {
    return <PublicDisplay config={config} captains={captains} players={players} round={round} onExit={() => setRole(null)} />;
  }

  if (role === "captain") {
    return (
      <CaptainView
        captain={captains.find((c) => c.id === captainSession.id) || captainSession}
        config={config}
        captains={captains}
        players={players}
        round={round}
        onExit={() => { setRole(null); setCaptainSession(null); }}
      />
    );
  }

  if (role === "admin") {
    return (
      <AdminConsole
        config={config} persistConfig={persistConfig}
        captains={captains} persistCaptains={persistCaptains}
        players={players} persistPlayers={persistPlayers}
        round={round} persistRound={persistRound}
        log={log} persistLog={persistLog}
        onExit={() => setRole(null)}
      />
    );
  }

  return null;
}

/* ----------------------------- Role Selector ------------------------------ */

function RoleSelector({ config, captains, onPublic, onAdmin, onCaptain }) {
  const [mode, setMode] = useState(null);
  const [captainId, setCaptainId] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const tryCaptainLogin = () => {
    const cap = captains.find((c) => c.id === captainId);
    if (!cap) { setError("Pick your team."); return; }
    if (String(cap.code).trim().toLowerCase() !== code.trim().toLowerCase()) {
      setError("That code doesn't match. Check with the auctioneer.");
      return;
    }
    onCaptain(cap);
  };
  const tryAdminLogin = () => {
    if (code.trim() !== String(config.adminCode)) { setError("Wrong admin code."); return; }
    onAdmin();
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
            <ClayButton color={C.teal} darkShadow={C.tealDark} text="#fff" onClick={onPublic}>Public Display</ClayButton>
            <ClayButton color={C.pink} darkShadow={C.pinkDark} text="#fff" onClick={() => { setMode("captain"); setError(""); }}>I'm a Captain</ClayButton>
            <ClayButton color={C.card} darkShadow="#D8DED4" text={C.ink} onClick={() => { setMode("admin"); setError(""); }}>Auctioneer Console</ClayButton>
          </div>
        )}

        {mode === "captain" && (
          <div className="popin" style={{ ...clayCardStyle(), padding: 22, display: "flex", flexDirection: "column", gap: 12 }}>
            {captains.length === 0 && <div style={{ color: C.pink, fontSize: 13, fontWeight: 600 }}>No captains set up yet — ask the auctioneer to finish Setup first.</div>}
            <label style={labelStyle}>Your team</label>
            <ClaySelect value={captainId} onChange={(e) => setCaptainId(e.target.value)}>
              <option value="">Select your team…</option>
              {captains.map((c) => <option key={c.id} value={c.id}>{c.teamName} ({c.name})</option>)}
            </ClaySelect>
            <label style={labelStyle}>Private code</label>
            <ClayInput value={code} onChange={(e) => setCode(e.target.value)} placeholder="Enter your code" />
            {error && <div style={{ color: C.pink, fontSize: 13, fontWeight: 600 }}>{error}</div>}
            <ClayButton color={C.lime} darkShadow={C.limeDark} onClick={tryCaptainLogin}>Enter</ClayButton>
            <TextLink onClick={() => setMode(null)}>← back</TextLink>
          </div>
        )}

        {mode === "admin" && (
          <div className="popin" style={{ ...clayCardStyle(), padding: 22, display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={labelStyle}>Admin code</label>
            <ClayInput type="password" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Enter admin code" />
            {error && <div style={{ color: C.pink, fontSize: 13, fontWeight: 600 }}>{error}</div>}
            <ClayButton color={C.lime} darkShadow={C.limeDark} onClick={tryAdminLogin}>Enter Console</ClayButton>
            <TextLink onClick={() => setMode(null)}>← back</TextLink>
          </div>
        )}
      </div>
    </div>
  );
}

const labelStyle = { fontSize: 12, textTransform: "uppercase", letterSpacing: 1, color: C.teal, fontWeight: 700, marginTop: 2 };

/* ------------------------------ Public Display ---------------------------- */

function PublicDisplay({ config, captains, players, round, onExit }) {
  const catName = round.categoryId ? config.categoryNames[round.categoryId] : null;
  const catPlayers = round.categoryId ? players.filter((p) => p.categoryId === round.categoryId) : [];

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

      <div style={{ padding: "0 28px 28px" }}>
        {round.phase === "idle" && (
          <div style={{ textAlign: "center", padding: "70px 0" }}>
            <div style={{ fontSize: 40, fontWeight: 900, color: C.teal }}>Waiting for the next segment</div>
            <div style={{ color: C.inkSoft, marginTop: 8 }}>The auctioneer will start the next category shortly.</div>
          </div>
        )}

        {round.phase === "bidding" && (
          <div style={{ textAlign: "center" }}>
            <Chip bg={C.pinkSoft} fg={C.pinkDark}>LIVE BIDDING</Chip>
            <div style={{ fontSize: 36, fontWeight: 900, margin: "12px 0 22px", color: C.ink }}>{catName}</div>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 26 }}>
              <CountdownRing endsAt={round.timerEndsAt} size={150} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 16, maxWidth: 900, margin: "0 auto" }}>
              {catPlayers.map((p, i) => (
                <div key={p.id} className="popin" style={clayCardStyle({ overflow: "hidden" })}>
                  <div style={topRibbon([C.teal, C.pink, C.lime, C.cyan][i % 4])} />
                  <div style={{ padding: "16px 14px", fontSize: 17, fontWeight: 700, color: C.ink }}>{p.name}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {(round.phase === "leftover-picking" || round.phase === "complete") && round.winners && (
          <RevealBoard config={config} captains={captains} players={players} round={round} catName={catName} />
        )}
      </div>

      <Scoreboard captains={captains} />
    </div>
  );
}

function RevealBoard({ config, captains, players, round, catName }) {
  const capName = (id) => captains.find((c) => c.id === id)?.teamName || "—";
  const catPlayers = players.filter((p) => p.categoryId === round.categoryId);
  const currentPicker = round.phase === "leftover-picking" ? round.orderedLosers?.[round.pickIndex] : null;

  return (
    <div style={{ textAlign: "center" }}>
      <Chip bg={C.cyanSoft} fg={C.cyanDark}>RESULTS</Chip>
      <div style={{ fontSize: 32, fontWeight: 900, margin: "12px 0 22px", color: C.ink }}>{catName}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 16, maxWidth: 1000, margin: "0 auto" }}>
        {catPlayers.map((p) => {
          const won = p.status === "won";
          return (
            <div key={p.id} className="popin" style={clayCardStyle({ overflow: "hidden", opacity: won ? 1 : 0.75 })}>
              <div style={topRibbon(won ? C.teal : C.pinkSoft)} />
              <div style={{ padding: "16px 14px" }}>
                <div style={{ fontWeight: 700, fontSize: 16, color: C.ink }}>{p.name}</div>
                {won ? (
                  <>
                    <div style={{ fontWeight: 800, fontSize: 15, color: C.tealDark, marginTop: 6 }}>{capName(p.winnerCaptainId)}</div>
                    <div style={{ fontSize: 13, color: C.inkSoft }}>{money(p.finalPrice)}</div>
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: C.inkSoft, marginTop: 6 }}>awaiting leftover pick</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {currentPicker && (
        <div style={{ marginTop: 22, fontSize: 19, fontWeight: 800, color: C.pinkDark }}>
          {capName(currentPicker.captainId)} is picking their player…
        </div>
      )}
      {round.phase === "complete" && (
        <div style={{ marginTop: 22, fontSize: 19, fontWeight: 800, color: C.tealDark }}>Segment complete</div>
      )}
    </div>
  );
}

function Scoreboard({ captains }) {
  return (
    <div style={{ marginTop: 10, padding: "18px 28px 30px" }}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(captains.length, 1)},1fr)`, gap: 12 }}>
        {captains.map((c) => (
          <div key={c.id} style={clayCardStyle({ padding: 12, textAlign: "center" })}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.teal }}>{c.teamName}</div>
            <div style={{ fontSize: 12, color: C.inkSoft }}>{c.roster?.length || 0}/11 players</div>
            <div style={{ fontSize: 15, fontWeight: 900, color: C.ink }}>{money(c.wallet)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------- Captain -------------------------------- */

function CaptainView({ captain, config, captains, players, round, onExit }) {
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [price, setPrice] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [checkingExisting, setCheckingExisting] = useState(true);
  const [pickSubmitted, setPickSubmitted] = useState(false);

  const catId = round.categoryId;
  const catPlayers = catId ? players.filter((p) => p.categoryId === catId) : [];
  const reserve = catId ? config.categoryReserves[catId] ?? 0 : 0;
  const step = config.bidRounding || 1000;
  const isMyTurn = round.phase === "leftover-picking" && round.orderedLosers?.[round.pickIndex]?.captainId === captain.id;
  const leftoverPlayers = isMyTurn ? players.filter((p) => round.leftoverPool.includes(p.id)) : [];

  useEffect(() => {
    let cancel = false;
    (async () => {
      if (round.phase === "bidding" && catId) {
        const existing = await readKey(K.bid(catId, captain.id), null);
        if (!cancel) { setSubmitted(!!existing); setCheckingExisting(false); }
      } else {
        setSubmitted(false);
        setCheckingExisting(false);
      }
    })();
    return () => { cancel = true; };
  }, [round.phase, catId, captain.id]);

  useEffect(() => {
    setSelectedPlayer(null);
    setPrice(String(reserve || ""));
    setPickSubmitted(false);
  }, [catId, reserve]);

  const submitBid = async () => {
    const p = Math.round(Number(price) / step) * step;
    if (!selectedPlayer) return alert("Pick a player first.");
    if (p < reserve) return alert(`Bid must be at least the reserve price of ${money(reserve)}.`);
    if (p > captain.wallet) return alert("That's more than your remaining wallet.");
    await writeKey(K.bid(catId, captain.id), { playerId: selectedPlayer, price: p, submittedAt: Date.now() });
    setSubmitted(true);
  };

  const submitPick = async (playerId) => {
    await writeKey(K.pick(catId, captain.id), { playerId, submittedAt: Date.now() });
    setPickSubmitted(true);
  };

  const myRoster = captain.roster || [];
  const catName = catId ? config.categoryNames[catId] : null;

  return (
    <div style={{ minHeight: "100vh", background: C.bg }}>
      <GlobalStyle />
      <div style={{ padding: 16 }}>
        <div style={{ ...clayCardStyle(), padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 18, color: C.ink }}>{captain.teamName}</div>
            <div style={{ fontSize: 12, color: C.inkSoft }}>{myRoster.length}/11 drafted</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: C.inkSoft, fontWeight: 700 }}>WALLET</div>
            <div style={{ fontSize: 19, fontWeight: 900, color: C.tealDark }}>{money(captain.wallet)}</div>
          </div>
        </div>
      </div>

      <div style={{ padding: "0 16px 18px", maxWidth: 480, margin: "0 auto" }}>
        {round.phase === "idle" && (
          <div style={{ textAlign: "center", padding: "50px 0" }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: C.teal }}>Waiting for next segment</div>
            <div style={{ color: C.inkSoft, marginTop: 8, fontSize: 14 }}>Watch the big screen — bidding opens shortly.</div>
          </div>
        )}

        {round.phase === "bidding" && !checkingExisting && (
          submitted ? (
            <div style={{ textAlign: "center", padding: "50px 0" }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: C.tealDark }}>Bid locked in</div>
              <div style={{ color: C.inkSoft, marginTop: 8, fontSize: 14 }}>Waiting for the reveal…</div>
            </div>
          ) : (
            <div>
              <Chip bg={C.pinkSoft} fg={C.pinkDark}>LIVE — {catName}</Chip>
              <div style={{ display: "flex", justifyContent: "center", margin: "18px 0" }}>
                <CountdownRing endsAt={round.timerEndsAt} size={110} />
              </div>
              <div style={{ fontSize: 12, color: C.inkSoft, fontWeight: 700, marginBottom: 8 }}>RESERVE: {money(reserve)}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                {catPlayers.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPlayer(p.id)}
                    style={{
                      textAlign: "left", padding: "15px 18px", borderRadius: 18, fontSize: 16, fontWeight: 700, cursor: "pointer", border: "none",
                      background: selectedPlayer === p.id ? C.lime : C.card,
                      color: C.ink,
                      boxShadow: selectedPlayer === p.id ? shadowInset : shadowCardSoft,
                    }}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
              <label style={labelStyle}>Your bid</label>
              <ClayInput type="number" step={step} value={price} onChange={(e) => setPrice(e.target.value)} />
              <div style={{ marginTop: 14 }}>
                <ClayButton color={C.lime} darkShadow={C.limeDark} onClick={submitBid} style={{ width: "100%" }}>Submit Sealed Bid</ClayButton>
              </div>
            </div>
          )
        )}

        {round.phase === "leftover-picking" && (
          isMyTurn ? (
            pickSubmitted ? (
              <div style={{ textAlign: "center", padding: "50px 0" }}>
                <div style={{ fontSize: 20, fontWeight: 900, color: C.tealDark }}>Pick locked in</div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 20, fontWeight: 900, color: C.pinkDark, textAlign: "center", marginBottom: 4 }}>Your pick</div>
                <div style={{ textAlign: "center", color: C.inkSoft, fontSize: 13, marginBottom: 16 }}>Choose a player from what's left in {catName}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {leftoverPlayers.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => submitPick(p.id)}
                      style={{ textAlign: "left", padding: "15px 18px", borderRadius: 18, fontSize: 16, fontWeight: 700, cursor: "pointer", background: C.tealSoft, color: C.tealDark, border: "none", boxShadow: shadowCardSoft }}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )
          ) : (
            <div style={{ textAlign: "center", padding: "50px 0" }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: C.teal }}>Another captain is picking</div>
              <div style={{ color: C.inkSoft, marginTop: 8, fontSize: 14 }}>Hang tight — you're in the queue.</div>
            </div>
          )
        )}

        {round.phase === "complete" && (
          <div style={{ textAlign: "center", padding: "44px 0" }}>
            <div style={{ fontSize: 21, fontWeight: 900, color: C.tealDark }}>Segment complete</div>
            <div style={{ color: C.inkSoft, marginTop: 8, fontSize: 14 }}>Waiting for the next category.</div>
          </div>
        )}

        <div style={{ marginTop: 26, ...clayCardStyle(), padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.teal, marginBottom: 8 }}>MY ROSTER</div>
          {myRoster.length === 0 && <div style={{ fontSize: 13, color: C.inkSoft }}>No players yet.</div>}
          {myRoster.map((r, i) => {
            const p = players.find((pl) => pl.id === r.playerId);
            return (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "5px 0", color: C.ink }}>
                <span>{p?.name || "—"}</span>
                <span style={{ color: C.inkSoft }}>{money(r.price)}</span>
              </div>
            );
          })}
        </div>
        <TextLink onClick={onExit}>← switch view</TextLink>
      </div>
    </div>
  );
}

/* ------------------------------ Admin Console ----------------------------- */

function AdminConsole(props) {
  const { config, persistConfig, captains, persistCaptains, players, persistPlayers, round, persistRound, log, persistLog, onExit } = props;
  const [tab, setTab] = useState("live");
  const resolvingRef = useRef(false);
  const pickingRef = useRef(false);

  const findCatPlayers = (catId) => players.filter((p) => p.categoryId === catId);

  const resolveCurrentRound = useCallback(async () => {
    if (resolvingRef.current) return;
    resolvingRef.current = true;
    try {
      const catId = round.categoryId;
      const catPlayers = findCatPlayers(catId);
      const captainIds = captains.map((c) => c.id);
      const bidsArr = [];
      for (const cap of captains) {
        const b = await readKey(K.bid(catId, cap.id), null);
        if (b) bidsArr.push({ captainId: cap.id, playerId: b.playerId, price: b.price, submittedAt: b.submittedAt });
      }
      const { winners, orderedLosers, leftoverPlayerIds } = computeResolution(catPlayers, bidsArr, captainIds);

      let newPlayers = [...players];
      let newCaptains = [...captains];
      let newLog = [...log];
      Object.entries(winners).forEach(([playerId, w]) => {
        newPlayers = newPlayers.map((p) => (p.id === playerId ? { ...p, status: "won", winnerCaptainId: w.captainId, finalPrice: w.price } : p));
        newCaptains = newCaptains.map((c) => (c.id === w.captainId ? { ...c, wallet: c.wallet - w.price, roster: [...(c.roster || []), { playerId, categoryId: catId, price: w.price }] } : c));
        newLog.push({ ts: Date.now(), type: "win", captainId: w.captainId, playerId, categoryId: catId, price: w.price });
      });

      await persistPlayers(newPlayers);
      await persistCaptains(newCaptains);
      await persistLog(newLog);

      if (orderedLosers.length === 0) {
        await persistRound({ ...round, phase: "complete", winners, orderedLosers: [], leftoverPool: [] });
      } else {
        await persistRound({ ...round, phase: "leftover-picking", winners, orderedLosers, leftoverPool: leftoverPlayerIds, pickIndex: 0 });
      }
    } finally {
      resolvingRef.current = false;
    }
    // eslint-disable-next-line
  }, [round, captains, players, log]);

  const checkForPick = useCallback(async () => {
    if (pickingRef.current) return;
    const currentLoser = round.orderedLosers?.[round.pickIndex];
    if (!currentLoser) return;
    pickingRef.current = true;
    try {
      const capId = currentLoser.captainId;
      const pick = await readKey(K.pick(round.categoryId, capId), null);
      if (pick && pick.playerId && round.leftoverPool.includes(pick.playerId)) {
        const price = currentLoser.price === -1 ? (config.categoryReserves[round.categoryId] ?? 0) : currentLoser.price;
        const newPlayers = players.map((p) => (p.id === pick.playerId ? { ...p, status: "won", winnerCaptainId: capId, finalPrice: price } : p));
        const newCaptains = captains.map((c) => (c.id === capId ? { ...c, wallet: c.wallet - price, roster: [...(c.roster || []), { playerId: pick.playerId, categoryId: round.categoryId, price }] } : c));
        const newLog = [...log, { ts: Date.now(), type: "leftover", captainId: capId, playerId: pick.playerId, categoryId: round.categoryId, price }];
        const newPool = round.leftoverPool.filter((id) => id !== pick.playerId);
        const nextIndex = round.pickIndex + 1;
        await writeKey(K.pick(round.categoryId, capId), null);
        await persistPlayers(newPlayers);
        await persistCaptains(newCaptains);
        await persistLog(newLog);
        if (nextIndex >= round.orderedLosers.length) {
          await persistRound({ ...round, phase: "complete", leftoverPool: newPool, pickIndex: nextIndex });
        } else {
          await persistRound({ ...round, leftoverPool: newPool, pickIndex: nextIndex });
        }
      }
    } finally {
      pickingRef.current = false;
    }
    // eslint-disable-next-line
  }, [round, players, captains, log, config]);

  useEffect(() => {
    const t = setInterval(() => {
      if (round.phase === "bidding" && round.timerEndsAt && Date.now() >= round.timerEndsAt) {
        resolveCurrentRound();
      }
      if (round.phase === "leftover-picking") {
        checkForPick();
      }
    }, 1200);
    return () => clearInterval(t);
  }, [round, resolveCurrentRound, checkForPick]);

  const nextCategoryId = config.categoryOrder.find((cid) => findCatPlayers(cid).some((p) => p.status === "available"));

  const startRound = async (categoryId) => {
    for (const cap of captains) {
      await writeKey(K.bid(categoryId, cap.id), null);
      await writeKey(K.pick(categoryId, cap.id), null);
    }
    await persistRound({ categoryId, phase: "bidding", timerEndsAt: Date.now() + BID_SECONDS * 1000, winners: null, orderedLosers: null, leftoverPool: null, pickIndex: 0 });
  };

  const rerunCategory = async (categoryId) => {
    const affected = findCatPlayers(categoryId).map((p) => p.id);
    const newPlayers = players.map((p) => (p.categoryId === categoryId ? { ...p, status: "available", winnerCaptainId: null, finalPrice: null } : p));
    const newCaptains = captains.map((c) => {
      const removed = (c.roster || []).filter((r) => affected.includes(r.playerId));
      const refund = removed.reduce((s, r) => s + r.price, 0);
      return { ...c, wallet: c.wallet + refund, roster: (c.roster || []).filter((r) => !affected.includes(r.playerId)) };
    });
    await persistPlayers(newPlayers);
    await persistCaptains(newCaptains);
    await persistLog([...log, { ts: Date.now(), type: "rerun", categoryId }]);
    await persistRound({ ...EMPTY_ROUND });
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg }}>
      <GlobalStyle />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src={dnlLogo} alt="DNL" style={{ height: 38, borderRadius: 10, boxShadow: shadowCardSoft }} />
          <div style={{ fontWeight: 900, fontSize: 18, color: C.ink }}>Auctioneer Console</div>
        </div>
        <TextLink onClick={onExit}>exit</TextLink>
      </div>
      <div style={{ display: "flex", gap: 8, padding: "6px 14px 14px", flexWrap: "wrap" }}>
        {["live", "setup", "overview"].map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "9px 18px", borderRadius: 999, fontSize: 13, fontWeight: 800, cursor: "pointer", border: "none",
            background: tab === t ? C.navy : C.card, color: tab === t ? "#fff" : C.ink,
            boxShadow: tab === t ? btnShadow(C.navyDark) : shadowCardSoft,
          }}>{t[0].toUpperCase() + t.slice(1)}</button>
        ))}
      </div>

      <div style={{ padding: "0 16px 24px", maxWidth: 900, margin: "0 auto" }}>
        {tab === "live" && (
          <LiveControlTab
            config={config} captains={captains} players={players} round={round} log={log}
            nextCategoryId={nextCategoryId} startRound={startRound} rerunCategory={rerunCategory}
            resolveCurrentRound={resolveCurrentRound}
            persistCaptains={persistCaptains} persistPlayers={persistPlayers} persistLog={persistLog}
          />
        )}
        {tab === "setup" && (
          <SetupTab config={config} persistConfig={persistConfig} captains={captains} persistCaptains={persistCaptains} players={players} persistPlayers={persistPlayers} />
        )}
        {tab === "overview" && (
          <OverviewTab config={config} captains={captains} players={players} log={log} />
        )}
      </div>
    </div>
  );
}

function LiveControlTab({ config, captains, players, round, log, nextCategoryId, startRound, rerunCategory, resolveCurrentRound, persistCaptains, persistPlayers, persistLog }) {
  const [manualCat, setManualCat] = useState("");
  const [assignPlayer, setAssignPlayer] = useState("");
  const [assignCaptain, setAssignCaptain] = useState("");
  const [assignPrice, setAssignPrice] = useState("");
  const [walletEditCap, setWalletEditCap] = useState("");
  const [walletEditVal, setWalletEditVal] = useState("");
  const [confirmRerun, setConfirmRerun] = useState(false);

  const catName = round.categoryId ? config.categoryNames[round.categoryId] : null;
  const availablePlayers = players.filter((p) => p.status === "available");
  const busy = round.phase === "bidding" || round.phase === "leftover-picking";

  const forceAssign = async () => {
    if (!assignPlayer || !assignCaptain) return alert("Pick a player and a captain.");
    const price = Number(assignPrice) || 0;
    const player = players.find((p) => p.id === assignPlayer);
    let newPlayers = players.map((p) => (p.id === assignPlayer ? { ...p, status: "won", winnerCaptainId: assignCaptain, finalPrice: price } : p));
    let newCaptains = captains.map((c) => (c.id === assignCaptain ? { ...c, wallet: c.wallet - price, roster: [...(c.roster || []), { playerId: assignPlayer, categoryId: player.categoryId, price }] } : c));
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={clayCardStyle({ padding: 18 })}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.teal, letterSpacing: 1 }}>CURRENT SEGMENT</div>
        <div style={{ fontSize: 24, fontWeight: 900, color: C.ink, marginTop: 2 }}>{catName || "— none live —"}</div>
        <div style={{ fontSize: 13, color: C.inkSoft }}>Phase: {round.phase}</div>
        {round.phase === "bidding" && (
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <CountdownRing endsAt={round.timerEndsAt} size={70} />
            <ClayButton color={C.pink} darkShadow={C.pinkDark} text="#fff" onClick={resolveCurrentRound}>Force Resolve Now</ClayButton>
          </div>
        )}
        {round.phase === "leftover-picking" && (
          <div style={{ marginTop: 10, fontSize: 14, color: C.ink }}>
            Waiting on pick {round.pickIndex + 1} of {round.orderedLosers.length}: <b>{captains.find((c) => c.id === round.orderedLosers[round.pickIndex]?.captainId)?.teamName}</b>
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <ClayButton
            color={C.lime} darkShadow={C.limeDark}
            disabled={!nextCategoryId || busy}
            onClick={() => startRound(nextCategoryId)}
          >
            Start next: {nextCategoryId ? config.categoryNames[nextCategoryId] : "all done"}
          </ClayButton>
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <ClaySelect value={manualCat} onChange={(e) => setManualCat(e.target.value)} style={{ width: "auto", minWidth: 200 }}>
            <option value="">Pick a category to start/rerun…</option>
            {config.categoryOrder.map((cid) => <option key={cid} value={cid}>{config.categoryNames[cid]}</option>)}
          </ClaySelect>
          <button disabled={!manualCat} onClick={() => startRound(manualCat)} style={{ padding: "10px 16px", borderRadius: 999, background: C.tealSoft, color: C.tealDark, border: "none", cursor: "pointer", fontWeight: 700 }}>Start</button>
          {!confirmRerun ? (
            <button disabled={!manualCat} onClick={() => setConfirmRerun(true)} style={{ padding: "10px 16px", borderRadius: 999, background: C.pinkSoft, color: C.pinkDark, border: "none", cursor: "pointer", fontWeight: 700 }}>Rerun (resets category)</button>
          ) : (
            <button onClick={() => { rerunCategory(manualCat); setConfirmRerun(false); }} style={{ padding: "10px 16px", borderRadius: 999, background: C.pink, color: "#fff", border: "none", cursor: "pointer", fontWeight: 700 }}>Confirm rerun?</button>
          )}
        </div>
      </div>

      <div style={clayCardStyle({ padding: 18 })}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.teal, letterSpacing: 1, marginBottom: 10 }}>MANUAL OVERRIDE — FORCE ASSIGN</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <ClaySelect value={assignPlayer} onChange={(e) => setAssignPlayer(e.target.value)} style={{ width: "auto", minWidth: 180 }}>
            <option value="">Player…</option>
            {availablePlayers.map((p) => <option key={p.id} value={p.id}>{p.name} ({config.categoryNames[p.categoryId]})</option>)}
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
  const [capCode, setCapCode] = useState("");
  const [bulk, setBulk] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);

  const addCaptain = async () => {
    if (!capName || !teamName || !capCode) return alert("Fill in name, team name, and code.");
    if (captains.length >= 6) return alert("Already have 6 captains.");
    const id = "cap_" + Math.random().toString(36).slice(2, 8);
    await persistCaptains([...captains, { id, name: capName, teamName, code: capCode, wallet: config.startingWallet, roster: [] }]);
    setCapName(""); setTeamName(""); setCapCode("");
  };
  const removeCaptain = async (id) => persistCaptains(captains.filter((c) => c.id !== id));

  const importPlayers = async () => {
    const lines = bulk.split("\n").map((l) => l.trim()).filter(Boolean);
    const newOnes = lines.map((line, i) => {
      const parts = line.split(",").map((s) => s.trim());
      const name = parts[0];
      const catNum = parseInt(parts[1], 10);
      const categoryId = CATEGORY_ORDER[catNum - 1];
      return categoryId ? { id: "p_" + Date.now().toString(36) + "_" + i, name, categoryId, status: "available", winnerCaptainId: null, finalPrice: null } : null;
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
            <ClayInput type="number" value={config.startingWallet} onChange={(e) => persistConfig({ ...config, startingWallet: Number(e.target.value) })} style={{ width: 140 }} />
          </div>
          <div>
            <label style={labelStyle}>Bid rounding</label>
            <ClayInput type="number" value={config.bidRounding} onChange={(e) => persistConfig({ ...config, bidRounding: Number(e.target.value) })} style={{ width: 100 }} />
          </div>
          <div>
            <label style={labelStyle}>Admin code</label>
            <ClayInput value={config.adminCode} onChange={(e) => persistConfig({ ...config, adminCode: e.target.value })} style={{ width: 140 }} />
          </div>
        </div>
      </div>

      <div style={clayCardStyle({ padding: 18 })}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.teal, letterSpacing: 1, marginBottom: 10 }}>CAPTAINS ({captains.length}/6)</div>
        {captains.map((c) => (
          <div key={c.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "7px 0", borderBottom: `1px solid ${C.bg}`, color: C.ink }}>
            <span>{c.teamName} — {c.name} (code: {c.code})</span>
            <TextLink onClick={() => removeCaptain(c.id)}>remove</TextLink>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <ClayInput placeholder="Captain name" value={capName} onChange={(e) => setCapName(e.target.value)} style={{ width: 150 }} />
          <ClayInput placeholder="Team name" value={teamName} onChange={(e) => setTeamName(e.target.value)} style={{ width: 150 }} />
          <ClayInput placeholder="Private code" value={capCode} onChange={(e) => setCapCode(e.target.value)} style={{ width: 130 }} />
          <button onClick={addCaptain} style={{ padding: "10px 18px", borderRadius: 999, background: C.lime, color: C.black, border: "none", cursor: "pointer", fontWeight: 700 }}>Add</button>
        </div>
      </div>

      <div style={clayCardStyle({ padding: 18 })}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.teal, letterSpacing: 1, marginBottom: 10 }}>CATEGORIES & RESERVE PRICES</div>
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
        <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 8 }}>One per line: <code>Player Name, Category Number (1-11)</code></div>
        <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={6}
          style={{ width: "100%", padding: "13px 16px", borderRadius: 16, border: "none", background: C.bg, color: C.ink, fontSize: 13, fontFamily: "monospace", boxShadow: shadowInset, outline: "none" }}
          placeholder={"Kasun Perera, 1\nNimali Silva, 8\n..."} />
        <div style={{ marginTop: 10 }}>
          <button onClick={importPlayers} style={{ padding: "10px 18px", borderRadius: 999, background: C.lime, color: C.black, border: "none", cursor: "pointer", fontWeight: 700 }}>Import</button>
        </div>
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
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, color: C.ink }}>
              <span>{c.teamName}</span>
              <span style={{ color: C.tealDark }}>{money(c.wallet)} left</span>
            </div>
            {(c.roster || []).map((r, i) => {
              const p = players.find((pl) => pl.id === r.playerId);
              return <div key={i} style={{ fontSize: 13, color: C.inkSoft, display: "flex", justifyContent: "space-between" }}><span>{p?.name}</span><span>{money(r.price)}</span></div>;
            })}
            {(!c.roster || c.roster.length === 0) && <div style={{ fontSize: 13, color: C.inkSoft }}>No players yet</div>}
          </div>
        ))}
      </div>

      <div style={clayCardStyle({ padding: 18 })}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.teal, letterSpacing: 1, marginBottom: 12 }}>TRANSACTION LOG</div>
        <div style={{ maxHeight: 260, overflowY: "auto", fontSize: 12, fontFamily: "monospace", color: C.inkSoft }}>
          {[...log].reverse().map((l, i) => (
            <div key={i} style={{ padding: "4px 0", borderBottom: `1px solid ${C.bg}` }}>
              {new Date(l.ts).toLocaleTimeString()} — {l.type} {JSON.stringify(l)}
            </div>
          ))}
          {log.length === 0 && <div>Nothing logged yet.</div>}
        </div>
      </div>

      <div style={clayCardStyle({ padding: 18 })}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.teal, letterSpacing: 1, marginBottom: 10 }}>EXPORT (for pb71.org sync)</div>
        <textarea readOnly value={csv} rows={6}
          style={{ width: "100%", padding: "13px 16px", borderRadius: 16, border: "none", background: C.bg, color: C.ink, fontSize: 12, fontFamily: "monospace", boxShadow: shadowInset, outline: "none" }}
          onFocus={(e) => e.target.select()} />
      </div>
    </div>
  );
}
