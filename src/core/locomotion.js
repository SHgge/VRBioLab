/**
 * @file VR thumbstick locomotion.
 *
 * Per-frame reads the XR session's input-source gamepad axes and
 * mutates the player rig:
 *
 *   • Left stick — full 360° horizontal movement:
 *       Y axis  → walk forward / backward along camera-forward.
 *       X axis  → strafe left / right along camera-right.
 *     A diagonal push moves the user diagonally, so the user can
 *     reach any spot on the floor without first turning.
 *   • Right stick X → smooth yaw around the user's HEAD world
 *     position. We rotate the rig in place so the head stays put
 *     while the world spins — without this fix the user would orbit
 *     in a circle around the rig's origin (which sits 1.6 m below
 *     and a meter behind the head), and the visible hand drifts on a
 *     different circle than the camera, breaking the "my hands are
 *     attached to my body" feel the user reported.
 *
 * Desktop mode is a no-op — OrbitControls handles the desktop camera
 * and a thumbstick isn't available.
 */
import * as THREE from 'three';

/** Walking speed at full stick deflection (metres / second). */
const MOVE_SPEED = 1.0;

/** Yaw speed at full stick deflection (radians / second).
 *  π rad/s ≈ 180°/s — comfortable for non-snap rotation. */
const ROT_SPEED = Math.PI;

/** Stick deflection below which we treat the input as zero. Avoids
 *  drift from imperfect controller hardware calibration. */
const DEADZONE = 0.15;

const _camForward = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);

const _headWorld = new THREE.Vector3();
const _playerToHead = new THREE.Vector3();

/**
 * @param {number} delta  Frame delta in seconds (THREE.Clock).
 * @param {{ renderer: THREE.WebGLRenderer,
 *           player: THREE.Object3D,
 *           camera: THREE.Camera }} globals
 */
export function updateLocomotion(delta, { renderer, player, camera }) {
	if (!renderer.xr.isPresenting) return;
	const session = renderer.xr.getSession();
	if (!session) return;

	// Use the XR head camera for "where the user is actually looking".
	// In a session, three.js exposes a composite XRArrayCamera whose
	// world matrix tracks the headset pose composed with the rig.
	const headCam = renderer.xr.getCamera ? renderer.xr.getCamera() : camera;

	for (const source of session.inputSources) {
		const axes = source.gamepad && source.gamepad.axes;
		if (!axes || axes.length < 4) continue;

		// Quest Touch / Quest 3S maps the thumbstick to axes 2 (X) and
		// axes 3 (Y). axes 0,1 are the (unused on Quest) touchpad.
		const stickX = axes[2] || 0;
		const stickY = axes[3] || 0;

		if (source.handedness === 'left') {
			// 360° horizontal movement: forward/back AND strafe left/right.
			const movingY = Math.abs(stickY) > DEADZONE;
			const movingX = Math.abs(stickX) > DEADZONE;
			if (movingY || movingX) {
				// Camera-forward (horizontal projection) — uses the headset
				// pose, so movement always tracks where the user is LOOKING,
				// not where the rig is facing.
				headCam.getWorldDirection(_camForward);
				_camForward.y = 0;
				if (_camForward.lengthSq() > 1e-6) {
					_camForward.normalize();
					// Camera-right = forward × world-up (right-handed)
					_camRight.crossVectors(_camForward, _worldUp).normalize();
					if (movingY) {
						// Quest pushes forward = -Y → flip sign so that
						// "stick up" walks along camera forward.
						player.position.addScaledVector(
							_camForward,
							-stickY * MOVE_SPEED * delta,
						);
					}
					if (movingX) {
						// Stick right (+X) → strafe right
						player.position.addScaledVector(
							_camRight,
							stickX * MOVE_SPEED * delta,
						);
					}
				}
			}
		} else if (source.handedness === 'right') {
			// Yaw rotation pivots around the user's HEAD world position.
			// Without this compensation, the rig spins around its own
			// origin (1.6 m below the head), so the head sweeps along an
			// arc and the hands sweep along a different arc — visually
			// "the hand and the eye don't move together," which is what
			// the user reported.
			if (Math.abs(stickX) > DEADZONE) {
				const dTheta = -stickX * ROT_SPEED * delta;

				headCam.getWorldPosition(_headWorld);
				// Vector from the head world to the rig origin.
				_playerToHead.subVectors(player.position, _headWorld);
				// Rotate that vector around world-up by the same angle…
				_playerToHead.applyAxisAngle(_worldUp, dTheta);
				// …and reattach it to the (unchanged) head position. The
				// rig now sits at a new world location chosen so the
				// rotated rig still places the head where it was.
				player.position.copy(_headWorld).add(_playerToHead);
				player.rotation.y += dTheta;
			}
		}
	}

	// Defensive — make sure children's world matrices reflect the new
	// rig pose THIS frame, before any reads (e.g. controller proximity
	// checks in optics) consume them.
	player.updateMatrixWorld(true);
}
