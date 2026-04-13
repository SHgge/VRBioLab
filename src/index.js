/**
 * VR BioLab - Зүрхний бүтэц (Heart Anatomy VR)
 *
 * Бодит 3D зүрхний загвар ашиглан сурагч улаан эсийн
 * дүрд зүрхний дотор аялж, бүтцийг интерактиваар судлана.
 */

import * as THREE from 'three';

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Text } from 'troika-three-text';
import { XR_BUTTONS } from 'gamepad-wrapper';
import { gsap } from 'gsap';
import { init } from './init.js';

// =====================================================================
// ТОГТМОЛУУД
// =====================================================================
const HEARTBEAT_PERIOD = 0.857; // ~70 bpm
const SYSTOLE_DURATION = 0.3;
const JOURNEY_SPEED = 0.04;
const BLOOD_CELL_COUNT = 80;
const DESIRED_HEIGHT = 1.2; // Зүрхний хүссэн өндөр (метр)

// =====================================================================
// ГЛОБАЛ ХУВЬСАГЧИД
// =====================================================================
const heartGroup = new THREE.Group();
let heartModel = null; // GLB загвар
let heartScale = 1; // GLB-д хэрэглэсэн масштаб
const bloodParticles = [];
const labelObjects = [];

let journeyPath = null;
let journeyProgress = 0;
let journeyActive = false;
let journeyAutoPlay = false;
let currentStationIndex = 0;
let heartbeatPhase = 0;
let playerCell = null;
const playerCellTrail = [];

// Текст UI
const stationTitle = new Text();
const stationInfo = new Text();
const instructionText = new Text();
const progressText = new Text();

// Аудио
let heartbeatSound = null;
let whooshSound = null;
let audioListener = null;

// =====================================================================
// СТАНЦУУД — Зүрхний аялалын зогсоолууд
// =====================================================================
const stations = [
	{
		name: 'Дээд хөндийн вен',
		nameEn: 'Superior Vena Cava',
		info: 'Биеийн дээд хэсгээс хүчилтөрөгчгүй\n(CO\u2082-тэй) цус зүрх рүү буцаж ирнэ.',
		t: 0.0,
		color: 0x4466aa,
	},
	{
		name: 'Баруун тосгуур',
		nameEn: 'Right Atrium',
		info: 'Хүчилтөрөгчгүй цус энд цуглана.\nТосгуур агшихад цус доош урсана.',
		t: 0.1,
		color: 0x5577bb,
	},
	{
		name: 'Трикуспидал хавхлага',
		nameEn: 'Tricuspid Valve',
		info: '3 хавтастай хавхлага. Цусыг баруун\nтосгуураас баруун ховдол руу нэвтрүүлнэ.\nБуцаж урсахаас сэргийлнэ.',
		t: 0.18,
		color: 0xffdd44,
	},
	{
		name: 'Баруун ховдол',
		nameEn: 'Right Ventricle',
		info: 'Баруун ховдол агшиж хүчилтөрөгчгүй\nцусыг уушигны артериар уушиг руу шахна.',
		t: 0.27,
		color: 0x4455aa,
	},
	{
		name: 'Уушигны хавхлага',
		nameEn: 'Pulmonary Valve',
		info: 'Уушигны хавхлага нээгдэж цусыг\nуушигны артери руу гаргана.\nХовдол сулрахад хаагдана.',
		t: 0.35,
		color: 0x44aaff,
	},
	{
		name: 'Уушиг (хий солилцол)',
		nameEn: 'Lungs (Gas Exchange)',
		info: 'Уушигт цус O\u2082-оор баяжиж,\nCO\u2082-г ялгаруулна.\nЦус хар улаанаас тод улаан болно!',
		t: 0.46,
		color: 0xff8899,
	},
	{
		name: 'Зүүн тосгуур',
		nameEn: 'Left Atrium',
		info: 'Хүчилтөрөгчөөр баяжсан цус\nуушигны венээр зүүн тосгуур руу ирнэ.',
		t: 0.56,
		color: 0xcc4444,
	},
	{
		name: 'Митрал хавхлага',
		nameEn: 'Mitral (Bicuspid) Valve',
		info: '2 хавтастай хавхлага. Цусыг зүүн\nтосгуураас зүүн ховдол руу дамжуулна.',
		t: 0.65,
		color: 0xff8844,
	},
	{
		name: 'Зүүн ховдол',
		nameEn: 'Left Ventricle',
		info: 'Зүрхний хамгийн хүчтэй хөндий!\nЗузаан булчинтай. Цусыг аортаар\nбүх биед түгээнэ.',
		t: 0.76,
		color: 0xdd3333,
	},
	{
		name: 'Аортын хавхлага',
		nameEn: 'Aortic Valve',
		info: 'Аортын хавхлага нээгдэж хүчилтөрөгчтэй\nцусыг аорт руу гаргана.',
		t: 0.86,
		color: 0xff4444,
	},
	{
		name: 'Аорт \u2192 Бүх бие',
		nameEn: 'Aorta \u2192 Body',
		info: 'Аортаар дамжин хүчилтөрөгчтэй цус\nбүх биеийн эд эсүүдэд хүрнэ.\n\nТrigger дарж дахин эхлүүлнэ үү!',
		t: 1.0,
		color: 0xff2222,
	},
];

// =====================================================================
// АНАТОМИЙН ШОШГОНУУД — зүрхний гадна талд байрлана
// =====================================================================
const anatomyLabels = [
	{
		text: 'Дээд хөндийн вен\nSuperior Vena Cava',
		pos: [0.35, 0.55, 0.15],
		color: 0x4488cc,
	},
	{
		text: 'Доод хөндийн вен\nInferior Vena Cava',
		pos: [0.3, -0.55, 0.15],
		color: 0x4488cc,
	},
	{
		text: 'Баруун тосгуур\nRight Atrium',
		pos: [0.5, 0.2, 0.3],
		color: 0x5577bb,
	},
	{
		text: 'Баруун ховдол\nRight Ventricle',
		pos: [0.45, -0.2, 0.3],
		color: 0x4466bb,
	},
	{
		text: 'Зүүн тосгуур\nLeft Atrium',
		pos: [-0.45, 0.25, 0.3],
		color: 0xcc5555,
	},
	{
		text: 'Зүүн ховдол\nLeft Ventricle',
		pos: [-0.4, -0.25, 0.3],
		color: 0xdd4444,
	},
	{
		text: 'Уушигны артери\nPulmonary Artery',
		pos: [0.15, 0.6, 0.25],
		color: 0x5599dd,
	},
	{
		text: 'Аорт\nAorta',
		pos: [-0.15, 0.65, 0.25],
		color: 0xdd4444,
	},
	{
		text: 'Трикуспидал\nхавхлага',
		pos: [0.35, 0.0, 0.35],
		color: 0xffdd44,
		fontSize: 0.03,
	},
	{
		text: 'Митрал\nхавхлага',
		pos: [-0.35, 0.0, 0.35],
		color: 0xff8844,
		fontSize: 0.03,
	},
	{
		text: 'Уушигны хавхлага',
		pos: [0.25, 0.5, 0.3],
		color: 0x66bbff,
		fontSize: 0.03,
	},
	{
		text: 'Аортын хавхлага',
		pos: [-0.2, 0.55, 0.3],
		color: 0xff5555,
		fontSize: 0.03,
	},
	{
		text: 'Миокард\nMyocardium\n(зүрхний булчин)',
		pos: [0.6, 0.0, 0.0],
		color: 0x996666,
		fontSize: 0.03,
	},
];

// =====================================================================
// GLB ЗАГВАР АЧААЛАХ
// =====================================================================

function loadHeartModel(scene) {
	return new Promise((resolve) => {
		const loader = new GLTFLoader();
		loader.load('assets/stylizedhumanheart.glb', (gltf) => {
			heartModel = gltf.scene;

			// Загварын хэмжээг тооцоолох
			const box = new THREE.Box3().setFromObject(heartModel);
			const size = new THREE.Vector3();
			box.getSize(size);
			const center = new THREE.Vector3();
			box.getCenter(center);

			// Хүссэн өндөрт масштаблах
			heartScale = DESIRED_HEIGHT / size.y;
			heartModel.scale.setScalar(heartScale);

			// Төвийг тэглэх
			heartModel.position.set(
				-center.x * heartScale,
				-center.y * heartScale,
				-center.z * heartScale,
			);

			// Материалын чанарыг сайжруулах
			heartModel.traverse((child) => {
				if (child.isMesh) {
					child.castShadow = true;
					child.receiveShadow = true;
					if (child.material) {
						child.material.envMapIntensity = 1.0;
					}
				}
			});

			heartGroup.add(heartModel);
			scene.add(heartGroup);

			// Зүрхийг нүдний өндөрт байрлуулах
			heartGroup.position.set(0, 1.4, -1.5);

			console.log(
				'Heart model loaded. Size:',
				size,
				'Scale:',
				heartScale,
			);

			// Загварын бүтцийг лог хийх (debug)
			heartModel.traverse((child) => {
				if (child.isMesh) {
					console.log('  Mesh:', child.name, child.geometry.type);
				}
			});

			resolve();
		});
	});
}

// =====================================================================
// АНАТОМИЙН ШОШГО БҮТЭЭХ
// =====================================================================

function createAnatomyLabels() {
	anatomyLabels.forEach((def) => {
		const label = new Text();
		label.text = def.text;
		label.fontSize = def.fontSize || 0.035;
		label.font = 'assets/SpaceMono-Bold.ttf';
		label.color = def.color;
		label.anchorX = 'center';
		label.anchorY = 'middle';
		label.textAlign = 'center';
		label.position.set(...def.pos);
		label.outlineWidth = 0.003;
		label.outlineColor = 0x000000;
		label.sync();
		heartGroup.add(label);
		labelObjects.push(label);

		// Шошгоноос зүрх рүү шугам татах
		const linePoints = [
			new THREE.Vector3(...def.pos),
			new THREE.Vector3(def.pos[0] * 0.5, def.pos[1] * 0.7, def.pos[2] * 0.3),
		];
		const lineGeom = new THREE.BufferGeometry().setFromPoints(linePoints);
		const lineMat = new THREE.LineBasicMaterial({
			color: def.color,
			transparent: true,
			opacity: 0.4,
		});
		heartGroup.add(new THREE.Line(lineGeom, lineMat));
	});
}

// =====================================================================
// ЦУСНЫ УРСГАЛЫН ЗАМ (Journey Path)
// =====================================================================

function createJourneyPath() {
	// Зүрхний дотоод цусны урсгалын зам
	// Координатууд heartGroup-ийн локал огторгуйд
	const points = [
		// Дээд хөндийн вен → Баруун тосгуур
		new THREE.Vector3(0.3, 0.55, 0),
		new THREE.Vector3(0.3, 0.4, 0),
		new THREE.Vector3(0.28, 0.25, 0),
		// Баруун тосгуур
		new THREE.Vector3(0.25, 0.15, 0.02),
		// Трикуспидал хавхлага
		new THREE.Vector3(0.22, 0.0, 0.02),
		new THREE.Vector3(0.2, -0.08, 0.02),
		// Баруун ховдол
		new THREE.Vector3(0.18, -0.2, 0.02),
		new THREE.Vector3(0.18, -0.35, 0.02),
		// Уушигны хавхлага руу дээш
		new THREE.Vector3(0.2, -0.15, 0.06),
		new THREE.Vector3(0.22, 0.1, 0.08),
		new THREE.Vector3(0.2, 0.35, 0.1),
		// Уушигны артери дээш
		new THREE.Vector3(0.15, 0.5, 0.12),
		new THREE.Vector3(0.08, 0.6, 0.15),
		// Уушиг (хий солилцол — дээд хэсэг)
		new THREE.Vector3(0.0, 0.7, 0.18),
		new THREE.Vector3(-0.1, 0.65, 0.15),
		// Уушигны венээр буцах
		new THREE.Vector3(-0.2, 0.55, 0.08),
		new THREE.Vector3(-0.28, 0.4, 0.02),
		// Зүүн тосгуур
		new THREE.Vector3(-0.25, 0.2, 0.02),
		new THREE.Vector3(-0.22, 0.1, 0.02),
		// Митрал хавхлага
		new THREE.Vector3(-0.2, -0.02, 0.02),
		new THREE.Vector3(-0.18, -0.1, 0.02),
		// Зүүн ховдол
		new THREE.Vector3(-0.16, -0.25, 0.02),
		new THREE.Vector3(-0.16, -0.4, 0.02),
		// Аортын хавхлага руу дээш
		new THREE.Vector3(-0.18, -0.2, 0.08),
		new THREE.Vector3(-0.15, 0.1, 0.1),
		new THREE.Vector3(-0.12, 0.4, 0.12),
		// Аорт дээш гарах
		new THREE.Vector3(-0.1, 0.55, 0.12),
		new THREE.Vector3(-0.05, 0.65, 0.1),
		new THREE.Vector3(0.0, 0.75, 0.08),
	];

	journeyPath = new THREE.CatmullRomCurve3(points, false);

	// Замыг харуулах (бүдэг улаан хоолой)
	const tubeGeom = new THREE.TubeGeometry(journeyPath, 300, 0.012, 8, false);
	const tubeMat = new THREE.MeshBasicMaterial({
		color: 0xff4444,
		transparent: true,
		opacity: 0.2,
	});
	heartGroup.add(new THREE.Mesh(tubeGeom, tubeMat));
}

// =====================================================================
// ЦУСНЫ ЭС PARTICLES
// =====================================================================

function createBloodParticles() {
	const geom = new THREE.SphereGeometry(0.008, 6, 4);

	for (let i = 0; i < BLOOD_CELL_COUNT; i++) {
		const t = Math.random();
		const isOxygenated = t > 0.45;
		const color = isOxygenated ? 0xdd3333 : 0x4466aa;
		const mat = new THREE.MeshBasicMaterial({ color });
		const cell = new THREE.Mesh(geom, mat);

		cell.userData = {
			t: t,
			speed: 0.012 + Math.random() * 0.02,
			offset: new THREE.Vector3(
				(Math.random() - 0.5) * 0.04,
				(Math.random() - 0.5) * 0.04,
				(Math.random() - 0.5) * 0.04,
			),
		};

		heartGroup.add(cell);
		bloodParticles.push(cell);
	}
}

// =====================================================================
// ТОГЛОГЧИЙН УЛААН ЦУСНЫ ЭС
// =====================================================================

function createPlayerCell() {
	const group = new THREE.Group();

	// Biconcave disc хэлбэр
	const geom = new THREE.SphereGeometry(0.03, 16, 12);
	const pos = geom.attributes.position;
	for (let i = 0; i < pos.count; i++) {
		const y = pos.getY(i);
		pos.setY(i, y * 0.35);
		const bulge = 1 + y * y * 3;
		pos.setX(i, pos.getX(i) * bulge);
		pos.setZ(i, pos.getZ(i) * bulge);
	}
	pos.needsUpdate = true;
	geom.computeVertexNormals();

	const mat = new THREE.MeshPhysicalMaterial({
		color: 0xcc0000,
		roughness: 0.3,
		metalness: 0.1,
		emissive: 0x660000,
		emissiveIntensity: 0.8,
	});
	group.add(new THREE.Mesh(geom, mat));

	// Гэрэлтэй хүрээ
	const glowGeom = new THREE.SphereGeometry(0.045, 12, 8);
	const glowMat = new THREE.MeshBasicMaterial({
		color: 0xff4444,
		transparent: true,
		opacity: 0.2,
	});
	group.add(new THREE.Mesh(glowGeom, glowMat));

	// Тоглогчийн гэрэл
	const light = new THREE.PointLight(0xff4444, 0.6, 0.4);
	group.add(light);

	group.visible = false;
	group.name = 'playerCell';
	heartGroup.add(group);
	return group;
}

// =====================================================================
// ЗҮРХНИЙ ЦОХИЛТ АНИМАЦИ
// =====================================================================

function updateHeartbeat(delta) {
	heartbeatPhase += delta;
	if (heartbeatPhase > HEARTBEAT_PERIOD) {
		heartbeatPhase -= HEARTBEAT_PERIOD;
	}

	const phase = heartbeatPhase / HEARTBEAT_PERIOD;
	const isSystole = phase < SYSTOLE_DURATION / HEARTBEAT_PERIOD;

	// Зүрхний бүхэлд цохилт анимаци (GLB загварт хэрэглэнэ)
	const beatPulse = isSystole ? 1.03 : 1.0;
	const currentScale = THREE.MathUtils.lerp(
		heartGroup.scale.x,
		beatPulse,
		delta * 10,
	);
	heartGroup.scale.setScalar(currentScale);

	// Систолын үед бага зэрэг Y тэнхлэгт шахалт
	if (heartModel) {
		const ySquish = isSystole ? 0.97 : 1.0;
		const xExpand = isSystole ? 1.02 : 1.0;
		heartModel.scale.set(
			heartScale * THREE.MathUtils.lerp(heartModel.scale.x / heartScale, xExpand, delta * 8),
			heartScale * THREE.MathUtils.lerp(heartModel.scale.y / heartScale, ySquish, delta * 8),
			heartScale * THREE.MathUtils.lerp(heartModel.scale.z / heartScale, xExpand, delta * 8),
		);
	}
}

// =====================================================================
// ЦУСНЫ ЭСИЙН УРСГАЛ ШИНЭЧЛЭХ
// =====================================================================

function updateBloodParticles(delta) {
	if (!journeyPath) return;

	bloodParticles.forEach((cell) => {
		cell.userData.t += cell.userData.speed * delta;
		if (cell.userData.t > 1) cell.userData.t -= 1;

		const point = journeyPath.getPointAt(cell.userData.t);
		cell.position.copy(point).add(cell.userData.offset);

		const isOxy = cell.userData.t > 0.45;
		cell.material.color.setHex(isOxy ? 0xdd3333 : 0x4466aa);
	});
}

// =====================================================================
// АЯЛАЛЫН ЛОГИК
// =====================================================================

function startJourney() {
	journeyActive = true;
	journeyAutoPlay = true;
	journeyProgress = 0;
	currentStationIndex = 0;
	playerCell.visible = true;

	// Хуучин trail цэвэрлэх
	playerCellTrail.forEach((t) => heartGroup.remove(t));
	playerCellTrail.length = 0;

	updateStationUI(stations[0]);
}

function updateJourney(delta) {
	if (!journeyActive || !journeyPath || !playerCell) return;

	if (journeyAutoPlay) {
		journeyProgress += JOURNEY_SPEED * delta;
		if (journeyProgress >= 1) {
			journeyProgress = 1;
			journeyAutoPlay = false;
		}
	}

	// Тоглогчийн эс байрлал
	const clampedT = Math.min(Math.max(journeyProgress, 0), 0.999);
	const point = journeyPath.getPointAt(clampedT);
	playerCell.position.copy(point);

	// Чиглэл
	const lookT = Math.min(clampedT + 0.01, 0.999);
	playerCell.lookAt(journeyPath.getPointAt(lookT));

	// Trail цэвэрлэх
	if (playerCellTrail.length > 20) {
		const old = playerCellTrail.shift();
		old.material.opacity -= 0.02;
		if (old.material.opacity <= 0) {
			heartGroup.remove(old);
		}
	}

	checkStation();

	const percent = Math.floor(journeyProgress * 100);
	progressText.text = `${percent}%`;
	progressText.sync();
}

function checkStation() {
	if (currentStationIndex >= stations.length - 1) return;

	const nextStation = stations[currentStationIndex + 1];
	if (journeyProgress >= nextStation.t) {
		currentStationIndex++;
		updateStationUI(nextStation);

		if (journeyAutoPlay) {
			journeyAutoPlay = false;
			setTimeout(() => {
				if (journeyActive && currentStationIndex < stations.length - 1) {
					journeyAutoPlay = true;
				}
			}, 2500);
		}
	}
}

function updateStationUI(station) {
	stationTitle.text = station.name;
	stationTitle.color = station.color;
	stationTitle.sync();

	stationInfo.text = `[${station.nameEn}]\n\n${station.info}`;
	stationInfo.sync();

	gsap.fromTo(
		stationTitle,
		{ fillOpacity: 0 },
		{ fillOpacity: 1, duration: 0.5 },
	);
}

// =====================================================================
// ЗҮРХНИЙ ЦОХИЛТЫН АУДИО (синтез)
// =====================================================================

function createHeartbeatBuffer(audioContext) {
	const sampleRate = audioContext.sampleRate;
	const length = Math.floor(sampleRate * HEARTBEAT_PERIOD);
	const buffer = audioContext.createBuffer(1, length, sampleRate);
	const data = buffer.getChannelData(0);

	// "Lub" (S1) — t=0, 120ms
	const lubEnd = 0.12 * sampleRate;
	for (let i = 0; i < lubEnd; i++) {
		const t = i / sampleRate;
		const env = Math.sin((i / lubEnd) * Math.PI);
		data[i] =
			env *
			(Math.sin(2 * Math.PI * 40 * t) * 0.7 +
				Math.sin(2 * Math.PI * 65 * t) * 0.4);
	}

	// "Dub" (S2) — t=0.3s, 80ms
	const dubStart = Math.floor(0.3 * sampleRate);
	const dubLen = Math.floor(0.08 * sampleRate);
	for (let j = 0; j < dubLen; j++) {
		const idx = dubStart + j;
		if (idx >= length) break;
		const t = j / sampleRate;
		const env = Math.sin((j / dubLen) * Math.PI);
		data[idx] +=
			env *
			(Math.sin(2 * Math.PI * 55 * t) * 0.5 +
				Math.sin(2 * Math.PI * 85 * t) * 0.3);
	}

	return buffer;
}

/** Цусны урсгалын whoosh дуу синтез */
function createWhooshBuffer(audioContext) {
	const sampleRate = audioContext.sampleRate;
	const length = Math.floor(sampleRate * 0.5);
	const buffer = audioContext.createBuffer(1, length, sampleRate);
	const data = buffer.getChannelData(0);

	for (let i = 0; i < length; i++) {
		const t = i / length;
		const env = Math.sin(t * Math.PI) * 0.3;
		data[i] = env * (Math.random() * 2 - 1);
	}

	return buffer;
}

// =====================================================================
// SCENE ТОХИРГОО
// =====================================================================

function setupScene({ scene, camera }) {
	// ── GLB зүрхний загвар ачаалах ──
	loadHeartModel(scene).then(() => {
		// Загвар ачаалагдсаны дараа шошго, зам зэргийг нэмэх
		createAnatomyLabels();
		createJourneyPath();
		createBloodParticles();
		playerCell = createPlayerCell();
	});

	// ── Гэрэлтүүлэг ──
	const ambientLight = new THREE.AmbientLight(0x554444, 0.8);
	scene.add(ambientLight);

	const mainLight = new THREE.DirectionalLight(0xffdddd, 1.2);
	mainLight.position.set(3, 5, 4);
	mainLight.castShadow = true;
	scene.add(mainLight);

	const fillLight = new THREE.DirectionalLight(0x8888cc, 0.5);
	fillLight.position.set(-3, -1, -3);
	scene.add(fillLight);

	const rimLight = new THREE.DirectionalLight(0xff8888, 0.3);
	rimLight.position.set(0, 0, -3);
	scene.add(rimLight);

	// Доорх шалны тусгал гэрэл
	const groundLight = new THREE.PointLight(0x442222, 0.3, 5);
	groundLight.position.set(0, 0, 0);
	scene.add(groundLight);

	// ── ТЕКСТ UI ──

	// Гарчиг
	stationTitle.fontSize = 0.12;
	stationTitle.font = 'assets/SpaceMono-Bold.ttf';
	stationTitle.color = 0xff6666;
	stationTitle.anchorX = 'center';
	stationTitle.anchorY = 'middle';
	stationTitle.outlineWidth = 0.005;
	stationTitle.outlineColor = 0x000000;
	stationTitle.position.set(0, 2.85, -1.5);
	stationTitle.text = 'VR BioLab: З\u04AF\u0440\u0445\u043D\u0438\u0439 \u0431\u04AF\u0442\u044D\u0446';
	stationTitle.sync();
	scene.add(stationTitle);

	// Мэдээлэл
	stationInfo.fontSize = 0.05;
	stationInfo.font = 'assets/SpaceMono-Bold.ttf';
	stationInfo.color = 0xdddddd;
	stationInfo.anchorX = 'center';
	stationInfo.anchorY = 'top';
	stationInfo.outlineWidth = 0.003;
	stationInfo.outlineColor = 0x000000;
	stationInfo.position.set(0, 2.7, -1.5);
	stationInfo.maxWidth = 2.0;
	stationInfo.text = 'Trigger \u0434\u0430\u0440\u0436 \u0430\u044F\u043B\u0430\u043B \u044D\u0445\u043B\u04AF\u04AF\u043B\u043D\u044D \u04AF\u04AF!';
	stationInfo.sync();
	scene.add(stationInfo);

	// Зааварчилгаа
	instructionText.fontSize = 0.04;
	instructionText.font = 'assets/SpaceMono-Bold.ttf';
	instructionText.color = 0xaaaaaa;
	instructionText.anchorX = 'center';
	instructionText.anchorY = 'middle';
	instructionText.outlineWidth = 0.002;
	instructionText.outlineColor = 0x000000;
	instructionText.position.set(0, 0.3, -1.2);
	instructionText.text =
		'[\u0411\u0430\u0440\u0443\u0443\u043D trigger] \u0410\u044F\u043B\u0430\u043B \u044D\u0445\u043B\u04AF\u04AF\u043B\u044D\u0445 / \u04AF\u0440\u0433\u044D\u043B\u0436\u043B\u04AF\u04AF\u043B\u044D\u0445  |  [Grip] \u0417\u04AF\u0440\u0445\u0438\u0439\u0433 \u044D\u0440\u0433\u04AF\u04AF\u043B\u044D\u0445';
	instructionText.sync();
	scene.add(instructionText);

	// Явц
	progressText.fontSize = 0.06;
	progressText.font = 'assets/SpaceMono-Bold.ttf';
	progressText.color = 0xff8888;
	progressText.anchorX = 'center';
	progressText.anchorY = 'middle';
	progressText.position.set(0, 0.45, -1.2);
	progressText.text = '';
	progressText.sync();
	scene.add(progressText);

	// ── АУДИО ──
	audioListener = new THREE.AudioListener();
	camera.add(audioListener);

	heartbeatSound = new THREE.PositionalAudio(audioListener);
	const hbBuffer = createHeartbeatBuffer(audioListener.context);
	heartbeatSound.setBuffer(hbBuffer);
	heartbeatSound.setLoop(true);
	heartbeatSound.setVolume(0.8);
	heartbeatSound.setRefDistance(1.5);
	heartGroup.add(heartbeatSound);

	whooshSound = new THREE.PositionalAudio(audioListener);
	const whooshBuffer = createWhooshBuffer(audioListener.context);
	whooshSound.setBuffer(whooshBuffer);
	whooshSound.setLoop(false);
	whooshSound.setVolume(0.4);

	try {
		heartbeatSound.play();
	} catch {
		// AudioContext may need user interaction
	}
}

// =====================================================================
// ФРЭЙМ БҮРИЙН ШИНЭЧЛЭЛТ
// =====================================================================

function onFrame(delta, _time, { camera, controllers }) {
	// ── Зүрхний цохилт ──
	updateHeartbeat(delta);

	// ── Цусны эсийн урсгал ──
	updateBloodParticles(delta);

	// ── Аялал шинэчлэх ──
	updateJourney(delta);

	// ── КОНТРОЛЛЕР ОРОЛТ ──
	if (controllers.right) {
		const { gamepad } = controllers.right;

		if (gamepad.getButtonClick(XR_BUTTONS.TRIGGER)) {
			if (!journeyActive) {
				startJourney();
				try {
					if (!heartbeatSound.isPlaying) heartbeatSound.play();
				} catch {
					// ignore
				}
			} else if (!journeyAutoPlay) {
				if (journeyProgress >= 1) {
					startJourney();
				} else {
					journeyAutoPlay = true;
				}
			}

			try {
				if (whooshSound.isPlaying) whooshSound.stop();
				whooshSound.play();
			} catch {
				// ignore
			}

			try {
				gamepad.getHapticActuator(0).pulse(0.3, 100);
			} catch {
				// ignore
			}
		}
	}

	// Grip → зүрхийг эргүүлэх
	if (controllers.left) {
		const { gamepad } = controllers.left;
		const gripValue = gamepad.getButtonValue(XR_BUTTONS.SQUEEZE);
		if (gripValue > 0.5) {
			heartGroup.rotation.y += delta * 0.8;
		}
	}
	if (controllers.right) {
		const { gamepad } = controllers.right;
		const gripValue = gamepad.getButtonValue(XR_BUTTONS.SQUEEZE);
		if (gripValue > 0.5) {
			heartGroup.rotation.y -= delta * 0.8;
		}
	}

	// ── Шошгууд камер руу харах (billboard) ──
	labelObjects.forEach((label) => {
		label.lookAt(camera.position);
	});

	// ── GSAP шинэчлэх ──
	gsap.ticker.tick(delta);
}

// =====================================================================
// ЭХЛҮҮЛЭХ
// =====================================================================

init(setupScene, onFrame);
