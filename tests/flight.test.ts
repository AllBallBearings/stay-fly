import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { FlightController, type XRControllerPose } from '../src/game/FlightController';
import { PlayerArm } from '../src/game/PlayerArm';
import { SkyWorld } from '../src/game/Course';

const engine = new NullEngine();
const neutral = { throttle: 0, brake: 0, yaw: 0, pitch: 0 };
const near = (a: number, b: number, tolerance = 1e-5) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const aligned = (a: Vector3, b: Vector3) => assert.ok(Vector3.Dot(a.normalizeToNew(), b.normalizeToNew()) > 0.99999);
let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`PASS ${name}`);
}
function setup(head = Quaternion.Identity(), start = Vector3.Forward()) {
  const scene = new Scene(engine);
  const rig = new TransformNode('rig', scene);
  const camera = new UniversalCamera('camera', new Vector3(0, 1.65, 0), scene);
  camera.parent = rig;
  camera.rotationQuaternion = head;
  const flight = new FlightController(rig, camera, { comfortMode: false, vignette: true }, {center: Vector3.Zero(), radius: 4500});
  flight.reset(new Vector3(0, 100, 0), start);
  flight.calibrate();
  function pose(side: 'left' | 'right', direction: Vector3, length = 0.65): XRControllerPose {
    return { handedness: side, position: flight.getShoulderPosition(side).add(direction.normalizeToNew().scale(length)) };
  }
  return {scene, rig, camera, flight, pose};
}

check('rest is zero; small lifts start slowly; raising either arm is monotonic to half speed', () => {
  const {flight, pose} = setup();
  for (const side of ['left', 'right'] as const) {
    let previous = -1;
    for (let i = 0; i <= 90; i++) {
      const angle = i * Math.PI / 180;
      const intent = flight.createXRIntent([pose(side, new Vector3(0, -Math.cos(angle), Math.sin(angle)))]);
      assert.ok(intent.throttle >= previous - 1e-9);
      assert.ok(intent.throttle <= 0.5);
      if (i === 0) near(intent.throttle, 0);
      if (i === 10) assert.ok(intent.throttle > 0 && intent.throttle < 0.01);
      previous = intent.throttle;
    }
    near(previous, 0.5);
  }
});
check('pulling a raised hand back reduces speed continuously to zero', () => {
  const {flight, pose} = setup();
  let previous = 1;
  for (let length = 0.65; length >= 0.05; length -= 0.01) {
    const intent = flight.createXRIntent([pose('left', Vector3.Forward(), length)]);
    assert.ok(intent.throttle <= previous + 1e-9);
    previous = intent.throttle;
  }
  near(previous, 0);
});
check('second arm adds thrust without a mode-switch jump; equal reaches average centrally', () => {
  const {flight, pose} = setup();
  let previous = 0.5;
  for (let i = 0; i <= 90; i++) {
    const angle = i * Math.PI / 180;
    const intent = flight.createXRIntent([pose('left', Vector3.Forward()), pose('right', new Vector3(0, -Math.cos(angle), Math.sin(angle)))]);
    assert.ok(intent.throttle >= previous - 1e-9);
    assert.ok(intent.throttle - previous < 0.015);
    previous = intent.throttle;
  }
  near(previous, 1);
  const arms = [pose('left', new Vector3(-0.4, 0, 1)), pose('right', new Vector3(0.4, 0, 1))];
  aligned(flight.createXRIntent(arms).direction, Vector3.Forward());
});
check('looking around does not steer; moving arms toward the new gaze does steer', () => {
  const {flight, camera, pose} = setup();
  const arms = [pose('left', Vector3.Forward())];
  const before = flight.createXRIntent(arms);
  camera.rotationQuaternion = Quaternion.FromEulerAngles(-0.3, Math.PI / 2, 0.2);
  aligned(flight.createXRIntent(arms).direction, before.direction);
  const gaze = Vector3.Zero();
  Vector3.Forward().rotateByQuaternionToRef(camera.rotationQuaternion, gaze);
  aligned(flight.createXRIntent([pose('left', gaze)]).direction, gaze);
});
check('non-neutral calibration: flight direction agrees with rendered shoulder-to-hand vector', () => {
  const {flight, rig, pose} = setup(Quaternion.FromEulerAngles(0.6, 1.2, 0.3), new Vector3(1, 0.15, 1));
  const hand = pose('right', new Vector3(0.5, 0.2, 0.4));
  rig.computeWorldMatrix(true);
  const worldHand = Vector3.TransformCoordinates(hand.position, rig.getWorldMatrix());
  const worldShoulder = Vector3.TransformCoordinates(flight.getShoulderPosition('right'), rig.getWorldMatrix());
  aligned(flight.createXRIntent([hand]).direction, worldHand.subtract(worldShoulder));
});
check('calibrated prone rest hovers and forward extension flies', () => {
  const {flight, pose} = setup(Quaternion.FromEulerAngles(Math.PI / 2, 0, 0));
  const rest = [pose('left', new Vector3(0, 0, -1)), pose('right', new Vector3(0, 0, -1))];
  flight.calibrate(rest);
  near(flight.createXRIntent(rest).throttle, 0);
  near(flight.createXRIntent([pose('left', Vector3.Down()), pose('right', Vector3.Down())]).throttle, 1);
});
check('90 and 180 degree turns settle quickly at 72/90/120 Hz without rotating the view', () => {
  for (const fps of [72, 90, 120]) for (const direction of [Vector3.Right(), new Vector3(0, 0, -1)]) {
    const {flight, rig, pose} = setup();
    for (let i = 0; i < fps; i++) flight.update(1 / fps, neutral, undefined, flight.createXRIntent([pose('left', Vector3.Forward())]));
    const rigRotation = rig.rotationQuaternion!.clone();
    let delta = Vector3.Zero();
    for (let i = 0; i < Math.ceil(fps * 0.15); i++) {
      const before = rig.position.clone();
      flight.update(1 / fps, neutral, undefined, flight.createXRIntent([pose('left', direction)]));
      delta = rig.position.subtract(before);
      assert.ok(delta.length() > 0.01 && Number.isFinite(delta.length()));
      if (i === 0) assert.ok(Vector3.Dot(delta.normalizeToNew(), direction) < 0.99, 'must smooth the first frame');
    }
    assert.ok(Vector3.Dot(delta.normalizeToNew(), direction) > 0.996);
    near(Quaternion.Dot(rigRotation, rig.rotationQuaternion!), 1);
  }
});
check('hands down and tracking loss stop exactly, with no altitude drift at 300 m', () => {
  const {flight, rig, pose} = setup();
  rig.position.y = 300;
  for (let i = 0; i < 90; i++) flight.update(1 / 90, neutral, undefined, flight.createXRIntent([pose('left', Vector3.Forward())]));
  const position = rig.position.clone();
  for (let i = 0; i < 180; i++) {
    const telemetry = flight.update(1 / 90, neutral, undefined, flight.createXRIntent(i < 90 ? [pose('left', Vector3.Down())] : []));
    near(telemetry.speed, 0);
  }
  near(Vector3.Distance(position, rig.position), 0);
});
check('boundary contains motion and allows immediate inward departure', () => {
  const {flight, rig, pose} = setup();
  rig.position.set(4499, 0, 0);
  for (let i = 0; i < 90; i++) flight.update(1 / 90, neutral, undefined, flight.createXRIntent([pose('left', Vector3.Right())]));
  assert.ok(rig.position.length() <= 4500.00001);
  for (let i = 0; i < 90; i++) flight.update(1 / 90, neutral, undefined, flight.createXRIntent([pose('left', Vector3.Left())]));
  assert.ok(rig.position.length() < 4480);
});
check('grip axes orient both hand models anatomically, including arbitrary controller rotation', () => {
  for (const left of [true, false]) for (const grip of [Quaternion.Identity(), Quaternion.FromEulerAngles(0.7, -1.2, 0.4)]) {
    const rotation = PlayerArm.rotationFromGrip(grip, left);
    const dorsal = Vector3.Up();
    dorsal.rotateByQuaternionToRef(rotation, dorsal);
    const expectedDorsal = new Vector3(left ? -1 : 1, 0, 0);
    expectedDorsal.rotateByQuaternionToRef(grip, expectedDorsal);
    aligned(dorsal, expectedDorsal);
    const thumb = new Vector3(left ? 1 : -1, 0, 0);
    thumb.rotateByQuaternionToRef(rotation, thumb);
    const expectedThumb = Vector3.Forward();
    expectedThumb.rotateByQuaternionToRef(grip, expectedThumb);
    aligned(thumb, expectedThumb);
  }
});
check('visible hands match tracked grips with locally merged geometry in a translated rig', () => {
  const {scene, rig, flight, pose} = setup();
  const arm = new PlayerArm(scene, rig, 'test-left', true);
  for (const length of [0.12, 0.35, 0.65, 0.8]) {
    const hand = pose('left', new Vector3(1, 0.3, 1), length);
    arm.update(flight.getShoulderPosition('left'), hand.position, Quaternion.Identity(), new Vector3(-1, -1, 0));
    const fist = scene.getTransformNodeByName('fist-test-left')!;
    near(Vector3.Distance(fist.position, hand.position), 0);
    const handMesh = scene.getMeshByName('test-left-closed-hand')!;
    handMesh.computeWorldMatrix(true);
    const worldGrip = Vector3.TransformCoordinates(hand.position, rig.computeWorldMatrix(true));
    const bounds = handMesh.getBoundingInfo().boundingBox;
    assert.ok(Vector3.Distance(bounds.centerWorld, worldGrip) < 0.05, 'hand must not double the rig translation');
    assert.ok(bounds.extendSize.length() < 0.12, 'hand stays human-sized');
    for (const mesh of arm.root.getChildMeshes()) assert.ok(mesh.position.asArray().every(Number.isFinite));
  }
  arm.dispose();
  assert.equal(scene.getTransformNodeByName('fist-test-left'), null);
});
check('expanded world builds and batches correctly with city, forest and enclosing sphere', () => {
  const scene = new Scene(engine);
  const world = new SkyWorld(scene);
  assert.ok(scene.getTransformNodeByName('neon-city'));
  assert.ok(scene.getTransformNodeByName('quiet-grove'));
  assert.ok(scene.getTextureByName('city-facade'));
  assert.ok(scene.meshes.length < 1500, `unbatched meshes: ${scene.meshes.length}`);
  for (const mesh of scene.meshes) {
    assert.ok(mesh.getTotalVertices() > 0, `empty geometry: ${mesh.name}`);
    mesh.computeWorldMatrix(true);
    assert.ok(mesh.getBoundingInfo().boundingBox.centerWorld.asArray().every(Number.isFinite));
  }
  assert.ok(world.flightBounds.radius > 4000);
  console.log(`World: ${scene.meshes.length} batches, ${scene.meshes.reduce((sum, mesh) => sum + mesh.getTotalVertices(), 0)} vertices`);
  scene.dispose();
});
engine.dispose();
console.log(`${passed} regression checks passed.`);
