import { Game } from './core/Game';
import { StateId } from './core/StateMachine';
import { BootState } from './modes/menu/BootState';
import { MainMenuState } from './modes/menu/MainMenuState';
import { HubState } from './modes/hub/HubState';
import { RunState } from './modes/run/RunState';
import { ResultState } from './modes/run/ResultState';

const game = new Game(document.getElementById('app')!, document.getElementById('ui')!);
const ctx = game.ctx;
game.register(new BootState(ctx), new MainMenuState(ctx), new HubState(ctx), new RunState(ctx), new ResultState(ctx));
game.start(StateId.BOOT);

// Handy for debugging from the console.
(window as unknown as { rainline: Game }).rainline = game;
