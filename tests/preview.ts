import { StarlightGame } from '../src/game/StarlightGame';
import { PlayerArm } from '../src/game/PlayerArm';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { FlightController } from '../src/game/FlightController';
import type { Scene } from '@babylonjs/core/scene';
import type { Engine } from '@babylonjs/core/Engines/engine';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import type { GameSettings } from '../src/game/types';

// Test-only access to the actual scene/controller; no debug hooks ship in the app.
const game = new StarlightGame(document.querySelector('canvas')!) as unknown as {
  scene: Scene; engine: Engine; flightRig: TransformNode;
  desktopCamera: UniversalCamera; flight: FlightController;
  settings: GameSettings;
};
const camera = game.desktopCamera;
camera.position.set(0, 1.65, 0);
camera.rotationQuaternion = Quaternion.Identity();
game.flight.calibrate();
const arms = [new PlayerArm(game.scene, game.flightRig, 'preview-left', true), new PlayerArm(game.scene, game.flightRig, 'preview-right', false)];
const input = (id: string) => document.getElementById(id) as HTMLInputElement;
function view(position: Vector3) {
  game.flight.reset(position, Vector3.Forward());
  camera.rotationQuaternion = Quaternion.Identity();
  game.flight.calibrate();
  input('head').value = '0';
  input('pitch').value = '20';
  input('heading').value = '0';
  input('fly').checked = false;
}
document.getElementById('city')!.onclick = () => view(new Vector3(0, 75, -180));
document.getElementById('forest')!.onclick = () => view(new Vector3(1550, 220, 100));
document.getElementById('connection')!.onclick = () => {
  view(new Vector3(720, 150, 450));
  game.flight.reset(new Vector3(720, 150, 450), new Vector3(1, 0, 0.2));
  game.flight.calibrate();
};
document.getElementById('arms')!.onclick = () => view(new Vector3(0, 180, -250));
let lastStats = 0;
game.scene.onBeforeRenderObservable.add(() => {
  const yaw = Number(input('heading').value) * Math.PI / 180;
  const length = Number(input('reach').value);
  const poses = (['left', 'right'] as const).map((side, i) => {
    const lift = Number(input(side).value) * Math.PI / 180;
    const direction = new Vector3(Math.sin(yaw) * Math.sin(lift), -Math.cos(lift), Math.cos(yaw) * Math.sin(lift));
    const shoulder = game.flight.getShoulderPosition(side);
    const position = shoulder.add(direction.scale(length));
    const rotation = Quaternion.Identity();
    Quaternion.FromUnitVectorsToRef(Vector3.Forward(), direction, rotation);
    arms[i].update(shoulder, position, rotation, shoulder.subtract(camera.position));
    return {position, handedness: side};
  });
  camera.rotationQuaternion = input('desktop').checked && input('fly').checked ? Quaternion.Identity()
    : Quaternion.FromEulerAngles(Number(input('pitch').value) * Math.PI / 180, Number(input('head').value) * Math.PI / 180, 0);
  const intent = game.flight.createXRIntent(poses);
  game.settings.comfortMode = input('comfort').checked;
  const desktop = input('desktop').checked;
  const telemetry = input('fly').checked ? game.flight.update(game.engine.getDeltaTime() / 1000,
    {throttle: desktop ? 1 : 0, brake: input('brake').checked ? 1 : 0, yaw:0, pitch:0}, undefined, desktop ? undefined : intent) : null;
  if (performance.now() - lastStats > 250) {
    document.getElementById('stats')!.textContent = `${telemetry ? `${(telemetry.speed * 3.6).toFixed(0)} km/h · ` : ''}Thrust: ${(intent.throttle * 100).toFixed(1)}% · Heading: ${intent.direction.asArray().map((x) => x.toFixed(2)).join(', ')} · ${game.engine.getFps().toFixed(0)} FPS · ${game.scene.getActiveMeshes().length} active meshes`;
    lastStats = performance.now();
  }
});
