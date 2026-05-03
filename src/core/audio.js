/**
 * @file Procedural sound effects for the microscope simulator.
 *
 * Everything is synthesised at play-time with the Web Audio API — no
 * .mp3 / .wav assets to ship, no hosting concerns, and we stay friendly
 * to the Quest 3S download budget. Each call produces a short cue
 * tuned for kid-immediate clarity:
 *
 *   playSwitchClick()    — sharp downward transient (light switch flip)
 *   playKnobTick()       — quiet high-pitched tick (knob detent)
 *   playSlideClink()     — bright glassy clink (slide settling on stage)
 *   playClipsSnap()      — metallic two-tap (spring clips clamping)
 *   playSweetSpotChime() — ascending two-note chime (in-focus reward)
 *   playStepDing()       — 660→990 Hz ding (workflow step advanced)
 *
 * The AudioContext is lazy — it must be unlocked by a user gesture
 * (browser policy), so we resume it on every play just in case it has
 * been suspended in the background.
 */

let _ctx = null;
let _master = null;

function getCtx() {
	if (!_ctx) {
		try {
			_ctx = new (window.AudioContext || window.webkitAudioContext)();
			_master = _ctx.createGain();
			_master.gain.value = 0.55;
			_master.connect(_ctx.destination);
		} catch {
			return null;
		}
	}
	if (_ctx.state === 'suspended') _ctx.resume().catch(() => {});
	return _ctx;
}

/** Single oscillator + gain envelope helper. */
function blip({ duration, freqStart, freqEnd, peak = 0.20, type = 'sine', attack = 0.005 }) {
	const ctx = getCtx();
	if (!ctx) return;
	const t = ctx.currentTime;
	const osc = ctx.createOscillator();
	osc.type = type;
	osc.frequency.setValueAtTime(freqStart, t);
	if (freqEnd !== undefined && freqEnd !== freqStart) {
		osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + duration);
	}
	const gain = ctx.createGain();
	gain.gain.setValueAtTime(0, t);
	gain.gain.linearRampToValueAtTime(peak, t + attack);
	gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
	osc.connect(gain).connect(_master);
	osc.start(t);
	osc.stop(t + duration + 0.02);
}

export function playSwitchClick() {
	// Sharp tonic transient — square wave because it reads as "mechanical"
	blip({ duration: 0.06, freqStart: 800, freqEnd: 130, peak: 0.30, type: 'square', attack: 0.003 });
}

export function playKnobTick() {
	// Quiet tick — stays under the haptic feedback so it doesn't fatigue
	// the kid's ears as the knob spins.
	blip({ duration: 0.04, freqStart: 1500, freqEnd: 1500, peak: 0.07, type: 'square', attack: 0.001 });
}

export function playDetentClick() {
	// Stronger thud for nosepiece detents — the kid should feel a beat
	// when the objective changes.
	blip({ duration: 0.10, freqStart: 320, freqEnd: 180, peak: 0.28, type: 'triangle' });
}

export function playSlideClink() {
	// Two stacked tones at 2.1k + 3.1k = bright glass-on-glass
	blip({ duration: 0.20, freqStart: 2100, freqEnd: 1500, peak: 0.18, type: 'sine' });
	blip({ duration: 0.18, freqStart: 3100, freqEnd: 2300, peak: 0.10, type: 'sine' });
}

export function playGlassShatter() {
	// Three quick descending crack sounds + a whoosh of high-frequency
	// noise — reads as "the slide just broke under the lens", warning
	// the kid that they're misusing the coarse knob at high mag.
	const ctx = getCtx();
	if (!ctx) return;
	const t = ctx.currentTime;

	// Three sharp transient cracks at 0/40/85 ms
	const cracks = [
		{ start: 0.000, freqStart: 2400, freqEnd: 600,  peak: 0.32 },
		{ start: 0.040, freqStart: 3000, freqEnd: 800,  peak: 0.28 },
		{ start: 0.085, freqStart: 1800, freqEnd: 400,  peak: 0.24 },
	];
	for (const c of cracks) {
		const osc = ctx.createOscillator();
		osc.type = 'square';
		osc.frequency.setValueAtTime(c.freqStart, t + c.start);
		osc.frequency.exponentialRampToValueAtTime(c.freqEnd, t + c.start + 0.05);
		const g = ctx.createGain();
		g.gain.setValueAtTime(0, t + c.start);
		g.gain.linearRampToValueAtTime(c.peak, t + c.start + 0.003);
		g.gain.exponentialRampToValueAtTime(0.001, t + c.start + 0.07);
		osc.connect(g).connect(_master);
		osc.start(t + c.start);
		osc.stop(t + c.start + 0.10);
	}

	// Brief noise burst — synthesised via a fast amplitude on a sawtooth
	// summed of two slightly detuned oscs (cheap white-noise approximation).
	const noiseDur = 0.20;
	const noise1 = ctx.createOscillator();
	noise1.type = 'sawtooth';
	noise1.frequency.setValueAtTime(2900, t + 0.10);
	const noise2 = ctx.createOscillator();
	noise2.type = 'sawtooth';
	noise2.frequency.setValueAtTime(3700, t + 0.10);
	const ng = ctx.createGain();
	ng.gain.setValueAtTime(0, t + 0.10);
	ng.gain.linearRampToValueAtTime(0.09, t + 0.115);
	ng.gain.exponentialRampToValueAtTime(0.001, t + 0.10 + noiseDur);
	noise1.connect(ng);
	noise2.connect(ng);
	ng.connect(_master);
	noise1.start(t + 0.10); noise1.stop(t + 0.10 + noiseDur + 0.02);
	noise2.start(t + 0.10); noise2.stop(t + 0.10 + noiseDur + 0.02);
}

export function playClipsSnap() {
	// Two-tap metallic — first short metallic transient, then a settle
	const ctx = getCtx();
	if (!ctx) return;
	blip({ duration: 0.07, freqStart: 1800, freqEnd: 900, peak: 0.22, type: 'square' });
	const t = ctx.currentTime;
	setTimeout(() => {
		blip({ duration: 0.08, freqStart: 1400, freqEnd: 700, peak: 0.20, type: 'square' });
	}, 70);
	void t;
}

export function playSweetSpotChime() {
	// Bright ascending C6 → E6 — pleasant and reads as "yes!"
	const ctx = getCtx();
	if (!ctx) return;
	const t = ctx.currentTime;
	const notes = [
		{ freq: 1046, start: 0.00, dur: 0.22 },
		{ freq: 1568, start: 0.10, dur: 0.32 },
	];
	for (const n of notes) {
		const osc = ctx.createOscillator();
		osc.type = 'sine';
		osc.frequency.setValueAtTime(n.freq, t + n.start);
		const g = ctx.createGain();
		g.gain.setValueAtTime(0, t + n.start);
		g.gain.linearRampToValueAtTime(0.22, t + n.start + 0.012);
		g.gain.exponentialRampToValueAtTime(0.001, t + n.start + n.dur);
		osc.connect(g).connect(_master);
		osc.start(t + n.start);
		osc.stop(t + n.start + n.dur + 0.04);
	}
}

export function playStepDing() {
	const ctx = getCtx();
	if (!ctx) return;
	const t = ctx.currentTime;
	const osc = ctx.createOscillator();
	osc.type = 'sine';
	osc.frequency.setValueAtTime(660, t);
	osc.frequency.exponentialRampToValueAtTime(990, t + 0.05);
	const g = ctx.createGain();
	g.gain.setValueAtTime(0, t);
	g.gain.linearRampToValueAtTime(0.20, t + 0.01);
	g.gain.exponentialRampToValueAtTime(0.001, t + 0.40);
	osc.connect(g).connect(_master);
	osc.start(t);
	osc.stop(t + 0.42);
}
