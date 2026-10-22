// 12-team double elimination, display only: no scores, no advancing.
//
// Winners bracket
//   Round 1      W1: 8 v 9   W2: 5 v 12   W3: 6 v 11   W4: 7 v 10   (slots 1–4 have byes)
//   Quarters     W5: 1 v W1  W6: 4 v W2   W7: 3 v W3   W8: 2 v W4
//   Semis        W9: W5 v W6   W10: W7 v W8
//   Final        W11: W9 v W10
// Losers bracket (losers drop in crossed over, so nobody meets the same team twice early)
//   Round 1      L1: lose W1 v lose W8   L2: lose W2 v lose W7   L3: lose W3 v lose W6   L4: lose W4 v lose W5
//   Round 2      L5: L1 v L2   L6: L3 v L4
//   Round 3      L7: L5 v lose W10   L8: L6 v lose W9
//   Round 4      L9: L7 v L8
//   Final        L10: L9 v lose W11
// Grand final    GF: W11 v L10

export const MAX_TEAMS = 12
export const BYE_SLOTS = [1, 4, 3, 2]

// A side is { slot }, { winner: matchId } or { loser: matchId }.
const s = slot => ({ slot })
const w = winner => ({ winner })
const l = loser => ({ loser })
const m = (id, a, b) => ({ id, a, b })

export const BRACKET = [
  {
    id: 'winners',
    title: "Winners' bracket",
    rounds: [
      { id: 'w1', title: 'Round 1', matches: [m('W1', s(8), s(9)), m('W2', s(5), s(12)), m('W3', s(6), s(11)), m('W4', s(7), s(10))] },
      { id: 'w2', title: 'Quarterfinals', matches: [m('W5', s(1), w('W1')), m('W6', s(4), w('W2')), m('W7', s(3), w('W3')), m('W8', s(2), w('W4'))] },
      { id: 'w3', title: 'Semifinals', matches: [m('W9', w('W5'), w('W6')), m('W10', w('W7'), w('W8'))] },
      { id: 'w4', title: "Winners' final", matches: [m('W11', w('W9'), w('W10'))] },
      { id: 'gf', title: 'Grand final', matches: [m('GF', w('W11'), w('L10'))] },
    ],
  },
  {
    id: 'losers',
    title: "Losers' bracket",
    rounds: [
      { id: 'l1', title: 'Round 1', matches: [m('L1', l('W1'), l('W8')), m('L2', l('W2'), l('W7')), m('L3', l('W3'), l('W6')), m('L4', l('W4'), l('W5'))] },
      { id: 'l2', title: 'Round 2', matches: [m('L5', w('L1'), w('L2')), m('L6', w('L3'), w('L4'))] },
      { id: 'l3', title: 'Round 3', matches: [m('L7', w('L5'), l('W10')), m('L8', w('L6'), l('W9'))] },
      { id: 'l4', title: 'Round 4', matches: [m('L9', w('L7'), w('L8'))] },
      { id: 'l5', title: "Losers' final", matches: [m('L10', w('L9'), l('W11'))] },
    ],
  },
]

const MATCH_SECTION = {}
for (const section of BRACKET) for (const round of section.rounds) for (const match of round.matches) MATCH_SECTION[match.id] = section.id

/** The bye slot that sits above round-1 match `index` (its quarterfinal opponent). */
export function byeFor(index) {
  return BYE_SLOTS[index]
}

/** Caption under a TBD box: where that team comes from. */
export function sourceLabel(side) {
  if (side.slot) return `Slot ${side.slot} · bye`
  if (side.winner) return side.winner === 'L10' ? "Losers' champion" : side.winner === 'W11' ? "Winners' champion" : `Winner ${side.winner}`
  return `Loser ${side.loser}`
}

/**
 * Lines to draw inside one section: from a match (or a bye box) to the side of
 * the next match it feeds. Losers dropping in from the other bracket get a
 * caption instead of a line.
 * Each edge is { from, to, side } where from is a match id or 'bye-<slot>'.
 */
export function sectionEdges(section) {
  const edges = []
  section.rounds.forEach((round, r) => round.matches.forEach(match => {
    for (const side of ['a', 'b']) {
      const src = match[side]
      if (src.winner && MATCH_SECTION[src.winner] === section.id) edges.push({ from: src.winner, to: match.id, side })
      else if (src.slot && r > 0) edges.push({ from: `bye-${src.slot}`, to: match.id, side })
    }
  }))
  return edges
}

/** Every slot that appears in round 1 of the winners' bracket (1–12, each once). */
export function allSlots() {
  const first = BRACKET[0].rounds[0].matches.flatMap(x => [x.a.slot, x.b.slot])
  return [...BYE_SLOTS, ...first]
}

export function bySlot(entries) {
  const map = {}
  for (const e of entries || []) map[e.slot] = e
  return map
}

// Singles: one player per slot.
export const teamName = e => e.player_name
