import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scalar } from '@babylonjs/core/Maths/math.scalar';
import { FlightController, type XRControllerPose } from '../src/game/FlightController';
import { PlayerArm } from '../src/game/PlayerArm';
import { SkyWorld } from '../src/game/Course';
import { getWorldNavigation, REGION_CONNECTIONS, WORLD_REGIONS } from '../src/game/WorldNavigation';
import { terrainDisk, terrainHeight, terrainStrip } from '../src/game/Terrain';
import { combinedRoll, handBankAngle, headBankAngle } from '../src/game/VRRoll';
import { RollController } from '../src/game/RollController';
import { DesktopControls } from '../src/game/DesktopControls';
import { WebcamControls } from '../src/game/webcam/WebcamControls';
import type { TrackingSample } from '../src/game/webcam/types';

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
function setup(head = Quaternion.Identity(), start = Vector3.Forward(), rollMode: 'assisted' | 'free' = 'assisted') {
  const scene = new Scene(engine);
  const rig = new TransformNode('rig', scene);
  const camera = new UniversalCamera('camera', new Vector3(0, 1.65, 0), scene);
  camera.parent = rig;
  camera.rotationQuaternion = head;
  const flight = new FlightController(rig, camera, { comfortMode: false, vignette: true, rollMode }, {center: Vector3.Zero(), radius: 4500});
  flight.reset(new Vector3(0, 100, 0), start);
  flight.calibrate();
  function pose(side: 'left' | 'right', direction: Vector3, length = 0.65): XRControllerPose {
    return { handedness: side, position: flight.getShoulderPosition(side).add(direction.normalizeToNew().scale(length)) };
  }
  return {scene, rig, camera, flight, pose};
}

check('desktop reaches high speed quickly in both modes and brakes without changing VR limits', () => {
  for (const comfortMode of [true, false]) for (const fps of [60, 120]) {
    const {scene, rig, camera} = setup();
    const flight = new FlightController(rig, camera, {comfortMode, vignette: true});
    flight.calibrate();
    let telemetry = flight.update(0, neutral);
    const max = comfortMode ? 100 : 160;
    for (let i = 0; i < fps; i++) telemetry = flight.update(1 / fps, {...neutral, throttle: 1});
    assert.ok(telemetry.speed > max * 0.93, `slow acceleration: ${telemetry.speed}`);
    for (let i = 0; i < fps * 2; i++) telemetry = flight.update(1 / fps, {...neutral, throttle: 1});
    assert.ok(Math.abs(telemetry.speed - max) < 0.1);
    for (let i = 0; i < fps; i++) telemetry = flight.update(1 / fps, {...neutral, throttle: 1, brake: 1});
    assert.ok(telemetry.speed < 3, `weak brakes: ${telemetry.speed}`);
    for (let i = 0; i < fps * 3; i++) telemetry = flight.update(1 / fps, {...neutral, throttle: 0.2});
    assert.ok(Math.abs(telemetry.speed - max * 0.2) < 0.1);
    for (let i = 0; i < fps * 2; i++) telemetry = flight.update(1 / fps, neutral, undefined, {active:true, throttle:1, direction:Vector3.Forward()});
    assert.ok(Math.abs(telemetry.speed - (comfortMode ? 70 : 140)) < 0.01);
    scene.dispose();
  }
});
check('webcam calibration maps rest, one/two-arm thrust, right turns, climbs and stale safety hover', () => {
  const controls = new WebcamControls();
  const sample = (time: number, options: {lift?: number; leftLift?: number; rightLift?: number; shiftX?: number; open?: boolean; uncertain?: boolean; handScale?: number; flatWorld?: boolean} = {}): TrackingSample => {
    const image = Array.from({length: 33}, () => ({x: .5, y: .5, z: 0, visibility: 1}));
    const world = Array.from({length: 33}, () => ({x: 0, y: 0, z: 0, visibility: 1}));
    image[11].x = .64; image[12].x = .36;
    const leftLift = options.leftLift ?? options.lift ?? 0;
    const rightLift = options.rightLift ?? options.lift ?? 0;
    image[15] = {x: .58 + (options.shiftX ?? 0), y: .85 - .35 * leftLift, z: 0, visibility: 1};
    image[16] = {x: .42 + (options.shiftX ?? 0), y: .85 - .35 * rightLift, z: 0, visibility: 1};
    world[11].x = -.18; world[12].x = .18;
    world[15] = {x: -.18, y: 0, z: -(options.flatWorld ? .15 : .15 + .5 * leftLift), visibility: 1};
    world[16] = {x: .18, y: 0, z: -(options.flatWorld ? .15 : .15 + .5 * rightLift), visibility: 1};
    const hand = (x: number, y: number) => {
      const scale = options.handScale ?? 1;
      const points = Array.from({length: 21}, () => ({x, y, z: 0}));
      for (const [finger, dx] of [[5,-.06],[9,-.02],[13,.02],[17,.06]] as const) {
        points[finger] = {x:x + dx * scale, y:y - .02 * scale, z:0};
        points[finger + 1] = {x:x + dx * scale, y:y - .07 * scale, z:0};
        points[finger + 2] = {x:x + dx * scale, y:y - .10 * scale, z:0};
        const tip = finger + 3;
        const extended = options.open || (options.uncertain && finger <= 9);
        points[tip] = extended ? {x:x + dx * 1.25 * scale, y:y - .18 * scale, z:0} : {x:x + dx * .25 * scale, y:y - .025 * scale, z:0};
      }
      return {landmarks: points};
    };
    return {generation: 1, frameId: time, capturedAtMs: time, inferenceMs: 35, pose: {image, world}, face: {matrix: [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1], landmarks: []}, hands: [hand(image[15].x, image[15].y), hand(image[16].x, image[16].y)]};
  };
  for (let i = 0; i < 8; i++) controls.addSample(sample(500 + i * 50, {open: true}));
  assert.ok(controls.captureRest(900));
  for (let i = 0; i < 8; i++) controls.addSample(sample(1000 + i * 50, {lift: 1, uncertain: true}));
  assert.ok(controls.captureReach(1400));
  controls.addSample(sample(1450));
  assert.equal(controls.read(1450, 1 / 60).hover, true);
  let intent = controls.read(1450, 1 / 60);
  for (let i = 0; i < 30; i++) {
    controls.addSample(sample(1500 + i, {lift: 1}));
    intent = controls.read(1500 + i, 1 / 60);
  }
  assert.ok(intent.throttle > .95 && intent.throttle <= 1);
  controls.addSample(sample(1550, {lift: 1, open: true}));
  assert.equal(controls.read(1550, 1 / 60).hover, true, "an open palm must stop flight immediately");
  controls.addSample(sample(1600, {leftLift: 1, rightLift: 0}));
  for (let i = 0; i < 30; i++) intent = controls.read(1600, 1 / 60);
  assert.ok(intent.throttle <= .51);
  controls.addSample(sample(1700, {lift: 1, shiftX: -.18}));
  for (let i = 0; i < 30; i++) intent = controls.read(1700, 1 / 60);
  assert.ok(intent.yaw > .5, `right turn ${intent.yaw}`);
  controls.addSample(sample(1800, {lift: 1}));
  const climbing = sample(1810, {lift: 1}); climbing.pose!.image[15].y -= .15; climbing.pose!.image[16].y -= .15;
  controls.addSample(climbing);
  for (let i = 0; i < 30; i++) intent = controls.read(1810, 1 / 60);
  assert.ok(intent.pitch < -.3, `climb ${intent.pitch}`);
  assert.equal(controls.read(2200, 1 / 60).hover, true);

  const depthControls = new WebcamControls();
  for (let i = 0; i < 8; i++) depthControls.addSample(sample(3000 + i * 50, {open: true, flatWorld: true}));
  assert.ok(depthControls.captureRest(3400));
  for (let i = 0; i < 8; i++) depthControls.addSample(sample(3500 + i * 50, {lift: 1, uncertain: true, flatWorld: true, handScale: 1.7}));
  assert.ok(depthControls.captureReach(3900), depthControls.getCalibrationIssue());
  for (let i = 0; i < 30; i++) {
    depthControls.addSample(sample(4000 + i, {lift: 1, flatWorld: true, handScale: 1.7}));
    intent = depthControls.read(4000 + i, 1 / 60);
  }
  assert.ok(intent.throttle > .95, `foreshortened arm depth throttle ${intent.throttle}`);
});
check('webcam exact hover clears desktop speed and steering immediately', () => {
  const {scene, flight} = setup();
  for (let i = 0; i < 60; i++) flight.update(1 / 60, {...neutral, throttle: 1, yaw: 1});
  const telemetry = flight.update(1 / 60, {...neutral, hover: true});
  near(telemetry.speed, 0);
  scene.dispose();
});
check('district navigation follows the viewing heading and all regions share a connected route network', () => {
  const city = WORLD_REGIONS[0];
  const facingNorth = getWorldNavigation(city.position, Vector3.Forward());
  assert.equal(facingNorth.region, 'Neon City');
  assert.ok(facingNorth.directions.includes('→ Quiet Forest'));
  const facingEast = getWorldNavigation(city.position, Vector3.Right());
  assert.ok(facingEast.directions.includes('↑ Quiet Forest'));
  assert.equal(getWorldNavigation(WORLD_REGIONS[1].position, Vector3.Forward()).region, 'Quiet Forest');
  assert.equal(getWorldNavigation(new Vector3(3500, 0, 3500), Vector3.Forward()).region, 'Between districts');
  const visited = new Set<string>([city.id]);
  for (let i = 0; i < WORLD_REGIONS.length; i++) for (const [a,b] of REGION_CONNECTIONS) {
    if (visited.has(a) || visited.has(b)) { visited.add(a); visited.add(b); }
  }
  assert.equal(visited.size, WORLD_REGIONS.length);
});
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
      if (i === 10) assert.ok(intent.throttle > 0 && intent.throttle < 0.08);
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
check('two-step calibration maps each player reach to full thrust and rejects an accidental rest capture', () => {
  const {flight, pose} = setup();
  const rest = [pose('left', Vector3.Down(), 0.54), pose('right', Vector3.Down(), 0.58)];
  flight.calibrateHover(rest);
  assert.equal(flight.calibrateFullReach(rest), 0);
  const full = [pose('left', Vector3.Forward(), 0.82), pose('right', Vector3.Forward(), 0.76)];
  assert.equal(flight.calibrateFullReach(full), 2);
  near(flight.createXRIntent(full).throttle, 1);
  const medium = [pose('left', Vector3.Forward(), 0.66)];
  const mediumThrottle = flight.createXRIntent(medium).throttle;
  assert.ok(mediumThrottle > 0 && mediumThrottle < 0.5, `uncalibrated gradient: ${mediumThrottle}`);
  near(flight.createXRIntent([pose('left', Vector3.Forward(), 0.72)]).throttle, 0.5);
  near(flight.createXRIntent([pose('left', Vector3.Forward(), 0.82)]).throttle, 0.5);
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
check('roll requires matching head and hand tilt, with a quiet neutral deadzone', () => {
  const {flight, camera, pose} = setup();
  const forward = [pose('left', Vector3.Forward()), pose('right', Vector3.Forward())];
  const bank = (sign: number) => [pose('left', new Vector3(0, sign * 0.2, 1)), pose('right', new Vector3(0, -sign * 0.2, 1))];
  for (const sign of [-1, 1]) {
    camera.rotationQuaternion = Quaternion.Identity();
    near(flight.createXRIntent(bank(sign)).roll ?? 0, 0);
    camera.rotationQuaternion = Quaternion.FromEulerAngles(0, 0, -sign * Math.PI / 7);
    near(flight.createXRIntent(forward).roll ?? 0, 0);
    const intent = flight.createXRIntent(bank(sign));
    assert.ok((intent.roll ?? 0) * sign > 0.8);
    near(flight.createXRIntent(bank(-sign)).roll ?? 0, 0);
    near(flight.createXRIntent([bank(sign)[0]]).roll ?? 0, 0);
    near(flight.createXRIntent([pose('left', Vector3.Down()), pose('right', Vector3.Down())]).roll ?? 0, 0);
  }
  near(combinedRoll(0.04, 0.4), 0);
  near(combinedRoll(0.4, 0.07), 0);
});
check('head roll excludes looking up, down or sideways and works in calibrated prone space', () => {
  for (const neutralHead of [Quaternion.Identity(), Quaternion.FromEulerAngles(Math.PI / 2, 0.5, 0.2)]) {
    for (const yaw of [-2, -0.5, 0, 1.5]) for (const pitch of [-0.7, 0, 0.7]) {
      const head = neutralHead.multiply(Quaternion.FromEulerAngles(pitch, yaw, 0));
      near(headBankAngle(head, neutralHead), 0);
      const banked = neutralHead.multiply(Quaternion.FromEulerAngles(pitch, yaw, -0.3));
      near(headBankAngle(banked, neutralHead), 0.3);
    }
    const left = new Vector3(-0.18, 0.1, 0.65);
    const right = new Vector3(0.18, -0.1, 0.65);
    left.rotateByQuaternionToRef(neutralHead, left);
    right.rotateByQuaternionToRef(neutralHead, right);
    assert.ok(handBankAngle(left, right, neutralHead) > 0.5);
  }
  near(headBankAngle(Quaternion.FromEulerAngles(Math.PI / 2, 0, -0.3), Quaternion.Identity()), 0);
});
check('full-reach calibration accounts for a natural difference in hand heights', () => {
  const {flight, camera, pose} = setup();
  const neutralHands = [pose('left', new Vector3(0, 0.06, 1)), pose('right', new Vector3(0, -0.06, 1))];
  assert.equal(flight.calibrateFullReach(neutralHands), 2);
  camera.rotationQuaternion = Quaternion.FromEulerAngles(0, 0, -0.4);
  near(flight.createXRIntent(neutralHands).roll ?? 0, 0);
  assert.ok((flight.createXRIntent([pose('left', new Vector3(0, 0.25, 1)), pose('right', new Vector3(0, -0.25, 1))]).roll ?? 0) > 0.5);
});
const worldHead = (rig: TransformNode, camera: UniversalCamera) => {
  const position = Vector3.Zero();
  camera.position.rotateByQuaternionToRef(rig.rotationQuaternion!, position);
  return position.addInPlace(rig.position);
};
check('VR tilt stays a bounded bank even when obsolete free-roll settings are supplied', () => {
  for (const fps of [72, 90, 120]) for (const sign of [-1, 1]) {
    const {flight, rig, camera, pose, scene} = setup(Quaternion.Identity(), Vector3.Forward(), 'free');
    const arms = [pose('left', new Vector3(0, sign * 0.2, 1)), pose('right', new Vector3(0, -sign * 0.2, 1))];
    const initialHeading = flight.createXRIntent(arms).direction;
    camera.rotationQuaternion = Quaternion.FromEulerAngles(0, 0, -sign * Math.PI / 7);
    for (let i = 0; i < fps * 6; i++) {
      const before = worldHead(rig, camera);
      const intent = flight.createXRIntent(arms);
      aligned(intent.direction, initialHeading);
      const telemetry = flight.update(1 / fps, neutral, undefined, intent);
      const movement = worldHead(rig, camera).subtract(before);
      aligned(movement, initialHeading);
      near(movement.length(), telemetry.speed / fps);
      near(rig.rotationQuaternion!.length(), 1);
    }
    const up = Vector3.Up();
    up.rotateByQuaternionToRef(rig.rotationQuaternion!, up);
    assert.ok(up.x * sign > 0.2, 'right bank must tilt the body to the right');
    const bankAngle = Math.acos(Scalar.Clamp(Vector3.Dot(up, Vector3.Up()), -1, 1));
    assert.ok(bankAngle < Math.PI / 4, 'VR bank must never continue into a barrel roll');
    camera.rotationQuaternion = Quaternion.Identity();
    for (let i = 0; i < fps * 2; i++) flight.update(1 / fps, neutral, undefined, {...flight.createXRIntent(arms), roll: 0});
    near(Math.abs(Quaternion.Dot(Quaternion.Identity(), rig.rotationQuaternion!)), 1, 0.001);
    scene.dispose();
  }
});
check('pointing changes remain direct and responsive while the body is rolled', () => {
  const {flight, rig, camera, pose} = setup();
  for (let i = 0; i < 90; i++) flight.update(1 / 90, neutral, undefined, {active: true, throttle: 1, direction: Vector3.Forward(), roll: 1});
  for (const worldDirection of [new Vector3(0, 0.5, 1), new Vector3(0, -0.5, 1), Vector3.Right(), new Vector3(0, 0, -1)]) {
    const local = Vector3.Zero();
    worldDirection.normalize().rotateByQuaternionToRef(rig.rotationQuaternion!.conjugate(), local);
    const arms = [pose('left', local), pose('right', local)];
    const intent = flight.createXRIntent(arms);
    aligned(intent.direction, worldDirection);
    let movement = Vector3.Zero();
    for (let i = 0; i < 18; i++) {
      const before = worldHead(rig, camera);
      flight.update(1 / 90, neutral, undefined, intent);
      movement = worldHead(rig, camera).subtract(before);
    }
    assert.ok(Vector3.Dot(movement.normalizeToNew(), worldDirection) > 0.999);
  }
});
check('VR comfort caps bank at 20 degrees versus 35 and recalibration does not snap the view', () => {
  for (const comfortMode of [true, false]) {
    const {rig, camera, scene} = setup();
    const flight = new FlightController(rig, camera, {comfortMode, vignette: true, rollMode: 'free'});
    flight.calibrate();
    const intent = {active: true, throttle: 1, direction: Vector3.Forward(), roll: 1};
    for (let i = 0; i < 180; i++) flight.update(1 / 90, neutral, undefined, intent);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(Quaternion.Dot(Quaternion.Identity(), rig.rotationQuaternion!))));
    near(angle, (comfortMode ? 20 : 35) * Math.PI / 180, 0.001);
    const banked = rig.rotationQuaternion!.clone();
    flight.calibrateHover();
    near(Quaternion.Dot(banked, rig.rotationQuaternion!), 1);
    flight.reset(new Vector3(0, 100, 0), Vector3.Forward());
    flight.update(1 / 90, neutral, undefined, {...intent, roll: 0});
    near(Quaternion.Dot(Quaternion.Identity(), rig.rotationQuaternion!), 1);
    scene.dispose();
  }
});
check('boundary contains motion and allows immediate inward departure', () => {
  const {flight, rig, pose} = setup();
  rig.position.set(4499, 0, 0);
  for (let i = 0; i < 90; i++) flight.update(1 / 90, neutral, undefined, flight.createXRIntent([pose('left', Vector3.Right())]));
  assert.ok(rig.position.length() <= 4500.00001);
  for (let i = 0; i < 90; i++) flight.update(1 / 90, neutral, undefined, flight.createXRIntent([pose('left', Vector3.Left())]));
  assert.ok(rig.position.length() < 4480);
});
check('assisted banking holds an angle, returns level and never becomes a spin near vertical', () => {
  for (const fps of [72, 90, 120]) for (const axis of [Vector3.Forward(), Vector3.Up()]) {
    const {flight, rig} = setup();
    const intent = {active: true, throttle: 0.5, direction: axis, roll: 0.5};
    for (let i = 0; i < fps * 3; i++) flight.update(1 / fps, neutral, undefined, intent);
    const banked = rig.rotationQuaternion!.clone();
    const angle = 2 * Math.acos(Math.min(1, Math.abs(Quaternion.Dot(banked, Quaternion.Identity()))));
    near(angle, 17.5 * Math.PI / 180, 0.001);
    for (let i = 0; i < fps * 3; i++) flight.update(1 / fps, neutral, undefined, intent);
    near(Math.abs(Quaternion.Dot(banked, rig.rotationQuaternion!)), 1);
    for (let i = 0; i < fps * 2; i++) flight.update(1 / fps, neutral, undefined, {...intent, roll: 0});
    near(Math.abs(Quaternion.Dot(Quaternion.Identity(), rig.rotationQuaternion!)), 1);
  }
});
check('assisted stunt is one exact revolution and requires neutral before retriggering', () => {
  for (const fps of [72, 90, 120]) for (const sign of [-1, 1]) {
    const control = new RollController();
    let bank = 0;
    const options = {active: true, mode: 'assisted' as const, comfort: false, fullRolls: true, gestureStunts: true};
    const run = (seconds: number, gesture: number) => {
      for (let i = 0; i < fps * seconds; i++) bank += control.update(1 / fps, bank, gesture, options);
    };
    run(0.15, sign);
    assert.ok(Math.abs(bank) < Math.PI / 3, 'short tilt should only bank');
    run(8, sign);
    near(bank, sign * (Math.PI * 2 + 35 * Math.PI / 180), 0.001);
    run(4, sign);
    near(bank, sign * (Math.PI * 2 + 35 * Math.PI / 180), 0.001);
    run(2, 0);
    near(bank, sign * Math.PI * 2, 0.001);
    run(6, sign);
    near(bank, sign * (Math.PI * 4 + 35 * Math.PI / 180), 0.001);
  }
});
check('disabling full rolls prevents stunts and continuous rotation, including after a mode switch', () => {
  for (const mode of ['assisted', 'free'] as const) {
    const roll = new RollController();
    let bank = 0;
    for (let i = 0; i < 900; i++) bank += roll.update(1 / 90, bank, 1, {active:true, mode, comfort:true, fullRolls:false, gestureStunts:true, stunt:1});
    near(bank, 20 * Math.PI / 180);
  }
});
check('hover or tracking loss cancels a stunt, stops translation and levels without orbiting the head', () => {
  const {flight, rig, camera} = setup();
  for (let i = 0; i < 100; i++) flight.update(1 / 90, neutral, undefined, {active:true, throttle:1, direction:Vector3.Forward(), roll:1});
  const position = worldHead(rig, camera);
  let rotation = rig.rotationQuaternion!.clone();
  for (let i = 0; i < 360; i++) {
    const telemetry = flight.update(1 / 90, neutral, undefined, {active:false, throttle:0, direction:Vector3.Zero()});
    near(telemetry.speed, 0);
    near(Vector3.Distance(worldHead(rig, camera), position), 0);
    assert.ok(Math.abs(Quaternion.Dot(rotation, rig.rotationQuaternion!)) > 0.999);
    rotation = rig.rotationQuaternion!.clone();
  }
  near(Math.abs(Quaternion.Dot(rotation, Quaternion.Identity())), 1);
});
check('keyboard binds speed, non-inverted steering, double-tap stunts and isolated free look', () => {
  const controls = new DesktopControls();
  controls.keyDown('ArrowUp', 0);
  near(controls.read(0).pitch, -1);
  controls.keyUp('ArrowUp');
  controls.keyDown('KeyW', 0);
  near(controls.read(1).throttle, 0.75);
  controls.keyUp('KeyW');
  controls.keyDown('ShiftLeft', 10);
  near(controls.read(0).throttle, 1);
  controls.keyUp('ShiftLeft');
  near(controls.read(0).throttle, 0.75);
  controls.keyDown('Space', 0);
  near(controls.read(0).brake, 1);
  controls.clear();
  controls.keyDown('KeyE', 100);
  controls.keyDown('KeyE', 200, true);
  near(controls.read(0).stunt!, 0);
  controls.keyUp('KeyE');
  controls.keyDown('KeyE', 250);
  near(controls.read(0).stunt!, 1);
  near(controls.read(0).stunt!, 0);
  controls.clear();
  controls.keyDown('AltLeft', 300);
  controls.mouseMove(100, -50);
  const look = controls.read(0);
  near(look.aimYaw!, 0); near(look.lookYaw!, 0.25); near(look.lookPitch!, -0.125);
  controls.clear();
  near(controls.read(0).roll!, 0);
  controls.mouseMove(100, -50);
  const aim = controls.read(0);
  near(aim.aimYaw!, 0.25); near(aim.aimPitch!, -0.125);
  near(controls.read(0).aimYaw!, 0);
});
check('desktop mouse pointing changes course promptly, free look does not and brake reaches true hover', () => {
  const {flight, rig, camera} = setup();
  flight.update(1 / 90, {...neutral, throttle:0.5, aimYaw:Math.PI / 2, aimPitch:-0.25});
  let movement = Vector3.Zero();
  for (let i = 0; i < 30; i++) {
    const before = rig.position.clone();
    flight.update(1 / 90, {...neutral, throttle:0.5});
    movement = rig.position.subtract(before);
  }
  assert.ok(movement.x > 0.1 && movement.y > 0 && Math.abs(movement.z) < 0.01);
  const heading = movement.normalizeToNew();
  for (let i = 0; i < 90; i++) {
    const before = rig.position.clone();
    flight.update(1 / 90, {...neutral, throttle:0.5, freeLook:true, lookYaw:0.01});
    aligned(rig.position.subtract(before), heading);
  }
  assert.ok(Math.abs(camera.rotationQuaternion!.y) > 0.2);
  for (let i = 0; i < 180; i++) flight.update(1 / 90, {...neutral, brake:1});
  const stopped = rig.position.clone();
  near(flight.update(1 / 90, {...neutral, brake:1}).speed, 0);
  near(Vector3.Distance(stopped, rig.position), 0);
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
    if (length === 0.8) {
      const shoulder = flight.getShoulderPosition('left');
      const wrist = hand.position.add(new Vector3(0, 0, -0.06));
      const elbow = scene.getMeshByName('test-left-elbow')!;
      assert.ok(Vector3.Distance(elbow.position, shoulder.add(wrist).scale(0.5)) < 0.04, 'full reach should visually straighten the elbow');
    }
    for (const mesh of arm.root.getChildMeshes()) assert.ok(mesh.position.asArray().every(Number.isFinite));
  }
  arm.dispose();
  assert.equal(scene.getTransformNodeByName('fist-test-left'), null);
});
check('city hills stay gentle, natural hills are tall, lakes and district connections remain level', () => {
  for (const region of WORLD_REGIONS) {
    let maximum = 0;
    for (let x = -region.radius; x <= region.radius; x += 20) for (let z = -region.radius; z <= region.radius; z += 20) {
      const h = terrainHeight(region.id, x, z);
      assert.ok(Number.isFinite(h) && h >= 0.7);
      maximum = Math.max(maximum, h);
    }
    const city = region.id === 'neon-city' || region.id === 'sky-harbor';
    assert.ok(city ? maximum > 10 && maximum < 30 : maximum > 95 && maximum < 180, `${region.id}: ${maximum}`);
    if (!city) {
      near(terrainHeight(region.id, 0, 0), 0.7);
      near(terrainHeight(region.id, 90, 0), 0.7);
    }
    near(terrainHeight(region.id, region.radius * 0.97, 0), 0.7);
    for (const [a,b] of REGION_CONNECTIONS) {
      if (a !== region.id && b !== region.id) continue;
      const other = WORLD_REGIONS.find((item) => item.id === (a === region.id ? b : a))!;
      const direction = other.position.subtract(region.position); direction.y = 0; direction.normalize();
      const join = direction.scale(region.radius * 0.58);
      near(terrainHeight(region.id, join.x, join.z), 0.7);
    }
  }
});
check('terrain and sloped road vertices match the shared heightfield with upward normals', () => {
  for (const id of ['neon-city', 'quiet-grove']) {
    for (const [data, lift] of [[terrainDisk(id, 650), 0], [terrainStrip(id, [new Vector3(100,0,100), new Vector3(108,0,110), new Vector3(116,0,120)], 16, 0.45), 0.45]] as const) {
      const positions = data.positions!;
      for (let i = 0; i < positions.length; i += 3) {
        near(positions[i + 1], terrainHeight(id, positions[i], positions[i + 2]) + lift);
        assert.ok(data.normals![i + 1] > 0);
      }
      assert.ok(data.indices!.every((index) => index >= 0 && index < positions.length / 3));
    }
  }
});
check('expanded world builds and batches correctly with city, forest and enclosing sphere', () => {
  const scene = new Scene(engine);
  const world = new SkyWorld(scene);
  assert.ok(scene.getTransformNodeByName('neon-city'));
  assert.ok(scene.getTransformNodeByName('quiet-grove'));
  assert.ok(scene.getTextureByName('city-facade'));
  for (const [a,b] of REGION_CONNECTIONS) assert.ok(scene.getTransformNodeByName(`region-link-${a}-${b}`));
  for (const region of WORLD_REGIONS) {
    const terrain = scene.getMeshByName(`${region.id}-hills`)!;
    assert.ok(terrain && terrain.getBoundingInfo().boundingBox.maximum.y > 10);
  }
  assert.ok(scene.meshes.length < 1500, `unbatched meshes: ${scene.meshes.length}`);
  for (const mesh of scene.meshes) {
    assert.ok(mesh.getTotalVertices() > 0, `empty geometry: ${mesh.name}`);
    mesh.computeWorldMatrix(true);
    assert.ok(mesh.getBoundingInfo().boundingBox.centerWorld.asArray().every(Number.isFinite));
  }
  assert.ok(world.flightBounds.radius > 4000);
  const city = WORLD_REGIONS.find((region) => region.id === 'neon-city')!;
  const bounce = world.resolveFlightMotion(city.position.add(new Vector3(96, 180, 0)), Vector3.Down().scale(220));
  assert.ok(bounce && bounce.normal.y > 0.5, 'solid city geometry should produce an upward collision normal');
  assert.ok(bounce.speedScale < 0.6 && bounce.displacement.length() < 220, 'collision should slow and deflect motion');
  for (const mesh of scene.meshes.filter((item) => item.material?.name === 'clouds' || item.material?.name === 'crystal-water')) {
    assert.notEqual(mesh.metadata?.flightCollision, true, `${mesh.material?.name} must remain pass-through`);
  }
  console.log(`World: ${scene.meshes.length} batches, ${scene.meshes.reduce((sum, mesh) => sum + mesh.getTotalVertices(), 0)} vertices`);
  scene.dispose();
});
engine.dispose();
console.log(`${passed} regression checks passed.`);
