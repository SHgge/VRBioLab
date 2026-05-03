/**
 * @file Production-quality procedural compound microscope.
 *
 * Builds an original school-laboratory binocular-style compound
 * microscope from THREE primitives + ExtrudeGeometry + canvas-generated
 * textures. Designed for VR (Quest 3S) — under 25 000 triangles, single
 * transmission material, shared geometries and materials.
 *
 * The design follows universal microscopy conventions (color-coded
 * objective rings, coarse-and-fine concentric focus knobs, tilted
 * eyepiece) and is NOT modelled after any specific manufacturer.
 *
 * Public API:
 *   import { createMicroscope } from './microscope/build.js';
 *   const scope = createMicroscope();
 *   scope.position.set(0.2, 0.98, 0);   // place on bench
 *   scene.add(scope);
 *
 * Named parts (resolve via THREE.Object3D.getObjectByName):
 *   Microscope, Microscope_Base, Microscope_LightSource,
 *   Microscope_OnOffSwitch, Microscope_Diaphragm, Microscope_Stage,
 *   Microscope_StageClips, Microscope_Arm, Microscope_CoarseKnob,
 *   Microscope_FineKnob, Microscope_Nosepiece,
 *   Microscope_Objective_4x, _10x, _40x, _100x,
 *   Microscope_EyepieceTube, Microscope_Eyepiece
 *
 * Pivot conventions:
 *   - Microscope_Nosepiece origin is at the rotation centre of the
 *     turret; rotate around its local Y axis to switch objective.
 *   - Microscope_Diaphragm origin is at its rotation centre; rotate
 *     around its local Y axis.
 *   - Focus knobs are concentric on a horizontal X-axis through the
 *     arm shroud; rotate the inner (Microscope_CoarseKnob /
 *     Microscope_FineKnob) Group around its local Z axis to spin —
 *     each Group already has rotation.z = π/2 baked in to flip the
 *     cylinder axle horizontal, so the spin is +rotation.z delta.
 */

import * as THREE from 'three';

// =====================================================================
// HELPERS
// =====================================================================

/** Builds a beveled box geometry — rounded corners and chamfered edges
 *  on every box mesh in this module. Sharp edges are the #1 give-away
 *  of cheap procedural work. */
function beveledBoxGeom(w, h, d, bevel = 0.004) {
	const safeBevel = Math.min(bevel, w / 2 - 0.002, d / 2 - 0.002, h / 2 - 0.002);
	const hw = w / 2 - safeBevel;
	const hd = d / 2 - safeBevel;
	const shape = new THREE.Shape();
	shape.absarc(-hw, -hd, safeBevel, Math.PI, 1.5 * Math.PI, false);
	shape.absarc(hw, -hd, safeBevel, 1.5 * Math.PI, 0, false);
	shape.absarc(hw, hd, safeBevel, 0, 0.5 * Math.PI, false);
	shape.absarc(-hw, hd, safeBevel, 0.5 * Math.PI, Math.PI, false);
	shape.closePath();
	const geom = new THREE.ExtrudeGeometry(shape, {
		depth: h - safeBevel * 2,
		bevelEnabled: true,
		bevelThickness: safeBevel,
		bevelSize: safeBevel,
		bevelSegments: 1,
		curveSegments: 3,
		steps: 1,
	});
	geom.rotateX(-Math.PI / 2);
	geom.center();
	return geom;
}

// =====================================================================
// PROCEDURAL TEXTURES (canvas-generated, run once at module load)
// =====================================================================

/** Brushed-metal normal map. 1024 × 1024 with vertical micro-scratches
 *  in the R channel — applied at low normalScale for subtle shimmer. */
function makeBrushedMetalNormalMap() {
	const canvas = document.createElement('canvas');
	canvas.width = 1024;
	canvas.height = 1024;
	const ctx = canvas.getContext('2d');
	// Default normal: pointing along +Z (RGB 128, 128, 255)
	ctx.fillStyle = '#8080ff';
	ctx.fillRect(0, 0, 1024, 1024);
	// Vertical streaks: vary R channel ±15
	for (let x = 0; x < 1024; x++) {
		const r = Math.round(128 + (Math.random() - 0.5) * 30);
		const clamped = Math.max(96, Math.min(160, r));
		ctx.fillStyle = `rgb(${clamped}, 128, 255)`;
		ctx.fillRect(x, 0, 1, 1024);
	}
	// 30 longer scratch lines
	for (let i = 0; i < 30; i++) {
		const x = Math.random() * 1024;
		const a = 0.10 + Math.random() * 0.18;
		ctx.fillStyle = `rgba(95, 128, 255, ${a})`;
		ctx.fillRect(x, 0, 1, 1024);
	}
	const tex = new THREE.CanvasTexture(canvas);
	tex.wrapS = THREE.RepeatWrapping;
	tex.wrapT = THREE.RepeatWrapping;
	tex.repeat.set(2, 2);
	return tex;
}

/** Engraved spec band for an objective ('4x', '10x', '40x', '100x'). */
function makeObjectiveSpecLabel(power) {
	const canvas = document.createElement('canvas');
	canvas.width = 512;
	canvas.height = 64;
	const ctx = canvas.getContext('2d');
	ctx.fillStyle = '#0a0a0a';
	ctx.fillRect(0, 0, 512, 64);
	// Subtle horizontal etching texture
	for (let i = 0; i < 30; i++) {
		const y = Math.random() * 64;
		ctx.fillStyle = `rgba(255, 255, 255, ${Math.random() * 0.04})`;
		ctx.fillRect(0, y, 512, 1);
	}
	const specs = {
		'4x':   { mag: '4×',   na: '0.10', wd: '17.0' },
		'10x':  { mag: '10×',  na: '0.25', wd: '10.5' },
		'40x':  { mag: '40×',  na: '0.65', wd: '0.65' },
		'100x': { mag: '100×', na: '1.25', wd: '0.20' },
	};
	const s = specs[power];
	ctx.fillStyle = '#e8e8e0';
	ctx.font = 'bold 24px sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(`PLAN ${s.mag} / ${s.na}`, 256, 22);
	ctx.font = '14px sans-serif';
	ctx.fillStyle = '#9090a0';
	ctx.fillText(`∞/0.17  WD ${s.wd}`, 256, 46);
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}

/** "ICS BIO" school identifier label on the side of the base. */
function makeICSBioLabel() {
	const canvas = document.createElement('canvas');
	canvas.width = 256;
	canvas.height = 64;
	const ctx = canvas.getContext('2d');
	ctx.clearRect(0, 0, 256, 64);
	ctx.fillStyle = 'rgba(190, 195, 200, 0.85)';
	ctx.font = 'bold 22px sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText('ICS BIO', 128, 32);
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}

// =====================================================================
// CACHED MATERIALS (created once, reused everywhere)
// =====================================================================

const _normalMap = makeBrushedMetalNormalMap();

/** Painted-metal body — base, arm, light housing, switch shrouds.
 *  Mid-light grey #BDBDBD. */
const _bodyMat = new THREE.MeshStandardMaterial({
	color: 0xbdbdbd,
	metalness: 0.40,
	roughness: 0.55,
	envMapIntensity: 1.0,
	normalMap: _normalMap,
	normalScale: new THREE.Vector2(0.12, 0.12),
});

/** Stage plate — original near-black charcoal so the slide reads
 *  clearly against it. */
const _stageMat = new THREE.MeshStandardMaterial({
	color: 0x1d2025,
	metalness: 0.72,
	roughness: 0.30,
	envMapIntensity: 1.25,
	normalMap: _normalMap,
	normalScale: new THREE.Vector2(0.16, 0.16),
});

/** Polished chrome — eyepiece collar, objective bodies, stage clips.
 *  Brightened slightly so it still reads as polished chrome against
 *  the new off-white body. */
const _chromeMat = new THREE.MeshStandardMaterial({
	color: 0xe8eaed,
	metalness: 1.0,
	roughness: 0.16,
	envMapIntensity: 1.5,
});

/** Knob bodies + nosepiece + smaller accent parts — medium grey
 *  #777777. Mid-roughness reads as matte plastic / painted metal. */
const _knobMat = new THREE.MeshStandardMaterial({
	color: 0x777777,
	metalness: 0.30,
	roughness: 0.55,
	envMapIntensity: 0.9,
});

/** Bright LED inside the light housing. */
const _emissiveMat = new THREE.MeshStandardMaterial({
	color: 0xffe0a0,
	emissive: 0xffd28a,
	emissiveIntensity: 1.5,
	roughness: 0.4,
});

/** Diaphragm aperture (emissive glow simulating light shining through). */
const _diaphragmEmissiveMat = new THREE.MeshStandardMaterial({
	color: 0x2a2418,
	emissive: 0xfff0c0,
	emissiveIntensity: 0.6,
	roughness: 0.7,
});

/** International color-coded objective rings. */
const _ringMat4x   = new THREE.MeshStandardMaterial({ color: 0xb83232, metalness: 0.30, roughness: 0.50, envMapIntensity: 1.1 });
const _ringMat10x  = new THREE.MeshStandardMaterial({ color: 0xd9b137, metalness: 0.30, roughness: 0.50, envMapIntensity: 1.1 });
const _ringMat40x  = new THREE.MeshStandardMaterial({ color: 0x3365b5, metalness: 0.30, roughness: 0.50, envMapIntensity: 1.1 });
const _ringMat100x = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, metalness: 0.30, roughness: 0.50, envMapIntensity: 1.1 });

/** Soft black rubber for the eyecup. */
const _rubberMat = new THREE.MeshStandardMaterial({
	color: 0x080808,
	metalness: 0,
	roughness: 0.95,
	envMapIntensity: 0.4,
});

/** Indicator/LED red emissive. */
const _indicatorMat = new THREE.MeshStandardMaterial({
	color: 0xff2a2a,
	emissive: 0xff2a2a,
	emissiveIntensity: 0.6,
});

/** Lens glass. PERF: transmission removed — screen-space refraction
 *  costs ~5–10 ms on Quest 3S when the lens fills much of the view
 *  (which is exactly what happens when the user leans into the
 *  eyepiece). Opacity + envMap reflection reads as glass at much
 *  lower cost. */
const _lensMat = new THREE.MeshStandardMaterial({
	color: 0xeaf2ff,
	metalness: 0,
	roughness: 0.05,
	transparent: true,
	opacity: 0.35,
	envMapIntensity: 1.6,
});

// =====================================================================
// CACHED GEOMETRIES (shared across instances)
// =====================================================================

/** Single knurl ridge — placed many times around each knob. */
const _ridgeGeom = new THREE.BoxGeometry(0.0015, 0.012, 0.0028);

/** Shared objective body subsection geometries — all four objectives
 *  use the same upper collar and tip cylinder, only ring colour and
 *  spec-band texture differ. */
const _objCollarGeom = new THREE.CylinderGeometry(0.012, 0.012, 0.005, 32);

// =====================================================================
// PARTS
// =====================================================================

/** Builds the main base — rounded plate, light housing, on/off
 *  switch, and a small "ICS BIO" identifier on the side. */
function makeBase() {
	const group = new THREE.Group();
	group.name = 'Microscope_Base';

	// Main body — 0.22 × 0.04 × 0.26 m beveled plate
	const body = new THREE.Mesh(beveledBoxGeom(0.220, 0.040, 0.260, 0.008), _bodyMat);
	body.position.y = 0.020;
	body.castShadow = true;
	body.receiveShadow = true;
	group.add(body);

	// "ICS BIO" school identifier on the left side
	const labelMat = new THREE.MeshStandardMaterial({
		map: makeICSBioLabel(),
		transparent: true,
		roughness: 0.6,
		metalness: 0.3,
	});
	const label = new THREE.Mesh(new THREE.PlaneGeometry(0.040, 0.010), labelMat);
	label.position.set(-0.111, 0.022, 0.06);
	label.rotation.y = -Math.PI / 2;
	group.add(label);

	// Light housing (raised step + chrome bezel + LED)
	group.add(makeLightHousing());

	// On/Off toggle switch on the right side of the base
	const switchBody = new THREE.Mesh(
		beveledBoxGeom(0.012, 0.020, 0.010, 0.001),
		_knobMat,
	);
	switchBody.position.set(0.116, 0.026, -0.060);
	switchBody.name = 'Microscope_OnOffSwitch';
	group.add(switchBody);

	// Chrome accent toggle on the switch
	const switchAccent = new THREE.Mesh(
		new THREE.CylinderGeometry(0.002, 0.002, 0.014, 12),
		_chromeMat,
	);
	switchAccent.rotation.z = Math.PI / 2;
	switchAccent.position.set(0.122, 0.026, -0.060);
	group.add(switchAccent);

	// Power LED indicator above the switch
	const led = new THREE.Mesh(new THREE.SphereGeometry(0.0025, 12, 8), _indicatorMat);
	led.position.set(0.116, 0.040, -0.060);
	group.add(led);

	return group;
}

/** Builds the light housing — chrome bezel ring around an emissive
 *  LED disc, recessed into a raised step in the centre of the base.
 *
 *  Position is aligned with the diaphragm above (both at microscope-
 *  local z = 0.020) so the LED shines straight up through the iris
 *  aperture and the stage's central hole — matching how real compound
 *  microscopes route light from base → condenser → diaphragm → stage.
 *
 *  The whole assembly (raised housing block + bezel + LED) is named
 *  Microscope_LightSource so any raycast inside it resolves to the
 *  same part. */
function makeLightHousing() {
	const group = new THREE.Group();
	group.name = 'Microscope_LightSource';

	const lightZ = 0.020;
	const baseTopY = 0.040;
	const housingH = 0.020;

	// Black cylindrical platform — replaces the previous rectangular
	// box. Reads as a typical school-microscope LED illuminator: a
	// low cylindrical housing on top of the base.
	const platform = new THREE.Mesh(
		new THREE.CylinderGeometry(0.032, 0.032, housingH, 32),
		_knobMat,
	);
	platform.position.set(0, baseTopY + housingH / 2, lightZ);
	platform.castShadow = true;
	group.add(platform);

	// Annular rim on top — covers the platform's flat top, leaving a
	// small circular hole exposing the LED below. Black to match the
	// rest of the housing.
	const rim = new THREE.Mesh(
		new THREE.RingGeometry(0.013, 0.032, 32),
		_knobMat,
	);
	rim.rotation.x = -Math.PI / 2;
	rim.position.set(0, baseTopY + housingH + 0.0008, lightZ);
	group.add(rim);

	// Emissive LED disc inside the rim hole — visible from above as the
	// glowing centre of the housing.
	const led = new THREE.Mesh(
		new THREE.CircleGeometry(0.012, 32),
		_emissiveMat,
	);
	led.rotation.x = -Math.PI / 2;
	led.position.set(0, baseTopY + housingH + 0.0010, lightZ);
	group.add(led);

	return group;
}

/** Iris diaphragm — disk under the stage with a side-mounted rotation
 *  grip lever. Group origin sits at the rotation centre (Y-axis). */
function makeDiaphragm() {
	const group = new THREE.Group();
	group.name = 'Microscope_Diaphragm';

	// Disk body
	const disk = new THREE.Mesh(
		new THREE.CylinderGeometry(0.024, 0.024, 0.010, 32),
		_stageMat,
	);
	group.add(disk);

	// Bright aperture in the centre — the IRIS hole. optics.js animates
	// this mesh's scale based on state.diaphragm so the aperture
	// physically opens (1.0) and closes (≈ 0.05) as the kid operates
	// the lever, matching how a real iris diaphragm regulates the
	// light passing through to the specimen.
	const aperture = new THREE.Mesh(
		new THREE.CircleGeometry(0.011, 24),
		_diaphragmEmissiveMat,
	);
	aperture.name = 'Microscope_Diaphragm_Aperture';
	aperture.rotation.x = -Math.PI / 2;
	aperture.position.y = 0.0051;
	group.add(aperture);

	// Rotation-grip lever protruding out the side
	const lever = new THREE.Mesh(
		beveledBoxGeom(0.030, 0.005, 0.005, 0.001),
		_knobMat,
	);
	lever.position.set(0.034, 0, 0);
	group.add(lever);

	// Lever knob tip
	const leverKnob = new THREE.Mesh(
		new THREE.SphereGeometry(0.0045, 12, 8),
		_knobMat,
	);
	leverKnob.position.set(0.052, 0, 0);
	group.add(leverKnob);

	return group;
}

/** Stage — flat plate with a centred circular aperture, two metal
 *  spring clips holding a slide position, and X/Y micrometer wheels
 *  on the right side. */
function makeStage() {
	const group = new THREE.Group();
	group.name = 'Microscope_Stage';

	// Stage plate as a rounded rectangle with circular aperture hole
	const w = 0.180, d = 0.140, r = 0.005;
	const plateShape = new THREE.Shape();
	plateShape.absarc(-w / 2 + r, -d / 2 + r, r, Math.PI, 1.5 * Math.PI, false);
	plateShape.absarc(w / 2 - r, -d / 2 + r, r, 1.5 * Math.PI, 0, false);
	plateShape.absarc(w / 2 - r, d / 2 - r, r, 0, 0.5 * Math.PI, false);
	plateShape.absarc(-w / 2 + r, d / 2 - r, r, 0.5 * Math.PI, Math.PI, false);
	plateShape.closePath();
	const aperture = new THREE.Path();
	aperture.absarc(0, 0, 0.013, 0, Math.PI * 2, true);
	plateShape.holes.push(aperture);

	const plateGeom = new THREE.ExtrudeGeometry(plateShape, {
		depth: 0.012,
		bevelEnabled: true,
		bevelThickness: 0.002,
		bevelSize: 0.002,
		bevelSegments: 1,
		curveSegments: 4,
		steps: 1,
	});
	plateGeom.rotateX(-Math.PI / 2);
	plateGeom.translate(0, 0.006, 0);

	const plate = new THREE.Mesh(plateGeom, _stageMat);
	plate.castShadow = true;
	plate.receiveShadow = true;
	group.add(plate);

	// Stage clips (sub-group, holding a slide position)
	const clipsGroup = new THREE.Group();
	clipsGroup.name = 'Microscope_StageClips';
	for (const dz of [-0.025, 0.025]) {
		const mount = new THREE.Mesh(
			beveledBoxGeom(0.014, 0.005, 0.014, 0.001),
			_chromeMat,
		);
		mount.position.set(-0.040, 0.014, dz);
		clipsGroup.add(mount);
		const spring = new THREE.Mesh(
			beveledBoxGeom(0.045, 0.003, 0.005, 0.001),
			_chromeMat,
		);
		spring.position.set(-0.012, 0.018, dz);
		spring.rotation.z = -0.10;
		clipsGroup.add(spring);
	}
	group.add(clipsGroup);

	// Specimen slide — opaque tinted box (NOT a transparent material;
	// keeping the lens material as the only transparent material in the
	// scope per the perf budget).
	const slide = new THREE.Mesh(
		new THREE.BoxGeometry(0.075, 0.0010, 0.025),
		new THREE.MeshStandardMaterial({
			color: 0xeaf2ff,
			metalness: 0.05,
			roughness: 0.10,
			envMapIntensity: 1.4,
		}),
	);
	slide.position.set(0.000, 0.0135, 0.000);
	group.add(slide);

	// Stained sample blob in the centre of the slide (purple haematoxylin
	// stain — typical biology classroom prep)
	const sampleBlob = new THREE.Mesh(
		new THREE.CircleGeometry(0.006, 24),
		new THREE.MeshStandardMaterial({
			color: 0xb83880,
			metalness: 0,
			roughness: 0.45,
		}),
	);
	sampleBlob.rotation.x = -Math.PI / 2;
	sampleBlob.position.set(0.000, 0.0142, 0.000);
	group.add(sampleBlob);

	// Frosted label end of the slide (where the sample is identified)
	const slideLabel = new THREE.Mesh(
		new THREE.BoxGeometry(0.014, 0.0011, 0.022),
		new THREE.MeshStandardMaterial({
			color: 0xe8e6df,
			metalness: 0,
			roughness: 0.85,
		}),
	);
	slideLabel.position.set(-0.030, 0.0136, 0.000);
	group.add(slideLabel);

	// X/Y mechanical-stage micrometer wheels on the right (knurled
	// rubber + chrome rim on the user-facing face)
	for (let i = 0; i < 2; i++) {
		const knob = new THREE.Mesh(
			new THREE.CylinderGeometry(0.014, 0.014, 0.012, 24),
			_knobMat,
		);
		knob.rotation.z = Math.PI / 2;
		knob.position.set(0.097, 0.003, -0.020 + i * 0.018);
		group.add(knob);
		// Chrome rim torus on the outer face (instead of solid chrome cap)
		const rim = new THREE.Mesh(
			new THREE.TorusGeometry(0.0135, 0.0008, 6, 24),
			_chromeMat,
		);
		rim.rotation.y = Math.PI / 2;
		rim.position.set(0.103, 0.003, -0.020 + i * 0.018);
		group.add(rim);
		// Small chrome accent in the centre
		const center = new THREE.Mesh(
			new THREE.CylinderGeometry(0.005, 0.005, 0.003, 12),
			_chromeMat,
		);
		center.rotation.z = Math.PI / 2;
		center.position.set(0.105, 0.003, -0.020 + i * 0.018);
		group.add(center);
	}

	return group;
}

/** Builds the curved arm — vertical post + upper bracket. The bracket
 *  swoops forward at the top to support the eyepiece tube above the
 *  nosepiece. ExtrudeGeometry with bezier silhouette + Y rotation
 *  so the silhouette's "forward" lines up with world +Z. */
function makeArm() {
	const group = new THREE.Group();
	group.name = 'Microscope_Arm';

	// Side silhouette in X-Y. X = forward (becomes world +Z after rotation).
	// Lower vertical section shortened by 5 cm from original (0.215 →
	// 0.165) — closes the light-to-diaphragm gap without over-cropping
	// the body. Bracket on top remains continuous with the eyepiece
	// tube (no floating gap).
	const armShape = new THREE.Shape();
	armShape.moveTo(-0.030, 0);
	armShape.lineTo(0.030, 0);
	armShape.lineTo(0.030, 0.165);
	armShape.bezierCurveTo(0.045, 0.195, 0.075, 0.215, 0.110, 0.220);
	armShape.lineTo(0.110, 0.250);
	armShape.bezierCurveTo(0.075, 0.255, 0.000, 0.255, -0.030, 0.245);
	armShape.lineTo(-0.030, 0);

	const armGeom = new THREE.ExtrudeGeometry(armShape, {
		depth: 0.070,
		bevelEnabled: true,
		bevelThickness: 0.005,
		bevelSize: 0.005,
		bevelSegments: 1,
		curveSegments: 8,
		steps: 1,
	});
	armGeom.translate(0, 0, -0.035);
	armGeom.rotateY(-Math.PI / 2); // shape +X → world +Z (forward toward user)

	const arm = new THREE.Mesh(armGeom, _bodyMat);
	arm.position.set(0, 0.040, -0.060);
	arm.castShadow = true;
	arm.receiveShadow = true;
	group.add(arm);

	// Black focus-knob shroud — a small box where the focus axles emerge.
	// Y position lowered by 5 cm to match the shorter arm.
	const shroud = new THREE.Mesh(
		beveledBoxGeom(0.080, 0.046, 0.060, 0.004),
		_knobMat,
	);
	shroud.position.set(0, 0.115, -0.030);
	group.add(shroud);

	return group;
}

/** Generic knurled knob — rubber body, knurled grip, chrome rim cap.
 *  Built with axle along Y; the caller rotates the wrapping Group to
 *  orient the axle horizontally.
 *
 *  PERF: knurl ridges are now a single InstancedMesh (1 draw call
 *  instead of 24+ per knob). With 4 knobs that saves ~90 draw calls. */
function makeKnob(radius, height, segments = 24, hasOuterCap = true) {
	const group = new THREE.Group();

	// Rubber body
	const body = new THREE.Mesh(
		new THREE.CylinderGeometry(radius, radius, height, segments),
		_knobMat,
	);
	group.add(body);

	// Knurled ridges as a single InstancedMesh
	const ridgeCount = segments;
	const ridges = new THREE.InstancedMesh(_ridgeGeom, _knobMat, ridgeCount);
	const dummy = new THREE.Object3D();
	for (let i = 0; i < ridgeCount; i++) {
		const a = (i / ridgeCount) * Math.PI * 2;
		dummy.position.set(
			Math.cos(a) * (radius + 0.0007),
			0,
			Math.sin(a) * (radius + 0.0007),
		);
		dummy.rotation.set(0, -a, 0);
		dummy.scale.set(1, height / 0.012, 1);
		dummy.updateMatrix();
		ridges.setMatrixAt(i, dummy.matrix);
	}
	ridges.instanceMatrix.needsUpdate = true;
	group.add(ridges);

	// Small chrome accent button on the outer face — real microscope
	// focus knobs have a small centre disc (often the manufacturer's
	// logo), NOT a full-face chrome cap.
	if (hasOuterCap) {
		const accent = new THREE.Mesh(
			new THREE.CylinderGeometry(radius * 0.32, radius * 0.32, 0.0020, 16),
			_chromeMat,
		);
		accent.position.y = height / 2 + 0.0010;
		group.add(accent);
		// Outer rim ring — thin chrome ring at the rim circumference
		const rim = new THREE.Mesh(
			new THREE.TorusGeometry(radius - 0.0005, 0.0008, 6, segments),
			_chromeMat,
		);
		rim.rotation.x = Math.PI / 2;
		rim.position.y = height / 2 + 0.0001;
		group.add(rim);
	}

	return group;
}

/** Coarse focus knob group — outer/larger knob on each side of the
 *  arm. To rotate, increment Microscope_CoarseKnob.rotation.x. */
function makeCoarseKnob() {
	const group = new THREE.Group();
	group.name = 'Microscope_CoarseKnob';
	for (const dx of [-1, 1]) {
		const knob = makeKnob(0.024, 0.018, 24, true);
		knob.rotation.z = Math.PI / 2;
		knob.position.set(dx * 0.078, 0.115, -0.030);
		group.add(knob);
	}
	return group;
}

/** Fine focus knob group — inner/smaller knob, concentric with the
 *  coarse knob. */
function makeFineKnob() {
	const group = new THREE.Group();
	group.name = 'Microscope_FineKnob';
	for (const dx of [-1, 1]) {
		const knob = makeKnob(0.016, 0.014, 20, true);
		knob.rotation.z = Math.PI / 2;
		knob.position.set(dx * 0.054, 0.115, -0.030);
		group.add(knob);
	}
	return group;
}

/** A single objective — stepped chrome tube, colored classification
 *  ring, engraved spec band. */
function makeObjective(power, ringMat, length, label) {
	const group = new THREE.Group();
	group.name = label;

	// Upper collar (where it screws into the nosepiece)
	const collar = new THREE.Mesh(_objCollarGeom, _chromeMat);
	collar.position.y = -0.0025;
	group.add(collar);

	// Upper section of the stepped tube (chrome)
	const upperLength = length * 0.42;
	const upperTube = new THREE.Mesh(
		new THREE.CylinderGeometry(0.0095, 0.0095, upperLength, 32),
		_chromeMat,
	);
	upperTube.position.y = -0.005 - upperLength / 2;
	group.add(upperTube);

	// Color classification ring
	const ringHeight = 0.005;
	const ring = new THREE.Mesh(
		new THREE.CylinderGeometry(0.0098, 0.0098, ringHeight, 32),
		ringMat,
	);
	ring.position.y = -0.005 - upperLength - ringHeight / 2;
	group.add(ring);

	// Engraved spec band — black anodised cylinder with canvas texture
	const specLength = length * 0.36;
	const specMat = new THREE.MeshStandardMaterial({
		map: makeObjectiveSpecLabel(power),
		metalness: 0.6,
		roughness: 0.42,
	});
	const specBand = new THREE.Mesh(
		new THREE.CylinderGeometry(0.009, 0.0085, specLength, 32),
		specMat,
	);
	specBand.position.y = -0.005 - upperLength - ringHeight - specLength / 2;
	group.add(specBand);

	// Tip — narrower stepped chrome
	const tipLength = length - 0.005 - upperLength - ringHeight - specLength;
	const tip = new THREE.Mesh(
		new THREE.CylinderGeometry(0.006, 0.005, tipLength, 24),
		_chromeMat,
	);
	tip.position.y = -length + tipLength / 2;
	group.add(tip);

	return group;
}

/** Nosepiece turret — rotating Group containing four objectives. The
 *  Group origin is at the rotation axis so it spins cleanly. */
function makeNosepiece() {
	const group = new THREE.Group();
	group.name = 'Microscope_Nosepiece';

	// Black anodised turret body
	const turret = new THREE.Mesh(
		new THREE.CylinderGeometry(0.045, 0.040, 0.020, 48),
		_knobMat,
	);
	group.add(turret);

	// Knurled chrome ring on top of the turret (rotation grip)
	const chromeRing = new THREE.Mesh(
		new THREE.CylinderGeometry(0.046, 0.046, 0.005, 48),
		_chromeMat,
	);
	chromeRing.position.y = 0.0125;
	group.add(chromeRing);

	// 32 small ridges on the chrome rotation ring — single InstancedMesh
	const turretRidgeGeom = new THREE.BoxGeometry(0.0012, 0.005, 0.003);
	const ridgeCount = 32;
	const turretRidges = new THREE.InstancedMesh(
		turretRidgeGeom,
		_chromeMat,
		ridgeCount,
	);
	const dummy = new THREE.Object3D();
	for (let i = 0; i < ridgeCount; i++) {
		const a = (i / ridgeCount) * Math.PI * 2;
		dummy.position.set(Math.cos(a) * 0.0468, 0.0125, Math.sin(a) * 0.0468);
		dummy.rotation.set(0, -a, 0);
		dummy.updateMatrix();
		turretRidges.setMatrixAt(i, dummy.matrix);
	}
	turretRidges.instanceMatrix.needsUpdate = true;
	group.add(turretRidges);

	// Index dot on the front (red — shows the active objective alignment)
	const indexDot = new THREE.Mesh(
		new THREE.SphereGeometry(0.0025, 12, 8),
		_indicatorMat,
	);
	indexDot.position.set(0, 0, 0.046);
	group.add(indexDot);

	// 4 objectives, evenly spaced around the turret. Each hangs down
	// from the turret bottom (y = -0.010). All objectives share the
	// SAME physical length so the kid can identify the active one by
	// the colour band only — and optics.js drops the active one ≈ 8 mm
	// further down to make the selection unambiguous.
	const OBJ_LEN = 0.034;
	const objectives = [
		{ power: '4x',   ring: _ringMat4x,   length: OBJ_LEN, label: 'Microscope_Objective_4x' },
		{ power: '10x',  ring: _ringMat10x,  length: OBJ_LEN, label: 'Microscope_Objective_10x' },
		{ power: '40x',  ring: _ringMat40x,  length: OBJ_LEN, label: 'Microscope_Objective_40x' },
		{ power: '100x', ring: _ringMat100x, length: OBJ_LEN, label: 'Microscope_Objective_100x' },
	];
	objectives.forEach((def, i) => {
		const a = (i / objectives.length) * Math.PI * 2 - Math.PI / 2;
		const obj = makeObjective(def.power, def.ring, def.length, def.label);
		obj.position.set(Math.cos(a) * 0.024, -0.010, Math.sin(a) * 0.024);
		group.add(obj);
	});

	return group;
}

/** Eyepiece tube — chrome-collar-bracketed black tube above the
 *  nosepiece. Bottom at group origin so the caller can position +
 *  tilt it as one unit. */
function makeEyepieceTube() {
	const group = new THREE.Group();
	group.name = 'Microscope_EyepieceTube';

	// Chrome lower collar (where the tube meets the arm)
	const lowerCollar = new THREE.Mesh(
		new THREE.CylinderGeometry(0.020, 0.022, 0.012, 32),
		_chromeMat,
	);
	lowerCollar.position.y = 0.006;
	group.add(lowerCollar);

	// Black tube body
	const tube = new THREE.Mesh(
		new THREE.CylinderGeometry(0.018, 0.018, 0.040, 32),
		_knobMat,
	);
	tube.position.y = 0.012 + 0.020;
	group.add(tube);

	// Chrome upper collar (where the eyepiece slots in)
	const upperCollar = new THREE.Mesh(
		new THREE.CylinderGeometry(0.0185, 0.0185, 0.005, 32),
		_chromeMat,
	);
	upperCollar.position.y = 0.012 + 0.040 + 0.0025;
	group.add(upperCollar);

	return group;
}

/** Eyepiece — top section the user looks through. Body cylinder +
 *  rubber eyecup + recessed glass lens. */
function makeEyepiece() {
	const group = new THREE.Group();
	group.name = 'Microscope_Eyepiece';

	// Body section that slots into the tube
	const body = new THREE.Mesh(
		new THREE.CylinderGeometry(0.017, 0.017, 0.014, 32),
		_knobMat,
	);
	body.position.y = 0.007;
	group.add(body);

	// Chrome band
	const band = new THREE.Mesh(
		new THREE.CylinderGeometry(0.0175, 0.0175, 0.004, 32),
		_chromeMat,
	);
	band.position.y = 0.016;
	group.add(band);

	// Rubber eyecup — wider at the top
	const eyecup = new THREE.Mesh(
		new THREE.CylinderGeometry(0.022, 0.018, 0.012, 32),
		_rubberMat,
	);
	eyecup.position.y = 0.024;
	group.add(eyecup);

	// Recessed glass lens (the SINGLE transparent material in the scope)
	const lens = new THREE.Mesh(
		new THREE.CylinderGeometry(0.014, 0.014, 0.003, 24),
		_lensMat,
	);
	lens.position.y = 0.030;
	// Named so optics.js can do `getObjectByName('Microscope_Eyepiece_Lens')`
	// and use the lens FACE as the proximity anchor for the eyepiece
	// view (instead of the eyepiece group's mounting origin, which sits
	// 3 cm lower).
	lens.name = 'Microscope_Eyepiece_Lens';
	group.add(lens);

	return group;
}

// =====================================================================
// PUBLIC ENTRY POINT
// =====================================================================

/**
 * Creates a complete procedural compound microscope.
 *
 * @returns {THREE.Group} group with all named parts attached
 */
export function createMicroscope() {
	const root = new THREE.Group();
	root.name = 'Microscope';

	// Base + light housing (y 0.000 → 0.062)
	root.add(makeBase());

	// All sub-assemblies above the base were lowered by 5 cm to bring
	// the diaphragm and the LED light source closer together — the
	// arm's lower section was shortened by the same amount (in makeArm),
	// so the eyepiece tube still sits flush on top of the bracket.

	// Diaphragm (under the stage at y ≈ 0.105)
	const diaphragm = makeDiaphragm();
	diaphragm.position.set(0, 0.105, 0.020);
	root.add(diaphragm);

	// Stage (above the diaphragm with aperture, y top ≈ 0.142)
	const stage = makeStage();
	stage.position.set(0, 0.130, 0.020);
	root.add(stage);

	// Arm (vertical post + upper forward bracket)
	root.add(makeArm());

	// Coarse + Fine focus knobs concentric on a horizontal axle
	root.add(makeCoarseKnob());
	root.add(makeFineKnob());

	// Nosepiece turret + objectives. Origin at y=0.250 — the chrome
	// ring on top of the turret sits flush against the bracket's
	// forward bottom (at y≈0.260), so the turret reads as bolted into
	// the bracket instead of dangling below it.
	const nosepiece = makeNosepiece();
	nosepiece.position.set(0, 0.250, 0.030);
	root.add(nosepiece);

	// Eyepiece tube — tilted 12° forward (toward the user) so the
	// student looks down into it comfortably from in front.
	const tilt = (12 / 180) * Math.PI;
	const eyeTube = makeEyepieceTube();
	eyeTube.rotation.x = tilt;
	eyeTube.position.set(0, 0.295, 0.030);
	root.add(eyeTube);

	// Eyepiece — sits at the top of the tilted tube. Position uses
	// trigonometry to land at the tube's upper end after tilt.
	const tubeHeight = 0.062;
	const eyepiece = makeEyepiece();
	eyepiece.rotation.x = tilt;
	eyepiece.position.set(
		0,
		0.295 + Math.cos(tilt) * tubeHeight,
		0.030 + Math.sin(tilt) * tubeHeight,
	);
	root.add(eyepiece);

	return root;
}
