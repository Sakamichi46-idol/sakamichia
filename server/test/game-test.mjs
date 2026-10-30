const CODE = 'R' + Math.random().toString(36).slice(2, 7).toUpperCase();
const BASE = 'wss://sakamichia-draft.pnlg11vs18ge.workers.dev/api/room/' + CODE;
function client(name, token) {
  const c = { name, token, ws: new WebSocket(BASE), states: [], errors: [] };
  c.ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.t === 'state') c.states.push(m);
    if (m.t === 'error') c.errors.push(m.message);
  };
  c.ready = new Promise(res => { c.ws.onopen = () => res(); });
  c.send = o => c.ws.send(JSON.stringify(o));
  c.waitFor = async (fn, label, timeout = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const s = [...c.states].reverse().find(fn);
      if (s) return s;
      await new Promise(r => setTimeout(r, 60));
    }
    throw new Error('timeout: ' + label);
  };
  c.latest = () => c.states[c.states.length - 1];
  return c;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pool = Array.from({ length: 30 }, (_, i) => 'm' + (i + 1));
const A = client('主催者', 'tok-a'), B = client('参加者', 'tok-b');
await Promise.all([A.ready, B.ready]);
A.send({ t: 'hello', token: 'tok-a', name: '主催者', create: { code: 'ROOM' + Math.floor(Math.random()*900+100) + '', config: { kind: 'members', rounds: 3, maxPlayers: 4, pool, label: 'test' } } });
let s = await A.waitFor(m => m.state?.phase === 'lobby', 'lobby');
console.log('A created, you =', s.you, 'players =', s.state.players.length);
B.send({ t: 'hello', token: 'tok-b', name: '参加者' });
s = await B.waitFor(m => m.state?.players.length === 2, 'B joined');
console.log('B joined, you =', s.you);
B.send({ t: 'start' });
await sleep(300);
console.log('B start rejected (host only):', B.errors.join(' | ') || 'NO ERROR?!');
A.send({ t: 'start' });
s = await A.waitFor(m => m.state?.phase === 'active', 'active');
console.log('game started, round =', s.state.session.round);
// round 1: both pick m1 (contested)
A.send({ t: 'pick', item: 'm1' });
await sleep(150);
B.send({ t: 'pick', item: 'm1' });
s = await A.waitFor(m => (m.state?.lastEvents || []).length > 0, 'resolved');
const ev = s.state.lastEvents[0];
console.log('contested resolve: winner =', ev.winner, 'contested =', ev.wasContested, 'loser must repick, round stays', s.state.session.round);
// loser repicks
const loser = ev.winner === 'p1' ? B : A;
loser.send({ t: 'pick', item: 'm2' });
s = await A.waitFor(m => m.state?.session?.round === 2, 'round 2');
console.log('round 2 reached. acquired:', JSON.stringify(s.state.session.acquired));
// rounds 2,3: distinct picks
for (const [a, b] of [['m3', 'm4'], ['m5', 'm6']]) {
  A.send({ t: 'pick', item: a });
  await sleep(120);
  B.send({ t: 'pick', item: b });
  await sleep(250);
}
s = await A.waitFor(m => m.state?.phase === 'finished', 'finished');
console.log('finished. acquired:', JSON.stringify(s.state.session.acquired));
A.send({ t: 'setlist', order: s.state.session.acquired.p1, encAt: 2, title: 'Aのセトリ' });
await sleep(250);
console.log('setlist shared:', JSON.stringify(B.latest().state.setlists));
B.send({ t: 'backToLobby' });
await sleep(200);
A.send({ t: 'backToLobby' });
s = await A.waitFor(m => m.state?.phase === 'lobby', 'back to lobby');
console.log('back to lobby ok');
A.ws.close(); B.ws.close();
console.log('ALL PASS');
