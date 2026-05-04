/**
 * @file Learn mode — interactive part identification.
 *
 * Public API:
 *   startLearn({ scene, camera, renderer, microscope, interactions, onExit })
 *   stopLearn()
 *   updateLearn(delta, time)   // call from animation loop
 *
 * Behaviour:
 *   • Each frame we raycast from the active VR controller(s) — or the
 *     desktop mouse — into the microscope. The first hit's nearest
 *     `Microscope_*` ancestor becomes the hovered part.
 *   • A small floating tooltip pops up at the hovered part with
 *     Mongolian name + description + "Тогноогүй / Танигдсан ✓" status.
 *   • A trigger 'select' (VR) or mouse click (desktop) marks the
 *     hovered part as identified — a green check Sprite is added at
 *     the part's bbox centre, a procedural "ding" plays, and a haptic
 *     pulse fires on the controller that did it.
 *   • A side panel to the user's left tracks progress (X / 15) and
 *     renders the full list with strikethroughs on identified items.
 *     "Дахин эхлэх" resets, "✕ Гарах" exits.
 *   • When all 15 are identified, 30 confetti boxes fountain from the
 *     microscope centre under simple gravity for 3 seconds, the side
 *     panel shows "Бүх хэсгийг танилаа! 🎉", and a "Дуусгах ✓" button
 *     enables → onExit.
 */
import * as THREE from 'three';

import { PARTS, PART_BY_NAME } from './learn-data.js';
import { clearHighlight, highlightPart } from '../microscope/highlight.js';
import { Panel } from '../ui/panel.js';

// =====================================================================
// CONSTANTS
// =====================================================================

const TOTAL_PARTS = PARTS.length;

const TOOLTIP_PANEL_W = 0.60;
const TOOLTIP_PANEL_H = 0.25;
const TOOLTIP_CANVAS_W = 768;
const TOOLTIP_CANVAS_H = 320;
/** World position the tooltip anchors to: 35 cm to the right of the
 *  hovered part, at gaze height (y = 1.55 m), so it sits clearly off
 *  the microscope body and never overlaps the part the user is
 *  pointing at. The Z component follows the part so the tooltip drifts
 *  with the user's aim while staying out of the line of sight. */
const TOOLTIP_X_OFFSET = 0.40;
const TOOLTIP_FIXED_Y = 1.55;

const SIDE_PANEL_W = 0.55;
const SIDE_PANEL_H = 0.78;
const SIDE_CANVAS_W = 720;
const SIDE_CANVAS_H = 1024;
const SIDE_PANEL_POS = new THREE.Vector3(-0.5, 1.55, -0.2);

const CHECK_SPRITE_SIZE = 0.025;

const CONFETTI_COUNT = 30;
const CONFETTI_DURATION = 3.0;

/** Dwell stabilisation — controller jitter switches the raycast hit
 *  between adjacent parts every few milliseconds. We only commit a
 *  new hover after the laser has rested on a target for this long,
 *  so the tooltip stays put long enough to be read. */
const HOVER_NEW_DWELL_MS = 250;
const HOVER_LOST_DWELL_MS = 120;

// =====================================================================
// MODULE STATE
// =====================================================================

let _state = null;

// =====================================================================
// PROCEDURAL TEXTURES (created once, reused)
// =====================================================================

let _checkTexture = null;
function getCheckTexture() {
	if (_checkTexture) return _checkTexture;
	const canvas = document.createElement('canvas');
	canvas.width = 128;
	canvas.height = 128;
	const ctx = canvas.getContext('2d');
	// Drop shadow
	ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
	ctx.beginPath();
	ctx.arc(66, 70, 56, 0, Math.PI * 2);
	ctx.fill();
	// Green disc
	ctx.fillStyle = '#22c55e';
	ctx.beginPath();
	ctx.arc(64, 64, 54, 0, Math.PI * 2);
	ctx.fill();
	// White outline
	ctx.strokeStyle = '#ffffff';
	ctx.lineWidth = 4;
	ctx.beginPath();
	ctx.arc(64, 64, 54, 0, Math.PI * 2);
	ctx.stroke();
	// White check mark
	ctx.lineWidth = 14;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	ctx.beginPath();
	ctx.moveTo(34, 66);
	ctx.lineTo(56, 88);
	ctx.lineTo(96, 42);
	ctx.stroke();
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.anisotropy = 8;
	tex.minFilter = THREE.LinearFilter;
	tex.generateMipmaps = false;
	_checkTexture = tex;
	return tex;
}

// =====================================================================
// PART POSITIONING HELPERS
// =====================================================================

const _bbox = new THREE.Box3();

/** World-space centre of a part's bounding box. */
function partWorldCentre(part) {
	_bbox.setFromObject(part);
	const out = new THREE.Vector3();
	_bbox.getCenter(out);
	return out;
}

/** Walk up from a hit mesh until a `Microscope_*` named ancestor is
 *  found. Returns the part name or null. */
function findPartName(mesh) {
	let cur = mesh;
	while (cur) {
		if (cur.name && PART_BY_NAME.has(cur.name)) return cur.name;
		cur = cur.parent;
	}
	return null;
}

// =====================================================================
// AUDIO — procedural "ding"
// =====================================================================

function playDing() {
	let ctx = _state && _state.audioCtx;
	if (!ctx) {
		try {
			ctx = new (window.AudioContext || window.webkitAudioContext)();
		} catch {
			return;
		}
		if (_state) _state.audioCtx = ctx;
	}
	if (ctx.state === 'suspended') ctx.resume().catch(() => {});

	const now = ctx.currentTime;
	const osc = ctx.createOscillator();
	osc.type = 'sine';
	osc.frequency.setValueAtTime(880, now);
	osc.frequency.exponentialRampToValueAtTime(1320, now + 0.02);

	const gain = ctx.createGain();
	gain.gain.setValueAtTime(0.0, now);
	gain.gain.linearRampToValueAtTime(0.18, now + 0.01);
	gain.gain.exponentialRampToValueAtTime(0.001, now + 0.30);

	osc.connect(gain).connect(ctx.destination);
	osc.start(now);
	osc.stop(now + 0.32);
}

// =====================================================================
// PANEL POSITIONING
// =====================================================================

const _camTmpPos = new THREE.Vector3();

/** Make a panel face the camera horizontally — Y rotation only, never
 *  tilted. */
function faceCamera(panelMesh, camera) {
	camera.getWorldPosition(_camTmpPos);
	const target = _camTmpPos.clone();
	target.y = panelMesh.position.y;
	panelMesh.lookAt(target);
}

// =====================================================================
// SIDE PANEL — progress + buttons
// =====================================================================

function renderSidePanel() {
	if (!_state) return;
	const panel = _state.sidePanel;
	const ctx = panel.ctx;
	const identified = _state.identified;
	const completed = _state.completed;

	panel.clear();
	panel.drawBackground('rgba(20, 28, 40, 0.94)', '#5fa5d6');

	// Title
	panel.drawText('СУРАХ', SIDE_CANVAS_W / 2, 50, {
		font: 'bold 36px Georgia',
		color: '#fafafa',
	});
	panel.drawText('Хэсгүүдийн нэр', SIDE_CANVAS_W / 2, 90, {
		font: '20px sans-serif',
		color: '#9fb6c8',
	});

	// Live counter
	panel.drawText(
		`Танигдсан:  ${identified.size} / ${TOTAL_PARTS}`,
		SIDE_CANVAS_W / 2,
		135,
		{
			font: 'bold 24px sans-serif',
			color: completed ? '#22c55e' : '#ffd248',
		},
	);

	// Part list
	const listX = 36;
	const listY = 175;
	const lineH = 36;
	for (let i = 0; i < PARTS.length; i++) {
		const p = PARTS[i];
		const y = listY + i * lineH;
		const isDone = identified.has(p.name);

		// Bullet / check icon
		ctx.font = 'bold 20px sans-serif';
		ctx.textBaseline = 'middle';
		ctx.textAlign = 'left';
		if (isDone) {
			ctx.fillStyle = '#22c55e';
			ctx.fillText('✓', listX, y);
		} else {
			ctx.fillStyle = '#5d7a92';
			ctx.fillText('•', listX, y);
		}

		// Label (with strikethrough if done)
		ctx.fillStyle = isDone ? '#7d8a9a' : '#dde6ef';
		ctx.font = '20px sans-serif';
		ctx.fillText(p.mn, listX + 30, y);
		if (isDone) {
			const w = ctx.measureText(p.mn).width;
			ctx.strokeStyle = '#7d8a9a';
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.moveTo(listX + 28, y);
			ctx.lineTo(listX + 32 + w, y);
			ctx.stroke();
		}
	}

	// Bottom buttons / completion message
	const btnY = SIDE_CANVAS_H - 110;
	if (completed) {
		// Toast above the Дуусгах button
		ctx.fillStyle = '#22c55e';
		ctx.font = 'bold 22px sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText('Бүх хэсгийг танилаа! 🎉', SIDE_CANVAS_W / 2, btnY - 28);

		panel.drawButton({
			id: 'finish',
			label: 'Дуусгах ✓',
			x: 80,
			y: btnY,
			w: SIDE_CANVAS_W - 160,
			h: 70,
			onClick: () => exitLearn(),
		});
	} else {
		const btnW = (SIDE_CANVAS_W - 60 - 16) / 2;
		panel.drawButton({
			id: 'reset',
			label: 'Дахин эхлэх',
			x: 30,
			y: btnY,
			w: btnW,
			h: 70,
			onClick: () => resetLearn(),
		});
		panel.drawButton({
			id: 'exit',
			label: '✕ Гарах',
			x: 30 + btnW + 16,
			y: btnY,
			w: btnW,
			h: 70,
			onClick: () => exitLearn(),
		});
	}

	panel.update();
}

// =====================================================================
// TOOLTIP — anchored to the hovered part
// =====================================================================

function renderTooltip(partName) {
	if (!_state) return;
	const tooltip = _state.tooltip;
	const meta = PART_BY_NAME.get(partName);
	if (!meta) return;

	tooltip.clear();
	tooltip.drawBackground('rgba(15, 22, 34, 0.95)', '#5fa5d6');

	// Mongolian name (large)
	tooltip.drawText(meta.mn, TOOLTIP_CANVAS_W / 2, 50, {
		font: 'bold 30px Georgia',
		color: '#fafafa',
	});

	// Description (multi-line, simple wrap)
	const descLines = wrapText(
		tooltip.ctx,
		meta.desc,
		TOOLTIP_CANVAS_W - 60,
		'18px sans-serif',
	);
	tooltip.ctx.font = '18px sans-serif';
	tooltip.ctx.fillStyle = '#cfd8e6';
	tooltip.ctx.textAlign = 'center';
	tooltip.ctx.textBaseline = 'top';
	let y = 90;
	for (const line of descLines) {
		tooltip.ctx.fillText(line, TOOLTIP_CANVAS_W / 2, y);
		y += 26;
	}

	// Status banner at the bottom
	const isDone = _state.identified.has(partName);
	tooltip.ctx.fillStyle = isDone ? '#22c55e' : '#ffd248';
	tooltip.ctx.font = 'bold 22px sans-serif';
	tooltip.ctx.textAlign = 'center';
	tooltip.ctx.textBaseline = 'middle';
	tooltip.ctx.fillText(
		isDone ? 'Танигдсан ✓' : 'Танигдаагүй ✗',
		TOOLTIP_CANVAS_W / 2,
		TOOLTIP_CANVAS_H - 36,
	);

	tooltip.update();
}

/** Word-wrap helper that respects ctx.measureText for the active font. */
function wrapText(ctx, text, maxWidth, font) {
	ctx.font = font;
	const words = text.split(/\s+/);
	const lines = [];
	let current = '';
	for (const word of words) {
		const test = current ? current + ' ' + word : word;
		if (ctx.measureText(test).width > maxWidth && current) {
			lines.push(current);
			current = word;
		} else {
			current = test;
		}
	}
	if (current) lines.push(current);
	return lines;
}

// =====================================================================
// HOVER DETECTION (controller raycast / mouse raycast)
// =====================================================================

const _ray = new THREE.Raycaster();
const _rayMatrix = new THREE.Matrix4();
const _rayOrigin = new THREE.Vector3();
const _rayDir = new THREE.Vector3();

function raycastFromController(controller) {
	_rayMatrix.identity().extractRotation(controller.matrixWorld);
	_rayOrigin.setFromMatrixPosition(controller.matrixWorld);
	_rayDir.set(0, 0, -1).applyMatrix4(_rayMatrix);
	_ray.set(_rayOrigin, _rayDir);
}

function raycastFromMouse(mouseNDC, camera) {
	_ray.setFromCamera(mouseNDC, camera);
}

/**
 * Returns the closest UN-identified part the laser is aimed at.
 * Already-identified parts are transparent to hover detection so the
 * laser passes through them; the user can no longer "re-hover" a
 * green-checked part once it's been learned.
 */
function pickPartHover() {
	if (!_state) return null;
	const hits = _ray.intersectObject(_state.microscope, true);
	for (const hit of hits) {
		const part = findPartName(hit.object);
		if (!part) continue;
		if (_state.identified.has(part)) continue;
		return part;
	}
	return null;
}

// =====================================================================
// IDENTIFY (mark a part as known)
// =====================================================================

function identify(partName, controllerForHaptic) {
	if (!_state || !partName) return;
	if (_state.identified.has(partName)) return;
	_state.identified.add(partName);

	// Place a check sprite at the part's centre
	const part = _state.microscope.getObjectByName(partName);
	if (part) {
		const centre = partWorldCentre(part);
		// Lift slightly and offset toward the user's side so the check
		// stays visible above the part rather than baked inside it.
		centre.y += 0.04;
		centre.z += 0.02;
		const sprite = makeCheckSprite();
		sprite.position.copy(centre);
		_state.scene.add(sprite);
		_state.checkSprites.set(partName, sprite);
	}

	// Audio + haptic feedback
	playDing();
	pulseHaptic(controllerForHaptic);

	// Refresh UI
	renderSidePanel();
	if (_state.hoveredPart === partName) renderTooltip(partName);

	// Completion gate
	if (_state.identified.size === TOTAL_PARTS && !_state.completed) {
		_state.completed = true;
		startConfetti();
		renderSidePanel();
	}
}

function makeCheckSprite() {
	const mat = new THREE.SpriteMaterial({
		map: getCheckTexture(),
		transparent: true,
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
	});
	const sprite = new THREE.Sprite(mat);
	sprite.scale.set(CHECK_SPRITE_SIZE, CHECK_SPRITE_SIZE, 1);
	sprite.renderOrder = 12;
	return sprite;
}

function pulseHaptic(controller) {
	if (!controller) return;
	const src = controller.userData && controller.userData.xrInputSource;
	const actuator = src && src.gamepad && src.gamepad.hapticActuators
		? src.gamepad.hapticActuators[0]
		: null;
	if (actuator && typeof actuator.pulse === 'function') {
		try {
			actuator.pulse(0.6, 100);
		} catch {
			// some browsers reject if not in a session — swallow
		}
	}
}

// =====================================================================
// CONFETTI — completion celebration
// =====================================================================

function startConfetti() {
	if (!_state) return;
	const N = CONFETTI_COUNT;
	const geom = new THREE.BoxGeometry(0.014, 0.014, 0.002);
	const mat = new THREE.MeshBasicMaterial();
	const mesh = new THREE.InstancedMesh(geom, mat, N);
	mesh.frustumCulled = false;
	mesh.renderOrder = 11;

	// Microscope centre as the spawn point
	const microCentre = new THREE.Vector3(0.2, 1.20, 0.25);

	const data = [];
	for (let i = 0; i < N; i++) {
		const angle = Math.random() * Math.PI * 2;
		const horiz = (0.4 + Math.random() * 0.9);
		data.push({
			pos: microCentre.clone(),
			vel: new THREE.Vector3(
				Math.cos(angle) * horiz,
				1.6 + Math.random() * 1.6,
				Math.sin(angle) * horiz,
			),
			rot: new THREE.Euler(),
			rotVel: new THREE.Vector3(
				(Math.random() - 0.5) * 6,
				(Math.random() - 0.5) * 6,
				(Math.random() - 0.5) * 6,
			),
		});
		const c = new THREE.Color();
		c.setHSL(Math.random(), 0.75, 0.6);
		mesh.setColorAt(i, c);
	}
	if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

	_state.scene.add(mesh);
	_state.confetti = { mesh, data, age: 0 };
}

function updateConfetti(delta) {
	if (!_state || !_state.confetti) return;
	const { mesh, data } = _state.confetti;
	_state.confetti.age += delta;

	const dummy = new THREE.Object3D();
	for (let i = 0; i < data.length; i++) {
		const d = data[i];
		d.vel.y -= 9.8 * delta;
		d.pos.addScaledVector(d.vel, delta);
		d.rot.x += d.rotVel.x * delta;
		d.rot.y += d.rotVel.y * delta;
		d.rot.z += d.rotVel.z * delta;
		dummy.position.copy(d.pos);
		dummy.rotation.copy(d.rot);
		dummy.updateMatrix();
		mesh.setMatrixAt(i, dummy.matrix);
	}
	mesh.instanceMatrix.needsUpdate = true;

	if (_state.confetti.age >= CONFETTI_DURATION) {
		_state.scene.remove(mesh);
		mesh.geometry.dispose();
		mesh.material.dispose();
		_state.confetti = null;
	}
}

// =====================================================================
// RESET / EXIT
// =====================================================================

function resetLearn() {
	if (!_state) return;
	_state.identified.clear();
	for (const sprite of _state.checkSprites.values()) {
		_state.scene.remove(sprite);
		sprite.material.dispose();
	}
	_state.checkSprites.clear();
	_state.completed = false;
	if (_state.confetti) {
		_state.scene.remove(_state.confetti.mesh);
		_state.confetti.mesh.geometry.dispose();
		_state.confetti.mesh.material.dispose();
		_state.confetti = null;
	}
	renderSidePanel();
	if (_state.hoveredPart) renderTooltip(_state.hoveredPart);
}

function exitLearn() {
	const onExit = _state && _state.onExit;
	stopLearn();
	if (onExit) onExit();
}

// =====================================================================
// PUBLIC API
// =====================================================================

/**
 * @param {{
 *   scene: THREE.Scene,
 *   camera: THREE.Camera,
 *   renderer: THREE.WebGLRenderer,
 *   microscope: THREE.Object3D,
 *   interactions?: any,
 *   onExit: () => void,
 * }} options
 */
export function startLearn({
	scene,
	camera,
	renderer,
	microscope,
	interactions,
	onExit,
}) {
	if (_state) stopLearn();

	// ── Side panel (left of user, gaze height) ───────────────────
	const sidePanel = new Panel({
		width: SIDE_PANEL_W,
		height: SIDE_PANEL_H,
		canvasW: SIDE_CANVAS_W,
		canvasH: SIDE_CANVAS_H,
		pixelScale: 2,
	});
	sidePanel.mesh.position.copy(SIDE_PANEL_POS);
	scene.add(sidePanel.mesh);
	const sideHandle = {
		panel: sidePanel,
		setHover: (id) => sidePanel.setHover(id),
		dispose: () => sidePanel.dispose(),
	};
	if (interactions) interactions.registerPanel(sideHandle);

	// ── Tooltip (hidden until hover) ─────────────────────────────
	const tooltip = new Panel({
		width: TOOLTIP_PANEL_W,
		height: TOOLTIP_PANEL_H,
		canvasW: TOOLTIP_CANVAS_W,
		canvasH: TOOLTIP_CANVAS_H,
		pixelScale: 2,
	});
	tooltip.mesh.visible = false;
	tooltip.mesh.renderOrder = 13;
	scene.add(tooltip.mesh);

	// ── VR controllers — track input sources for haptics, listen
	//    for trigger 'select' events so we can identify parts. ────
	const vrControllers = [
		renderer.xr.getController(0),
		renderer.xr.getController(1),
	];
	const handlers = [];
	for (const controller of vrControllers) {
		const onConnected = (e) => {
			controller.userData.xrInputSource = e.data;
		};
		const onDisconnected = () => {
			controller.userData.xrInputSource = null;
		};
		const onSelect = () => {
			if (!_state) return;
			// Identify the STABLE hover (the part the user actually sees
			// highlighted + the tooltip for) — not whatever the laser
			// happened to flicker onto at click instant.
			if (_state.hoveredPart) identify(_state.hoveredPart, controller);
		};
		controller.addEventListener('connected', onConnected);
		controller.addEventListener('disconnected', onDisconnected);
		controller.addEventListener('select', onSelect);
		handlers.push({ controller, onConnected, onDisconnected, onSelect });
	}

	// ── Desktop click — same identify logic but via mouse ────────
	const container = renderer.domElement;
	const mouse = new THREE.Vector2();
	const onMouseMove = (e) => {
		if (renderer.xr.isPresenting) return;
		const rect = container.getBoundingClientRect();
		mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
		mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
	};
	const onMouseClick = () => {
		if (!_state || renderer.xr.isPresenting) return;
		// Same as VR — use the stable hovered part (post-dwell), not a
		// fresh raycast taken at the click instant.
		if (_state.hoveredPart) identify(_state.hoveredPart, null);
	};
	container.addEventListener('mousemove', onMouseMove);
	container.addEventListener('click', onMouseClick);

	_state = {
		scene,
		camera,
		renderer,
		microscope,
		interactions,
		onExit,
		sidePanel,
		sideHandle,
		tooltip,
		vrControllers,
		controllerHandlers: handlers,
		container,
		mouse,
		onMouseMove,
		onMouseClick,
		hoveredPart: null,
		// Dwell-stabiliser scratch state (used in updateLearn)
		pendingHover: null,
		pendingTime: 0,
		identified: new Set(),
		checkSprites: new Map(),
		confetti: null,
		completed: false,
		audioCtx: null,
	};

	renderSidePanel();
	faceCamera(sidePanel.mesh, camera);
}

/** Tear down all panels, sprites, listeners. Safe to call repeatedly. */
export function stopLearn() {
	if (!_state) return;

	// Restore any in-progress hover highlight so the next mode starts
	// with un-modified microscope materials.
	clearHighlight(_state.microscope);

	// Remove sprites
	for (const sprite of _state.checkSprites.values()) {
		_state.scene.remove(sprite);
		sprite.material.dispose();
	}
	_state.checkSprites.clear();

	// Remove confetti
	if (_state.confetti) {
		_state.scene.remove(_state.confetti.mesh);
		_state.confetti.mesh.geometry.dispose();
		_state.confetti.mesh.material.dispose();
	}

	// Unregister + dispose panels
	if (_state.interactions) {
		_state.interactions.unregisterPanel(_state.sideHandle);
	}
	_state.sidePanel.dispose();
	_state.tooltip.dispose();

	// Detach controller listeners
	for (const h of _state.controllerHandlers) {
		h.controller.removeEventListener('connected', h.onConnected);
		h.controller.removeEventListener('disconnected', h.onDisconnected);
		h.controller.removeEventListener('select', h.onSelect);
	}

	// Detach mouse listeners
	_state.container.removeEventListener('mousemove', _state.onMouseMove);
	_state.container.removeEventListener('click', _state.onMouseClick);

	_state = null;
}

/**
 * Per-frame tick. Call from the main animation loop.
 *   • Recomputes hover state from controllers / mouse.
 *   • Re-faces the side panel + tooltip toward the camera.
 *   • Drives the confetti physics.
 */
export function updateLearn(delta /*, time */) {
	if (!_state) return;

	// Resolve current raycast hit from VR controllers (any) or mouse (desktop)
	let rawHover = null;
	if (_state.renderer.xr.isPresenting) {
		for (const controller of _state.vrControllers) {
			raycastFromController(controller);
			const part = pickPartHover();
			if (part) {
				rawHover = part;
				break; // first controller's hit wins
			}
		}
	} else {
		raycastFromMouse(_state.mouse, _state.camera);
		rawHover = pickPartHover();
	}

	// Dwell-time stabiliser. Controller hand-tremor causes the raw hit
	// to flicker between adjacent meshes every few frames, which would
	// thrash the tooltip + cyan highlight if applied directly. We commit
	// a new hover only after the laser has rested on it for
	// HOVER_NEW_DWELL_MS (or rested on "nothing" for HOVER_LOST_DWELL_MS).
	const now = performance.now();
	let nextHover;
	if (rawHover === _state.hoveredPart) {
		// Ray is back on the current target — abandon any pending switch.
		_state.pendingHover = null;
		_state.pendingTime = 0;
		nextHover = _state.hoveredPart;
	} else if (rawHover !== _state.pendingHover) {
		// New candidate — start the dwell timer for it.
		_state.pendingHover = rawHover;
		_state.pendingTime = now;
		nextHover = _state.hoveredPart;
	} else {
		// Same candidate as last frame — has it dwelled long enough?
		const dwellNeeded =
			rawHover === null ? HOVER_LOST_DWELL_MS : HOVER_NEW_DWELL_MS;
		if (now - _state.pendingTime >= dwellNeeded) {
			nextHover = rawHover; // commit (may be null = clear)
			_state.pendingHover = null;
			_state.pendingTime = 0;
		} else {
			nextHover = _state.hoveredPart; // keep current — still settling
		}
	}

	if (nextHover !== _state.hoveredPart) {
		// Swap the cyan-pulse highlight from the previous hover to the
		// new one. clearHighlight is global, but it ONLY touches
		// material clones — green identification Sprites are scene
		// children and stay put.
		clearHighlight(_state.microscope);
		_state.hoveredPart = nextHover;
		if (nextHover) {
			highlightPart(_state.microscope, nextHover);
			renderTooltip(nextHover);
			_state.tooltip.mesh.visible = true;
		} else {
			_state.tooltip.mesh.visible = false;
		}
	}

	// Tooltip anchored 40 cm to the RIGHT of the hovered part at gaze
	// height — clear of the microscope body so the user can read it
	// while the laser ray + cyan glow stay on the part itself.
	if (_state.hoveredPart) {
		const part = _state.microscope.getObjectByName(_state.hoveredPart);
		if (part) {
			const centre = partWorldCentre(part);
			_state.tooltip.mesh.position.set(
				centre.x + TOOLTIP_X_OFFSET,
				TOOLTIP_FIXED_Y,
				centre.z,
			);
			faceCamera(_state.tooltip.mesh, _state.camera);
		}
	}

	// Side panel always faces camera horizontally
	faceCamera(_state.sidePanel.mesh, _state.camera);

	// Confetti physics
	if (_state.confetti) updateConfetti(delta);
}
