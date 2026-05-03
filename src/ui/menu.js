/**
 * @file VR floating menus — launch button + main 5-action menu.
 *
 * Both factories return a UI handle:
 *   {
 *     panel,          // the underlying Panel instance
 *     setHover,       // forwards to panel.setHover + redraw
 *     fadeOut,        // 0.4 s opacity tween, then optional callback
 *     fadeIn,
 *     dispose,
 *   }
 *
 * The handle shape is what InteractionSystem expects to register, so a
 * single registration covers both hover and click handling.
 */
import * as THREE from 'three';

import { Panel } from './panel.js';

/** 0.4 s fade transition shared by both UIs. */
const FADE_MS = 400;

/**
 * Anchor the panel ACROSS the bench from the user at world (0.2, 1.55,
 * −1.0). The panel rotates around Y only — its lookAt target is the
 * camera position projected to the panel's Y level — so the panel face
 * stays vertical regardless of whether the user is standing, sitting,
 * or has tilted their head. (Plain camera.lookAt would tilt the panel
 * up/down to follow camera height, which the user perceives as "далий".)
 */
function placePanelAcrossBench(panel, scene, camera) {
	const camPos = new THREE.Vector3();
	camera.getWorldPosition(camPos);
	panel.mesh.position.set(0.2, 1.55, -0.6);
	// Project camera onto the panel's horizontal plane so the panel rotates
	// around Y only. Result: a perfectly upright panel facing the user
	// horizontally — symmetrical and square-on regardless of head height.
	const lookTarget = camPos.clone();
	lookTarget.y = panel.mesh.position.y;
	panel.mesh.lookAt(lookTarget);
	if (!panel.mesh.parent) scene.add(panel.mesh);
}

/** Cubic ease-in-out for fade transitions. */
function easeInOut(t) {
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Run a 0..1 → callback tween over `duration` ms; resolves on complete. */
function tween(duration, onFrame, onComplete) {
	const start = performance.now();
	function step() {
		const elapsed = performance.now() - start;
		const raw = Math.min(1, elapsed / duration);
		onFrame(easeInOut(raw));
		if (raw < 1) requestAnimationFrame(step);
		else if (onComplete) onComplete();
	}
	requestAnimationFrame(step);
}

// =====================================================================
// LAUNCH BUTTON
// =====================================================================

/**
 * Single large entry-point button floating in front of the bench. On
 * click, fades itself out and invokes onLaunch.
 *
 * @param {{ scene: THREE.Scene, camera: THREE.Camera,
 *           onLaunch: () => void }} options
 */
export function createLaunchButton({ scene, camera, onLaunch }) {
	const panel = new Panel({
		width: 1.05,
		height: 0.62,
		pixelScale: 2,
	});
	placePanelAcrossBench(panel, scene, camera);

	let dismissing = false;

	function render() {
		panel.clear();
		panel.drawBackground('rgba(15, 25, 40, 0.94)', '#5fa5d6');

		// ICS logo placeholder — red disc with white "ICS" mark
		const ctx = panel.ctx;
		ctx.fillStyle = '#c8423d';
		ctx.beginPath();
		ctx.arc(512, 110, 50, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = '#ffffff';
		ctx.lineWidth = 3;
		ctx.stroke();
		ctx.fillStyle = '#ffffff';
		ctx.font = 'bold 32px sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText('ICS', 512, 110);

		// Title
		panel.drawText('АЖИЛЛАГААГ ЭХЛҮҮЛЭХ', 512, 215, {
			font: 'bold 42px Georgia',
			color: '#fafafa',
		});

		// Subtitle
		panel.drawText('Биологийн микроскоптой танилцана уу', 512, 265, {
			font: '22px sans-serif',
			color: '#a0bdd0',
		});

		// Big CTA button — well above the 8×4 cm Quest 3S touch-target.
		// onClick fires onLaunch IMMEDIATELY (no fadeOut tween): WebXR
		// sessions pause window.requestAnimationFrame, which is what the
		// fade tween relied on, so the callback never used to fire in
		// VR. Instant transition is reliable in both VR and desktop.
		panel.drawButton({
			id: 'launch',
			label: 'ЭХЛҮҮЛЭХ',
			x: 312,
			y: 320,
			w: 400,
			h: 100,
			onClick: () => {
				if (dismissing) return;
				dismissing = true;
				panel.disabled = true;
				if (onLaunch) onLaunch();
			},
		});

		panel.update();
	}

	function fadeOut(cb) {
		tween(
			FADE_MS,
			(t) => {
				panel.setOpacity(1 - t);
			},
			cb,
		);
	}

	function fadeIn(cb) {
		panel.setOpacity(0);
		tween(
			FADE_MS,
			(t) => {
				panel.setOpacity(t);
			},
			cb,
		);
	}

	panel.onHoverChange = render;
	render();

	return {
		panel,
		setHover: (id) => panel.setHover(id),
		fadeOut,
		fadeIn,
		dispose: () => panel.dispose(),
	};
}

// =====================================================================
// MAIN MENU
// =====================================================================

/** The 5 modes the menu offers. modeId values are stable across the
 *  app — later prompts reference them. */
const MODES = [
	{ id: 'guide',   label: 'Заавар',   sublabel: 'Guide'   },
	{ id: 'learn',   label: 'Сурах',    sublabel: 'Learn'   },
	{ id: 'explore', label: 'Судлах',   sublabel: 'Explore' },
	{ id: 'test',    label: 'Шалгах',   sublabel: 'Test'    },
	{ id: 'options', label: 'Тохиргоо', sublabel: 'Options' },
];

/**
 * The 5-button mode selector that replaces the launch button. Clicking
 * a button calls onSelect(modeId).
 *
 * @param {{ scene: THREE.Scene, camera: THREE.Camera,
 *           onSelect: (modeId: string) => void }} options
 */
export function createMainMenu({ scene, camera, onSelect }) {
	const panel = new Panel({
		width: 1.25,
		height: 0.78,
		pixelScale: 2,
	});
	placePanelAcrossBench(panel, scene, camera);

	function render() {
		panel.clear();
		panel.drawBackground('rgba(20, 28, 40, 0.92)', '#5fa5d6');

		panel.drawText('ЛАБОРАТОРИЙН ҮЙЛДЛҮҮД', 512, 60, {
			font: 'bold 38px Georgia',
			color: '#fafafa',
		});
		panel.drawText('Доороос сонгож үйлдлийг эхлүүлнэ үү', 512, 105, {
			font: '20px sans-serif',
			color: '#9fb6c8',
		});

		// 5 buttons stacked vertically — each meets the Quest 3S touch
		// target (every button is 700 × 60 px on a 1024 × 512 canvas
		// across a 0.92 × 0.62 m mesh ≈ 63 × 7 cm in world space, well
		// over the 8 × 4 cm minimum).
		const btnW = 700;
		const btnH = 60;
		const startY = 145;
		const gap = 12;
		const cx = 512 - btnW / 2;

		MODES.forEach((m, i) => {
			panel.drawButton({
				id: m.id,
				label: m.label,
				sublabel: m.sublabel,
				x: cx,
				y: startY + i * (btnH + gap),
				w: btnW,
				h: btnH,
				onClick: () => onSelect && onSelect(m.id),
			});
		});

		panel.update();
	}

	function fadeOut(cb) {
		tween(
			FADE_MS,
			(t) => panel.setOpacity(1 - t),
			cb,
		);
	}

	function fadeIn(cb) {
		panel.setOpacity(0);
		tween(
			FADE_MS,
			(t) => panel.setOpacity(t),
			cb,
		);
	}

	panel.onHoverChange = render;
	render();
	// Note: opacity tween (fadeIn) skipped — window.requestAnimationFrame
	// is paused during a WebXR immersive session, so the tween would
	// leave the panel at opacity 0 (invisible). The panel renders fully
	// opaque immediately instead, which is reliable in both VR and
	// desktop.

	return {
		panel,
		setHover: (id) => panel.setHover(id),
		fadeOut,
		fadeIn,
		dispose: () => panel.dispose(),
	};
}
