// Adapters turn a third-party live-scoreboard JSON into the UETMS import payload.
// Add a new adapter here and it instantly becomes selectable on a feed source.

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

// "28:14" / "1:05:09" -> seconds
function hmsToSeconds(v) {
  if (typeof v !== 'string' || !v.includes(':')) return null;
  const parts = v.split(':').map((x) => num(x, 0));
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/**
 * Decide which per-player counter actually holds kills.
 * Some scoreboard apps increment `knockCount` for every frag and never touch `elimCount`
 * (that is exactly what tochanparn.space does), others do the opposite.
 * We compare each column against the team's own totalKills and pick the one that matches.
 */
function resolveKillField(teams, mode = 'auto') {
  if (mode && mode !== 'auto') return mode;
  let elimHits = 0; let knockHits = 0; let sumElim = 0; let sumKnock = 0;
  for (const t of teams) {
    const players = Array.isArray(t.players) ? t.players : [];
    const e = players.reduce((s, p) => s + num(p.elimCount ?? p.elims ?? p.kills), 0);
    const k = players.reduce((s, p) => s + num(p.knockCount ?? p.knocks), 0);
    const total = num(t.totalKills ?? t.kills ?? t.score);
    sumElim += e; sumKnock += k;
    if (e === total) elimHits++;
    if (k === total) knockHits++;
  }
  if (elimHits > knockHits) return 'elim';
  if (knockHits > elimHits) return 'knock';
  return sumElim >= sumKnock ? 'elim' : 'knock';
}

/**
 * Placement is often missing mid-match ("rank":"-"). Derive it the BR way:
 * teams still alive rank above dead teams, and among dead teams the one that
 * survived longest placed higher.
 */
function derivePlacements(rows) {
  const sorted = [...rows].sort((a, b) => {
    const ar = Number(a.rank); const br = Number(b.rank);
    const aHas = Number.isFinite(ar) && ar > 0;
    const bHas = Number.isFinite(br) && br > 0;
    if (aHas && bHas) return ar - br;            // feed already gives a real rank
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (a.isDead !== b.isDead) return a.isDead ? 1 : -1;  // alive first
    if (b.survival !== a.survival) return b.survival - a.survival;
    if (b.elimTime !== a.elimTime) return b.elimTime - a.elimTime;
    if (b.kills !== a.kills) return b.kills - a.kills;
    return String(a.name).localeCompare(String(b.name));
  });
  sorted.forEach((row, i) => { row.placement = i + 1; });
  return sorted;
}

/**
 * tochanparn.space / Aditya Stream Studios style scoreboard:
 * { success, matchId, timestamp, data:[ { name, tag, slot, logo, score, totalKills,
 *   rank, isDead, eliminationTime, survivalSeconds, survivalTime,
 *   players:[ { name, knockCount, elimCount, knock, elim } ] } ] }
 */
function tochanparn(raw, opts = {}) {
  const list = Array.isArray(raw?.data) ? raw.data
    : Array.isArray(raw?.teams) ? raw.teams
      : Array.isArray(raw) ? raw : null;
  if (!list) throw new Error('Feed has no "data" array of teams');

  const killField = resolveKillField(list, opts.killField);

  const rows = list.map((t) => {
    const players = Array.isArray(t.players) ? t.players : [];
    const survival = num(t.survivalSeconds, hmsToSeconds(t.survivalTime) ?? 0);
    return {
      name: String(t.name ?? t.teamName ?? '').trim(),
      tag: t.tag ? String(t.tag).trim() : undefined,
      logo: t.logo || t.logoUrl || null,
      slot: t.slot ?? null,
      kills: num(t.totalKills ?? t.kills ?? t.score),
      rank: t.rank,
      isDead: Boolean(t.isDead),
      elimTime: num(t.eliminationTime),
      survival,
      players: players
        .map((p) => {
          const elim = num(p.elimCount ?? p.elims ?? p.kills);
          const knock = num(p.knockCount ?? p.knocks);
          const kills = killField === 'elim' ? elim : killField === 'sum' ? elim + knock : knock;
          return {
            ign: String(p.name ?? p.ign ?? '').trim(),
            kills,
            knocks: killField === 'elim' ? knock : 0,
            damage: num(p.damage ?? p.totalDamage),
            assists: num(p.assists),
            revives: num(p.revives),
            headshots: num(p.headshots),
          };
        })
        .filter((p) => p.ign),
    };
  }).filter((t) => t.name);

  if (!rows.length) throw new Error('No usable teams in feed');
  derivePlacements(rows);

  const alive = rows.filter((t) => !t.isDead).length;
  const finished = rows.length > 1 && alive <= 1;

  return {
    externalMatchId: raw?.matchId ? String(raw.matchId) : null,
    playedAt: raw?.timestamp ? new Date(num(raw.timestamp)).toISOString() : null,
    finished,
    aliveTeams: alive,
    killField,
    teams: rows
      .sort((a, b) => a.placement - b.placement)
      .map((t) => ({
        team: t.name,
        shortName: t.tag,
        logoUrl: t.logo,
        placement: t.placement,
        kills: t.kills,
        survivalTime: t.survival || undefined,
        players: t.players,
      })),
  };
}

/** Payload is already in UETMS import shape — just pass it through. */
function uetms(raw) {
  if (!Array.isArray(raw?.teams)) throw new Error('Expected a "teams" array in UETMS import format');
  const finishedFlag = raw.finished ?? true;
  return {
    externalMatchId: raw.externalMatchId ? String(raw.externalMatchId) : null,
    playedAt: raw.playedAt || null,
    finished: Boolean(finishedFlag),
    aliveTeams: 0,
    killField: 'native',
    teams: raw.teams,
  };
}

export const ADAPTERS = {
  tochanparn: { label: 'Live scoreboard (tochanparn / data[] format)', fn: tochanparn },
  uetms: { label: 'UETMS native import payload', fn: uetms },
};

export function detectAdapter(raw) {
  if (Array.isArray(raw?.teams) && raw.teams.some((t) => t && t.placement !== undefined)) return 'uetms';
  if (Array.isArray(raw?.data) || Array.isArray(raw)) return 'tochanparn';
  if (Array.isArray(raw?.teams)) return 'tochanparn';
  throw new Error('Could not detect feed format — pick an adapter manually');
}

/** Normalise any supported feed body into { externalMatchId, teams, finished, ... }. */
export function mapFeed(raw, { adapter = 'auto', killField = 'auto' } = {}) {
  const key = adapter && adapter !== 'auto' ? adapter : detectAdapter(raw);
  const entry = ADAPTERS[key];
  if (!entry) throw new Error(`Unknown adapter "${key}"`);
  return { adapter: key, ...entry.fn(raw, { killField }) };
}
