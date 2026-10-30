"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readApiResponse, isRoomIdentity } from "../lib/api-response.mjs";

const CARDS = ["1", "2", "3", "5", "8", "13", "21", "?", "☕"];
type Identity = { roomId: string; token: string };
type Member = { id: string; name: string; host: boolean; online: boolean; voted: boolean; vote: string | null };
type Result = { timestamp: string; title: string; estimate: string };
type Room = { id: string; title: string; round: number; revealed: boolean; saving: boolean; me: string; isHost: boolean; myVote: string | null; members: Member[]; history: Result[] };
type Connection = "connecting" | "online" | "offline" | "expired";
const storageKey = (id: string) => `planning-poker:${id}`;
function readStorage(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
function writeStorage(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* The current tab still works without persistent browser storage. */ } }

function Brand() { return <div className="brand"><span className="brand-icon" aria-hidden="true">P</span> planning poker</div>; }
function useRoom(identity: Identity | null, onError: (text: string) => void) {
  const [room, setRoom] = useState<Room | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const socket = useRef<WebSocket | null>(null);
  useEffect(() => {
    setRoom(null);
    if (!identity) return;
    let disposed = false, retries = 0, fatal = false;
    let timer: ReturnType<typeof setTimeout>;
    let current: WebSocket;
    function connect() {
      setConnection("connecting");
      current = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/socket`);
      socket.current = current;
      current.onopen = () => { if (!disposed) current.send(JSON.stringify({ type: "connect", ...identity })); };
      current.onmessage = event => {
        if (disposed) return;
        const message = JSON.parse(event.data);
        if (message.type === "state") { setRoom(message.state); setConnection("online"); retries = 0; }
        if (message.type === "error") { onError(message.message); if (message.fatal) { fatal = true; setConnection("expired"); } }
      };
      current.onclose = event => {
        if (disposed) return;
        if (event.code === 4001 || event.code === 4002 || fatal) { setConnection("expired"); return; }
        setConnection("offline");
        timer = setTimeout(connect, Math.min(1000 * 2 ** retries++, 10000));
      };
      current.onerror = () => current.close();
    }
    connect();
    return () => { disposed = true; clearTimeout(timer); current?.close(); socket.current = null; };
  }, [identity, onError]);
  const send = useCallback((action: object) => {
    if (socket.current?.readyState !== WebSocket.OPEN) { onError("Anslutningen återställs. Vänta ett ögonblick."); return; }
    socket.current.send(JSON.stringify(action));
  }, [onError]);
  return { room, connection, send };
}

export default function Home() {
  const [initialized, setInitialized] = useState(false);
  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [lastSaved, setLastSaved] = useState(0);
  const showError = useCallback((text: string) => setError(text), []);
  const { room, connection, send } = useRoom(identity, showError);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("room");
    setRoomId(id); setName(readStorage("planning-poker:name") || "");
    if (id) { const token = readStorage(storageKey(id)); if (token) setIdentity({ roomId: id, token }); }
    setInitialized(true);
  }, []);
  useEffect(() => {
    if (!room || room.revealed || connection !== "online") return;
    const vote = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || (event.target instanceof HTMLElement && (event.target.matches("input,textarea,select") || event.target.isContentEditable))) return;
      const value = /^[1-7]$/.test(event.key) ? CARDS[Number(event.key) - 1] : event.key === "?" ? "?" : event.key.toLowerCase() === "c" ? "☕" : null;
      if (value) { event.preventDefault(); send({ type: "vote", value: room.myVote === value ? null : value }); }
    };
    window.addEventListener("keydown", vote);
    return () => window.removeEventListener("keydown", vote);
  }, [room, connection, send]);
  async function enter(event: React.FormEvent) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const response = await fetch(roomId ? `/api/rooms/${encodeURIComponent(roomId)}/join` : "/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const result = await readApiResponse(response);
      if (!isRoomIdentity(result)) throw new Error("Servern skickade inga giltiga rumsuppgifter. Öppna appens aktuella länk och försök igen.");
      writeStorage(storageKey(result.roomId), result.token); writeStorage("planning-poker:name", name.trim());
      history.replaceState(null, "", `?room=${result.roomId}`); setRoomId(result.roomId); setIdentity(result); setLastSaved(0);
    } catch (e) { setError(e instanceof Error ? e.message : "Kunde inte ansluta. Försök igen."); }
    finally { setBusy(false); }
  }
  function leave() {
    send({ type: "leave" });
    if (!room?.isHost && identity) { try { localStorage.removeItem(storageKey(identity.roomId)); } catch {} }
    setIdentity(null); setRoomId(null); setError(""); setEditing(false); history.replaceState(null, "", "/");
  }
  function freshStart() {
    if (identity) { try { localStorage.removeItem(storageKey(identity.roomId)); } catch {} }
    setIdentity(null); setRoomId(null); setError(""); history.replaceState(null, "", "/");
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(`${location.origin}/?room=${room!.id}`); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { setError("Kopiera rumslänken från adressfältet."); }
  }
  async function download() {
    try {
      const response = await fetch(`/api/rooms/${identity!.roomId}/export`, { headers: { Authorization: `Bearer ${identity!.token}` } });
      if (!response.ok) throw new Error("Kunde inte hämta filen.");
      const url = URL.createObjectURL(await response.blob()); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `planning-poker-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { showError(e instanceof Error ? e.message : "Kunde inte hämta filen."); }
  }
  const errorBox = error && <div className="alert" role="alert"><span>{error}</span><button aria-label="Stäng meddelandet" onClick={() => setError("")}>×</button></div>;

  if (!identity) return <main className="landing"><header className="landing-header"><Brand/></header><section className="welcome"><h1>{roomId ? "Gå med i rum" : "Skapa rum"}</h1><p className="intro">{roomId ? "Ange ditt namn för att ansluta till rummet." : "Skapa ett rum och dela länken med deltagarna."}</p><form className="start-panel" onSubmit={enter}><label htmlFor="name">Vad heter du?</label><input id="name" autoComplete="given-name" placeholder="Ditt namn" value={name} onChange={e => setName(e.target.value)} maxLength={40} required/><button className="primary" disabled={!initialized || busy || !name.trim()}>{busy ? "Ansluter…" : roomId ? "Gå med i rummet" : "Skapa ett rum"}<span aria-hidden="true">↗</span></button>{errorBox}{roomId && <button className="text-button" type="button" onClick={freshStart}>Skapa ett eget rum i stället</button>}</form></section><div className="card-scene" aria-hidden="true"><div className="sample-card card-one"><small>STORY POINTS</small><strong>3</strong><span>3</span></div><div className="sample-card card-two"><small>STORY POINTS</small><strong>5</strong><span>5</span></div><div className="sample-card card-three"><small>STORY POINTS</small><strong>8</strong><span>8</span></div></div></main>;

  if (!room || connection === "expired") return <main className="loading-view"><Brand/><div className="loading-content"><div className="brand-icon">P</div><h1>{connection === "expired" ? "Rummet är inte tillgängligt." : "Ansluter…"}</h1><p>{connection === "expired" ? "Sessionen kan ha avslutats eller servern startats om." : connection === "offline" ? "Väntar på servern. Vi försöker igen automatiskt." : "Ansluter till ditt rum."}</p>{errorBox}{connection === "expired" && <button className="primary" onClick={freshStart}>Till startsidan</button>}</div></main>;

  const active = room.members.filter(p => p.online);
  const voted = active.filter(p => p.voted).length;
  const enabled = connection === "online" && !room.saving;
  const numeric = active.map(p => Number(p.vote)).filter(n => Number.isFinite(n) && n > 0);
  const consensus = numeric.length > 0 && numeric.length === active.length && numeric.every(n => n === numeric[0]);
  return <div className="workspace"><header className="room-header"><Brand/><div className="header-actions"><span className={`connection ${connection !== "online" ? "reconnecting" : ""}`} role="status"><span className="dot"/>{connection === "online" ? "Rummet är öppet" : "Återansluter…"}</span><button className="secondary share" onClick={copyLink}>{copied ? "Länk kopierad ✓" : "Dela rumslänk ↗"}</button><button className="text-button leave" onClick={leave}>Lämna</button></div></header><main className="room-main"><div className="room-intro"><div><h1>Estimering</h1></div><div className="session-meta"><strong>{String(room.history.length).padStart(2, "0")}</strong><span>uppgifter estimerade</span></div></div>{errorBox}{connection !== "online" && <div className="notice" role="status">Anslutningen avbröts. Vi återansluter automatiskt. Dina kort går att välja när du är ansluten igen.</div>}<div className="room-grid"><section className="play-area" aria-label="Aktuell omgång"><div className="task-header"><span className="eyebrow">AKTUELL UPPGIFT</span><span className="round">Omgång {room.round}</span></div>{room.isHost && (!room.title || editing) ? <form className="task-form" key={`${room.round}-${editing}`} onSubmit={event => { event.preventDefault(); const value = new FormData(event.currentTarget).get("title"); setError(""); send({ type: "title", value }); setEditing(false); }}><label htmlFor="task">Vad ska ni estimera?</label><div className="inline-form"><input id="task" name="title" placeholder="T.ex. Inloggning med SSO" defaultValue={room.title} maxLength={200} required/><button className="primary" disabled={!enabled}>Starta uppgift</button></div>{editing && <button type="button" className="text-button" onClick={() => setEditing(false)}>Avbryt</button>}</form> : <div className="task-title"><h2>{room.title || "Väntar på en uppgift"}</h2>{room.isHost && <button className="text-button" disabled={!enabled} onClick={() => setEditing(true)}>Ändra</button>}</div>}
<div className={`poker-table ${room.revealed ? "is-revealed" : ""}`}><div className="table-center"><span className="table-symbol" aria-hidden="true">{room.revealed ? "✧" : "✳"}</span><h3>{room.revealed ? consensus ? "Samma estimat" : "Rösterna visas" : voted === active.length && active.length > 0 ? "Alla har röstat" : "Välj estimat"}</h3><p>{room.revealed ? "Diskutera estimatet innan det sparas." : "Välj ett kort. Din röst är hemlig tills ni visar."}</p><span className="vote-count">{room.revealed ? "Röstning avslutad" : `${voted} av ${active.length} har röstat`}</span></div><div className="table-people">{active.map(person => <div className="seat" key={person.id}><div className={`mini-card ${room.revealed ? "face-up" : person.voted ? "voted" : "waiting"}`} aria-label={room.revealed ? `${person.name}: ${person.vote ?? "ingen röst"}` : `${person.name}: ${person.voted ? "har röstat" : "väntar"}`}>{room.revealed ? person.vote || "–" : person.voted ? "✳" : "···"}</div><span className="seat-name">{person.name}{person.id === room.me ? " (du)" : ""}</span></div>)}</div></div>
<div className="round-controls">{room.isHost ? <><button className="primary" disabled={!enabled || voted === 0 || room.revealed} onClick={() => { setError(""); send({ type: "reveal" }); }}>{room.revealed ? "Korten är visade ✓" : "Visa korten"}</button><button className="secondary" disabled={!enabled} onClick={() => { setError(""); send({ type: "reset" }); }}>Rösta om ↻</button></> : <span className="muted">{room.revealed ? "Facilitatorn väljer det gemensamma estimatet." : "Facilitatorn visar korten när ni är redo."}</span>}</div>
{room.revealed && room.isHost && <form key={room.round} className="save-form" onSubmit={event => { event.preventDefault(); setError(""); setLastSaved(room.history.length + 1); send({ type: "save", value: new FormData(event.currentTarget).get("estimate") }); }}><div><label htmlFor="estimate">Ert gemensamma estimat</label><p>Välj det ni kom överens om.</p></div><select id="estimate" name="estimate" defaultValue="" required disabled={!enabled}><option value="" disabled>Välj poäng</option>{CARDS.slice(0, 7).map(card => <option key={card}>{card}</option>)}</select><button className="primary" disabled={!enabled || !room.title}>{room.saving ? "Sparar…" : "Spara & gå vidare →"}</button>{!room.title && <p className="save-hint">Ge uppgiften ett namn ovan för att spara.</p>}</form>}
<section className="deck-area" aria-label="Dina kort"><div className="deck-heading"><h3>Ditt estimat</h3><span>{room.revealed ? "Röstningen är avslutad." : room.myVote ? `Du har valt ${room.myVote} · klicka igen för att ångra` : "Välj ett kort."}</span></div><div className="deck">{CARDS.map((card, index) => <button key={card} className={`vote-card ${room.myVote === card ? "selected" : ""}`} aria-label={card === "?" ? "Osäker" : card === "☕" ? "Behöver en paus" : `${card} story points`} aria-pressed={room.myVote === card} disabled={!enabled || room.revealed} onClick={() => { setError(""); send({ type: "vote", value: room.myVote === card ? null : card }); }}><span>{card}</span><small>{index < 7 ? index + 1 : card === "?" ? "?" : "C"}</small></button>)}</div><p className="keyboard-note">{room.revealed ? "Korten låses upp när nästa omgång börjar." : "Tips: tryck 1–7 på tangentbordet för att välja kort, ? för osäker och C för paus."}</p></section></section>
<aside className="sidebar"><section className="side-panel"><div className="panel-heading"><h2>Deltagare</h2><span className="number-badge">{active.length}</span></div><ul className="participant-list">{room.members.map((person, index) => <li key={person.id} className={!person.online ? "person-offline" : ""}><span className={`avatar avatar-${index % 4}`}>{person.name.slice(0, 2).toUpperCase()}</span><div className="person-name"><strong>{person.name}{person.id === room.me && <span> (du)</span>}</strong><small>{!person.online ? "Frånkopplad" : person.host ? "Facilitator" : "Deltagare"}</small></div><span className={`person-status ${person.voted && person.online ? "done" : ""}`} aria-label={!person.online ? "Frånkopplad" : room.revealed ? `Röst: ${person.vote ?? "ingen"}` : person.voted ? "Har röstat" : "Väntar"}>{!person.online ? "–" : room.revealed ? person.vote || "–" : person.voted ? "✓" : "·"}</span></li>)}</ul><button className="invite-link" onClick={copyLink}>{copied ? "Kopierat ✓" : "Kopiera rumslänk"}</button></section><section className="side-panel history-panel"><div className="panel-heading"><h2>Sparade estimat</h2><span className="number-badge">{room.history.length}</span></div>{room.history.length ? <ol className="history-list">{[...room.history].reverse().map((item, index) => <li key={`${item.timestamp}-${index}`}><div><strong>{item.title}</strong><small>{new Date(item.timestamp).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}</small></div><span className="estimate-badge">{item.estimate}</span></li>)}</ol> : <div className="empty-history"><span aria-hidden="true">↳</span><p>Inga sparade estimat.</p></div>}{room.isHost && <button className="export-button" disabled={!room.history.length || !enabled} onClick={download}>Hämta estimat som CSV <span aria-hidden="true">↓</span></button>}<p className="autosave" role="status"><span className="dot"/>{room.saving ? "Sparar till fil…" : lastSaved > 0 && room.history.length >= lastSaved ? "Estimat sparat till CSV" : "Estimat sparas till CSV"}</p></section></aside></div></main></div>;
}
