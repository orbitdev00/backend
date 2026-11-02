// 16-player double elimination, display only: no scores, no advancing.
//
// Winners bracket (slots 1–12 kept their old round-1 games; 1–4 now play 13–16 instead of a bye)
//   Round 1      W1: 1 v 16  W2: 8 v 9   W3: 4 v 13  W4: 5 v 12  W5: 3 v 14  W6: 6 v 11  W7: 2 v 15  W8: 7 v 10
//   Quarters     W9: W1 v W2   W10: W3 v W4   W11: W5 v W6   W12: W7 v W8
//   Semis        W13: W9 v W10   W14: W11 v W12
//   Final        W15: W13 v W14
// Losers bracket (losers drop in crossed over, so nobody meets the same player twice early)
//   Round 1      L1: lose W1 v lose W2   L2: lose W3 v lose W4   L3: lose W5 v lose W6   L4: lose W7 v lose W8
//   Round 2      L5: L1 v lose W12   L6: L2 v lose W11   L7: L3 v lose W10   L8: L4 v lose W9
//   Round 3      L9: L5 v L6   L10: L7 v L8
//   Round 4      L11: L9 v lose W14   L12: L10 v lose W13
//   Round 5      L13: L11 v L12
//   Final        L14: L13 v lose W15
// Grand final    GF: W15 v L14

export const MAX_TEAMS = 16

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
      {
        id: 'w1', title: 'Round 1', matches: [
          m('W1', s(1), s(16)), m('W2', s(8), s(9)), m('W3', s(4), s(13)), m('W4', s(5), s(12)),
          m('W5', s(3), s(14)), m('W6', s(6), s(11)), m('W7', s(2), s(15)), m('W8', s(7), s(10)),
        ],
      },
      { id: 'w2', title: 'Quarterfinals', matches: [m('W9', w('W1'), w('W2')), m('W10', w('W3'), w('W4')), m('W11', w('W5'), w('W6')), m('W12', w('W7'), w('W8'))] },
      { id: 'w3', title: 'Semifinals', matches: [m('W13', w('W9'), w('W10')), m('W14', w('W11'), w('W12'))] },
      { id: 'w4', title: "Winners' final", matches: [m('W15', w('W13'), w('W14'))] },
      { id: 'gf', title: 'Grand final', matches: [m('GF', w('W15'), w('L14'))] },
    ],
  },
  {
    id: 'losers',
    title: "Losers' bracket",
    rounds: [
      { id: 'l1', title: 'Round 1', matches: [m('L1', l('W1'), l('W2')), m('L2', l('W3'), l('W4')), m('L3', l('W5'), l('W6')), m('L4', l('W7'), l('W8'))] },
      { id: 'l2', title: 'Round 2', matches: [m('L5', w('L1'), l('W12')), m('L6', w('L2'), l('W11')), m('L7', w('L3'), l('W10')), m('L8', w('L4'), l('W9'))] },
      { id: 'l3', title: 'Round 3', matches: [m('L9', w('L5'), w('L6')), m('L10', w('L7'), w('L8'))] },
      { id: 'l4', title: 'Round 4', matches: [m('L11', w('L9'), l('W14')), m('L12', w('L10'), l('W13'))] },
      { id: 'l5', title: 'Round 5', matches: [m('L13', w('L11'), w('L12'))] },
      { id: 'l6', title: "Losers' final", matches: [m('L14', w('L13'), l('W15'))] },
    ],
  },
]

const MATCH_SECTION = {}
for (const section of BRACKET) for (const round of section.rounds) for (const match of round.matches) MATCH_SECTION[match.id] = section.id

/** Caption under a TBD box: where that team comes from. */
export function sourceLabel(side) {
  if (side.winner) return side.winner === 'L14' ? "Losers' champion" : side.winner === 'W15' ? "Winners' champion" : `Winner ${side.winner}`
  return `Loser ${side.loser}`
}

/**
 * Lines to draw inside one section: from a match to the side of the next
 * match it feeds. Losers dropping in from the other bracket get a
 * caption instead of a line.
 * Each edge is { from, to, side }.
 */
export function sectionEdges(section) {
  const edges = []
  section.rounds.forEach(round => round.matches.forEach(match => {
    for (const side of ['a', 'b']) {
      const src = match[side]
      if (src.winner && MATCH_SECTION[src.winner] === section.id) edges.push({ from: src.winner, to: match.id, side })
    }
  }))
  return edges
}

/** Every slot that appears in round 1 of the winners' bracket (1–16, each once). */
export function allSlots() {
  return BRACKET[0].rounds[0].matches.flatMap(x => [x.a.slot, x.b.slot])
}

export function bySlot(entries) {
  const map = {}
  for (const e of entries || []) map[e.slot] = e
  return map
}

// Singles: one player per slot.
export const teamName = e => e.player_name
