/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as THREE from 'three';

import { DevUI } from '@iwer/devui';
import { GamepadWrapper } from 'gamepad-wrapper';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Text } from 'troika-three-text';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
// eslint-disable-next-line sort-imports
import { XRDevice, metaQuest3 } from 'iwer';
// eslint-disable-next-line sort-imports
import Stats from 'three/addons/libs/stats.module.js';

export async function init(setupScene = () => {}, onFrame = () => {}) {
	// iwer setup
	let nativeWebXRSupport = false;
	if (navigator.xr) {
		nativeWebXRSupport = await navigator.xr.isSessionSupported('immersive-vr');
	}
	if (!nativeWebXRSupport) {
		const xrDevice = new XRDevice(metaQuest3);
		xrDevice.installRuntime();
		xrDevice.fovy = (75 / 180) * Math.PI;
		xrDevice.ipd = 0;
		window.xrdevice = xrDevice;
		xrDevice.controllers.right.position.set(0.15649, 1.43474, -0.38368);
		xrDevice.controllers.right.quaternion.set(
			0.14766305685043335,
			0.02471366710960865,
			-0.0037767395842820406,
			0.9887216687202454,
		);
		xrDevice.controllers.left.position.set(-0.15649, 1.43474, -0.38368);
		xrDevice.controllers.left.quaternion.set(
			0.14766305685043335,
			0.02471366710960865,
			-0.0037767395842820406,
			0.9887216687202454,
		);
		new DevUI(xrDevice);
	}

	const container = document.createElement('div');
	document.body.appendChild(container);

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x1a0505);

	const camera = new THREE.PerspectiveCamera(
		50,
		window.innerWidth / window.innerHeight,
		0.1,
		100,
	);
	// Camera is local to the player anchor (added below). Natural adult
	// eye-height ≈ 1.65 m so the user starts standing in front of the
	// bench and can lean down to peer through the microscope eyepiece —
	// matching the real-world ergonomics of a school biology lab.
	camera.position.set(0, 1.68, 0);

	const controls = new OrbitControls(camera, container);
	// Target world (0.2, 1.18, 0.27) — the microscope eyepiece centroid,
	// so the desktop camera frames the microscope right out of the gate.
	// Player feet sit at world (0.2, 0, 0.70); subtract for local space.
	controls.target.set(0.2 - 0.2, 1.18, 0.27 - 0.70);
	controls.update();

	const renderer = new THREE.WebGLRenderer({
		antialias: true,
		powerPreference: 'high-performance',
	});
	// Cap pixel ratio at 1.5 — anything higher chews Quest 3S GPU budget
	// without a visible quality gain after foveated rendering kicks in.
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.xr.enabled = true;
	// Maximum foveated rendering — peripheral pixels render at lower
	// resolution while the centre stays sharp. Saves ~30% GPU on Quest 3S.
	if (typeof renderer.xr.setFoveation === 'function') {
		renderer.xr.setFoveation(1.0);
	}
	container.appendChild(renderer.domElement);

	const environment = new RoomEnvironment(renderer);
	const pmremGenerator = new THREE.PMREMGenerator(renderer);
	scene.environment = pmremGenerator.fromScene(environment).texture;

	// Player anchor — feet at world (0.2, 0, 0.70). With the camera's
	// 1.65 m local Y, the user's eye sits at world (0.2, 1.65, 0.70) —
	// natural standing height in front of the bench, looking forward
	// at the microscope (centred at world (0.2, ≈1.18, 0.27)).
	const player = new THREE.Group();
	player.name = 'Player';
	player.position.set(0.2, 0, 0.70);
	scene.add(player);
	player.add(camera);

	const controllerModelFactory = new XRControllerModelFactory();
	const controllers = {
		left: null,
		right: null,
	};
	for (let i = 0; i < 2; i++) {
		const raySpace = renderer.xr.getController(i);
		const gripSpace = renderer.xr.getControllerGrip(i);
		const mesh = controllerModelFactory.createControllerModel(gripSpace);
		gripSpace.add(mesh);
		player.add(raySpace, gripSpace);
		raySpace.visible = false;
		gripSpace.visible = false;
		gripSpace.addEventListener('connected', (e) => {
			raySpace.visible = true;
			gripSpace.visible = true;
			const handedness = e.data.handedness;
			controllers[handedness] = {
				raySpace,
				gripSpace,
				mesh,
				gamepad: new GamepadWrapper(e.data.gamepad),
			};
		});
		gripSpace.addEventListener('disconnected', (e) => {
			raySpace.visible = false;
			gripSpace.visible = false;
			const handedness = e.data.handedness;
			controllers[handedness] = null;
		});
	}

	function onWindowResize() {
		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();

		renderer.setSize(window.innerWidth, window.innerHeight);
	}

	window.addEventListener('resize', onWindowResize);

	const globals = {
		scene,
		camera,
		renderer,
		player,
		controllers,
	};

	setupScene(globals);

	// ── Performance HUD (desktop) ──
	// Stats.js shows FPS / frame-time / memory in the top-left corner.
	// Click the panel to cycle metrics.
	const stats = new Stats();
	stats.dom.style.position = 'fixed';
	stats.dom.style.top = '8px';
	stats.dom.style.left = '8px';
	stats.dom.style.zIndex = '1000';
	document.body.appendChild(stats.dom);

	// ── Performance HUD (in-VR) ──
	// Troika 3D text floats at the lower-right of the headset view; updates
	// twice per second so the readout doesn't flicker every frame.
	const fpsText = new Text();
	fpsText.text = 'FPS --';
	fpsText.fontSize = 0.022;
	fpsText.color = 0x00e5c7;
	fpsText.outlineWidth = 0.0015;
	fpsText.outlineColor = 0x000000;
	fpsText.anchorX = 'right';
	fpsText.anchorY = 'bottom';
	fpsText.position.set(0.30, -0.20, -0.6);
	fpsText.sync();
	camera.add(fpsText);

	let fpsAccDelta = 0;
	let fpsAccFrames = 0;

	const clock = new THREE.Clock();
	function animate() {
		const delta = clock.getDelta();
		const time = clock.getElapsedTime();
		Object.values(controllers).forEach((controller) => {
			if (controller?.gamepad) {
				controller.gamepad.update();
			}
		});
		onFrame(delta, time, globals);
		renderer.render(scene, camera);

		// FPS sample (every 0.5 s — half-second smoothing avoids jitter)
		fpsAccDelta += delta;
		fpsAccFrames++;
		if (fpsAccDelta >= 0.5) {
			const fps = Math.round(fpsAccFrames / fpsAccDelta);
			const ms = (1000 / Math.max(fps, 1)).toFixed(1);
			fpsText.text = `FPS ${fps}  •  ${ms} ms`;
			fpsText.color =
				fps >= 70 ? 0x00e5c7 : fps >= 50 ? 0xffd24a : 0xff5577;
			fpsText.sync();
			fpsAccDelta = 0;
			fpsAccFrames = 0;
		}
		stats.update();
	}

	renderer.setAnimationLoop(animate);

	document.body.appendChild(VRButton.createButton(renderer));
}
