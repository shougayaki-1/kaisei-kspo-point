# 2026 current-year rule-source matrix

This document is a traceability matrix for the current-year scoring capability work. It does not replace the authoritative competition document and does not complete a production `ConfigVersion`.

## Authoritative source

- Document: `第3回 開成運動交流祭 競技要領【詳細版】`
- Issuer: `第11期生徒会執行部`
- Source file reviewed: `競技要領【詳細版】.pdf`
- Length: 23 pages
- Important release note: page 1 says that score allocation and competition time may change. The PDF is therefore an implementation source for the current rules, but not a production-release approval by itself.

## Matrix

| Competition / source page | Authoritative raw fields | Derived formula | Comparison / ranking | Known point allocation | Known aggregation / topology | Implementation capability | Unresolved source information / release blocker |
|---|---|---|---|---|---|---|---|
| 五色綱引き (pp.2-4) | Normal rope count; 30m rope acquired state | `normalRopes * normalRopePoints + longRope * longRopePoints` | Higher set score wins | Normal rope 1 point; 30m rope 5 points | One match is described as two sets; the final tournament aggregation and matchup are not specified sufficiently for production | `WEIGHTED_SUM` raw-to-derived scorer; config-defined weights; Calculation Trace | Final tournament score, matchup, and two-set final aggregation; latest pre-event rule confirmation |
| 玉入れ (pp.5-7) | Basket count at the end of the event | Raw number is the comparison value | Higher is better; document states 1st-4th | 1st-4th order is stated, but no tournament aggregate point table is stated | Document says three teams per vertical class and also states 1st-4th; venue diagram shows four courts | Existing `NUMBER + HIGHER_IS_BETTER` generic scorer | Three-team/four-rank/four-court topology contradiction; tournament point table; tie rule; final topology confirmation |
| 王様ドッジボール (pp.8-11) | Non-PII role counts: king-out state, minister out count, knight out count | Opponent role score: `kingOut * kingPoints + ministerOutCount * ministerPoints + knightOutCount * knightPoints` | Higher match score wins; equal score is a draw | Win 2 points; draw 1 point each; opponent king-out bonus 1 point; role score values are king 5, minister 2, knight 1 | The document mentions 基礎期・充実期・発展期, but production session/match topology and tournament conversion are not fully specified | Explicit `KING_DODGEBALL + WIN_POINTS`; raw fields; draw and king bonus; Calculation Trace; no player names | Exact production session/match topology; tournament-total conversion; tie behavior outside the stated match draw; final rule confirmation |
| スポーツリバーシ (pp.12-14) | Normal mat count; giant mat acquired state | `normalMats * normalMatPoints + giantMat * giantMatPoints` | Higher own-side mat score wins | Normal mat 1 point; giant mat 8 points | One team has two matches; document also says three teams per vertical class; final aggregation is not specified | `WEIGHTED_SUM` raw-to-derived scorer; config-defined weights; Calculation Trace | Concrete match topology and final tournament score; three-team interpretation; tie rule; latest confirmation |
| リレー (pp.15-17) | Measured elapsed time; adjudicated total penalty time | `elapsed + penalty` | Shorter adjusted time ranks higher; 1st-4th stated | No tournament rank-point table is stated | Three races are stated | `ADJUSTED_TIME`; elapsed and penalty remain separate raw fields; no penalty-per-violation inference | Penalty seconds per violation are not stated; three-race aggregation and tournament point conversion; tie rule; latest confirmation |
| 台風の目 (pp.18-20) | Manual rank for each race | Rank is the configured comparison value | Lower rank number is better | 1st 50, 2nd 30, 3rd 20, 4th 10 | Two races; race points are summed for final competition rank | Existing `RANK_MANUAL + LOWER_IS_BETTER + RANK_POINTS + SUM`; complete non-production fixture and regression case added | Exact production entry/topology mapping, any tournament-wide conversion, tie behavior beyond the configured rank rule, final confirmation |
| 障害物リレー (pp.21-23) | Manual final rank of the 15th-pair anchor | Rank is the configured comparison value | Lower rank number is better; 1st-4th stated | No point table is stated | 1st-4th groups run simultaneously; anchor is the 15th pair | Existing generic manual-rank path can represent the raw ranking | Tournament rank-point table; aggregation and tie rule; final production topology/configuration; latest confirmation |

## Production-config decision

Do not create or activate `config/2026-kaisei-tournament.json` from this PDF alone. The matrix records capabilities and blockers, while the production file requires a verified final source, complete teams/entries/sessions, complete point tables, and regression cases for every active profile. No prior-year score sheet, memory, or inferred default is used to fill the gaps.

## Shared-path invariant

Derived values and match outcomes are calculated in the domain scoring engine. Host production scoring, saved `ScoringTestCase` regression, and simulator calls must use that same engine. Raw Result and immutable ConfigVersion data remain authoritative; scores and traces are derived projections.
