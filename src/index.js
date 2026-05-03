/**
 * VR BioLab — entry point
 *
 * Builds the school biology lab environment around the player, drops
 * the microscope onto the bench at world (0.2, 0.98, 0.25), then shows
 * the Launch Activity → Main Menu flow. Selecting "Заавар" enters
 * Guide mode (6 narrated chapters with part-highlighting).
 */

import { createLaunchButton, createMainMenu } from './ui/menu.js';
import { startExplore, stopExplore, updateExplore } from './activities/explore.js';
import { startGuide, stopGuide, updateGuide } from './activities/guide.js';
import { startLearn, stopLearn, updateLearn } from './activities/learn.js';

import { InteractionSystem } from './core/interactions.js';
import { createLabEnvironment } from './lab-environment.js';
import { createMicroscope } from './microscope/build.js';
import { init } from './init.js';
import { updateLocomotion } from './core/locomotion.js';

// Module-level handles so the menu's onSelect callbacks can reach the
// scene graph and the renderer without prop-drilling through closures.
let lab = null;
let microscope = null;
let scene = null;
let camera = null;
let renderer = null;
let interactions = null;
let activeUI = null;
let overlayDismissed = false;

function dismissLoadingOverlay() {
	if (overlayDismissed) return;
	overlayDismissed = true;
	const overlay = document.getElementById('loading-overlay');
	if (!overlay) return;
	overlay.classList.add('hidden');
	setTimeout(() => overlay.remove(), 700);
}

function setupScene(globals) {
	scene = globals.scene;
	camera = globals.camera;
	renderer = globals.renderer;

	lab = createLabEnvironment(scene, renderer);

	microscope = createMicroscope();
	microscope.position.set(0.2, 0.98, 0.25);
	// 1.1× scale-up so the model reads as ≈ 55 cm tall in VR — the
	// previous 50 cm felt undersized for a kid leaning over a real
	// classroom microscope. All proximity / world-position checks
	// downstream derive from getWorldPosition / Box3, so they adapt
	// automatically; the only hardcoded coords are the light beam,
	// which is parented to the microscope inside optics.js.
	microscope.scale.set(1.1, 1.1, 1.1);
	scene.add(microscope);

	interactions = new InteractionSystem({
		renderer,
		camera,
		scene,
		container: renderer.domElement,
	});

	showLaunchButton();

	void lab;
}

function showLaunchButton() {
	const launch = createLaunchButton({
		scene,
		camera,
		onLaunch: () => {
			interactions.unregisterPanel(launch);
			launch.dispose();
			showMainMenu();
		},
	});
	interactions.registerPanel(launch);
	activeUI = launch;
}

function showMainMenu() {
	const menu = createMainMenu({
		scene,
		camera,
		onSelect: (mode) => {
			if (mode === 'guide') {
				interactions.unregisterPanel(menu);
				menu.dispose();
				activeUI = null;
				startGuide({
					scene,
					camera,
					renderer,
					microscope,
					interactions,
					onExit: () => {
						stopGuide();
						showMainMenu();
					},
				});
				return;
			}
			if (mode === 'learn') {
				interactions.unregisterPanel(menu);
				menu.dispose();
				activeUI = null;
				startLearn({
					scene,
					camera,
					renderer,
					microscope,
					interactions,
					onExit: () => {
						stopLearn();
						showMainMenu();
					},
				});
				return;
			}
			if (mode === 'explore') {
				interactions.unregisterPanel(menu);
				menu.dispose();
				activeUI = null;
				startExplore({
					scene,
					camera,
					renderer,
					microscope,
					interactions,
					onExit: () => {
						stopExplore();
						showMainMenu();
					},
				});
				return;
			}
			// Other modes wire up in later prompts.
			console.info(`${mode} идэвхжлээ`);
		},
	});
	interactions.registerPanel(menu);
	activeUI = menu;
}

function onFrame(delta, time, globals) {
	if (!overlayDismissed) dismissLoadingOverlay();
	if (interactions) interactions.update();
	updateGuide(time);
	updateLearn(delta, time);
	updateExplore(delta, time);
	updateLocomotion(delta, globals);
	void activeUI;
}

init(setupScene, onFrame);
