import "./style.css";
import { StarlightGame } from "./game/StarlightGame";
import { AppUI } from "./ui/AppUI";

const canvas = document.getElementById("game-canvas");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Game canvas is unavailable");

const game = new StarlightGame(canvas);
const ui = new AppUI(game.settings, {
  enterVR: () => void game.enterVR().catch(() => ui.showToast("Could not start VR — try again from Quest Browser")),
  playDesktop: () => game.startDesktop(),
  calibrate: () => game.calibrate(),
  resume: () => game.resume(),
  recalibrate: () => game.recalibrate(),
  restart: () => game.restart(),
});
game.attachUI(ui);

game.initializeXR()
  .then((supported) => ui.setXRSupport(supported))
  .catch((error: unknown) => {
    console.warn("WebXR initialization failed; desktop mode remains available.", error);
    ui.setXRSupport(false);
  });
