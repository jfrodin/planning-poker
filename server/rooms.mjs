import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';

export const CARDS = ['1', '2', '3', '5', '8', '13', '21', '?', '☕'];
const random = () => randomBytes(24).toString('base64url');
export function csvCell(value) {
  let text = String(value);
  if (/^[\s]*[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export const csvLine = values => values.map(csvCell).join(';') + '\r\n';
export const CSV_HEADER = '\uFEFF' + csvLine(['Tidpunkt', 'Rum', 'Uppgift', 'Estimat']);

export async function createStore(directory) {
  await mkdir(directory, { recursive: true });
  const filename = `session-${new Date().toISOString().replaceAll(':', '-')}-${randomBytes(3).toString('hex')}.csv`;
  const file = await open(path.join(directory, filename), 'wx', 0o600);
  await file.writeFile(CSV_HEADER);
  await file.sync();
  const rooms = new Map();
  let writes = Promise.resolve();
  function member(name, host = false) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 40) throw new Error('Skriv ett namn på högst 40 tecken.');
    return { id: random(), token: random(), name: name.trim(), host, vote: null, sockets: new Set() };
  }
  function create(name) {
    if (rooms.size >= 100) throw new Error('Servern har fullt med rum. Starta om för en ny session.');
    const person = member(name, true);
    const room = { id: random(), members: new Map([[person.id, person]]), title: '', revealed: false, round: 1, history: [], saving: false };
    rooms.set(room.id, room);
    return { room, person };
  }
  function get(id) {
    const room = rooms.get(id);
    if (!room) throw new Error('Rummet finns inte längre. Skapa ett nytt rum om servern har startats om.');
    return room;
  }
  function join(id, name) {
    const room = get(id);
    if (room.members.size >= 100) throw new Error('Rummet är fullt.');
    const person = member(name);
    room.members.set(person.id, person);
    return { room, person };
  }
  function authenticate(id, token) {
    const room = get(id);
    const person = [...room.members.values()].find(p => p.token === token);
    if (!person) throw new Error('Din anslutning till rummet har upphört. Gå med igen.');
    return { room, person };
  }
  function state(room, viewer) {
    return { id: room.id, title: room.title, round: room.round, revealed: room.revealed, saving: room.saving,
      me: viewer.id, isHost: viewer.host, myVote: viewer.vote, history: room.history,
      members: [...room.members.values()].map(p => ({ id: p.id, name: p.name, host: p.host,
        online: p.sockets.size > 0, voted: p.vote !== null, vote: room.revealed ? p.vote : null })) };
  }
  function broadcast(room) {
    for (const person of room.members.values()) {
      const payload = JSON.stringify({ type: 'state', state: state(room, person) });
      for (const socket of person.sockets) if (socket.readyState === 1) socket.send(payload);
    }
  }
  async function act(room, person, action) {
    if (room.saving) throw new Error('Estimatet sparas. Vänta ett ögonblick.');
    if (action.type === 'vote') {
      if (room.revealed) throw new Error('Korten är redan visade. Vänta till nästa omgång.');
      if (action.value !== null && !CARDS.includes(action.value)) throw new Error('Välj ett giltigt kort.');
      person.vote = action.value;
    } else {
      if (!person.host) throw new Error('Bara facilitatorn kan göra detta.');
      switch (action.type) {
        case 'title':
          if (typeof action.value !== 'string' || action.value.trim().length > 200) throw new Error('Uppgiften får vara högst 200 tecken.');
          // A new task starts with a fresh ballot, so votes cannot be reused accidentally.
          if (room.title !== action.value.trim()) {
            if (room.title || room.revealed || [...room.members.values()].some(p => p.vote !== null)) room.round++;
            room.title = action.value.trim(); room.revealed = false;
            for (const p of room.members.values()) p.vote = null;
          }
          break;
        case 'reveal':
          if (![...room.members.values()].some(p => p.vote !== null && p.sockets.size)) throw new Error('Vänta tills någon har röstat.');
          room.revealed = true;
          break;
        case 'reset':
          room.revealed = false; room.round++;
          for (const p of room.members.values()) p.vote = null;
          break;
        case 'save': {
          if (!room.revealed) throw new Error('Visa korten innan ni sparar estimatet.');
          if (!room.title) throw new Error('Skriv ett namn på uppgiften först.');
          if (!CARDS.slice(0, 7).includes(action.value)) throw new Error('Välj ett slutligt estimat.');
          const item = { timestamp: new Date().toISOString(), title: room.title, estimate: action.value };
          room.saving = true; broadcast(room);
          try {
            const write = writes.then(async () => { await file.writeFile(csvLine([item.timestamp, room.id, item.title, item.estimate])); await file.sync(); });
            writes = write.catch(() => {});
            await write;
            room.history.push(item); room.title = ''; room.revealed = false; room.round++;
            for (const p of room.members.values()) p.vote = null;
          } catch (error) {
            console.error('CSV write failed:', error);
            throw new Error('Kunde inte spara filen. Kontrollera diskutrymmet och försök igen. Omgången finns kvar.');
          } finally { room.saving = false; broadcast(room); }
          break;
        }
        default: throw new Error('Okänd åtgärd.');
      }
    }
    broadcast(room);
  }
  return { rooms, filename, create, join, get, authenticate, state, broadcast, act,
    exportRoom: room => CSV_HEADER + room.history.map(i => csvLine([i.timestamp, room.id, i.title, i.estimate])).join(''),
    readSession: () => readFile(path.join(directory, filename), 'utf8'),
    close: async () => { await writes; await file.close(); } };
}
