/**
 * @file Sweet-spot reward visuals for Explore mode.
 *
 * Two effects:
 *
 *   • Sparkle particle burst — 18 small star sprites fan outward from
 *     the slide centre, rising slightly and fading. Drives "you nailed
 *     it" celebration when the kid lands the focus on 0.5.
 *
 *   • Praise text float — a "Сайн!" sprite rises from the slide centre
 *     and fades, reinforcing the win in language the kid reads.
 *
 * Both are scene-attached (NOT camera-attached) because they're tied
 * to the position of the slide, not the kid's gaze. They're rendered
 * with depthTest: false so even if the eyepiece overlay is up, the
 * praise still reads clearly.
 */
import * as THREE from 'three';

// =====================================================================
// SPARKLE
// =====================================================================

const SPARKLE_COUNT = 18;
const SPARKLE_DURATION = 1.0;

export function createSparkle({ scene }) {
	const tex = makeStarTexture();
	const mat = new THREE.MeshBasicMaterial({
		map: tex,
		transparent: true,
		depthTest: false,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		toneMapped: false,
		side: THREE.DoubleSide,
	});

	const mesh = new THREE.InstancedMesh(
		new THREE.PlaneGeometry(0.012, 0.012),
		mat,
		SPARKLE_COUNT,
	);
	mesh.frustumCulled = false;
	mesh.renderOrder = 13;
	mesh.visible = false;
	scene.add(mesh);

	let active = null; // { age, particles, origin }
	const _dummy = new THREE.Object3D();

	function trigger(worldPos, camera) {
		const particles = [];
		for (let i = 0; i < SPARKLE_COUNT; i++) {
			const angle = Math.random() * Math.PI * 2;
			const speed = 0.10 + Math.random() * 0.18;
			particles.push({
				angle,
				speed,
				vy: 0.08 + Math.random() * 0.16,
				scale: 0.7 + Math.random() * 0.6,
				rotSpeed: (Math.random() - 0.5) * 8,
			});
		}
		active = {
			age: 0,
			particles,
			origin: worldPos.clone(),
			camera,
		};
		mesh.visible = true;
	}

	function update(delta) {
		if (!active) return;
		active.age += delta;
		const t = active.age / SPARKLE_DURATION;
		if (t >= 1) {
			mesh.visible = false;
			active = null;
			return;
		}
		const fade = 1 - t;
		mat.opacity = fade;

		// Camera-billboard quaternion — derived once per frame so all
		// 18 instances face the user.
		const billboard = new THREE.Quaternion();
		if (active.camera) active.camera.getWorldQuaternion(billboard);

		for (let i = 0; i < active.particles.length; i++) {
			const p = active.particles[i];
			const r = p.speed * active.age * (1 + 0.5 * t);
			const x = active.origin.x + Math.cos(p.angle) * r;
			const y = active.origin.y + p.vy * active.age - 0.6 * active.age * active.age;
			const z = active.origin.z + Math.sin(p.angle) * r;
			_dummy.position.set(x, y, z);
			_dummy.quaternion.copy(billboard);
			_dummy.rotateZ(active.age * p.rotSpeed);
			const s = p.scale * fade;
			_dummy.scale.set(s, s, 1);
			_dummy.updateMatrix();
			mesh.setMatrixAt(i, _dummy.matrix);
		}
		mesh.instanceMatrix.needsUpdate = true;
	}

	function dispose() {
		scene.remove(mesh);
		mesh.geometry.dispose();
		mat.dispose();
		tex.dispose();
		active = null;
	}

	return { trigger, update, dispose };
}

function makeStarTexture() {
	const canvas = document.createElement('canvas');
	canvas.width = 64;
	canvas.height = 64;
	const ctx = canvas.getContext('2d');

	// Hot bright core
	const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
	grad.addColorStop(0, 'rgba(255, 248, 180, 1)');
	grad.addColorStop(0.35, 'rgba(255, 220, 80, 0.85)');
	grad.addColorStop(0.7, 'rgba(0, 229, 199, 0.45)');
	grad.addColorStop(1, 'rgba(0, 229, 199, 0)');
	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, 64, 64);

	// Cross-hair spike — gives the sparkle its star feel
	ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
	ctx.lineWidth = 2;
	ctx.lineCap = 'round';
	ctx.beginPath();
	ctx.moveTo(32, 4);  ctx.lineTo(32, 60);
	ctx.moveTo(4, 32);  ctx.lineTo(60, 32);
	ctx.stroke();

	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.minFilter = THREE.LinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.generateMipmaps = false;
	return tex;
}

// =====================================================================
// PRAISE TEXT — "Сайн!"
// =====================================================================

const PRAISE_DURATION = 1.5;

export function createPraiseText({ scene }) {
	const canvas = document.createElement('canvas');
	canvas.width = 512;
	canvas.height = 256;
	const ctx = canvas.getContext('2d');
	ctx.font = 'bold 130px Georgia';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	// Gold-ish fill with white outline so it reads against any specimen
	ctx.lineWidth = 8;
	ctx.strokeStyle = '#ffffff';
	ctx.strokeText('Сайн!', 256, 128);
	const grad = ctx.createLinearGradient(0, 60, 0, 196);
	grad.addColorStop(0, '#fff299');
	grad.addColorStop(1, '#ffae42');
	ctx.fillStyle = grad;
	ctx.fillText('Сайн!', 256, 128);

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
	sprite.scale.set(0.18, 0.09, 1);
	sprite.renderOrder = 14;
	sprite.visible = false;
	scene.add(sprite);

	let active = null;

	function trigger(worldPos) {
		sprite.position.copy(worldPos);
		sprite.position.y += 0.04;
		active = { age: 0, originY: sprite.position.y };
		sprite.visible = true;
	}

	function update(delta) {
		if (!active) return;
		active.age += delta;
		const t = active.age / PRAISE_DURATION;
		if (t >= 1) {
			sprite.visible = false;
			active = null;
			return;
		}
		// Float upward, scale up briefly, then fade
		sprite.position.y = active.originY + t * 0.10;
		const grow = t < 0.25 ? t / 0.25 : 1;
		const baseS = 0.16 + 0.06 * grow;
		sprite.scale.set(baseS * 2, baseS, 1);
		mat.opacity = t < 0.25 ? grow : Math.max(0, 1 - (t - 0.25) / 0.75);
	}

	function dispose() {
		scene.remove(sprite);
		mat.dispose();
		tex.dispose();
		active = null;
	}

	return { trigger, update, dispose };
}
