/**
 * @file Eyepiece viewport + magnification + hand-driven optics controls.
 *
 * Owns:
 *   • A circular Canvas-textured plane parented to the camera. When the
 *     user's head is close to the eyepiece, the plane fades in and shows
 *     the specimen drawn at the current optical settings.
 *   • The optical state (objective, coarse + fine focus, diaphragm,
 *     power) and animations of the visible model parts.
 *   • Hand-driven interactions on the actual microscope parts. The user
 *     squeezes the controller's GRIP button while their hand is near a
 *     knob / nosepiece / diaphragm / switch, then physically moves the
 *     controller to operate it. No side-panel buttons required —
 *     replicating the NCBioNetwork lab simulator's "feel".
 *
 *   Hand control map (grip held + motion):
 *     • Microscope_OnOffSwitch  — squeeze toggles power (no motion needed)
 *     • Microscope_Nosepiece    — horizontal arc → 90° detents per objective
 *     • Microscope_CoarseKnob   — vertical motion → coarse focus
 *     • Microscope_FineKnob     — vertical motion → fine focus
 *     • Microscope_Diaphragm    — horizontal motion → aperture %
 *
 * Public API:
 *   const optics = createOptics({ scene, camera, renderer, microscope, getStageSlideId });
 *   optics.setControllers([controller0, controller1])
 *   optics.update(delta, time)
 *   optics.cycleObjective(direction)   // +1 or -1
 *   optics.adjustCoarse(direction)     // +/- 1, panel-button fallback
 *   optics.adjustFine(direction)
 *   optics.adjustDiaphragm(direction)
 *   optics.togglePower()
 *   optics.getState()
 *   optics.dispose()
 */

import * as THREE from 'three';

import {
	playDetentClick,
	playGlassShatter,
	playKnobTick,
	playSwitchClick,
} from '../core/audio.js';
import { drawSpecimen } from '../activities/specimens.js';

// =====================================================================
// MODEL CONSTANTS
// =====================================================================

const EYEPIECE_POWER = 10;

const OBJECTIVES = [
	{ power: 4,   partName: 'Microscope_Objective_4x'   },
	{ power: 10,  partName: 'Microscope_Objective_10x'  },
	{ power: 40,  partName: 'Microscope_Objective_40x'  },
	{ power: 100, partName: 'Microscope_Objective_100x' },
];

function coarseAllowedFor(objectiveIndex) {
	return objectiveIndex <= 1; // 4× and 10× only — saves the 40×/100× lens
}

/** Strict real-microscope rule: fine focus is the precision adjustment
 *  needed at high magnification. At 4×/10× the field is so large that
 *  fine focus is meaningless — kids should learn to reach for the
 *  COARSE knob there. We block fine engagement at low mag with a
 *  buzz haptic so the lesson sticks. */
function fineAllowedFor(objectiveIndex) {
	return objectiveIndex >= 2; // 40× and 100× only
}

const COARSE_STEP = 0.06;
const FINE_STEP = 0.02;
const DIAPHRAGM_STEP = 0.20;

const NOSEPIECE_TWEEN_TIME = 0.5;

// =====================================================================
// EYEPIECE OVERLAY
// =====================================================================

/**
 * Overlay plane geometry. The plane is now BIG ENOUGH (1.40 m) at the
 * 0.35 m camera distance to fill the kid's whole field of view — that
 * way, when they lean into the eyepiece, the dark surround occludes the
 * lab and they get a clean "looking through the tube" experience. The
 * actual specimen circle inside the canvas is sized small (~18% of the
 * canvas radius) so the dark frame is clearly visible.
 */
const OVERLAY_PLANE_SIZE = 1.40;
const OVERLAY_PLANE_DIST = 0.35;
const OVERLAY_CANVAS_SIZE = 1024;

/** Distance (m) from the head to the eyepiece-LENS world centre below
 *  which the overlay is fully visible. With the 1.1× microscope scale
 *  and a standing head Y ≈ 1.68 m vs. lens Y ≈ 1.46 m, the kid's eye
 *  can realistically lean to ≈ 9-10 cm above the lens — so 12 cm
 *  triggers reliably the moment the kid's nose dips toward the
 *  eyepiece, which is the cue we want. */
const PROXIMITY_FULL = 0.12;
/** Distance above which the overlay is hidden entirely. The 12 → 25 cm
 *  fade window gives a smooth ramp — the kid sees the view appear as
 *  they lean in, instead of it snapping on at the last centimetre. */
const PROXIMITY_FADE = 0.25;
/** Cap on overlay alpha. At 0.97 the immersion is strong but the
 *  kid can still faintly see their hands / the microscope frame
 *  around the dark surround when adjusting focus knobs while looking
 *  through the lens. */
const OVERLAY_MAX_OPACITY = 0.97;

// =====================================================================
// HAND-DRIVEN INTERACTIONS
// =====================================================================

/**
 * Per-part interaction spec. The user squeezes the controller grip
 * within `grabRadius` of the part's world centre and then physically
 * moves the controller — `kind` decides what that motion does.
 *
 *   toggle        — squeeze fires once (no motion tracking)
 *   spin-vertical — vertical (y) controller motion adjusts a 0..1 value
 *                   (focus knobs)
 *   slide-horizontal — horizontal (x) controller motion adjusts a 0..1
 *                   value (diaphragm)
 *   detent-rotate — horizontal arc; when accumulated motion crosses
 *                   ±DETENT_THRESHOLD, fire one detent step
 */
/**
 * Each interactive part gets a generous grab radius so the kid doesn't
 * have to position their hand pixel-perfectly, plus a `hint` symbol
 * that the proximity-cue sprite renders to teach the gesture: a kid
 * sees "↕" floating above the focus knob and immediately knows to
 * grip-and-drag UP/DOWN.
 */
const INTERACTIVE_PARTS = [
	{ name: 'Microscope_OnOffSwitch', kind: 'toggle',           grabRadius: 0.09, hint: '⏻', hintLabel: 'TAP' },
	{ name: 'Microscope_StageClips',  kind: 'tap-clips',        grabRadius: 0.08, hint: '↓', hintLabel: 'CLIP' },
	{ name: 'Microscope_Nosepiece',   kind: 'detent-rotate',    grabRadius: 0.11, hint: '↻', hintLabel: 'TURN' },
	{ name: 'Microscope_CoarseKnob',  kind: 'spin-vertical',    grabRadius: 0.10, hint: '↕', hintLabel: 'PULL' },
	{ name: 'Microscope_FineKnob',    kind: 'spin-vertical',    grabRadius: 0.08, hint: '↕', hintLabel: 'PULL' },
	{ name: 'Microscope_Diaphragm',   kind: 'slide-horizontal', grabRadius: 0.09, hint: '↔', hintLabel: 'SLIDE' },
];

/** Vertical motion (m) per full focus sweep — 4 cm of hand travel
 *  walks the coarse knob from one extreme to the other. */
const FOCUS_M_PER_SWEEP = 0.04;
/** Horizontal motion (m) per full diaphragm sweep. */
const DIAPHRAGM_M_PER_SWEEP = 0.05;
/** Horizontal arc (m) accumulated before the nosepiece snaps to its
 *  next 90° detent. */
const DETENT_THRESHOLD = 0.05;

// =====================================================================
// PUBLIC FACTORY
// =====================================================================

/**
 * @param {{
 *   scene: THREE.Scene,
 *   camera: THREE.Camera,
 *   renderer: THREE.WebGLRenderer,
 *   microscope: THREE.Object3D,
 *   getStageSlideId: () => (string|null),
 * }} options
 */
export function createOptics({
	scene,
	camera,
	renderer,
	microscope,
	getStageSlideId,
	onClipsTap,
}) {
	// ── Optical state ───────────────────────────────────────────────
	const state = {
		objectiveIndex: 0,
		// Stage starts at the BOTTOM of its travel range so coarse-knob
		// rotation visibly RAISES the stage toward the objective —
		// matching the standard real-microscope procedure of starting
		// low and racking up. Sweet spot is at coarseFocus = 0.5.
		coarseFocus: 0.0,
		fineFocus: 0.5,
		diaphragm: 0.0,    // start CLOSED — workflow has user open it
		powerOn: false,    // start OFF — workflow has user turn it on
		nosepieceTween: null,
		// ── Workflow locks ────────────────────────────────────────
		// Each lock is set by an explore.js step's `onComplete` hook
		// once that step has been satisfied. Once set, the lock prevents
		// the corresponding action from being undone, so the kid can't
		// accidentally regress earlier work.
		powerLocked: false,        // true → cannot turn power off again
		diaphragmMin: 0.0,         // floor for state.diaphragm
		objectiveMin: 0,           // can't drop below this objective index
	};

	// ── Eyepiece overlay ────────────────────────────────────────────
	const canvas = document.createElement('canvas');
	canvas.width = OVERLAY_CANVAS_SIZE;
	canvas.height = OVERLAY_CANVAS_SIZE;
	const ctx = canvas.getContext('2d');

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.minFilter = THREE.LinearFilter;
	texture.magFilter = THREE.LinearFilter;
	texture.generateMipmaps = false;
	texture.anisotropy = 8;

	const overlayMat = new THREE.MeshBasicMaterial({
		map: texture,
		transparent: true,
		depthTest: false,
		depthWrite: false,
		side: THREE.DoubleSide,
		toneMapped: false,
	});
	overlayMat.opacity = 0;

	const overlay = new THREE.Mesh(
		new THREE.PlaneGeometry(OVERLAY_PLANE_SIZE, OVERLAY_PLANE_SIZE),
		overlayMat,
	);
	overlay.renderOrder = 9999;
	overlay.frustumCulled = false;
	overlay.position.set(0, 0, -OVERLAY_PLANE_DIST);
	overlay.visible = false;
	// Parent the overlay to the camera so it always tracks the headset
	// pose. The camera is itself a child of the player rig (set up in
	// init.js); we MUST NOT reparent it into the scene root, because
	// that would detach it from the rig — the user would then see the
	// laser/controllers move with locomotion while the camera stays
	// put, which is exactly the desync the user reported.
	camera.add(overlay);

	// ── Live preview monitor ──────────────────────────────────────
	// A small "LCD screen" mounted to the LEFT of the microscope. It
	// mirrors what the kid would see through the eyepiece, in real
	// time, so they can adjust focus/diaphragm with both hands while
	// watching the result — no need to keep leaning in. When they
	// nail the focus and want to see it BIG, they lean their face
	// into the eyepiece for the full immersive view.
	const previewMat = new THREE.MeshBasicMaterial({
		map: texture,            // share texture with the eyepiece overlay
		transparent: true,
		side: THREE.DoubleSide,
		toneMapped: false,
	});
	previewMat.opacity = 1;
	const previewPlane = new THREE.Mesh(
		new THREE.PlaneGeometry(0.18, 0.18),
		previewMat,
	);
	// FIXED to the LEFT of the microscope, close enough that the kid
	// sees focus changes WITHOUT having to look across the room. Half
	// the previous size — fits in peripheral vision while the kid is
	// looking at the model. Faces the kid's expected eye position
	// (one-time Y-axis lookAt at construct time, never per frame, so
	// the panel stops swimming with the head).
	previewPlane.position.set(-0.05, 1.45, 0.18);
	const _previewLookAt = new THREE.Vector3(0.20, 1.45, 0.70);
	previewPlane.lookAt(_previewLookAt);
	previewPlane.renderOrder = 9;
	previewPlane.visible = false;
	scene.add(previewPlane);

	// Chrome bezel around the monitor — sells "this is a screen" so the
	// kid reads it as a UI element, not a floating image. A flat ring
	// around the plane edge. Scaled to match the smaller plane.
	const bezelGeom = new THREE.RingGeometry(0.09, 0.10, 32);
	const bezelMat = new THREE.MeshBasicMaterial({
		color: 0x9aa6b0,
		side: THREE.DoubleSide,
		toneMapped: false,
	});
	const previewBezel = new THREE.Mesh(bezelGeom, bezelMat);
	previewBezel.position.copy(previewPlane.position);
	previewBezel.position.z -= 0.001; // sit just behind the canvas plane
	previewBezel.renderOrder = 8;
	previewBezel.visible = false;
	previewBezel.quaternion.copy(previewPlane.quaternion);
	scene.add(previewBezel);

	// Title label above the monitor
	const titleCanvas = document.createElement('canvas');
	titleCanvas.width = 256; titleCanvas.height = 64;
	const tctx = titleCanvas.getContext('2d');
	tctx.fillStyle = 'rgba(15, 22, 34, 0.92)';
	tctx.fillRect(0, 0, 256, 64);
	tctx.fillStyle = '#00e5c7';
	tctx.font = 'bold 28px sans-serif';
	tctx.textAlign = 'center'; tctx.textBaseline = 'middle';
	tctx.fillText('LIVE VIEW', 128, 32);
	const titleTex = new THREE.CanvasTexture(titleCanvas);
	titleTex.colorSpace = THREE.SRGBColorSpace;
	titleTex.minFilter = THREE.LinearFilter;
	titleTex.generateMipmaps = false;
	const titleMat = new THREE.MeshBasicMaterial({
		map: titleTex,
		transparent: true,
		side: THREE.DoubleSide,
		toneMapped: false,
	});
	const previewTitle = new THREE.Mesh(
		new THREE.PlaneGeometry(0.09, 0.022),
		titleMat,
	);
	previewTitle.position.set(
		previewPlane.position.x,
		previewPlane.position.y + 0.11,
		previewPlane.position.z,
	);
	previewTitle.quaternion.copy(previewPlane.quaternion);
	previewTitle.renderOrder = 9;
	previewTitle.visible = false;
	scene.add(previewTitle);

	// ── Microscope part references ─────────────────────────────────
	const eyepiecePart  = microscope.getObjectByName('Microscope_Eyepiece');
	const nosepiece     = microscope.getObjectByName('Microscope_Nosepiece');
	const coarseKnob    = microscope.getObjectByName('Microscope_CoarseKnob');
	const fineKnob      = microscope.getObjectByName('Microscope_FineKnob');
	const lightSource   = microscope.getObjectByName('Microscope_LightSource');
	const onOffSwitch   = microscope.getObjectByName('Microscope_OnOffSwitch');
	const stagePart     = microscope.getObjectByName('Microscope_Stage');
	const diaphragmAperture = microscope.getObjectByName('Microscope_Diaphragm_Aperture');

	// Capture the stage's resting Y at startup so we can offset around
	// it as the user rotates the focus knobs. We exaggerate the travel
	// well beyond a real microscope's 1-2 mm because, in VR, the kid
	// is looking at the model from ~50 cm and a few mm of motion is
	// invisible — they need to SEE the stage rise and fall to connect
	// "I turned the knob → the stage moved → the image sharpened".
	// stageBaseY is the LOWEST stage position — the kid only RAISES
	// the stage from here. Keeps the stage from clipping through the
	// diaphragm below. Travel is capped at 0.030 so even at full focus
	// the stage stops just below the longest objective tip.
	const stageBaseY = stagePart ? stagePart.position.y : 0.130;
	const STAGE_TRAVEL = 0.030;

	// ── Active-objective drop animation ────────────────────────────
	// All four objectives are now the same physical length (see
	// makeNosepiece). To make the ACTIVE one obvious, we slide it ~8 mm
	// lower than its peers. The kid sees one objective sticking out
	// below the turret — the rest tucked up flush.
	const objectiveParts = [
		'Microscope_Objective_4x',
		'Microscope_Objective_10x',
		'Microscope_Objective_40x',
		'Microscope_Objective_100x',
	].map((n) => microscope.getObjectByName(n));
	const objectiveBaseY = objectiveParts.map((p) => p ? p.position.y : -0.010);
	const ACTIVE_DROP = 0.008;

	// ── Individual knob children for in-place spin ─────────────────
	// The Microscope_CoarseKnob group has its origin at the microscope
	// base (0,0,0). Rotating the GROUP around X spins it around the
	// base — the visible knobs orbit through space rather than spinning
	// in place. We instead rotate each KNOB CHILD around its own local
	// Y axis (which becomes the horizontal axle after the build.js
	// `rotation.z = π/2`).
	const coarseKnobChildren = coarseKnob ? [...coarseKnob.children] : [];
	const fineKnobChildren = fineKnob ? [...fineKnob.children] : [];
	const _spinAxis = new THREE.Vector3(0, 1, 0);

	// ── Visible light beam ────────────────────────────────────────
	// Two-layer additive glow: an INNER bright core and an OUTER
	// softer halo. Both share a vertical-gradient alpha map that
	// makes the cone solid at the LED face and fade to transparent at
	// the top — sells "the LED is shining and the light spreads as
	// it rises". Cheaper than a real PointLight + volumetric shader,
	// and reads cleanly on Quest 3S.
	const beamGradientTex = makeBeamGradientTexture();

	// Beam runs from LED face (y ≈ 0.025) up to the diaphragm bottom
	// (y ≈ 0.105). Length 0.080, midpoint 0.065. The cone widens as it
	// rises (LED is a point source, light fans out before hitting the
	// iris).
	const beamLength = 0.080;
	const beamY = 0.065;

	// Inner bright core — narrow, almost-white, dominant brightness.
	const beamCoreGeom = new THREE.CylinderGeometry(0.012, 0.003, beamLength, 24, 1, true);
	const beamCoreMat = new THREE.MeshBasicMaterial({
		color: 0xfff5d8,
		map: beamGradientTex,
		transparent: true,
		opacity: 0,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
		side: THREE.DoubleSide,
		toneMapped: false,
	});
	const beamCore = new THREE.Mesh(beamCoreGeom, beamCoreMat);
	beamCore.position.set(0, beamY, 0.020);
	beamCore.frustumCulled = false;
	beamCore.renderOrder = 8;
	microscope.add(beamCore);

	// Outer soft halo — wider, warmer, dimmer. Wraps the core with a
	// gentle ambient glow so the beam doesn't read as a hard pillar.
	const beamHaloGeom = new THREE.CylinderGeometry(0.024, 0.005, beamLength, 24, 1, true);
	const beamHaloMat = new THREE.MeshBasicMaterial({
		color: 0xffe49a,
		map: beamGradientTex,
		transparent: true,
		opacity: 0,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
		side: THREE.DoubleSide,
		toneMapped: false,
	});
	const beamHalo = new THREE.Mesh(beamHaloGeom, beamHaloMat);
	beamHalo.position.set(0, beamY, 0.020);
	beamHalo.frustumCulled = false;
	beamHalo.renderOrder = 7;
	microscope.add(beamHalo);

	// Glow plane at the LED face — radial gradient sprite that adds a
	// warm bloom at the source. Reads as "the LED itself is hot".
	const lampGlowTex = makeLampGlowTexture();
	const lampGlowMat = new THREE.MeshBasicMaterial({
		map: lampGlowTex,
		color: 0xfff3c8,
		transparent: true,
		opacity: 0,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
		side: THREE.DoubleSide,
		toneMapped: false,
	});
	const lampGlow = new THREE.Mesh(
		new THREE.PlaneGeometry(0.038, 0.038),
		lampGlowMat,
	);
	lampGlow.rotation.x = -Math.PI / 2;
	lampGlow.position.set(0, 0.0265, 0.020);
	lampGlow.renderOrder = 8;
	microscope.add(lampGlow);

	// Track all beam-related objects for the per-frame opacity update.
	const beamMeshes = [beamCore, beamHalo, lampGlow];
	const beamMats = [beamCoreMat, beamHaloMat, lampGlowMat];
	const beamPeakOpacities = [0.65, 0.45, 0.95];

	// LED emissive material — locate the inner emissive child once.
	let ledMat = null;
	if (lightSource) {
		lightSource.traverse((child) => {
			if (
				!ledMat &&
				child.material &&
				child.material.emissive &&
				child.material.emissive.r + child.material.emissive.g + child.material.emissive.b > 0
			) {
				ledMat = child.material;
			}
		});
	}

	// ── Eyepiece world position cache ──────────────────────────────
	// Point at the LENS face, not the group origin or bbox top — only
	// the lens is where the kid actually presses their eye against.
	// build.js names this mesh `Microscope_Eyepiece_Lens` for direct
	// lookup. Falls back to the group's bbox top if the lens isn't
	// found (e.g. an older microscope build).
	const _eyeWorld = new THREE.Vector3();
	const _eyeBox = new THREE.Box3();
	const eyeLens = microscope.getObjectByName('Microscope_Eyepiece_Lens');
	function updateEyepieceWorld() {
		if (eyeLens) {
			eyeLens.getWorldPosition(_eyeWorld);
		} else if (eyepiecePart) {
			_eyeBox.setFromObject(eyepiecePart);
			_eyeBox.getCenter(_eyeWorld);
			_eyeWorld.y = _eyeBox.max.y;
		} else {
			_eyeWorld.set(0.2, 1.42, 0.29);
		}
	}
	updateEyepieceWorld();

	// ── Hand-control state (per controller) ────────────────────────
	const controllers = []; // populated by setControllers()
	const controllerHandlers = [];
	const heldByController = new Map(); // controller → { spec, lastCtrlPos, accum, tickAccum, prevFocus }

	const _tmpCtrlPos = new THREE.Vector3();
	const _tmpPartPos = new THREE.Vector3();
	const _camHeadWorld = new THREE.Vector3();
	const _grabBox = new THREE.Box3();

	/**
	 * World position the kid is actually REACHING for, not the part
	 * group's origin. Most of the microscope's named groups (e.g.
	 * Microscope_CoarseKnob) keep their local origin at the microscope's
	 * base while their visible meshes live at substantial local offsets
	 * — so getWorldPosition() returns a point ~17 cm AWAY from where
	 * the knob actually is in space. Using the bounding-box centre
	 * fixes proximity checks for both grab and hint-sprite placement.
	 *
	 * The microscope is static (it doesn't translate during Explore),
	 * so we cache the centroid the first time each part is asked for —
	 * setFromObject traverses the entire sub-tree, which adds up across
	 * 6 interactive parts × 2 controllers × 90 fps. Only the stage
	 * moves (with focus), and we don't proximity-check the stage.
	 */
	const _centroidCache = new Map();
	function getPartGrabPos(part, out) {
		const cached = _centroidCache.get(part);
		if (cached) {
			out.copy(cached);
			return out;
		}
		_grabBox.setFromObject(part);
		_grabBox.getCenter(out);
		_centroidCache.set(part, out.clone());
		return out;
	}

	// ── Proximity hint sprites ─────────────────────────────────────
	// One per interactive part. Becomes visible only when:
	//   1. The part is in the workflow's CURRENT-step highlight set
	//      (set via setActiveHintParts) — so the kid never sees a hint
	//      for a part they aren't supposed to be touching right now.
	//   2. The kid's hand is within the part's grab radius (≈ "they're
	//      touching it"), not the loose 1.8× proximity we used before.
	const hintSprites = new Map();
	for (const spec of INTERACTIVE_PARTS) {
		const sprite = makeHintSprite(spec.hint, spec.hintLabel);
		sprite.visible = false;
		scene.add(sprite);
		hintSprites.set(spec.name, sprite);
	}

	/** Workflow-driven set of part names that are eligible to show
	 *  their hint sprite. Empty → no hints (e.g. during notification
	 *  steps that don't ask the kid to touch anything). */
	const activeHintParts = new Set();
	function setActiveHintParts(names) {
		activeHintParts.clear();
		if (Array.isArray(names)) {
			for (const n of names) activeHintParts.add(n);
		}
	}

	function setControllers(ctrls) {
		// Detach any previous bindings
		for (const h of controllerHandlers) {
			h.controller.removeEventListener('squeezestart', h.onSqueezeStart);
			h.controller.removeEventListener('squeezeend', h.onSqueezeEnd);
			h.controller.removeEventListener('select', h.onSelect);
		}
		controllerHandlers.length = 0;
		controllers.length = 0;

		for (const controller of ctrls) {
			if (!controller) continue;
			const onSqueezeStart = () => onGripStart(controller);
			const onSqueezeEnd = () => onGripEnd(controller);
			const onSelect = () => onTriggerSelect(controller);
			controller.addEventListener('squeezestart', onSqueezeStart);
			controller.addEventListener('squeezeend', onSqueezeEnd);
			controller.addEventListener('select', onSelect);
			controllerHandlers.push({ controller, onSqueezeStart, onSqueezeEnd, onSelect });
			controllers.push(controller);
		}
	}

	/** Returns the NAME of the interactive part closest to ANY
	 *  controller, within its grab radius, or null. Used by free-mode
	 *  to drive hover-highlight feedback. */
	function getHoveredPartName() {
		let best = null;
		let bestDist = Infinity;
		for (const ctrl of controllers) {
			ctrl.getWorldPosition(_tmpCtrlPos);
			for (const spec of INTERACTIVE_PARTS) {
				const part = microscope.getObjectByName(spec.name);
				if (!part) continue;
				getPartGrabPos(part, _tmpPartPos);
				const d = _tmpCtrlPos.distanceTo(_tmpPartPos);
				if (d < spec.grabRadius && d < bestDist) {
					bestDist = d;
					best = spec.name;
				}
			}
		}
		return best;
	}

	/** Returns `{ spec, part }` for the closest interactive part within
	 *  its grab radius of the controller, or null. */
	function findGrabTarget(controller) {
		controller.getWorldPosition(_tmpCtrlPos);
		let best = null;
		let bestDist = Infinity;
		for (const spec of INTERACTIVE_PARTS) {
			const part = microscope.getObjectByName(spec.name);
			if (!part) continue;
			getPartGrabPos(part, _tmpPartPos);
			const d = _tmpCtrlPos.distanceTo(_tmpPartPos);
			if (d < spec.grabRadius && d < bestDist) {
				bestDist = d;
				best = { spec, part };
			}
		}
		return best;
	}

	function onGripStart(controller) {
		// Don't try to grab a microscope part if the controller is already
		// carrying a slide — that grip press is the user reaching for the
		// stage, handled by the slide system on squeeze-release.
		if (controllerHoldingSlide(controller)) return;

		const target = findGrabTarget(controller);
		if (!target) return;
		const { spec } = target;

		if (spec.kind === 'toggle') {
			togglePower();
			playSwitchClick();
			pulseHaptic(controller, 0.8, 60);
			return;
		}

		if (spec.kind === 'tap-clips') {
			// One-shot tap on the spring clips. Routed out so slides.js
			// can flip the visual + state — clips are slide-domain, not
			// optics-domain, but the proximity/grip handling lives here.
			if (onClipsTap) onClipsTap();
			pulseHaptic(controller, 0.7, 70);
			return;
		}

		controller.getWorldPosition(_tmpCtrlPos);
		heldByController.set(controller, {
			spec,
			lastCtrlPos: _tmpCtrlPos.clone(),
			accum: 0,
			tickAccum: 0,
			prevFocus: getEffectiveFocus(),
		});
		// Strong "got it" pulse so the kid can feel the moment the knob
		// engages, even without looking down at the controller.
		pulseHaptic(controller, 0.6, 60);
	}

	function onGripEnd(controller) {
		heldByController.delete(controller);
	}

	/** Trigger (select) on the power switch flips it too — friendlier
	 *  than requiring the user to grip-press a tiny switch. */
	function onTriggerSelect(controller) {
		controller.getWorldPosition(_tmpCtrlPos);
		if (onOffSwitch) {
			getPartGrabPos(onOffSwitch, _tmpPartPos);
			if (_tmpCtrlPos.distanceTo(_tmpPartPos) < 0.09) {
				togglePower();
				playSwitchClick();
				pulseHaptic(controller, 0.8, 60);
			}
		}
	}

	function updateHandHolds(/* delta */) {
		for (const [controller, hold] of heldByController) {
			controller.getWorldPosition(_tmpCtrlPos);
			const dx = _tmpCtrlPos.x - hold.lastCtrlPos.x;
			const dy = _tmpCtrlPos.y - hold.lastCtrlPos.y;
			const motion = Math.abs(dx) + Math.abs(dy);

			switch (hold.spec.kind) {
				case 'spin-vertical': {
					// Up → focus increases, down → decreases.
					const focusDelta = dy / FOCUS_M_PER_SWEEP;
					if (hold.spec.name === 'Microscope_CoarseKnob') {
						if (coarseAllowedFor(state.objectiveIndex)) {
							state.coarseFocus = clamp(state.coarseFocus + focusDelta, 0, 1);
							spinKnobsInPlace(coarseKnobChildren, focusDelta * 6);
							hold.misuseAccum = 0; // they're at low mag, allowed
						} else {
							// Locked! Track accumulated misuse — if the kid
							// keeps cranking the coarse knob at 40×/100×,
							// after ≈ 5 cm of motion we shatter the slide
							// (sound only) as a warning that they're about
							// to crash the lens through the cover slip.
							pulseHaptic(controller, 0.15, 40);
							hold.misuseAccum = (hold.misuseAccum || 0) + Math.abs(dy);
							if (hold.misuseAccum >= 0.05 && !hold.shatterFired) {
								hold.shatterFired = true;
								playGlassShatter();
								pulseHaptic(controller, 1.0, 200);
							}
						}
					} else {
						if (fineAllowedFor(state.objectiveIndex)) {
							state.fineFocus = clamp(state.fineFocus + focusDelta, 0, 1);
							spinKnobsInPlace(fineKnobChildren, focusDelta * 6);
						} else {
							// Buzz — fine is locked at low mag (4×/10×).
							pulseHaptic(controller, 0.15, 40);
						}
					}
					emitMotionTicks(controller, hold, motion);
					emitSweetSpotTick(controller, hold);
					break;
				}
				case 'slide-horizontal': {
					// Right → open, left → close (matches the lever direction
					// on a typical iris diaphragm). Diaphragm cannot drop
					// below state.diaphragmMin once the workflow has locked
					// the minimum.
					const apDelta = dx / DIAPHRAGM_M_PER_SWEEP;
					state.diaphragm = clamp(state.diaphragm + apDelta, state.diaphragmMin, 1);
					emitMotionTicks(controller, hold, motion);
					break;
				}
				case 'detent-rotate': {
					hold.accum += dx;
					if (Math.abs(hold.accum) >= DETENT_THRESHOLD) {
						const dir = hold.accum > 0 ? 1 : -1;
						cycleObjective(dir);
						hold.accum = 0;
						pulseHaptic(controller, 0.7, 80);
						playDetentClick();
					}
					emitMotionTicks(controller, hold, motion);
					break;
				}
				default:
					break;
			}
			hold.lastCtrlPos.copy(_tmpCtrlPos);
		}
	}

	/** Tiny haptic ticks every ~1.2 cm of hand travel — feels like the
	 *  kid is dragging across grit. Reinforces "I am moving the knob".
	 *  Without this, the controller is silent during the sweep and the
	 *  motion can feel ghost-like. */
	function emitMotionTicks(controller, hold, motion) {
		hold.tickAccum += motion;
		if (hold.tickAccum >= 0.012) {
			pulseHaptic(controller, 0.10, 12);
			playKnobTick();
			hold.tickAccum = 0;
		}
	}

	/** Stronger pulse when the focus value crosses the sweet spot at
	 *  0.5. Gives the kid a clear "you're THERE" tactile cue at the
	 *  in-focus position — easy to find without staring at the panel. */
	function emitSweetSpotTick(controller, hold) {
		const cur = getEffectiveFocus();
		if ((hold.prevFocus - 0.5) * (cur - 0.5) < 0) {
			pulseHaptic(controller, 0.55, 50);
		}
		hold.prevFocus = cur;
	}

	/** Float the directional-hint sprite above each interactive part.
	 *  Opacity ramps from 0 → 1 as the closer hand approaches; once
	 *  ANY hand is held on the part, it stays at full opacity until
	 *  release. Sprites that aren't near any hand and aren't held
	 *  fade to invisible so the lab doesn't feel cluttered. */
	function updateHintSprites() {
		// Cache "is part X currently held?" for cheap lookup below.
		const heldNames = new Set();
		for (const hold of heldByController.values()) heldNames.add(hold.spec.name);

		for (const spec of INTERACTIVE_PARTS) {
			const sprite = hintSprites.get(spec.name);
			if (!sprite) continue;

			// Filter 1: must be a part the active workflow step is
			// asking about. Without this filter the kid would see a
			// hint for the diaphragm (say) while reaching for the
			// focus knob — confusing and noisy.
			if (!activeHintParts.has(spec.name)) {
				sprite.visible = false;
				continue;
			}

			const part = microscope.getObjectByName(spec.name);
			if (!part) {
				sprite.visible = false;
				continue;
			}
			// Bounding-box centre — see getPartGrabPos for why we don't
			// trust part.getWorldPosition() for these named groups.
			getPartGrabPos(part, _tmpPartPos);
			// Position to the RIGHT of the part (not above) — keeps the
			// hint out of the part itself and out of the kid's main view
			// of the model. World +X for all parts; the diaphragm sticks
			// out a bit further.
			const isDiaphragm = spec.name === 'Microscope_Diaphragm';
			sprite.position.copy(_tmpPartPos);
			sprite.position.x += isDiaphragm ? 0.07 : 0.04;

			// Filter 2: the kid's hand must be within the part's actual
			// grab radius — i.e. they're "touching" the part, not just
			// nearby. This makes the hint feel like the part is
			// REACTING to contact rather than asserting itself
			// unprompted.
			let proximity = 0;
			for (const ctrl of controllers) {
				ctrl.getWorldPosition(_tmpCtrlPos);
				const d = _tmpCtrlPos.distanceTo(_tmpPartPos);
				if (d < spec.grabRadius) {
					proximity = Math.max(proximity, 1 - d / spec.grabRadius);
				}
			}
			if (heldNames.has(spec.name)) proximity = 1;

			sprite.visible = proximity > 0.05;
			sprite.material.opacity = proximity;
			// Half the previous size — the hint is meant to whisper "you
			// can grab this", not dominate the kid's view of the model.
			const baseScale = 0.022 + proximity * 0.013;
			sprite.scale.set(baseScale, baseScale, 1);
		}
	}

	// ── Animations ─────────────────────────────────────────────────
	function tweenNosepiece(toRot) {
		if (!nosepiece) return;
		state.nosepieceTween = {
			from: nosepiece.rotation.y,
			to: toRot,
			t: 0,
			duration: NOSEPIECE_TWEEN_TIME,
		};
	}

	function updateAnimations(delta) {
		if (state.nosepieceTween && nosepiece) {
			const t = state.nosepieceTween;
			t.t += delta;
			const a = Math.min(1, t.t / t.duration);
			const eased = a < 0.5 ? 4 * a * a * a : 1 - Math.pow(-2 * a + 2, 3) / 2;
			nosepiece.rotation.y = t.from + (t.to - t.from) * eased;
			if (a >= 1) state.nosepieceTween = null;
		}

		// LED emission — CONSTANT brightness when power is on. The
		// diaphragm does NOT dim the LED in a real microscope; it only
		// limits how much light passes the IRIS upward to the specimen.
		// Tying LED brightness to diaphragm was a physics error.
		if (ledMat) {
			ledMat.emissiveIntensity = state.powerOn ? 1.6 : 0.0;
		}

		// Light beam from LED to diaphragm — represents the LIGHT
		// EMITTED by the bulb, before any iris regulation. Stays at
		// full opacity while power is on, regardless of diaphragm.
		// Two-layer beam (core + halo) + lamp glow each ramp toward
		// their peak with a cheap lerp for a soft on/off transition.
		for (let i = 0; i < beamMats.length; i++) {
			const mat = beamMats[i];
			const target = state.powerOn ? beamPeakOpacities[i] : 0;
			mat.opacity += (target - mat.opacity) * 0.25;
		}

		// Diaphragm aperture (the IRIS hole) — physically opens and
		// closes with state.diaphragm. Scale 0.05 (almost closed) to
		// 1.0 (fully open). This is what the kid SEES respond to the
		// diaphragm lever; the brightness of the SPECIMEN above is
		// modulated separately by drawSpecimen using the same value.
		if (diaphragmAperture) {
			const irisScale = 0.05 + state.diaphragm * 0.95;
			diaphragmAperture.scale.set(irisScale, irisScale, 1);
			// Dim the aperture when power is off (no light passing).
			if (diaphragmAperture.material) {
				diaphragmAperture.material.emissiveIntensity = state.powerOn ? 1.4 : 0.0;
			}
		}

		// Spin the on-off switch toggle so the user sees the flip.
		if (onOffSwitch) {
			const targetX = state.powerOn ? 0.4 : -0.4;
			onOffSwitch.rotation.x += (targetX - onOffSwitch.rotation.x) * 0.2;
		}

		// Stage tracks the focus value. focus = 0 → stage at lowest
		// (start position, fully retracted from the objective). focus
		// = 1 → stage at the TOP of its safe travel. Sweet-spot for
		// in-focus image is around focus = 0.5 (mid-travel).
		if (stagePart) {
			stagePart.position.y = stageBaseY + getEffectiveFocus() * STAGE_TRAVEL;
		}

		// Drop the ACTIVE objective ~8 mm lower than the other three
		// so the kid can see at a glance which one is engaged. Smooth
		// lerp keeps the motion soft when the nosepiece rotates.
		for (let i = 0; i < objectiveParts.length; i++) {
			const part = objectiveParts[i];
			if (!part) continue;
			const targetY = objectiveBaseY[i] - (i === state.objectiveIndex ? ACTIVE_DROP : 0);
			part.position.y += (targetY - part.position.y) * 0.18;
		}
	}

	// ── Per-frame ──────────────────────────────────────────────────
	function update(delta /*, time */) {
		updateAnimations(delta);
		updateHandHolds(delta);
		updateHintSprites();

		updateEyepieceWorld();
		if (renderer.xr.isPresenting) {
			const xrCam = renderer.xr.getCamera();
			xrCam.getWorldPosition(_camHeadWorld);
		} else {
			camera.getWorldPosition(_camHeadWorld);
		}
		const dist = _camHeadWorld.distanceTo(_eyeWorld);

		let alpha;
		if (manualOverlayMode) {
			// X-button override: full overlay regardless of head distance.
			alpha = OVERLAY_MAX_OPACITY;
		} else if (dist <= PROXIMITY_FULL) {
			alpha = OVERLAY_MAX_OPACITY;
		} else if (dist >= PROXIMITY_FADE) {
			alpha = 0;
		} else {
			const t = 1 - (dist - PROXIMITY_FULL) / (PROXIMITY_FADE - PROXIMITY_FULL);
			alpha = t * OVERLAY_MAX_OPACITY;
		}

		overlayMat.opacity = alpha;
		overlay.visible = alpha > 0.01;

		// Live preview monitor — visible whenever the lab is "running"
		// (power on AND a slide on the stage). FIXED in world space:
		// position + orientation set ONCE at construction. No lookAt
		// per frame; the panel feels like a stable wall-mounted
		// display, never "swimming" with the kid's head.
		const previewActive = state.powerOn && !!getStageSlideId();
		previewPlane.visible = previewActive;
		previewBezel.visible = previewActive;
		previewTitle.visible = previewActive;

		// Redraw if EITHER consumer is visible — one canvas update,
		// two displays. We throttle to ≈ 24 fps and skip entirely when
		// the rendered state hasn't changed; the canvas drawing is
		// expensive (radial gradients × hundreds of cells) and was the
		// dominant cost when the kid was rapidly turning a knob.
		if (overlay.visible || previewActive) {
			_redrawTimer += delta;
			if (_redrawTimer >= REDRAW_INTERVAL) {
				_redrawTimer = 0;
				maybeRedrawOverlay();
			}
		}
	}

	let _redrawTimer = 0;
	const REDRAW_INTERVAL = 1 / 24; // ~42 ms — plenty for a microscope sim

	let _lastDrawKey = null;
	function maybeRedrawOverlay() {
		const slideId = getStageSlideId();
		// Quantise focus / diaphragm so 0.001-level jitter doesn't
		// trigger a redraw — the kid can't perceive that magnitude
		// of change anyway.
		const key =
			(slideId || '_') + '|' +
			state.objectiveIndex + '|' +
			(state.powerOn ? '1' : '0') + '|' +
			Math.round(state.coarseFocus * 200) + '|' +
			Math.round(state.fineFocus * 200) + '|' +
			Math.round(state.diaphragm * 100);
		if (key === _lastDrawKey) return;
		_lastDrawKey = key;
		redrawOverlay();
	}

	function redrawOverlay() {
		const slideId = getStageSlideId();
		if (!state.powerOn) {
			drawDarkField(ctx, canvas.width, canvas.height, 'Гэрэл унтраалттай байна');
		} else if (!slideId) {
			drawDarkField(ctx, canvas.width, canvas.height, 'Слайд тавиагүй байна');
		} else {
			drawSpecimen(
				slideId, ctx, canvas.width, canvas.height,
				getMagnification(), getEffectiveFocus(), getEffectiveBrightness(),
			);
		}
		texture.needsUpdate = true;
	}

	// ── Derived state ──────────────────────────────────────────────
	function getMagnification() {
		return EYEPIECE_POWER * OBJECTIVES[state.objectiveIndex].power;
	}

	function getEffectiveFocus() {
		const fineDelta = (state.fineFocus - 0.5) * 0.20;
		return clamp(state.coarseFocus + fineDelta, 0, 1);
	}

	function getEffectiveBrightness() {
		return state.powerOn ? state.diaphragm : 0.0;
	}

	function getState() {
		return {
			objectiveIndex: state.objectiveIndex,
			objectivePower: OBJECTIVES[state.objectiveIndex].power,
			magnification: getMagnification(),
			coarseFocus: state.coarseFocus,
			fineFocus: state.fineFocus,
			focus: getEffectiveFocus(),
			focusError: Math.abs(getEffectiveFocus() - 0.5) * 2,
			diaphragm: state.diaphragm,
			brightness: getEffectiveBrightness(),
			powerOn: state.powerOn,
			coarseAllowed: coarseAllowedFor(state.objectiveIndex),
			fineAllowed: fineAllowedFor(state.objectiveIndex),
		};
	}

	// ── Mutations (used by panel buttons + auto-callers) ───────────
	function cycleObjective(direction = 1) {
		const min = state.objectiveMin || 0;
		let next;
		if (direction > 0) {
			next = state.objectiveIndex + 1;
			if (next >= OBJECTIVES.length) next = min; // wrap forward
		} else {
			next = state.objectiveIndex - 1;
			if (next < min) return; // backward motion blocked by progression lock
		}
		const stepDir = next > state.objectiveIndex ? 1 : -1;
		state.objectiveIndex = next;
		if (nosepiece) {
			tweenNosepiece(nosepiece.rotation.y + stepDir * Math.PI / 2);
		}
		// NB: we used to drift coarseFocus / fineFocus on switch to
		// force a refocus — but that visibly bumped the stage every
		// time the kid changed lens, which felt like a bug. Real
		// parfocal microscopes preserve focus across objectives, so
		// we now keep the focus untouched.
	}

	function adjustCoarse(direction) {
		if (!coarseAllowedFor(state.objectiveIndex)) return;
		state.coarseFocus = clamp(state.coarseFocus + direction * COARSE_STEP, 0, 1);
		spinKnobsInPlace(coarseKnobChildren, direction * 0.5);
	}

	function adjustFine(direction) {
		if (!fineAllowedFor(state.objectiveIndex)) return;
		state.fineFocus = clamp(state.fineFocus + direction * FINE_STEP, 0, 1);
		spinKnobsInPlace(fineKnobChildren, direction * 0.6);
	}

	/** Rotate each knob mesh around its OWN local Y axis. After build.js
	 *  applies `rotation.z = π/2` to each knob, that local Y maps to a
	 *  world-horizontal axis through the knob's centre — so the knob
	 *  spins in place like a real focus dial instead of orbiting around
	 *  the microscope base. */
	function spinKnobsInPlace(knobs, angle) {
		for (const k of knobs) k.rotateOnAxis(_spinAxis, angle);
	}

	function adjustDiaphragm(direction) {
		const target = state.diaphragm + direction * DIAPHRAGM_STEP;
		state.diaphragm = clamp(target, state.diaphragmMin, 1);
	}

	function togglePower() {
		// Once the power-on step is locked, the switch only fires the
		// "ON" direction — the kid can't accidentally turn the
		// microscope off again and regress to step 1.
		if (state.powerLocked) {
			if (!state.powerOn) state.powerOn = true;
			return;
		}
		state.powerOn = !state.powerOn;
	}

	/** Force a sizeable focus offset — used by the workflow on entry to
	 *  the coarse-find / fine-sharpen steps so the slide is visibly OUT
	 *  of focus and the kid HAS to operate the relevant knob. Without
	 *  this, the steps' `Math.abs(focus - 0.5) < threshold` checks would
	 *  evaluate true the moment the previous step finished (since focus
	 *  starts perfectly at 0.5) and the workflow would skip ahead. */
	function bumpFocus(magnitude) {
		const sign = Math.random() > 0.5 ? 1 : -1;
		const cMag = Math.max(0.10, magnitude);
		state.coarseFocus = clamp(state.coarseFocus + sign * cMag, 0.05, 0.95);
		state.fineFocus = clamp(state.fineFocus + sign * (magnitude * 0.5), 0.05, 0.95);
	}

	function lockPowerOn() { state.powerLocked = true; }
	function setDiaphragmMin(v) { state.diaphragmMin = clamp(v, 0, 1); }
	function setObjectiveMin(i) {
		state.objectiveMin = Math.max(0, Math.min(OBJECTIVES.length - 1, i | 0));
	}
	/** Lift every workflow lock — used when free-explore mode begins. */
	function clearLocks() {
		state.powerLocked = false;
		state.diaphragmMin = 0;
		state.objectiveMin = 0;
	}

	/** True when the kid's head is within the eyepiece-overlay fade
	 *  range — i.e. they're leaning into the lens. Used by the
	 *  workflow's eyepiece-look gate. */
	function isHeadAtEyepiece() {
		updateEyepieceWorld();
		if (renderer.xr.isPresenting) {
			const xrCam = renderer.xr.getCamera();
			xrCam.getWorldPosition(_camHeadWorld);
		} else {
			camera.getWorldPosition(_camHeadWorld);
		}
		return _camHeadWorld.distanceTo(_eyeWorld) < PROXIMITY_FADE;
	}

	/** Force the eyepiece overlay visible regardless of head proximity.
	 *  Wired to the controller X button in explore.js so the kid can
	 *  pop the tunnel view from anywhere in the lab. */
	let manualOverlayMode = false;
	function setManualEyepieceMode(on) { manualOverlayMode = !!on; }
	function toggleManualEyepieceMode() {
		manualOverlayMode = !manualOverlayMode;
	}
	function isManualEyepieceMode() { return manualOverlayMode; }

	/** When the workflow finishes, explore.js calls this so hint
	 *  sprites apply to ALL interactive parts (not just the workflow's
	 *  step-specific list). The hover-highlight is driven from
	 *  explore.js using getHoveredPartName(). */
	function setFreeMode(on) {
		if (on) {
			activeHintParts.clear();
			for (const spec of INTERACTIVE_PARTS) activeHintParts.add(spec.name);
		}
	}

	function dispose() {
		camera.remove(overlay);
		overlay.geometry.dispose();
		overlayMat.dispose();
		// texture is disposed below — both overlay and preview share it
		for (const sprite of hintSprites.values()) {
			scene.remove(sprite);
			if (sprite.material.map) sprite.material.map.dispose();
			sprite.material.dispose();
		}
		hintSprites.clear();
		scene.remove(previewPlane);
		previewPlane.geometry.dispose();
		previewMat.dispose();
		scene.remove(previewBezel);
		previewBezel.geometry.dispose();
		bezelMat.dispose();
		scene.remove(previewTitle);
		previewTitle.geometry.dispose();
		titleMat.dispose();
		titleTex.dispose();
		texture.dispose();
		for (const m of beamMeshes) {
			microscope.remove(m);
			m.geometry.dispose();
		}
		for (const mat of beamMats) {
			if (mat.map) mat.map.dispose();
			mat.dispose();
		}
		for (const h of controllerHandlers) {
			h.controller.removeEventListener('squeezestart', h.onSqueezeStart);
			h.controller.removeEventListener('squeezeend', h.onSqueezeEnd);
			h.controller.removeEventListener('select', h.onSelect);
		}
		controllerHandlers.length = 0;
		controllers.length = 0;
		heldByController.clear();
		if (nosepiece) nosepiece.rotation.y = 0;
		if (coarseKnob) coarseKnob.rotation.x = 0;
		if (fineKnob) fineKnob.rotation.x = 0;
		// Reset each individual knob's accumulated spin so the next
		// run of Explore starts from a clean orientation.
		for (const k of coarseKnobChildren) {
			k.rotation.x = 0; k.rotation.y = 0;
			// preserve original z rotation (π/2) which was set by build.js
			k.rotation.z = Math.PI / 2;
		}
		for (const k of fineKnobChildren) {
			k.rotation.x = 0; k.rotation.y = 0;
			k.rotation.z = Math.PI / 2;
		}
		if (onOffSwitch) onOffSwitch.rotation.x = 0;
		if (stagePart) stagePart.position.y = stageBaseY;
		// Restore objective base Y positions so the next Explore run
		// starts with no objective dropped.
		for (let i = 0; i < objectiveParts.length; i++) {
			const part = objectiveParts[i];
			if (part) part.position.y = objectiveBaseY[i];
		}
	}

	return {
		setControllers,
		setActiveHintParts,
		update,
		cycleObjective,
		adjustCoarse,
		adjustFine,
		adjustDiaphragm,
		togglePower,
		bumpFocus,
		lockPowerOn,
		setDiaphragmMin,
		setObjectiveMin,
		clearLocks,
		isHeadAtEyepiece,
		setManualEyepieceMode,
		toggleManualEyepieceMode,
		isManualEyepieceMode,
		setFreeMode,
		getHoveredPartName,
		getState,
		getMagnification,
		dispose,
	};
}

// =====================================================================
// FALLBACK FIELDS
// =====================================================================

function drawDarkField(ctx, w, h, message) {
	const cx = w / 2, cy = h / 2;
	// Match drawSpecimen's circle so the empty-state and live-state
	// have identical layout — feels like the same "screen" with content
	// swapped in and out.
	const radius = Math.min(w, h) * 0.35;

	ctx.fillStyle = '#000';
	ctx.fillRect(0, 0, w, h);

	ctx.save();
	ctx.beginPath();
	ctx.arc(cx, cy, radius, 0, Math.PI * 2);
	ctx.clip();
	ctx.fillStyle = '#0a0a0a';
	ctx.fillRect(0, 0, w, h);

	ctx.fillStyle = '#7a8a98';
	ctx.font = '28px sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(message, cx, cy);

	ctx.restore();
}

/** True if the controller currently has a slide group as a direct child
 *  (the slide system reparents slides onto controllers via attach()). */
function controllerHoldingSlide(controller) {
	for (const child of controller.children) {
		if (child.userData && child.userData.isSlide) return true;
	}
	return false;
}

/** Vertical gradient texture for the light-beam cone — solid white at
 *  the bottom (LED face), fading to transparent at the top (diaphragm).
 *  Combined with additive blending, this gives the cone a soft "the
 *  light dims as it disperses upward" feel instead of a hard pillar. */
function makeBeamGradientTexture() {
	const canvas = document.createElement('canvas');
	canvas.width = 16;
	canvas.height = 256;
	const ctx = canvas.getContext('2d');
	// Cylinder UV: bottom face at v=0 (canvas y=256 in UV-flipped land),
	// top face at v=1 (canvas y=0). We want bright at bottom → drawn
	// large alpha at canvas y near 256, fading to 0 at canvas y=0.
	const grad = ctx.createLinearGradient(0, 256, 0, 0);
	grad.addColorStop(0.00, 'rgba(255, 255, 255, 1.00)');
	grad.addColorStop(0.30, 'rgba(255, 255, 255, 0.80)');
	grad.addColorStop(0.70, 'rgba(255, 255, 255, 0.30)');
	grad.addColorStop(1.00, 'rgba(255, 255, 255, 0.00)');
	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, 16, 256);

	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.minFilter = THREE.LinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.generateMipmaps = false;
	tex.wrapS = THREE.RepeatWrapping;
	return tex;
}

/** Radial gradient texture for the LED's surface bloom — bright hot
 *  spot at the centre that fades to transparent at the edges. Drawn
 *  as a flat plane at the LED face. */
function makeLampGlowTexture() {
	const canvas = document.createElement('canvas');
	canvas.width = 128;
	canvas.height = 128;
	const ctx = canvas.getContext('2d');
	const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
	grad.addColorStop(0.00, 'rgba(255, 250, 220, 1.00)');
	grad.addColorStop(0.20, 'rgba(255, 240, 180, 0.85)');
	grad.addColorStop(0.55, 'rgba(255, 220, 130, 0.30)');
	grad.addColorStop(1.00, 'rgba(255, 200, 100, 0.00)');
	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, 128, 128);

	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.minFilter = THREE.LinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.generateMipmaps = false;
	return tex;
}

/** Build a circular "hint" sprite with a directional symbol + small
 *  caption. Drawn into a 256² canvas, dropped onto a Sprite so it
 *  always faces the camera. The opacity is animated by the optics
 *  module based on hand proximity. */
function makeHintSprite(symbol, label) {
	const canvas = document.createElement('canvas');
	canvas.width = 256;
	canvas.height = 256;
	const ctx = canvas.getContext('2d');

	// Soft cyan disc background
	ctx.fillStyle = 'rgba(0, 229, 199, 0.30)';
	ctx.beginPath();
	ctx.arc(128, 128, 110, 0, Math.PI * 2);
	ctx.fill();
	// Bright outline
	ctx.strokeStyle = '#00e5c7';
	ctx.lineWidth = 6;
	ctx.beginPath();
	ctx.arc(128, 128, 110, 0, Math.PI * 2);
	ctx.stroke();

	// Big direction symbol — fills the disc
	ctx.fillStyle = '#ffffff';
	ctx.font = 'bold 140px sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(symbol, 128, 132);

	// Caption pill — small text under the symbol explaining the gesture
	if (label) {
		ctx.fillStyle = 'rgba(10, 26, 40, 0.80)';
		const pillW = 110, pillH = 30;
		ctx.fillRect(128 - pillW / 2, 200, pillW, pillH);
		ctx.fillStyle = '#00e5c7';
		ctx.font = 'bold 18px sans-serif';
		ctx.fillText(label, 128, 215);
	}

	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.minFilter = THREE.LinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.generateMipmaps = false;

	const mat = new THREE.SpriteMaterial({
		map: tex,
		transparent: true,
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
	});
	mat.opacity = 0;

	const sprite = new THREE.Sprite(mat);
	sprite.renderOrder = 14;
	sprite.scale.set(0.045, 0.045, 1);
	return sprite;
}

function pulseHaptic(controller, intensity, durationMs) {
	const src = controller.userData && controller.userData.xrInputSource;
	const actuator = src && src.gamepad && src.gamepad.hapticActuators
		? src.gamepad.hapticActuators[0] : null;
	if (actuator && typeof actuator.pulse === 'function') {
		try {
			actuator.pulse(intensity, durationMs);
		} catch {
			// some browsers reject outside an active session — swallow
		}
	}
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
