# RAINLINE

A low-poly, rain-soaked cyberpunk run-and-escape game. You're a freed mind in a
simulated city, hunted by suited Agents. Each round ends when you reach a
payphone and complete the call before they catch you.

Three.js + TypeScript + Vite. All art and (soon) audio is procedural — no external assets.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build
```

## Controls (run)

| Action | Keys |
| --- | --- |
| Switch lanes | A / D or ← / → |
| Jump (hold for higher) | W / Space / ↑ |
| Slide (mid-air: fast-fall) | S / Ctrl / ↓ |
| Sprint burst (cooldown) | Shift |
| Free-look | Mouse |
| Call at the payphone | hold E |
| Pause / abort | Esc, then Q |

## Code layout

```
src/
  config.ts              all tunables: speeds, timers, difficulty, XP, missions
  main.ts                registers states and starts the game
  core/                  Game loop, StateMachine, Input, seeded RNG, dispose helper
  save/                  localStorage persistence
  render/                palette, procedural textures, low-poly models
  ui/                    DOM helpers, run HUD, stylesheet
  modes/menu/            boot + main menu
  modes/hub/             hub (placeholder until milestone 4)
  modes/run/             RUN mode: RunState, Player, Chasers, Track (chunk streaming),
                         CityEnvironment (instanced scenery), RunWorld (camera/fog/rain), ResultState
```

State flow: `BOOT → MAIN_MENU → HUB → RUN → RESULT → HUB` (cutscene, training and
defense states are reserved in the state machine for later milestones).

## Milestones

- [x] 1. Scaffold, loop, state machine, input, playable RUN prototype
- [ ] 2. Run feel polish: junction turns, Agent ambushes, post-processing, audio
- [ ] 3. Apartment + rooftop themes, chunk generator difficulty scaling
- [ ] 4. Hub mode, NPCs, mission terminal, save/load
- [ ] 5. Skill tree + training mini-games
- [ ] 6. Skills wired into run mechanics
- [ ] 7. Comic cutscenes + 5-mission campaign
- [ ] 8. Defense alert mini-game, balancing, performance, polish
