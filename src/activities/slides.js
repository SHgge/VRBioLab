/**
 * @file Slide tray + grabbable slides for Explore mode.
 *
 * Spawns a small wooden tray on the bench to the user's right with the
 * four labelled glass slides (A onion, B blood, C letter-E, D leaf).
 * The user squeezes the grip button on a VR controller to pick a slide
 * up; while held the slide is reparented to the controller so it
 * tracks the hand. On release:
 *
 *   • If within SNAP_RADIUS of the stage, the slide locks onto the
 *     stage (replacing any previous stage slide, which returns to its
 *     home tray slot).
 *   • Otherwise the slide returns to its tray slot — we don't simulate
 *     physics, that's overkill for a learning sim.
 *
 * Desktop fallback: a `selectSlide(id)` API teleports a slide onto the
 * stage instantly. The Explore side panel uses this for the "Слайд
 * солих" cycle button.
 *
 * Public API:
 *   const slides = createSlideSystem({ scene, microscope, renderer, onStageSlideChanged });
 *   slides.update(delta)
 *   slides.selectSlide(id)        // desktop / programmatic
 *   slides.getStageSlideId()      // string | null
 *   slides.dispose()
 */

import * as THREE from 'three';

import { playClipsSnap, playSlideClink } from '../core/audio.js';
import { SLIDES } from './specimens.js';

// =====================================================================
// CONSTANTS
// =====================================================================

const SLIDE_W = 0.075;
const SLIDE_D = 0.025;
const SLIDE_T = 0.0012;

/** World-space position of the tray base. Sits on the bench top
 *  (y = 0.98) on the user's right of the microscope — swapped with
 *  the glove-box decor so the slide tray gets the prime hand-reach
 *  spot. */
const TRAY_POS = new THREE.Vector3(0.65, 0.98, 0.2);

/** Slide-on-stage local position INSIDE the stage Group.
 *
 *   • Stage plate is extruded depth 0.012 then translated +0.006 Y, so
 *     the plate occupies stage-local Y from 0.006 to 0.018 — the TOP
 *     surface (where the slide rests) is at Y = 0.018.
 *   • Slide thickness = SLIDE_T (0.0012). Half-thickness = 0.0006.
 *   • Slide bottom resting on the plate top + 1 mm gap to clear the
 *     stage clip springs → centre Y = 0.018 + 0.0006 + 0.001 ≈ 0.020.
 *
 *  When a slide is parented to the stage at this local offset, it sits
 *  visibly on top of the plate (not buried inside it) and automatically
 *  follows any vertical movement of the stage that the focus knobs
 *  apply. */
const STAGE_LOCAL_SLIDE = new THREE.Vector3(0, 0.020, 0);
const SNAP_RADIUS = 0.08;   // metres — within this, release → snap to stage
const GRAB_RADIUS = 0.12;   // metres — within this of a slide, squeeze → grab

// =====================================================================
// TEXTURES — slide labels (A, B, C, D + Mongolian name)
// =====================================================================

function makeSlideLabelTexture(letter, mn) {
	const canvas = document.createElement('canvas');
	canvas.width = 384;
	canvas.height = 144;
	const ctx = canvas.getContext('2d');

	// Frosted off-white background
	ctx.fillStyle = '#ece8d8';
	ctx.fillRect(0, 0, 384, 144);

	// Letter — larger so the kid can read it from a hand-held distance
	ctx.fillStyle = '#1a1a1a';
	ctx.font = 'bold 92px serif';
	ctx.textAlign = 'left';
	ctx.textBaseline = 'middle';
	ctx.fillText(letter, 18, 76);

	// Mongolian name
	ctx.fillStyle = '#3a3020';
	ctx.font = 'bold 34px sans-serif';
	ctx.textAlign = 'left';
	ctx.textBaseline = 'middle';
	ctx.fillText(mn, 115, 76);

	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.anisotropy = 8;
	tex.minFilter = THREE.LinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.generateMipmaps = false;
	return tex;
}

// Materials shared across slides (cheap to keep one per slide because
// the label texture differs per slide).
const _slideGlassMat = new THREE.MeshStandardMaterial({
	color: 0xeaf2ff,
	metalness: 0.05,
	roughness: 0.10,
	transparent: true,
	opacity: 0.85,
});

// =====================================================================
// BUILD ONE SLIDE MESH
// =====================================================================

function buildSlide(slideDef) {
	const group = new THREE.Group();
	group.name = `Slide_${slideDef.id}`;
	group.userData.slideId = slideDef.id;
	group.userData.isSlide = true;

	// Glass plate
	const glass = new THREE.Mesh(
		new THREE.BoxGeometry(SLIDE_W, SLIDE_T, SLIDE_D),
		_slideGlassMat,
	);
	glass.castShadow = false;
	glass.receiveShadow = false;
	group.add(glass);

	// Specimen droplet — coloured circle in the slide centre
	const dropMat = new THREE.MeshStandardMaterial({
		color: slideDef.dropColor,
		metalness: 0,
		roughness: 0.55,
	});
	const drop = new THREE.Mesh(
		new THREE.CircleGeometry(0.0085, 24),
		dropMat,
	);
	drop.rotation.x = -Math.PI / 2;
	drop.position.set(0.005, SLIDE_T / 2 + 0.0001, 0);
	group.add(drop);

	// Frosted label end (left third of the slide)
	const labelTex = makeSlideLabelTexture(slideDef.id, slideDef.mn);
	const labelMat = new THREE.MeshStandardMaterial({
		map: labelTex,
		color: 0xffffff,
		metalness: 0,
		roughness: 0.85,
	});
	const labelW = 0.030;
	const label = new THREE.Mesh(
		new THREE.PlaneGeometry(labelW, SLIDE_D * 0.85),
		labelMat,
	);
	label.rotation.x = -Math.PI / 2;
	label.position.set(-SLIDE_W / 2 + labelW / 2 + 0.001, SLIDE_T / 2 + 0.0002, 0);
	group.add(label);

	group.userData.disposeExtras = () => {
		labelTex.dispose();
		labelMat.dispose();
		dropMat.dispose();
	};

	return group;
}

// =====================================================================
// SLIDE TRAY (wooden board with 4 receptacle dimples)
// =====================================================================

function buildTray() {
	const group = new THREE.Group();
	group.name = 'SlideTray';

	const trayW = 0.20;
	const trayD = 0.13;
	const trayH = 0.012;

	// Wooden board
	const woodMat = new THREE.MeshStandardMaterial({
		color: 0x6e4a2c,
		metalness: 0,
		roughness: 0.85,
	});
	const board = new THREE.Mesh(
		new THREE.BoxGeometry(trayW, trayH, trayD),
		woodMat,
	);
	board.position.y = trayH / 2;
	board.castShadow = true;
	board.receiveShadow = true;
	group.add(board);

	// Side rails — keep slides from sliding off
	const railMat = new THREE.MeshStandardMaterial({
		color: 0x4a2f1c,
		metalness: 0,
		roughness: 0.85,
	});
	for (const sx of [-1, 1]) {
		const rail = new THREE.Mesh(
			new THREE.BoxGeometry(0.005, 0.005, trayD),
			railMat,
		);
		rail.position.set(sx * (trayW / 2 - 0.0025), trayH + 0.0025, 0);
		group.add(rail);
	}

	// Engraved title
	const titleCanvas = document.createElement('canvas');
	titleCanvas.width = 512; titleCanvas.height = 64;
	const tctx = titleCanvas.getContext('2d');
	tctx.fillStyle = '#6e4a2c'; tctx.fillRect(0, 0, 512, 64);
	tctx.fillStyle = '#e8d2a6';
	tctx.font = 'bold 28px serif';
	tctx.textAlign = 'center'; tctx.textBaseline = 'middle';
	tctx.fillText('БЭЛДМЭЛ', 256, 32);
	const titleTex = new THREE.CanvasTexture(titleCanvas);
	titleTex.colorSpace = THREE.SRGBColorSpace;
	titleTex.minFilter = THREE.LinearFilter;
	titleTex.generateMipmaps = false;
	const titleMat = new THREE.MeshStandardMaterial({
		map: titleTex,
		metalness: 0,
		roughness: 0.85,
	});
	const titlePlane = new THREE.Mesh(
		new THREE.PlaneGeometry(0.10, 0.012),
		titleMat,
	);
	titlePlane.rotation.x = -Math.PI / 2;
	titlePlane.position.set(0, trayH + 0.0001, -trayD / 2 + 0.012);
	group.add(titlePlane);

	group.userData.disposeExtras = () => {
		titleTex.dispose();
		titleMat.dispose();
	};

	return group;
}

/** Compute the home (slot) position for slide index i within the tray. */
function homePositionForIndex(i) {
	// 4 slots in a 2×2 grid on the tray, oriented along the bench.
	const col = i % 2;          // 0 left, 1 right
	const row = Math.floor(i / 2); // 0 back, 1 front
	const dx = (col === 0 ? -0.045 : 0.045);
	const dz = (row === 0 ? -0.030 : 0.030);
	return TRAY_POS.clone().add(new THREE.Vector3(dx, 0.013, dz));
}

// =====================================================================
// PUBLIC FACTORY
// =====================================================================

/**
 * @param {{
 *   scene: THREE.Scene,
 *   microscope: THREE.Object3D,
 *   renderer: THREE.WebGLRenderer,
 *   onStageSlideChanged?: (slideId: string|null) => void,
 * }} options
 */
export function createSlideSystem({
	scene,
	microscope,
	renderer,
	onStageSlideChanged,
}) {
	// Hide the built-in static slide that ships with the microscope so
	// our Explore-mode swappable slides are the only ones visible.
	const builtInSlide = findBuiltInSlide(microscope);
	if (builtInSlide) builtInSlide.visible = false;

	// Microscope_Stage group — slides are parented HERE when on stage,
	// so when the focus knobs move the stage vertically, the active
	// slide rides up/down with it (just like a real microscope).
	const stageGroup = microscope.getObjectByName('Microscope_Stage');

	// Tray
	const tray = buildTray();
	tray.position.copy(TRAY_POS);
	scene.add(tray);

	// Slides — created at home positions; world-space (parent = scene)
	const slideRecords = SLIDES.map((def, i) => {
		const mesh = buildSlide(def);
		const home = homePositionForIndex(i);
		mesh.position.copy(home);
		scene.add(mesh);
		return {
			id: def.id,
			def,
			mesh,
			home,
			location: 'tray', // 'tray' | 'stage' | 'held'
			heldBy: null,
		};
	});

	let stageSlideId = null;
	function setStageSlide(id) {
		if (stageSlideId === id) return;
		stageSlideId = id;
		if (onStageSlideChanged) onStageSlideChanged(id);
	}

	/** Once the workflow's "place-slide" step is satisfied, we lock
	 *  the stage so the kid can't yank the slide back off. They can
	 *  still SWAP slides via the side-panel "Слайд солих" button (the
	 *  selectSlide path) — what we forbid is leaving the stage empty. */
	let stageLocked = false;
	function lockStage() { stageLocked = true; }
	/** Lift the stage lock so the kid can grab the slide back off and
	 *  swap it for another. Called when free-explore mode begins. */
	function unlockStage() { stageLocked = false; }

	// ── Stage clips animation ──────────────────────────────────────
	// The two chrome spring meshes inside Microscope_StageClips. They
	// start tilted slightly up (rotation.z ≈ -0.10 from build.js) and
	// rotate further down to clamp onto the slide when secured.
	const SPRING_REST = -0.10;
	const SPRING_CLAMPED = -0.55;
	const CLIP_TWEEN_DURATION = 0.45;

	const clipsGroup = stageGroup ? stageGroup.getObjectByName('Microscope_StageClips') : null;
	const clipSprings = [];
	if (clipsGroup) {
		for (const child of clipsGroup.children) {
			// Springs are the meshes with rotation.z != 0; mounts have rotation 0.
			if (child.isMesh && Math.abs(child.rotation.z) > 1e-3) {
				clipSprings.push(child);
			}
		}
	}

	let clipsSecured = false;
	let clipTweenT = -1; // -1 = idle; 0..1 during animation
	let clipTweenReverse = false; // false = securing, true = releasing
	function areClipsSecured() { return clipsSecured; }

	/** Toggle the spring clips. Once the workflow's secure-clips step
	 *  is done, this becomes a real toggle in free-explore mode — the
	 *  kid can release the clips, swap the slide, and re-secure. */
	function secureClips() {
		clipsSecured = !clipsSecured;
		clipTweenReverse = !clipsSecured; // true while springs lift back up
		clipTweenT = 0;
		playClipsSnap();
	}

	function releaseClips() {
		// Used on dispose — restore springs to rest pose so the next
		// run of Explore mode starts from a clean visual.
		clipsSecured = false;
		clipTweenT = -1;
		clipTweenReverse = false;
		for (const s of clipSprings) s.rotation.z = SPRING_REST;
	}

	function tickClipsAnimation(delta) {
		if (clipTweenT < 0) return;
		clipTweenT = Math.min(1, clipTweenT + delta / CLIP_TWEEN_DURATION);
		const eased = 1 - Math.pow(1 - clipTweenT, 3);
		// Forward (rest → clamped) when securing; reverse when releasing.
		const startZ = clipTweenReverse ? SPRING_CLAMPED : SPRING_REST;
		const endZ   = clipTweenReverse ? SPRING_REST    : SPRING_CLAMPED;
		const z = startZ + (endZ - startZ) * eased;
		for (const s of clipSprings) s.rotation.z = z;
		if (clipTweenT >= 1) clipTweenT = -1;
	}

	// VR controllers — listen for grip squeeze events.
	const controllers = [renderer.xr.getController(0), renderer.xr.getController(1)];
	const controllerHandlers = [];
	for (const controller of controllers) {
		const onConnected = (e) => {
			controller.userData.xrInputSource = e.data;
		};
		const onDisconnected = () => {
			controller.userData.xrInputSource = null;
		};
		const onSqueezeStart = () => {
			tryGrabNearest(controller);
		};
		const onSqueezeEnd = () => {
			tryReleaseHeld(controller);
		};
		controller.addEventListener('connected', onConnected);
		controller.addEventListener('disconnected', onDisconnected);
		controller.addEventListener('squeezestart', onSqueezeStart);
		controller.addEventListener('squeezeend', onSqueezeEnd);
		controllerHandlers.push({
			controller, onConnected, onDisconnected, onSqueezeStart, onSqueezeEnd,
		});
	}

	const _v = new THREE.Vector3();
	const _q = new THREE.Quaternion();
	const _ctrlPos = new THREE.Vector3();
	const _slidePos = new THREE.Vector3();
	const _stageWorld = new THREE.Vector3();
	const _clipsWorld = new THREE.Vector3();
	const _clipsBox = new THREE.Box3();

	/** Current stage-top world position. The stage Y can drift as the
	 *  focus knobs adjust, so we read this fresh on every snap check. */
	function getStageSnapWorld(out) {
		if (stageGroup) {
			stageGroup.getWorldPosition(out);
			out.y += STAGE_LOCAL_SLIDE.y; // top of the stage plate
		} else {
			out.set(0.20, 1.1735, 0.270);
		}
		return out;
	}

	/** Move the slide onto the stage and reparent it under the stage
	 *  Group, so any subsequent stage movement carries the slide with
	 *  it. Safe to call from any source parent (scene / controller). */
	function dropSlideOnStage(rec) {
		if (stageGroup) {
			stageGroup.attach(rec.mesh); // preserves world transform
			rec.mesh.position.copy(STAGE_LOCAL_SLIDE);
			rec.mesh.quaternion.identity();
		} else {
			scene.attach(rec.mesh);
			getStageSnapWorld(_stageWorld);
			rec.mesh.position.copy(_stageWorld);
			rec.mesh.quaternion.identity();
		}
	}

	function tryGrabNearest(controller) {
		controller.getWorldPosition(_ctrlPos);

		// Find the closest grabbable slide.
		let best = null;
		let bestDist = GRAB_RADIUS;
		for (const rec of slideRecords) {
			if (rec.location === 'held') continue;
			if (stageLocked && rec.location === 'stage') continue;
			if (clipsSecured && rec.location === 'stage') continue;
			rec.mesh.getWorldPosition(_slidePos);
			const d = _slidePos.distanceTo(_ctrlPos);
			if (d < bestDist) {
				bestDist = d;
				best = rec;
			}
		}

		// CONFLICT GUARD: optics.js also fires a 'squeezestart' handler
		// for the StageClips part. The clips and the on-stage slide
		// physically overlap, so without this check both fire on the
		// same press: slides yanks the slide off, then optics secures
		// the clips on empty air. We DEFER to the clips when the kid's
		// hand is closer to them than to any slide — that lets
		// re-clamping work after a swap.
		if (clipsGroup) {
			_clipsBox.setFromObject(clipsGroup);
			_clipsBox.getCenter(_clipsWorld);
			const clipsDist = _ctrlPos.distanceTo(_clipsWorld);
			if (clipsDist < 0.10 && clipsDist <= bestDist) {
				return; // optics' tap-clips path will handle it
			}
		}

		if (!best) return;

		// Reparent to the controller so the slide tracks the hand.
		// THREE.Object3D.attach preserves the world transform across
		// reparenting — without it the slide would teleport into the
		// controller's local origin.
		controller.attach(best.mesh);
		best.location = 'held';
		best.heldBy = controller;
		// If we yanked the active stage slide off the stage, that means
		// nothing is on the stage anymore until the user drops one.
		if (stageSlideId === best.id) setStageSlide(null);
		pulseHaptic(controller, 0.4, 30);
	}

	function tryReleaseHeld(controller) {
		const rec = slideRecords.find((r) => r.heldBy === controller);
		if (!rec) return;
		// World positions at moment of release. Stage world is read live
		// because the focus knobs may have raised/lowered the stage.
		rec.mesh.getWorldPosition(_slidePos);
		getStageSnapWorld(_stageWorld);
		const onStage = _slidePos.distanceTo(_stageWorld) < SNAP_RADIUS;

		if (onStage) {
			// Bump any previous stage slide back to its tray slot.
			if (stageSlideId && stageSlideId !== rec.id) {
				const prev = slideRecords.find((r) => r.id === stageSlideId);
				if (prev) returnToTray(prev);
			}
			dropSlideOnStage(rec);
			rec.location = 'stage';
			rec.heldBy = null;
			setStageSlide(rec.id);
			pulseHaptic(controller, 0.7, 80);
			playSlideClink();
		} else {
			returnToTray(rec);
			pulseHaptic(controller, 0.2, 40);
		}
		void _v; void _q;
	}

	function returnToTray(rec) {
		// Detach from whatever (controller / stage) before teleporting
		// to the tray-slot home position; otherwise rec.home would be
		// interpreted in the parent's local frame.
		if (rec.mesh.parent && rec.mesh.parent !== scene) {
			scene.attach(rec.mesh);
		}
		rec.mesh.position.copy(rec.home);
		rec.mesh.quaternion.identity();
		rec.location = 'tray';
		rec.heldBy = null;
	}

	/** Programmatic select — used by the desktop "Слайд солих" button.
	 *  Teleports the named slide onto the stage and returns whatever was
	 *  there to its tray slot. */
	function selectSlide(id) {
		const rec = slideRecords.find((r) => r.id === id);
		if (!rec) return;
		// Bump previous stage slide.
		if (stageSlideId && stageSlideId !== id) {
			const prev = slideRecords.find((r) => r.id === stageSlideId);
			if (prev) returnToTray(prev);
		}
		dropSlideOnStage(rec);
		rec.location = 'stage';
		rec.heldBy = null;
		setStageSlide(id);
		playSlideClink();
	}

	function update(delta) {
		tickClipsAnimation(delta);
	}

	function dispose() {
		releaseClips();
		// Detach controller listeners
		for (const h of controllerHandlers) {
			h.controller.removeEventListener('connected', h.onConnected);
			h.controller.removeEventListener('disconnected', h.onDisconnected);
			h.controller.removeEventListener('squeezestart', h.onSqueezeStart);
			h.controller.removeEventListener('squeezeend', h.onSqueezeEnd);
		}
		// If a slide is still parented to a controller at exit, move it
		// back to the scene first so the disposal traversal is clean.
		for (const rec of slideRecords) {
			if (rec.mesh.parent && rec.mesh.parent !== scene) {
				scene.attach(rec.mesh);
			}
			scene.remove(rec.mesh);
			rec.mesh.traverse((child) => {
				if (child.geometry) child.geometry.dispose();
			});
			if (rec.mesh.userData.disposeExtras) rec.mesh.userData.disposeExtras();
		}
		scene.remove(tray);
		tray.traverse((child) => {
			if (child.geometry) child.geometry.dispose();
		});
		if (tray.userData.disposeExtras) tray.userData.disposeExtras();
		if (builtInSlide) builtInSlide.visible = true;
	}

	return {
		update,
		selectSlide,
		lockStage,
		unlockStage,
		secureClips,
		areClipsSecured,
		getStageSlideId: () => stageSlideId,
		dispose,
	};
}

// =====================================================================
// HELPERS
// =====================================================================

/** Find the original built-in slide on the microscope stage so we can
 *  hide it during Explore mode (and restore it on dispose). It's the
 *  only mesh inside Microscope_Stage with that tell-tale 0.075 × 0.025
 *  footprint. We grab the slide AND the static stained sample blob. */
function findBuiltInSlide(microscope) {
	const stage = microscope.getObjectByName('Microscope_Stage');
	if (!stage) return null;
	// Wrap the relevant children in a phantom group so the caller can
	// flip `.visible` on a single object.
	const fakeGroup = { _children: [], visible: true };
	for (const child of stage.children) {
		if (!child.geometry) continue;
		// The built-in slide is a 0.075 × 0.0010 × 0.025 BoxGeometry;
		// the stain is a 0.006-radius CircleGeometry; the label is
		// 0.014 × 0.0011 × 0.022. Match by component existence.
		const params = child.geometry.parameters;
		if (!params) continue;
		const isSlideBox = params.width === 0.075 && params.depth === 0.025;
		const isSampleBlob = params.radius === 0.006;
		const isSlideLabel = params.width === 0.014 && params.depth === 0.022;
		if (isSlideBox || isSampleBlob || isSlideLabel) {
			fakeGroup._children.push(child);
		}
	}
	if (fakeGroup._children.length === 0) return null;
	return {
		get visible() { return fakeGroup.visible; },
		set visible(v) {
			fakeGroup.visible = v;
			for (const c of fakeGroup._children) c.visible = v;
		},
	};
}

function pulseHaptic(controller, intensity, durationMs) {
	const src = controller.userData && controller.userData.xrInputSource;
	const actuator = src && src.gamepad && src.gamepad.hapticActuators
		? src.gamepad.hapticActuators[0] : null;
	if (actuator && typeof actuator.pulse === 'function') {
		try {
			actuator.pulse(intensity, durationMs);
		} catch {
			// some browsers refuse outside an active session — swallow
		}
	}
}
