/**
 * @file Guide mode — narrated 6-chapter walkthrough of the microscope.
 *
 * Public API:
 *   startGuide({ scene, camera, renderer, microscope, interactions, onExit })
 *   stopGuide()
 *   updateGuide(time)   // call from animation loop for highlight pulse
 *
 * Chapter sequence:
 *   1 intro          Микроскоп гэж юу вэ?
 *   2 care           Микроскопыг хэрхэн зөв барих вэ
 *   3 parts          Үндсэн хэсгүүд
 *   4 magnification  Томруулалт
 *   5 focusing       Фокус тохируулах
 *   6 cleanup        Ажил дууссаны дараа
 *
 * On chapter advance:
 *   - relevant Microscope_* parts pulse cyan (highlight.js)
 *   - desktop camera tweens to chapter.cameraPosition over 1.2 s
 *   - in VR, the panel re-anchors to the user's current gaze
 *   - a 0.2 s procedural "page-turn" noise plays (Web Audio)
 *
 * Last chapter's "Дараах" turns into "Дуусгах ✓" and triggers onExit.
 */
import * as THREE from 'three';

import {
	clearHighlight,
	highlightPart,
	updateHighlights,
} from '../microscope/highlight.js';
import { Panel } from '../ui/panel.js';

// =====================================================================
// CHAPTER CONTENT
// =====================================================================

const CHAPTERS = [
	{
		id: 'intro',
		title: 'Микроскоп гэж юу вэ?',
		body:
			'Микроскоп бол маш жижиг зүйлсийг томруулж харах багаж юм. Бид нүдээрээ хүний эс, ургамлын эд, бактерийг харж чадахгүй — тэдгээр нь хүний нүдний нарийвчлалаас 100–1000 дахин жижиг. Микроскоп хэд хэдэн линз ашиглан гэрлийг бөөгнүүлж, жижиг объектыг асар их томруулдаг.\n\n' +
			'Биологийн микроскопод "compound" буюу нэгдмэл гэх хэлбэрийг хамгийн их ашигладаг. Энэ нь хоёр оптик системтэй: objective lens (доод линз) болон eyepiece (нүдний линз). Тэдгээрийн томруулалт үржигдэж эцсийн томруулалтыг өгдөг — жишээ нь 10× × 40× = 400×.\n\n' +
			'Энэхүү хичээлд бид микроскопын бүтэц, ажиллагаа, зөв ашиглах аргыг сурна.',
		highlightParts: ['Microscope'],
		cameraPosition: [0.0, 1.55, 0.85],
	},
	{
		id: 'care',
		title: 'Микроскопыг хэрхэн зөв барих вэ',
		body:
			'Микроскоп бол үнэ цэнэтэй, эмзэг багаж — буруу барих, унагах нь линз болон оптик системийг гэмтээдэг. Тиймээс хэзээ ч нэг гараар бүү бари. Зүүн гараараа суурийг (Base) доороос нь, баруун гараараа гарыг (Arm) дээрээс нь барина. Энэ хоёр гарын дэмжлэгээр л микроскоп баттай шилжинэ.\n\n' +
			'Микроскопыг тэгш, хатуу гадаргуу дээр тавь. Утсыг чимхэх, чалгах боломжгүй газарт. Линзийг хуруугаараа бүү хүр — арьсны өөх линзний оптик гадаргуу дээр бараан толбо үүсгэдэг. Зөвхөн тусгай линз цэвэрлэгч даавуугаар арчина.\n\n' +
			'Ашиглаагүй үед микроскопыг тоосноос хамгаалсан бүтээлгээр хучна.',
		highlightParts: ['Microscope_Arm', 'Microscope_Base'],
		cameraPosition: [0.7, 1.30, 0.55],
	},
	{
		id: 'parts',
		title: 'Үндсэн хэсгүүд',
		body:
			'Микроскоп нь хэд хэдэн чухал хэсгүүдээс бүрдэнэ. Суурь (Base) бүх жинг үүрнэ. Гар (Arm) дээш сунаж нүдний хэсэгт хүрнэ. Дээр нь Eyepiece tube байрлана — ихэвчлэн 10× томруулалттай линзтэй.\n\n' +
			'Дунд хэсэгт ширээ (Stage) — энэ нь slide-ийг тавих платформ. Ширээний доор diaphragm болон гэрлийн эх үүсвэр байрлана. Ширээн дээр Nosepiece (хамар) гэж эргэлддэг хэсэг бий — тэр нь 4 өөр томруулалттай objective линз агуулдаг (4×, 10×, 40×, 100×).\n\n' +
			'Гарны хажуугаар фокусын хоёр knob — coarse (бүдүүн) ба fine (нарийн) — slide-ийг ширээний өндөрт зөв байрлуулна.',
		highlightParts: [
			'Microscope_Base',
			'Microscope_Arm',
			'Microscope_Stage',
			'Microscope_Nosepiece',
			'Microscope_EyepieceTube',
			'Microscope_Eyepiece',
			'Microscope_CoarseKnob',
			'Microscope_FineKnob',
		],
		cameraPosition: [-0.30, 1.55, 0.65],
	},
	{
		id: 'magnification',
		title: 'Томруулалт',
		body:
			'Микроскопын эцсийн томруулалт нь eyepiece болон objective линзний томруулалтын үржвэр юм. Жишээ нь 10× eyepiece × 40× objective = 400× томруулалт.\n\n' +
			'Стандарт сургуулийн микроскоп дөрвөн objective бүхий: 4× (улаан тууз — өргөн талбай харах), 10× (шар тууз — урьдчилсан үзлэг), 40× (цэнхэр тууз — эс судлал), 100× (цагаан тууз — иммерсион тосоор бактери). Өнгөт туузнууд нь олон улсын стандарт.\n\n' +
			'Ажил эхлэхдээ үргэлж 4× объективаар эхэл — slide-ийг олох, фокус барихад хамгийн хялбар. Дараа нь Nosepiece-ийг эргүүлж томруулалтыг нэмнэ.',
		highlightParts: [
			'Microscope_Objective_4x',
			'Microscope_Objective_10x',
			'Microscope_Objective_40x',
			'Microscope_Objective_100x',
			'Microscope_Eyepiece',
		],
		cameraPosition: [0.20, 1.40, 0.45],
	},
	{
		id: 'focusing',
		title: 'Фокус тохируулах',
		body:
			'Фокус тохируулах нь микроскоп ашиглах гол ур чадвар. Хоёр knob ашиглана: coarse (бүдүүн) ба fine (нарийн).\n\n' +
			'Coarse knob нь том хөдөлгөөн өгдөг — ширээг хурдан дээш доош хөдөлгөнө. Үүнийг зөвхөн 4× буюу 10× объективтай ашиглана. Fine knob нь маш жижиг хөдөлгөөн өгдөг — нарийн фокус барихад хэрэгтэй, ялангуяа 40× ба 100× томруулалттай ажиллахдаа.\n\n' +
			'Дараах дарааллаар тохируулна: эхлээд 4×-аар coarse-ыг slide харагдтал эргүүлнэ. Дараа нь fine-аар нарийвчилнa. Объективийг 40× руу шилжүүлэхдээ зөвхөн fine knob ашигла — coarse-ыг ашиглавал слайдыг гэмтээж болно.',
		highlightParts: ['Microscope_CoarseKnob', 'Microscope_FineKnob'],
		cameraPosition: [0.55, 1.20, 0.50],
	},
	{
		id: 'cleanup',
		title: 'Ажил дууссаны дараа',
		body:
			'Туршилт дууссаны дараа микроскопыг зөв цэвэрлэх нь шинжлэх ухааны хариуцлагын нэг хэсэг.\n\n' +
			'Эхлээд Nosepiece-ийг 4× объектив руу буцаа — энэ нь дараагийн ашиглагч зөв байрлалаас эхлэхэд тусладаг. Дараа нь slide-ийг spring clip-ээс гарга, цэвэрлэ. Stage дээр дусал, тоос байвал зөөлөн даавуугаар арчи.\n\n' +
			'Дараа нь гэрлийн эх үүсвэрийг On/Off switch-ээр унтраа. Линз дээр хуруу хүрсэн бол линзний цэвэрлэгч tissue ашигла. Микроскопыг тэгш гадаргуу дээр, бүтээлгээр хучсан, тоосноос хамгаалсан газарт хадгална. Эцэст нь гараа угаа.',
		highlightParts: ['Microscope_OnOffSwitch', 'Microscope_Objective_4x'],
		cameraPosition: [0.20, 1.50, 0.70],
	},
];

const TWEEN_MS = 1200;
const PANEL_WORLD_W = 1.45;
const PANEL_WORLD_H = 0.85;
const CANVAS_W = 1280;
const CANVAS_H = 768;
const PANEL_PIXEL_SCALE = 2;

// =====================================================================
// MODULE STATE
// =====================================================================

let _state = null;

// =====================================================================
// PANEL POSITIONING
// =====================================================================

/**
 * Anchor the panel ACROSS the bench from the user at world (0.2, 1.55,
 * −1.0). The panel rotates around Y only — its lookAt target is the
 * camera position projected onto the panel's horizontal plane — so the
 * panel face stays vertical regardless of head height.
 */
function placePanelAcrossBench(panel, scene, camera) {
	const camPos = new THREE.Vector3();
	camera.getWorldPosition(camPos);
	panel.mesh.position.set(0.2, 1.55, -0.6);
	const lookTarget = camPos.clone();
	lookTarget.y = panel.mesh.position.y;
	panel.mesh.lookAt(lookTarget);
	if (!panel.mesh.parent) scene.add(panel.mesh);
}

// =====================================================================
// CAMERA TWEEN (DESKTOP ONLY)
// =====================================================================

let _tweenId = 0;

function easeInOutCubic(t) {
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Animate camera.position from its current value to worldPos over
 *  duration ms with cubic ease. Cancels any in-flight tween. The
 *  player Group's position is subtracted so we end up writing
 *  player-local coordinates into camera.position (which init.js
 *  expects). */
function tweenCameraToWorld(camera, worldPos, duration) {
	const id = ++_tweenId;
	const startLocal = camera.position.clone();

	const player = camera.parent;
	const playerWorld = new THREE.Vector3();
	if (player) player.getWorldPosition(playerWorld);
	const targetLocal = new THREE.Vector3(
		worldPos[0] - playerWorld.x,
		worldPos[1] - playerWorld.y,
		worldPos[2] - playerWorld.z,
	);

	const start = performance.now();
	function step() {
		if (id !== _tweenId) return; // a new tween cancelled this one
		const elapsed = performance.now() - start;
		const t = Math.min(1, elapsed / duration);
		const eased = easeInOutCubic(t);
		camera.position.lerpVectors(startLocal, targetLocal, eased);
		if (t < 1) requestAnimationFrame(step);
	}
	requestAnimationFrame(step);
}

// =====================================================================
// AUDIO CUE — procedural "page turn" noise
// =====================================================================

function playPageTurn() {
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

	const dur = 0.20;
	const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
	const data = buffer.getChannelData(0);
	for (let i = 0; i < data.length; i++) {
		const t = i / data.length;
		// Quick attack, slow decay. Sounds like a page being turned.
		const env = Math.sin(t * Math.PI) * (1 - t * 0.4);
		data[i] = (Math.random() * 2 - 1) * env;
	}

	const src = ctx.createBufferSource();
	src.buffer = buffer;
	const filter = ctx.createBiquadFilter();
	filter.type = 'bandpass';
	filter.frequency.value = 3500;
	filter.Q.value = 0.6;
	const gain = ctx.createGain();
	gain.gain.value = 0.18;
	src.connect(filter).connect(gain).connect(ctx.destination);
	src.start();
}

// =====================================================================
// PANEL RENDERING
// =====================================================================

/** Wrap text into lines that fit `maxWidth` pixels, one paragraph at a
 *  time (paragraphs separated by '\n\n'). */
function drawWrappedBody(ctx, text, x, y, maxWidth, lineHeight) {
	ctx.font = '22px sans-serif';
	ctx.fillStyle = '#dde6ef';
	ctx.textAlign = 'left';
	ctx.textBaseline = 'top';
	const paragraphs = text.split('\n\n');
	let cursor = y;
	for (const para of paragraphs) {
		const words = para.replace(/\n/g, ' ').split(/\s+/);
		let line = '';
		for (const word of words) {
			const test = line ? line + ' ' + word : word;
			if (ctx.measureText(test).width > maxWidth && line) {
				ctx.fillText(line, x, cursor);
				cursor += lineHeight;
				line = word;
			} else {
				line = test;
			}
		}
		if (line) {
			ctx.fillText(line, x, cursor);
			cursor += lineHeight;
		}
		cursor += lineHeight * 0.45; // paragraph spacing
	}
}

/** Six small circles at the top of the panel; the active chapter's
 *  circle is filled, the others are hollow. */
function drawProgressDots(ctx, currentIdx, total) {
	const cx = CANVAS_W / 2;
	const y = 38;
	const gap = 22;
	const totalWidth = (total - 1) * gap;
	const startX = cx - totalWidth / 2;
	for (let i = 0; i < total; i++) {
		ctx.beginPath();
		ctx.arc(startX + i * gap, y, 7, 0, Math.PI * 2);
		if (i === currentIdx) {
			ctx.fillStyle = '#5fa5d6';
			ctx.fill();
		} else if (i < currentIdx) {
			ctx.fillStyle = '#3a5d7a';
			ctx.fill();
		} else {
			ctx.strokeStyle = '#3a5d7a';
			ctx.lineWidth = 2;
			ctx.stroke();
		}
	}
}

/** Disabled-button render (no hit-test entry). */
function drawDisabledButton(ctx, x, y, w, h, label) {
	const r = 10;
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
	ctx.fillStyle = 'rgba(40, 50, 64, 0.6)';
	ctx.fill();
	ctx.strokeStyle = 'rgba(80, 100, 120, 0.5)';
	ctx.lineWidth = 1.5;
	ctx.stroke();
	ctx.fillStyle = 'rgba(140, 155, 170, 0.5)';
	ctx.font = '24px sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(label, x + w / 2, y + h / 2);
}

// =====================================================================
// CHAPTER NAVIGATION
// =====================================================================

function showChapter(i) {
	_state.chapter = i;
	const ch = CHAPTERS[i];

	// 1. Highlights — clear all then add the chapter's parts
	clearHighlight(_state.microscope);
	for (const partName of ch.highlightParts) {
		highlightPart(_state.microscope, partName);
	}

	// 2. Camera or panel re-anchor
	if (_state.renderer.xr.isPresenting) {
		// VR: re-aim the panel at the user's current camera position so
		// it stays square-on when the user has stepped to the side.
		placePanelAcrossBench(_state.panel, _state.scene, _state.camera);
	} else if (ch.cameraPosition) {
		tweenCameraToWorld(_state.camera, ch.cameraPosition, TWEEN_MS);
	}

	// 3. Audio cue
	playPageTurn();

	// 4. Re-render the panel
	render();
}

function next() {
	if (!_state) return;
	if (_state.chapter === CHAPTERS.length - 1) {
		exitGuide();
	} else {
		showChapter(_state.chapter + 1);
	}
}

function prev() {
	if (!_state) return;
	if (_state.chapter > 0) showChapter(_state.chapter - 1);
}

function exitGuide() {
	const onExit = _state && _state.onExit;
	stopGuide();
	if (onExit) onExit();
}

// =====================================================================
// PANEL RENDER
// =====================================================================

function render() {
	if (!_state) return;
	const panel = _state.panel;
	const ch = CHAPTERS[_state.chapter];
	const isFirst = _state.chapter === 0;
	const isLast = _state.chapter === CHAPTERS.length - 1;

	panel.clear();
	panel.drawBackground();

	// Progress dots above the title
	drawProgressDots(panel.ctx, _state.chapter, CHAPTERS.length);

	// Subtitle / chapter index line
	panel.drawText(
		`ЗААВАР  ·  Бүлэг ${_state.chapter + 1} / ${CHAPTERS.length}`,
		CANVAS_W / 2,
		90,
		{ font: '22px sans-serif', color: '#9fb6c8' },
	);

	// Big chapter title
	panel.drawText(ch.title, CANVAS_W / 2, 145, {
		font: 'bold 36px Georgia',
		color: '#fafafa',
	});

	// Body paragraphs (multi-line wrap)
	drawWrappedBody(panel.ctx, ch.body, 80, 200, CANVAS_W - 160, 32);

	// Bottom row buttons — each ≥ 8 cm × 4 cm in world space
	const btnY = 660;
	const btnW = 240;
	const btnH = 70;
	if (isFirst) {
		drawDisabledButton(panel.ctx, 80, btnY, btnW, btnH, '← Өмнөх');
	} else {
		panel.drawButton({
			id: 'prev',
			label: '← Өмнөх',
			x: 80,
			y: btnY,
			w: btnW,
			h: btnH,
			onClick: prev,
		});
	}

	panel.drawButton({
		id: 'next',
		label: isLast ? 'Дуусгах ✓' : 'Дараах →',
		x: (CANVAS_W - btnW) / 2,
		y: btnY,
		w: btnW,
		h: btnH,
		onClick: next,
	});

	panel.drawButton({
		id: 'exit',
		label: '✕ Цэс рүү',
		x: CANVAS_W - 80 - btnW,
		y: btnY,
		w: btnW,
		h: btnH,
		onClick: exitGuide,
	});

	panel.update();
}

// =====================================================================
// PUBLIC API
// =====================================================================

/**
 * Begin the 6-chapter guide. Replaces the main menu.
 *
 * @param {{
 *   scene: THREE.Scene,
 *   camera: THREE.Camera,
 *   renderer: THREE.WebGLRenderer,
 *   microscope: THREE.Object3D,
 *   interactions?: any,
 *   onExit: () => void,
 * }} options
 */
export function startGuide({
	scene,
	camera,
	renderer,
	microscope,
	interactions,
	onExit,
}) {
	if (_state) stopGuide();

	const panel = new Panel({
		width: PANEL_WORLD_W,
		height: PANEL_WORLD_H,
		canvasW: CANVAS_W,
		canvasH: CANVAS_H,
		pixelScale: PANEL_PIXEL_SCALE,
	});
	placePanelAcrossBench(panel, scene, camera);

	const handle = {
		panel,
		setHover: (id) => panel.setHover(id),
		dispose: () => panel.dispose(),
	};

	_state = {
		scene,
		camera,
		renderer,
		microscope,
		interactions,
		onExit,
		panel,
		handle,
		chapter: -1,
		audioCtx: null,
	};

	// Re-render whenever hover state flips
	panel.onHoverChange = render;

	if (interactions) interactions.registerPanel(handle);

	showChapter(0);
}

/** Tear down the panel + highlights. Safe to call multiple times. */
export function stopGuide() {
	if (!_state) return;
	clearHighlight(_state.microscope);
	if (_state.interactions) _state.interactions.unregisterPanel(_state.handle);
	_state.handle.dispose();
	_state = null;
}

/** Per-frame tick — drives the highlight pulse. Always safe to call. */
export function updateGuide(timeSeconds) {
	updateHighlights(timeSeconds);
}
