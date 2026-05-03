/**
 * @file Explore mode — guided 9-step microscope workflow.
 *
 * Walks the student through the canonical NCBioNetwork sequence:
 *
 *   1. Гэрэл асаа               — squeeze the on/off switch
 *   2. Диафрагмыг бүрэн нээ     — grip the diaphragm + slide right
 *   3. 4× объектив сонго        — grip the nosepiece + rotate
 *   4. Бэлдмэлийг тавцанд тавь  — grip a slide and drop it on the stage
 *   5. Том фокусоор бэлдмэлийг ол — grip the coarse knob + move
 *   6. Нарийн фокусоор тодрууул   — grip the fine knob + move
 *   7. 10× объектив сонго        — re-rotate the nosepiece
 *   8. 40× объектив сонго        — re-rotate; coarse is now LOCKED
 *   9. Дуусгасан                  — summary panel
 *
 * Each step:
 *   • Highlights the model part(s) the user is supposed to interact
 *     with using the cyan emissive pulse from microscope/highlight.js.
 *   • Watches optics + slide state every frame; auto-advances when the
 *     gating condition is met (with a small ding + haptic).
 *   • Offers a "Алгасах ▶" skip button on the side panel for testing /
 *     accessibility.
 *
 * The hand-driven controls live in microscope/optics.js — squeezing the
 * grip button while near a part is the primary input. The side panel
 * also keeps duplicate ▼/▲ buttons as a desktop-mouse fallback.
 *
 * Public API:
 *   startExplore({ scene, camera, renderer, microscope, interactions, onExit })
 *   stopExplore()
 *   updateExplore(delta, time)
 */

import * as THREE from 'three';

import {
	clearHighlight,
	highlightPart,
	updateHighlights,
} from '../microscope/highlight.js';
import { playStepDing, playSweetSpotChime } from '../core/audio.js';
import { Panel } from '../ui/panel.js';
import { SLIDES } from './specimens.js';
import { createOptics } from '../microscope/optics.js';
import { createSlideSystem } from './slides.js';

// =====================================================================
// CONSTANTS
// =====================================================================

const SIDE_PANEL_W = 0.55;
const SIDE_PANEL_H = 0.78;
const SIDE_CANVAS_W = 720;
const SIDE_CANVAS_H = 1024;
const SIDE_PANEL_POS = new THREE.Vector3(-0.5, 1.55, -0.2);

// Callout = small panel anchored to the highlighted part with a cyan
// leader line drawn from the part to the panel. One per active step.
// Panel sits closer to the microscope (was 32 cm) so the kid can read
// the instructions and SEE the highlighted part in one glance, without
// flicking their gaze far to the side.
const CALLOUT_PANEL_W = 0.40;
const CALLOUT_PANEL_H = 0.22;
const CALLOUT_CANVAS_W = 768;
const CALLOUT_CANVAS_H = 420;
const CALLOUT_OFFSET_X = 0.22;     // metres from anchor to panel centre
const CALLOUT_PANEL_Y = 1.45;      // gaze height — slightly below default eye level

const SUMMARY_PANEL_W = 1.10;
const SUMMARY_PANEL_H = 0.76;
const SUMMARY_CANVAS_W = 1280;
const SUMMARY_CANVAS_H = 880;

// =====================================================================
// 9-STEP WORKFLOW
// =====================================================================

/**
 * Each step has:
 *   id, title (short), instruction (one line), help (longer prose),
 *   highlightParts: model parts to glow,
 *   isMet(state, slides): boolean — auto-advance when true.
 */
/**
 * Step definitions.
 *
 * Each step's lifecycle:
 *   • onEnter(optics, slides) — runs ONCE when the step becomes active.
 *     Used to perturb state so the gating condition is initially UNMET
 *     (e.g. defocus the slide so the user must operate the focus knob).
 *     Without this, steps that test "focus near 0.5" would auto-skip
 *     because focus starts perfectly at 0.5 from the previous step.
 *   • isMet(opticsState, slides) — true when the step's success
 *     condition currently holds. Used either by itself or together with
 *     dwellAdvance.
 *   • dwellAdvance — if set, advance after this many seconds REGARDLESS
 *     of isMet. Used for steps that just teach a fact ("you start at
 *     4×") rather than testing an action.
 *   • onComplete(optics, slides) — runs ONCE when the step advances.
 *     Used to lock the relevant state so the kid can't undo the action
 *     they just performed (e.g. once power is on it stays on).
 */
const STEPS = [
	{
		id: 'power-on',
		title: 'Алхам 1 / 8',
		instruction: 'Гэрлийг АСАА',
		help:
			'1) Гар-аа суурийн хажуугийн ⏻ товч руу ойртуул.\n' +
			'2) GRIP товчийг дарна.\n' +
			'3) Гэрэл асч, тавцангын доороос туяа цацарна.',
		highlightParts: ['Microscope_OnOffSwitch'],
		isMet: (s) => s.powerOn,
		onComplete: (optics) => optics.lockPowerOn(),
	},
	{
		id: 'open-diaphragm',
		title: 'Алхам 2 / 8',
		instruction: 'Диафрагмыг бүрэн НЭЭ',
		help:
			'1) Гар-аа тавцангын доорх ↔ хавтгай руу ойртуул.\n' +
			'2) GRIP-ийг ДАРСАН ХЭВЭЭР гар-аа БАРУУН тийш гулга.\n' +
			'3) Туяа гэрэлтэх хүртэл (85%+).',
		highlightParts: ['Microscope_Diaphragm'],
		isMet: (s) => s.diaphragm >= 0.85,
		onComplete: (optics) => optics.setDiaphragmMin(0.50),
	},
	{
		id: 'place-slide',
		title: 'Алхам 3 / 8',
		instruction: 'Бэлдмэлийг ТАВЬ',
		help:
			'1) Tray дээрх "e" үсэг slide руу гар очно.\n' +
			'2) GRIP дараад тавцан дээр авч ирнэ.\n' +
			'3) GRIP-ийг суллавал slide бэхлэгдэнэ.',
		highlightParts: ['Microscope_Stage'],
		isMet: (_s, slides) => slides.getStageSlideId() !== null,
		onComplete: (_optics, slides) => slides.lockStage(),
	},
	{
		id: 'secure-clips',
		title: 'Алхам 4 / 8',
		instruction: 'Хавчуурыг ДАР',
		help:
			'1) Тавцан дээрх 2 хавчуур руу гар очно.\n' +
			'2) GRIP товчийг ТОВШ.\n' +
			'3) Slide газартаа түгжигдсэн.',
		highlightParts: ['Microscope_StageClips'],
		isMet: (_s, slides) => slides.areClipsSecured(),
	},
	{
		id: 'coarse-find',
		title: 'Алхам 5 / 8',
		instruction: '4×-д ТОМ фокусаар тодрууул',
		help:
			'1) ТОМ дамар руу гар очиж GRIP дарна.\n' +
			'2) Дарсан хэвээр дээш-доош хөдөлгө.\n' +
			'3) Live View дээр дүрс ТОДРОХ хүртэл — авто шилжинэ.',
		highlightParts: ['Microscope_CoarseKnob'],
		isMet: (s) => s.objectiveIndex === 0 && Math.abs(s.focus - 0.5) < 0.10,
	},
	{
		id: 'eyepiece-4x',
		title: 'Алхам 6 / 8',
		instruction: 'Окуляр + X товч',
		help:
			'1) Толгойгоо окуляр (дээд линз) руу ойртуул.\n' +
			'2) Зүүн гарны X товчыг дар.\n' +
			'3) Дүрсийг бодитоор томруулж үзнэ үү — "e" үсэг УРВУУ харагдана.',
		highlightParts: ['Microscope_Eyepiece'],
		// Advance only when the kid actually presses X — confirms they
		// SAW the magnified view (proximity alone wasn't enough; the
		// kid could just stand near the lens).
		isMet: (_s, _slides, _entry, optics) => optics && optics.isManualEyepieceMode(),
	},
	{
		id: 'switch-10x',
		title: 'Алхам 7 / 8',
		instruction: '10× линз руу СЭЛГЭ',
		help:
			'1) Сэлгүүрийг гар-аар бариад эргүүл.\n' +
			'2) ШАР ТУУЗТАЙ 10× доош ирнэ.\n' +
			'3) Дахин ТОМ дамраар тодрууул.',
		highlightParts: ['Microscope_Nosepiece', 'Microscope_Objective_10x'],
		isMet: (s) => s.objectiveIndex >= 1 && Math.abs(s.focus - 0.5) < 0.05,
		onComplete: (optics) => optics.setObjectiveMin(1),
	},
	{
		id: 'eyepiece-10x',
		title: 'Алхам 8 / 8',
		instruction: '10×-д X товчоор дахин хар',
		help:
			'1) Окуляр руу дахин ойртуул.\n' +
			'2) Зүүн гарны X товчыг дар.\n' +
			'3) "e" 10× өсгөлтөөр илүү томорч харагдана. Амжилттай!',
		highlightParts: ['Microscope_Eyepiece'],
		isMet: (_s, _slides, _entry, optics) => optics && optics.isManualEyepieceMode(),
	},
	{
		id: 'done',
		title: 'Чөлөөт туршилт',
		instruction: 'Хүссэнээ хий!',
		help:
			'• Slide сольж бусад бэлдмэл харна.\n' +
			'• Бүх knob чөлөөтэй ажиллана.\n' +
			'• Гар ойртвол хэсгүүд гэрэлтэнэ.\n' +
			'• X товчоор линз дотроос харж болно.',
		highlightParts: [],
		isMet: () => false,
	},
];

const SUMMARY_LINES = [
	'Микроскопыг ажиллуулахын өмнө гэрлийг асаах ёстой.',
	'Диафрагмаар гэрлийн хэмжээг тохируулж бэлдмэлийн ялгааг тодруулна.',
	'Үргэлж хамгийн бага өсгөлтөөс (4×) эхлэн ажиллана.',
	'Том фокусыг зөвхөн 4× ба 10×-д ашиглах. 40×, 100×-д заавал нарийн фокус.',
	'Окуляр 10× × объектив = нийт өсгөлт (40, 100, 400, 1000).',
	'Микроскоп дүрсийг 180° эргүүлдэг — "E" үсэг урвуу харагдана.',
];

// =====================================================================
// MODULE STATE
// =====================================================================

let _state = null;

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
export function startExplore({
	scene,
	camera,
	renderer,
	microscope,
	interactions,
	onExit,
}) {
	if (_state) stopExplore();

	const slides = createSlideSystem({
		scene,
		microscope,
		renderer,
		onStageSlideChanged: () => renderSidePanel(),
	});

	const optics = createOptics({
		scene, camera, renderer, microscope,
		getStageSlideId: () => slides.getStageSlideId(),
		// Tap on stage clips routes from optics' grip detection into the
		// slide system — the clip animation + state lives there.
		onClipsTap: () => slides.secureClips(),
	});

	// Hook the VR controllers up to the optics module so grip-near-knob
	// drives the focus / nosepiece / diaphragm. Slide grabs go to the
	// slide system on the same controller events; both systems silently
	// no-op when their proximity check fails.
	const vrControllers = [
		renderer.xr.getController(0),
		renderer.xr.getController(1),
	];
	// Track xrInputSource on each controller so haptic helpers can fire
	// on the right hand (slides + optics share the lookup).
	const trackHandlers = [];
	for (const controller of vrControllers) {
		const onConnected = (e) => { controller.userData.xrInputSource = e.data; };
		const onDisconnected = () => { controller.userData.xrInputSource = null; };
		controller.addEventListener('connected', onConnected);
		controller.addEventListener('disconnected', onDisconnected);
		trackHandlers.push({ controller, onConnected, onDisconnected });
	}
	optics.setControllers(vrControllers);

	// Side panel
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
	sidePanel.onHoverChange = () => renderSidePanel();

	_state = {
		scene, camera, renderer, microscope, interactions, onExit,
		slides, optics,
		sidePanel, sideHandle,
		summaryPanel: null, summaryHandle: null,
		showingSummary: false,
		stepIndex: 0,
		stepHoldTimer: 0,        // dwell after step is satisfied before advancing
		audioCtx: null,
		vrControllers,
		trackHandlers,
		callout: null,           // { panel, line, anchorDot, anchorWorld }
		// Sweet-spot debouncer: must defocus past 0.15 before another
		// sparkle can fire, so the reward doesn't spam the kid every
		// frame they happen to be at 0.5.
		sweetSpotArmed: false,
		// True once the kid finishes the 8-step tutorial. Unlocks all
		// gated state and lets them explore freely.
		freeMode: false,
		// Hovered part name (set by optics.getHoveredPartName each
		// frame in free mode) — drives the per-frame highlight pulse.
		hoveredPartName: null,
		// Warning panel — floats near the microscope in free mode while
		// the stage is empty or the clips are released. Built lazily.
		warnPanel: null,
		warnLastShown: null, // 'no-slide' | 'no-clips' | null
	};

	applyStepHighlight();
	rebuildCallout();
	renderSidePanel();
	faceCamera(sidePanel.mesh, camera);
}

export function stopExplore() {
	if (!_state) return;

	clearHighlight(_state.microscope);
	disposeCallout();

	if (_state.interactions) {
		_state.interactions.unregisterPanel(_state.sideHandle);
		if (_state.summaryHandle) {
			_state.interactions.unregisterPanel(_state.summaryHandle);
		}
	}
	_state.sidePanel.dispose();
	if (_state.summaryPanel) _state.summaryPanel.dispose();
	disposeWarnPanel();
	_state.optics.dispose();
	_state.slides.dispose();

	for (const h of _state.trackHandlers) {
		h.controller.removeEventListener('connected', h.onConnected);
		h.controller.removeEventListener('disconnected', h.onDisconnected);
	}

	_state = null;
}

export function updateExplore(delta, time) {
	if (!_state) return;
	_state.optics.update(delta, time);
	_state.slides.update(delta);
	updateHighlights(time);

	const optState = _state.optics.getState();

	// Step gating — three modes per step:
	//   • dwellAdvance: just wait N seconds, then advance (notification)
	//   • isMet + 0.4 s dwell: condition-driven advance with a small
	//     hold so a momentary flicker doesn't skip the step
	//   • 'done': never advances on its own — user hits Дуусгах
	const step = STEPS[_state.stepIndex];
	if (step && !_state.showingSummary && step.id !== 'done') {
		if (step.dwellAdvance) {
			_state.stepHoldTimer += delta;
			if (_state.stepHoldTimer >= step.dwellAdvance) {
				advanceStep();
			}
		} else {
			// Pass optics as 4th arg so step.isMet can check
			// `optics.isHeadAtEyepiece()` for the eyepiece-look gates.
			if (step.isMet(optState, _state.slides, null, _state.optics)) {
				_state.stepHoldTimer += delta;
				if (_state.stepHoldTimer > 0.4) {
					advanceStep();
				}
			} else {
				_state.stepHoldTimer = 0;
			}
		}
	}

	// Sweet-spot reward — fires once each time the kid's focus crosses
	// into the in-focus band (after first defocusing far enough). Only
	// meaningful once they have a slide on the stage and the light is
	// on; otherwise the eyepiece is dark and there's nothing to see.
	if (
		optState.powerOn &&
		_state.slides.getStageSlideId() &&
		!_state.showingSummary
	) {
		if (!_state.sweetSpotArmed) {
			if (optState.focusError > 0.18) _state.sweetSpotArmed = true;
		} else if (optState.focusError < 0.04) {
			fireSweetSpot();
			_state.sweetSpotArmed = false;
		}
	}

	updateCallout();

	// Free-mode hover highlight: pulse cyan on whichever interactive
	// part the kid's hand is closest to. Re-uses the same highlight
	// system as the workflow steps but driven by proximity instead
	// of a fixed list.
	if (_state.freeMode) {
		const hovered = _state.optics.getHoveredPartName();
		if (hovered !== _state.hoveredPartName) {
			clearHighlight(_state.microscope);
			if (hovered) highlightPart(_state.microscope, hovered);
			_state.hoveredPartName = hovered;
		}
	}

	// X button on either controller toggles the manual eyepiece
	// overlay. Lets the kid pop the immersive tunnel view without
	// having to physically lean to the lens.
	pollEyepieceToggleButton();

	// Free-mode warning: experiment can only continue while the slide
	// is on the stage AND the clips are clamped. If the kid releases
	// the clips and forgets to re-clamp (or grabs the slide off and
	// hasn't put a new one back), we float a panel near the microscope
	// reminding them what's missing.
	if (_state.freeMode) updateFreeModeWarning();

	faceCamera(_state.sidePanel.mesh, _state.camera);
	if (_state.summaryPanel) faceCamera(_state.summaryPanel.mesh, _state.camera);
}

const _xButtonWasPressed = { 0: false, 1: false };
function pollEyepieceToggleButton() {
	if (!_state || !_state.renderer.xr.isPresenting) return;
	const session = _state.renderer.xr.getSession();
	if (!session) return;
	let i = 0;
	for (const source of session.inputSources) {
		if (i > 1) break;
		const gp = source.gamepad;
		// X (left controller) and A (right) are typically buttons[4].
		const button = gp && gp.buttons && gp.buttons[4];
		const pressedNow = !!(button && button.pressed);
		if (pressedNow && !_xButtonWasPressed[i]) {
			_state.optics.toggleManualEyepieceMode();
		}
		_xButtonWasPressed[i] = pressedNow;
		i++;
	}
}

// =====================================================================
// SWEET-SPOT REWARD — chime only (visual reward effects removed per
// user feedback; the live preview monitor already shows the kid that
// the focus is sharp, no overlay text needed)
// =====================================================================

function fireSweetSpot() {
	playSweetSpotChime();
}

// =====================================================================
// STEP MANAGEMENT
// =====================================================================

function advanceStep() {
	if (!_state) return;

	// Lock the action the kid just performed — see step.onComplete in
	// the STEPS array for what each step locks (power on, diaphragm
	// minimum, slide-on-stage, objective progression). Locking happens
	// BEFORE we move on so the new step starts in the locked state.
	const finishedStep = STEPS[_state.stepIndex];
	if (finishedStep && finishedStep.onComplete) {
		finishedStep.onComplete(_state.optics, _state.slides);
	}

	_state.stepIndex = Math.min(_state.stepIndex + 1, STEPS.length - 1);
	_state.stepHoldTimer = 0;

	// Run the new step's onEnter to perturb state if needed.
	const newStep = STEPS[_state.stepIndex];
	if (newStep && newStep.onEnter) {
		newStep.onEnter(_state.optics, _state.slides);
	}

	// 'done' step → unlock everything and switch to free-explore mode.
	// Hint sprites + hover highlights apply to ALL interactive parts;
	// no more workflow gating; kid plays freely. The slide stage and
	// clips become re-toggleable so the kid can unclamp, swap to a
	// different slide, and re-clamp.
	if (newStep && newStep.id === 'done') {
		_state.freeMode = true;
		_state.optics.clearLocks();
		_state.optics.setFreeMode(true);
		_state.slides.unlockStage();
	}

	playStepDing();
	applyStepHighlight();
	rebuildCallout();
	renderSidePanel();
}

function applyStepHighlight() {
	if (!_state) return;
	clearHighlight(_state.microscope);
	const step = STEPS[_state.stepIndex];
	if (!step) {
		_state.optics.setActiveHintParts([]);
		return;
	}
	if (_state.freeMode) {
		// Free mode: every interactive part shows its gesture hint
		// when the kid hovers near it; the workflow's static cyan
		// highlight is OFF (per-frame hover highlight handled in
		// updateExplore).
		_state.optics.setActiveHintParts([
			'Microscope_OnOffSwitch',
			'Microscope_StageClips',
			'Microscope_Nosepiece',
			'Microscope_CoarseKnob',
			'Microscope_FineKnob',
			'Microscope_Diaphragm',
		]);
		return;
	}
	for (const partName of step.highlightParts) {
		highlightPart(_state.microscope, partName);
	}
	_state.optics.setActiveHintParts(step.highlightParts);
}

// =====================================================================
// STEP CALLOUT — floating panel + leader line attached to the active
// part. Mimics the labelled-callouts in a textbook diagram so the
// student instantly sees WHERE on the model the next action happens.
// =====================================================================

const _anchorTmp = new THREE.Vector3();
const _anchorBox = new THREE.Box3();

/** World position to anchor the leader line to for the current step.
 *  Most steps point at a microscope sub-part; "place-slide" points at
 *  the slide tray instead.
 *
 *  We use the part's bounding-box centre instead of getWorldPosition()
 *  because several named groups (Coarse/Fine knobs, etc.) keep their
 *  group origin at the microscope's base while their visible meshes
 *  live at offsets — getWorldPosition() would point the leader line
 *  to the wrong spot. */
function getStepAnchorWorld(step) {
	if (!_state) return null;
	if (!step) return null;

	if (step.id === 'place-slide') {
		// Slide tray sits at world (0.55, 0.98, 0.05). Anchor 4 cm above
		// the surface so the dot reads as "the slides on the tray".
		return new THREE.Vector3(0.55, 1.02, 0.05);
	}

	const partName = step.highlightParts && step.highlightParts[0];
	if (!partName) return null;
	const part = _state.microscope.getObjectByName(partName);
	if (!part) return null;
	_anchorBox.setFromObject(part);
	_anchorBox.getCenter(_anchorTmp);
	return _anchorTmp.clone();
}

/** Compute where the floating callout panel should sit. We push it
 *  out to the side AWAY from the user's centreline (microscope is at
 *  x≈0.2; tray at x≈0.55) so the leader line stays clear, and pin Y
 *  to a constant gaze height so the panel is always readable. */
function getCalloutPanelWorld(anchorWorld) {
	const onRightSideOfBench = anchorWorld.x > 0.4;
	const offsetX = onRightSideOfBench ? -CALLOUT_OFFSET_X : +CALLOUT_OFFSET_X;
	return new THREE.Vector3(
		anchorWorld.x + offsetX,
		CALLOUT_PANEL_Y,
		anchorWorld.z,
	);
}

function rebuildCallout() {
	if (!_state) return;
	disposeCallout();
	if (_state.freeMode) return; // no instruction callouts in free mode
	const step = STEPS[_state.stepIndex];
	if (!step || step.id === 'done') return;

	const anchorWorld = getStepAnchorWorld(step);
	if (!anchorWorld) return;

	// ── Panel ────────────────────────────────────────────────────
	const panel = new Panel({
		width: CALLOUT_PANEL_W,
		height: CALLOUT_PANEL_H,
		canvasW: CALLOUT_CANVAS_W,
		canvasH: CALLOUT_CANVAS_H,
		pixelScale: 2,
	});
	panel.mesh.position.copy(getCalloutPanelWorld(anchorWorld));
	panel.mesh.renderOrder = 12;
	_state.scene.add(panel.mesh);

	renderCalloutBody(panel, step);

	// ── Anchor dot — small cyan sphere where the leader line meets
	//    the highlighted part. Gives the leader line a clear "this
	//    spot" terminator instead of disappearing into the model.
	const dotGeom = new THREE.SphereGeometry(0.008, 12, 8);
	const dotMat = new THREE.MeshBasicMaterial({
		color: 0x00e5c7,
		transparent: true,
		opacity: 0.95,
		depthTest: false,
		toneMapped: false,
	});
	const anchorDot = new THREE.Mesh(dotGeom, dotMat);
	anchorDot.renderOrder = 12;
	anchorDot.position.copy(anchorWorld);
	_state.scene.add(anchorDot);

	// ── Leader line ──────────────────────────────────────────────
	// Drawn from the anchor dot to the closest edge of the panel, so
	// the line "pulls" the user's eye from the part to the text.
	const lineGeom = new THREE.BufferGeometry().setFromPoints([
		anchorWorld.clone(),
		panel.mesh.position.clone(),
	]);
	const lineMat = new THREE.LineBasicMaterial({
		color: 0x00e5c7,
		transparent: true,
		opacity: 0.85,
		depthTest: false,
	});
	const line = new THREE.Line(lineGeom, lineMat);
	line.renderOrder = 11;
	line.frustumCulled = false;
	_state.scene.add(line);

	_state.callout = { panel, line, anchorDot, anchorWorld };
}

function renderCalloutBody(panel, step) {
	const ctx = panel.ctx;
	panel.clear();
	panel.drawBackground('rgba(15, 22, 34, 0.96)', '#00e5c7');

	// Step number pill (top-left corner)
	ctx.fillStyle = '#00e5c7';
	roundRect(ctx, 14, 14, 130, 36, 8);
	ctx.fill();
	ctx.fillStyle = '#0a1a28';
	ctx.font = 'bold 18px sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(step.title, 79, 32);

	// Instruction — the big primary line
	ctx.font = 'bold 30px sans-serif';
	ctx.fillStyle = '#fafafa';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'top';
	const instructionLines = wrapText(ctx, step.instruction, CALLOUT_CANVAS_W - 60, 'bold 30px sans-serif');
	let y = 80;
	for (const line of instructionLines) {
		ctx.fillText(line, CALLOUT_CANVAS_W / 2, y);
		y += 38;
	}

	// Divider line between instruction and step-by-step help
	y += 8;
	ctx.strokeStyle = 'rgba(0, 229, 199, 0.4)';
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(60, y);
	ctx.lineTo(CALLOUT_CANVAS_W - 60, y);
	ctx.stroke();
	y += 16;

	// Help text — preserve manual line breaks ('\n') from the step
	// definition (we use these to mark the 1)/2)/3) sequence) and only
	// wrap individual lines that overflow. Left-aligned so the numbered
	// steps line up cleanly at the kid's reading edge.
	ctx.font = '18px sans-serif';
	ctx.fillStyle = '#cfdbe5';
	ctx.textAlign = 'left';
	ctx.textBaseline = 'top';
	const helpParagraphs = String(step.help || '').split('\n');
	for (const para of helpParagraphs) {
		const wrapped = wrapText(ctx, para, CALLOUT_CANVAS_W - 80, '18px sans-serif');
		for (const line of wrapped) {
			if (y > CALLOUT_CANVAS_H - 28) break;
			ctx.fillText(line, 40, y);
			y += 24;
		}
	}

	panel.update();
}

const _camTmpForCallout = new THREE.Vector3();

function updateCallout() {
	if (!_state || !_state.callout) return;
	const { panel, line, anchorDot, anchorWorld } = _state.callout;

	// Face the panel horizontally toward the camera so the text stays
	// readable as the user walks/turns.
	_state.camera.getWorldPosition(_camTmpForCallout);
	const target = _camTmpForCallout.clone();
	target.y = panel.mesh.position.y;
	panel.mesh.lookAt(target);

	// Refresh the leader-line endpoints in case the anchor part has
	// animated (e.g. nosepiece rotating to a new objective). Cheap —
	// 6 floats per frame.
	const positions = line.geometry.attributes.position;
	// Re-read the part's world position if applicable.
	const step = STEPS[_state.stepIndex];
	const live = getStepAnchorWorld(step);
	if (live) {
		positions.setXYZ(0, live.x, live.y, live.z);
		anchorDot.position.copy(live);
		anchorWorld.copy(live);
	}
	const p = panel.mesh.position;
	positions.setXYZ(1, p.x, p.y, p.z);
	positions.needsUpdate = true;
}

function disposeCallout() {
	if (!_state || !_state.callout) return;
	const { panel, line, anchorDot } = _state.callout;
	_state.scene.remove(panel.mesh);
	_state.scene.remove(line);
	_state.scene.remove(anchorDot);
	panel.dispose();
	line.geometry.dispose();
	line.material.dispose();
	anchorDot.geometry.dispose();
	anchorDot.material.dispose();
	_state.callout = null;
}

// =====================================================================
// FREE-MODE WARNING PANEL
// =====================================================================
// Floats above the microscope when the kid has either grabbed the
// slide off the stage OR released the clips. Reminds them that a
// secured slide is required before continuing the experiment.

const WARN_PANEL_W = 0.42;
const WARN_PANEL_H = 0.18;
const WARN_CANVAS_W = 768;
const WARN_CANVAS_H = 320;
const WARN_PANEL_POS = new THREE.Vector3(0.20, 1.70, 0.05);

function ensureWarnPanel() {
	if (_state.warnPanel) return _state.warnPanel;
	const panel = new Panel({
		width: WARN_PANEL_W,
		height: WARN_PANEL_H,
		canvasW: WARN_CANVAS_W,
		canvasH: WARN_CANVAS_H,
		pixelScale: 2,
	});
	panel.mesh.position.copy(WARN_PANEL_POS);
	panel.mesh.renderOrder = 12;
	panel.mesh.visible = false;
	// Y-only lookAt at construct so it stays oriented toward the user
	// even though it's not parented to the camera.
	const lookAt = new THREE.Vector3(0.20, WARN_PANEL_POS.y, 0.70);
	panel.mesh.lookAt(lookAt);
	_state.scene.add(panel.mesh);
	_state.warnPanel = panel;
	return panel;
}

function renderWarnPanel(reason) {
	const panel = ensureWarnPanel();
	const ctx = panel.ctx;
	panel.clear();
	panel.drawBackground('rgba(50, 18, 18, 0.94)', '#ff6464');

	// "⚠" icon + heading
	panel.drawText('⚠ АНХААРУУЛГА', WARN_CANVAS_W / 2, 50, {
		font: 'bold 32px sans-serif',
		color: '#ffd0d0',
	});

	const lines = reason === 'no-slide'
		? [
			'Тавцан хоосон!',
			'Slide-ыг авч тавцан дээр тавиад',
			'хавчуурыг буцааж даран түгжээрэй.',
		]
		: [
			'Хавчуур задарсан байна!',
			'Хавчуур дээр гар-аа очиж GRIP',
			'товчоор дарж slide-ыг түгжээрэй.',
		];

	ctx.font = '24px sans-serif';
	ctx.fillStyle = '#fff5f5';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'top';
	let y = 110;
	for (const line of lines) {
		ctx.fillText(line, WARN_CANVAS_W / 2, y);
		y += 36;
	}

	panel.update();
	panel.mesh.visible = true;
}

function hideWarnPanel() {
	if (_state && _state.warnPanel) _state.warnPanel.mesh.visible = false;
}

function updateFreeModeWarning() {
	if (!_state) return;
	const slideOnStage = !!_state.slides.getStageSlideId();
	const clipsSecured = _state.slides.areClipsSecured();

	let reason = null;
	if (!slideOnStage) reason = 'no-slide';
	else if (!clipsSecured) reason = 'no-clips';

	if (reason) {
		if (_state.warnLastShown !== reason) {
			renderWarnPanel(reason);
			_state.warnLastShown = reason;
		} else {
			ensureWarnPanel().mesh.visible = true;
		}
	} else if (_state.warnLastShown !== null) {
		hideWarnPanel();
		_state.warnLastShown = null;
	}
}

function disposeWarnPanel() {
	if (_state && _state.warnPanel) {
		_state.warnPanel.dispose();
		_state.warnPanel = null;
		_state.warnLastShown = null;
	}
}

// =====================================================================
// SIDE PANEL — step-focused
// =====================================================================

function renderSidePanel() {
	if (!_state) return;
	const panel = _state.sidePanel;
	const ctx = panel.ctx;
	const optState = _state.optics.getState();
	const slideId = _state.slides.getStageSlideId();
	const step = STEPS[_state.stepIndex];

	panel.clear();
	panel.drawBackground('rgba(20, 28, 40, 0.94)', '#5fa5d6');

	// ── Header ──────────────────────────────────────────────────
	panel.drawText('СУДЛАХ', SIDE_CANVAS_W / 2, 42, {
		font: 'bold 32px Georgia',
		color: '#fafafa',
	});
	// Step indicator line — keeps the user oriented in the workflow,
	// the FULL instruction lives in the floating callout near the part.
	panel.drawText(step.title, SIDE_CANVAS_W / 2, 80, {
		font: 'bold 18px sans-serif',
		color: '#00e5c7',
	});

	// ── Live optics readout ─────────────────────────────────────
	let y = 130;
	drawStatRow(ctx, 'Гэрэл',     optState.powerOn ? 'АСААЛТТАЙ' : 'УНТРААЛТТАЙ', y, optState.powerOn ? '#22c55e' : '#a02828'); y += 30;
	drawStatRow(ctx, 'Диафрагм',  `${Math.round(optState.diaphragm * 100)}%`, y); y += 30;
	drawStatRow(ctx, 'Объектив',  `${optState.objectivePower}×`, y); y += 30;
	drawStatRow(ctx, 'Өсгөлт',    `${optState.magnification}×`, y); y += 30;
	drawStatRow(ctx, 'Бэлдмэл',   slideLabelFor(slideId), y, slideId ? '#ffd248' : '#7a8a98'); y += 30;
	drawStatRow(ctx, 'Фокус',     focusReadout(optState.focusError), y, focusColor(optState.focusError)); y += 30;

	if (!optState.coarseAllowed) {
		ctx.fillStyle = '#ffae42';
		ctx.font = 'italic 15px sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText('⚠ ТОМ фокус: 40×/100×-д блок', SIDE_CANVAS_W / 2, y + 8);
		y += 22;
	}
	if (!optState.fineAllowed) {
		ctx.fillStyle = '#ffae42';
		ctx.font = 'italic 15px sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText('⚠ НАРИЙН фокус: 4×/10×-д блок', SIDE_CANVAS_W / 2, y + 8);
		y += 22;
	}

	// ── Buttons (compact, mainly desktop fallback) ─────────────
	const halfW = (SIDE_CANVAS_W - 48 - 12) / 2;
	const btnH = 44;
	const fullW = SIDE_CANVAS_W - 48;
	let bY = SIDE_CANVAS_H - 360;

	if (step.id === 'done' || _state.stepIndex === STEPS.length - 1) {
		panel.drawButton({
			id: 'finish', label: 'Дуусгах ✓',
			x: 24, y: bY, w: fullW, h: 60,
			onClick: () => showSummary(),
		});
		bY += 76;
	} else {
		panel.drawButton({
			id: 'skip-step', label: 'Энэ алхмыг алгасах ▶',
			x: 24, y: bY, w: fullW, h: 50,
			onClick: () => advanceStep(),
		});
		bY += 64;
	}

	// Reach-fallback control buttons — useful on desktop, also a backup
	// for VR users still learning the grip-on-part interaction.
	panel.drawButton({
		id: 'cycle-obj', label: `Объектив ▶ ${nextObjPower(optState.objectivePower)}×`,
		x: 24, y: bY, w: fullW, h: btnH,
		onClick: () => { _state.optics.cycleObjective(+1); renderSidePanel(); },
	});
	bY += btnH + 8;

	panel.drawButton({
		id: 'coarse-down', label: 'Том ▼',
		x: 24, y: bY, w: halfW, h: btnH,
		onClick: () => { _state.optics.adjustCoarse(-1); renderSidePanel(); },
	});
	panel.drawButton({
		id: 'coarse-up', label: 'Том ▲',
		x: 24 + halfW + 12, y: bY, w: halfW, h: btnH,
		onClick: () => { _state.optics.adjustCoarse(+1); renderSidePanel(); },
	});
	bY += btnH + 8;

	panel.drawButton({
		id: 'fine-down', label: 'Нарийн ▼',
		x: 24, y: bY, w: halfW, h: btnH,
		onClick: () => { _state.optics.adjustFine(-1); renderSidePanel(); },
	});
	panel.drawButton({
		id: 'fine-up', label: 'Нарийн ▲',
		x: 24 + halfW + 12, y: bY, w: halfW, h: btnH,
		onClick: () => { _state.optics.adjustFine(+1); renderSidePanel(); },
	});
	bY += btnH + 8;

	panel.drawButton({
		id: 'dia-down', label: 'Диафрагм ▼',
		x: 24, y: bY, w: halfW, h: btnH,
		onClick: () => { _state.optics.adjustDiaphragm(-1); renderSidePanel(); },
	});
	panel.drawButton({
		id: 'dia-up', label: 'Диафрагм ▲',
		x: 24 + halfW + 12, y: bY, w: halfW, h: btnH,
		onClick: () => { _state.optics.adjustDiaphragm(+1); renderSidePanel(); },
	});
	bY += btnH + 8;

	panel.drawButton({
		id: 'power', label: optState.powerOn ? 'Гэрэл унтраах' : 'Гэрэл асаах',
		x: 24, y: bY, w: halfW, h: btnH,
		onClick: () => { _state.optics.togglePower(); renderSidePanel(); },
	});
	panel.drawButton({
		id: 'next-slide', label: 'Слайд солих ▶',
		x: 24 + halfW + 12, y: bY, w: halfW, h: btnH,
		onClick: () => {
			const next = nextSlideId(slideId);
			if (next) _state.slides.selectSlide(next);
			renderSidePanel();
		},
	});
	bY += btnH + 12;

	// Exit
	panel.drawButton({
		id: 'exit', label: '✕ Гарах',
		x: 24, y: bY, w: fullW, h: btnH,
		onClick: () => exitExplore(),
	});

	panel.update();
}

function drawStatRow(ctx, label, value, y, valueColor = '#fafafa') {
	ctx.font = '17px sans-serif';
	ctx.fillStyle = '#9fb6c8';
	ctx.textAlign = 'left';
	ctx.textBaseline = 'middle';
	ctx.fillText(label, 40, y);

	ctx.font = 'bold 18px sans-serif';
	ctx.fillStyle = valueColor;
	ctx.textAlign = 'right';
	ctx.fillText(value, SIDE_CANVAS_W - 40, y);
}

function focusReadout(err) {
	if (err < 0.10) return 'ТОДОРХОЙ ✓';
	if (err < 0.30) return 'Бараг тод';
	if (err < 0.60) return 'Бүрэлзсэн';
	return 'Маш бүрэлзсэн';
}

function focusColor(err) {
	if (err < 0.10) return '#22c55e';
	if (err < 0.30) return '#a8e063';
	if (err < 0.60) return '#ffd248';
	return '#a02828';
}

function slideLabelFor(slideId) {
	if (!slideId) return '— тавцан хоосон —';
	const def = SLIDES.find((s) => s.id === slideId);
	return `${slideId}. ${def ? def.mn : ''}`;
}

function nextObjPower(current) {
	const order = [4, 10, 40, 100];
	const i = order.indexOf(current);
	return order[(i + 1) % order.length];
}

function nextSlideId(current) {
	const order = SLIDES.map((s) => s.id);
	const i = current ? order.indexOf(current) : -1;
	return order[(i + 1) % order.length];
}

// =====================================================================
// SUMMARY PANEL
// =====================================================================

function showSummary() {
	if (!_state || _state.showingSummary) return;
	_state.showingSummary = true;
	clearHighlight(_state.microscope);

	const panel = new Panel({
		width: SUMMARY_PANEL_W,
		height: SUMMARY_PANEL_H,
		canvasW: SUMMARY_CANVAS_W,
		canvasH: SUMMARY_CANVAS_H,
		pixelScale: 2,
	});
	panel.mesh.position.set(0.2, 1.55, -0.6);
	panel.mesh.renderOrder = 14;
	_state.scene.add(panel.mesh);

	const handle = {
		panel,
		setHover: (id) => panel.setHover(id),
		dispose: () => panel.dispose(),
	};
	if (_state.interactions) _state.interactions.registerPanel(handle);
	panel.onHoverChange = () => renderSummary(panel);

	_state.summaryPanel = panel;
	_state.summaryHandle = handle;

	renderSummary(panel);
	faceCamera(panel.mesh, _state.camera);
}

function renderSummary(panel) {
	const ctx = panel.ctx;
	panel.clear();
	panel.drawBackground('rgba(15, 22, 34, 0.97)', '#5fa5d6');

	panel.drawText('🎉 Сурсан зүйл', SUMMARY_CANVAS_W / 2, 60, {
		font: 'bold 44px Georgia',
		color: '#fafafa',
	});
	panel.drawText('Микроскоп ажиллуулах үндсэн дүрэм', SUMMARY_CANVAS_W / 2, 110, {
		font: '22px sans-serif',
		color: '#9fb6c8',
	});

	ctx.font = '24px sans-serif';
	ctx.fillStyle = '#dde6ef';
	ctx.textAlign = 'left';
	ctx.textBaseline = 'top';
	let y = 175;
	for (let i = 0; i < SUMMARY_LINES.length; i++) {
		ctx.fillStyle = '#5fa5d6';
		ctx.beginPath();
		ctx.arc(75, y + 18, 22, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = '#0a1a28';
		ctx.font = 'bold 22px sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(String(i + 1), 75, y + 18);

		ctx.fillStyle = '#dde6ef';
		ctx.font = '24px sans-serif';
		ctx.textAlign = 'left';
		ctx.textBaseline = 'top';
		const wrapped = wrapText(ctx, SUMMARY_LINES[i], SUMMARY_CANVAS_W - 180, '24px sans-serif');
		let ly = y;
		for (const line of wrapped) {
			ctx.fillText(line, 115, ly);
			ly += 32;
		}
		y = ly + 18;
	}

	panel.drawButton({
		id: 'continue', label: 'Үргэлжлүүлэн судлах',
		x: SUMMARY_CANVAS_W / 2 - 360,
		y: SUMMARY_CANVAS_H - 110,
		w: 340, h: 70,
		onClick: () => closeSummary(),
	});
	panel.drawButton({
		id: 'exit', label: '✕ Цэс рүү буцах',
		x: SUMMARY_CANVAS_W / 2 + 20,
		y: SUMMARY_CANVAS_H - 110,
		w: 340, h: 70,
		onClick: () => exitExplore(),
	});

	panel.update();
}

function closeSummary() {
	if (!_state || !_state.summaryPanel) return;
	if (_state.interactions && _state.summaryHandle) {
		_state.interactions.unregisterPanel(_state.summaryHandle);
	}
	_state.summaryPanel.dispose();
	_state.summaryPanel = null;
	_state.summaryHandle = null;
	_state.showingSummary = false;
	applyStepHighlight();
	rebuildCallout();
}

function exitExplore() {
	const onExit = _state && _state.onExit;
	stopExplore();
	if (onExit) onExit();
}

// =====================================================================
// HELPERS
// =====================================================================

const _camTmp = new THREE.Vector3();

function faceCamera(panelMesh, camera) {
	camera.getWorldPosition(_camTmp);
	const target = _camTmp.clone();
	target.y = panelMesh.position.y;
	panelMesh.lookAt(target);
}

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

function roundRect(ctx, x, y, w, h, r) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.lineTo(x + w - r, y);
	ctx.quadraticCurveTo(x + w, y, x + w, y + r);
	ctx.lineTo(x + w, y + h - r);
	ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
	ctx.lineTo(x + r, y + h);
	ctx.quadraticCurveTo(x, y + h, x, y + h - r);
	ctx.lineTo(x, y + r);
	ctx.quadraticCurveTo(x, y, x + r, y);
	ctx.closePath();
}
