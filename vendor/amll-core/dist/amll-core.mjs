import { Application as e } from "@pixi/app";
import { Texture as t, utils as n } from "@pixi/core";
import { Container as r } from "@pixi/display";
import { BlurFilter as i } from "@pixi/filter-blur";
import { BulgePinchFilter as a } from "@pixi/filter-bulge-pinch";
import { ColorMatrixFilter as o } from "@pixi/filter-color-matrix";
import { Sprite as s } from "@pixi/sprite";
//#region src/bg-render/base.ts
var c = class {};
function l(e) {
	return Math.max(1, e);
}
var u = class extends c {
	canvas;
	observer;
	flowSpeed = 1;
	currerntRenderScale = .75;
	constructor(e) {
		super(), this.canvas = e, this.observer = new ResizeObserver(() => {
			let t = l(e.clientWidth * window.devicePixelRatio * this.currerntRenderScale), n = l(e.clientHeight * window.devicePixelRatio * this.currerntRenderScale);
			this.onResize(t, n);
		}), this.observer.observe(e);
	}
	setRenderScale(e) {
		this.currerntRenderScale = e, this.onResize(this.canvas.clientWidth * window.devicePixelRatio * this.currerntRenderScale, this.canvas.clientHeight * window.devicePixelRatio * this.currerntRenderScale);
	}
	onResize(e, t) {
		this.canvas.width = e, this.canvas.height = t;
	}
	setFlowSpeed(e) {
		this.flowSpeed = e;
	}
	disconnectResizeObserver() {
		this.observer.disconnect();
	}
	dispose() {
		this.disconnectResizeObserver(), this.canvas.remove();
	}
	getElement() {
		return this.canvas;
	}
}, d = class {
	label;
	gl;
	program;
	vertexShader;
	fragmentShader;
	attrs;
	uniformLocations = /* @__PURE__ */ new Map();
	constructor(e, t, n, r = "unknown") {
		this.label = r, this.gl = e;
		let i = this.createShader(e.VERTEX_SHADER, t), a;
		try {
			a = this.createShader(e.FRAGMENT_SHADER, n), this.program = this.createProgram(i, a);
		} catch (t) {
			throw e.deleteShader(i), a && e.deleteShader(a), t;
		}
		this.vertexShader = i, this.fragmentShader = a;
		let o = e.getProgramParameter(this.program, e.ACTIVE_ATTRIBUTES), s = {};
		for (let t = 0; t < o; t++) {
			let n = e.getActiveAttrib(this.program, t);
			if (!n) continue;
			let r = e.getAttribLocation(this.program, n.name);
			r !== -1 && (s[n.name] = r);
		}
		this.attrs = s;
	}
	createShader(e, t) {
		let n = this.gl, r = n.createShader(e);
		if (!r) throw Error("Failed to create shader");
		if (n.shaderSource(r, t), n.compileShader(r), !n.getShaderParameter(r, n.COMPILE_STATUS)) {
			let t = /* @__PURE__ */ Error(`Failed to compile shader for type ${e} "${this.label}": ${n.getShaderInfoLog(r)}`);
			throw n.deleteShader(r), t;
		}
		return r;
	}
	createProgram(e, t) {
		let n = this.gl, r = n.createProgram();
		if (!r) throw Error("Failed to create program");
		if (n.attachShader(r, e), n.attachShader(r, t), n.linkProgram(r), !n.getProgramParameter(r, n.LINK_STATUS)) {
			let e = n.getProgramInfoLog(r);
			throw n.deleteProgram(r), Error(`Failed to link program "${this.label}": ${e}`);
		}
		return r;
	}
	use() {
		this.gl.useProgram(this.program);
	}
	notFoundUniforms = /* @__PURE__ */ new Set();
	warnUniformNotFound(e) {
		this.notFoundUniforms.has(e) || (this.notFoundUniforms.add(e), console.warn(`Failed to get uniform location for program "${this.label}": ${e}`));
	}
	getUniformLocation(e) {
		let t = this.uniformLocations.get(e);
		return t === void 0 && (t = this.gl.getUniformLocation(this.program, e), this.uniformLocations.set(e, t)), t === null && this.warnUniformNotFound(e), t;
	}
	setUniform1f(e, t) {
		let n = this.getUniformLocation(e);
		n !== null && this.gl.uniform1f(n, t);
	}
	setUniform2f(e, t, n) {
		let r = this.getUniformLocation(e);
		r !== null && this.gl.uniform2f(r, t, n);
	}
	setUniform3f(e, t, n, r) {
		let i = this.getUniformLocation(e);
		i !== null && this.gl.uniform3f(i, t, n, r);
	}
	setUniform4f(e, t, n, r, i) {
		let a = this.getUniformLocation(e);
		a !== null && this.gl.uniform4f(a, t, n, r, i);
	}
	setUniform1i(e, t) {
		let n = this.getUniformLocation(e);
		n !== null && this.gl.uniform1i(n, t);
	}
	setUniform1fv(e, t) {
		let n = this.getUniformLocation(e);
		n !== null && this.gl.uniform1fv(n, t);
	}
	setUniform3fv(e, t) {
		let n = this.getUniformLocation(e);
		n !== null && this.gl.uniform3fv(n, t);
	}
	dispose() {
		let e = this.gl;
		e.deleteShader(this.vertexShader), e.deleteShader(this.fragmentShader), e.deleteProgram(this.program), this.uniformLocations.clear();
	}
};
//#endregion
//#region src/utils/resource.ts
function f(e) {
	return new Promise((t, n) => {
		let r = document.createElement("img");
		r.onload = () => t(r), r.onerror = n, r.src = e, r.crossOrigin = "anonymous", r.loading = "eager";
	});
}
function p(e) {
	return new Promise((t, n) => {
		let r = document.createElement("video"), i = !1, a = !1, o = !1;
		r.addEventListener("playing", () => {
			i = !0, s();
		}, !0), r.addEventListener("timeupdate", () => {
			a = !0, s();
		}, !0), r.addEventListener("error", (e) => {
			o = !0, n(e);
		}, !0);
		function s() {
			i && a && !o && t(r);
		}
		r.src = e, r.playsInline = !0, r.crossOrigin = "anonymous", r.autoplay = !0, r.loop = !0, r.muted = !0, r.play();
	});
}
function m(e, t = !1) {
	return t ? p(e) : f(e);
}
function h(e) {
	return new Promise((t, n) => {
		(e instanceof HTMLImageElement ? e.complete : e.readyState >= 3) ? t(e) : (e.onload = () => t(e), e.onerror = n);
	});
}
//#endregion
//#region src/bg-render/palette/color-utilities.ts
function g(e) {
	let [t, n, r] = e, i = Math.max(t, n, r), a = Math.min(t, n, r), o = i * 100 / 255;
	if (i === a) return {
		h: 0,
		s: 0,
		v: o
	};
	let s = (i - a) / i * 100, c = 0;
	return c = i === t ? 60 * (n - r) / (i - a) : i === n ? 60 * (2 + (r - t) / (i - a)) : 60 * (4 + (t - n) / (i - a)), c < 0 && (c += 360), {
		h: c,
		s,
		v: o
	};
}
function _(e) {
	let t = e.h === 360 ? 0 : e.h, n = Math.floor(t / 60) % 6, r = t / 60 - n, i = e.v / 100 * (1 - e.s / 100) * 255, a = e.v / 100 * (1 - r * (e.s / 100)) * 255, o = e.v / 100 * (1 - (1 - r) * (e.s / 100)) * 255, s = e.v * 255 / 100;
	return [
		[
			s,
			o,
			i
		],
		[
			a,
			s,
			i
		],
		[
			i,
			s,
			o
		],
		[
			i,
			a,
			s
		],
		[
			o,
			i,
			s
		],
		[
			s,
			i,
			a
		]
	][n] ?? [
		s,
		i,
		a
	];
}
function v(e) {
	let [t, n, r] = e, i = t / 255, a = n / 255, o = r / 255;
	return [
		i * .4124 + a * .3576 + o * .1805,
		i * .2126 + a * .7152 + o * .0722,
		i * .0193 + a * .1192 + o * .9505
	];
}
function y(e) {
	let [t, n, r] = e;
	return [
		(t * 3.2406 - n * 1.5372 - r * .4986) * 255,
		(-t * .9689 + n * 1.8758 + r * .0415) * 255,
		(t * .0557 - n * .204 + r * 1.057) * 255
	];
}
var b = {
	x: .95047,
	y: 1,
	z: 1.0883
};
function x(e) {
	return e > .008856 ? Math.cbrt(e) : 7.787 * e + 16 / 116;
}
function S(e) {
	let [t, n, r] = e;
	return [
		116 * x(n / b.y) - 16,
		500 * (x(t / b.x) - x(n / b.y)),
		200 * (x(n / b.y) - x(r / b.z))
	];
}
function C(e) {
	let t = 6 / 29, [n, r, i] = e, a = (n + 16) / 116, o = a + r / 500, s = a - i / 200;
	return [
		o > t ? b.x * o * o * o : (o - 16 / 116) * 3 * t * t * b.x,
		a > t ? b.y * a * a * a : (a - 16 / 116) * 3 * t * t * b.y,
		s > t ? b.z * s * s * s : (s - 16 / 116) * 3 * t * t * b.z
	];
}
function w(e) {
	return S(v(e));
}
function T(e) {
	return y(C(e));
}
function E(e) {
	return e <= .04045 ? e / 12.92 : ((e + .055) / 1.055) ** 2.4;
}
function D(e) {
	let [t, n, r] = e, i = E(t), a = E(n), o = E(r), s = Math.cbrt(.4122214708 * i + .5363325363 * a + .0514459929 * o), c = Math.cbrt(.2119034982 * i + .6806995451 * a + .1073969566 * o), l = Math.cbrt(.0883024619 * i + .2817188376 * a + .6299787005 * o);
	return [
		.2104542553 * s + .793617785 * c - .0040720468 * l,
		1.9779984951 * s - 2.428592205 * c + .4505937099 * l,
		.0259040371 * s + .7827717662 * c - .808675766 * l
	];
}
function O(e) {
	return e <= 216 / 24389 ? 24389 / 27 * e : Math.cbrt(e) * 116 - 16;
}
function k(e) {
	let [t, n, r] = e;
	return O(.2126 * E(t / 255) + .7152 * E(n / 255) + .0722 * E(r / 255));
}
function A(e) {
	return k(e) <= 40;
}
function j(e) {
	return k(e) >= 60;
}
function M(e) {
	return k(e) <= 50;
}
function N(e, t) {
	let [n, r, i] = e, [a, o, s] = t, c = n - a, l = r - o, u = i - s;
	return c * c + l * l + u * u;
}
//#endregion
//#region src/bg-render/palette/kmeans.ts
function P(e) {
	let t = e >>> 0;
	return () => {
		t = t + 1831565813 >>> 0;
		let e = t;
		return e = Math.imul(e ^ e >>> 15, e | 1), e ^= e + Math.imul(e ^ e >>> 7, e | 61), ((e ^ e >>> 14) >>> 0) / 4294967296;
	};
}
function F(e) {
	let t = 2166136261;
	for (let { color: n, count: r } of e) for (let e of [...n, r]) t ^= Math.round(e) & 65535, t = Math.imul(t, 16777619) >>> 0;
	return t >>> 0;
}
function I(e) {
	return e.some((e) => e <= 250);
}
function ee(e, t) {
	let n = e.filter(t);
	return n.length > 0 ? n : [...e];
}
function te(e) {
	return e.map((e) => Math.min(255, Math.max(0, e)));
}
function ne(e) {
	let t = /* @__PURE__ */ new Map();
	for (let n of e) {
		let e = `${n.color[0]},${n.color[1]},${n.color[2]}`, r = t.get(e);
		r ? r.count += n.count : t.set(e, {
			color: [...n.color],
			count: n.count
		});
	}
	return [...t.values()];
}
function re(e) {
	return e.map((e) => ({
		color: w(e.color),
		count: e.count
	}));
}
function ie(e, t) {
	return e.every((e, n) => e === t[n]);
}
function ae(e, t) {
	let n = 0, r = Infinity;
	for (let i = 0; i < t.length; i++) {
		let a = N(e, t[i]);
		a < r && (n = i, r = a);
	}
	return n;
}
function oe(e, t) {
	let n = [
		0,
		0,
		0
	], r = -Infinity;
	for (let { color: i } of e) {
		let e = Infinity;
		for (let n of t) {
			let t = N(i, n);
			t < e && (e = t);
		}
		e > r && (r = e, n = i);
	}
	return n;
}
function se(e, t, n) {
	let r = Math.floor(n() * e.length), i = /* @__PURE__ */ new Set([r]), a = [e[r].color];
	for (let r = 1; r < t; r++) {
		let t = 0, o = new Float64Array(e.length);
		for (let n = 0; n < e.length; n++) {
			let i = e[n].color, s = N(a[0], i);
			for (let e = 1; e < r; e++) {
				let t = N(a[e], i);
				t < s && (s = t);
			}
			t += s * e[n].count, o[n] = t;
		}
		if (t <= 2 ** -52) {
			let t = e.findIndex((e, t) => !i.has(t));
			if (t < 0) break;
			i.add(t), a.push(e[t].color);
			continue;
		}
		let s = n() * t;
		for (let t = 0; t < e.length; t++) if (!i.has(t) && o[t] >= s) {
			i.add(t), a.push(e[t].color);
			break;
		}
		if (a.length === r) {
			let t = e.findIndex((e, t) => !i.has(t));
			if (t < 0) break;
			i.add(t), a.push(e[t].color);
		}
	}
	return a;
}
function ce(e, t, n, r) {
	let i = Math.min(t, e.length);
	if (i <= 0) return [];
	let a;
	if (n) a = se(e, i, r);
	else {
		let t = e.map((e) => e.color);
		for (let e = t.length - 1; e > 0; e--) {
			let n = Math.floor(r() * (e + 1));
			[t[e], t[n]] = [t[n], t[e]];
		}
		a = t.slice(0, i);
	}
	let o = new Int32Array(e.length), s = !0, c = 0;
	for (; s && c < 250;) {
		s = !1, c++;
		for (let t = 0; t < e.length; t++) o[t] = ae(e[t].color, a);
		for (let t = 0; t < i; t++) {
			let n = 0, r = 0, i = 0, c = 0;
			for (let a = 0; a < e.length; a++) {
				if (o[a] !== t) continue;
				let { color: s, count: l } = e[a];
				n += s[0] * l, r += s[1] * l, i += s[2] * l, c += l;
			}
			if (c === 0) {
				a[t] = oe(e, a), s = !0;
				continue;
			}
			let l = [
				n / c,
				r / c,
				i / c
			];
			ie(l, a[t]) || (a[t] = l, s = !0);
		}
	}
	return a;
}
function L(e, t = !1, n = !1, r = P(F(e))) {
	let i = [...e];
	t && i.length > 1 && (i = ee(i, (e) => I(e.color))), n && (i = re(i)), i = ne(i);
	let a = ce(i, 1, !1, r)[0] ?? [
		0,
		0,
		0
	], o = te(n ? T(a) : a);
	return {
		color: o,
		colorIsDark: M(o)
	};
}
function le(e, t, n, r = !1, i = !1, a = !1, o = "accent", s = P(F(e))) {
	let c = r, l = a;
	e.length === 1 && (c = !1, l = !1);
	let u = n.colorIsDark, d = ee(e, (e) => o === "dominant" ? !c || I(e.color) : u ? A(e.color) : c ? j(e.color) && I(e.color) : j(e.color));
	i && (d = re(d)), d = ne(d);
	let f = ce(d, t, l, s).map((e) => te(i ? T(e) : e)), p = [];
	for (let e = 0; e < t; e++) p.push(f.length > 0 ? [...f[e % f.length]] : [
		0,
		0,
		0
	]);
	return {
		palette: p,
		paletteIsDark: u,
		themeColor: n
	};
}
//#endregion
//#region src/bg-render/palette/octtree.ts
var ue = 8, de = class e {
	owner;
	parentNode;
	indexInParent;
	children = [
		null,
		null,
		null,
		null,
		null,
		null,
		null,
		null
	];
	childCount = 0;
	leafNodeCount = 0;
	sampleCount = 0;
	redSum = 0;
	greenSum = 0;
	blueSum = 0;
	constructor(e, t, n) {
		this.owner = e, this.parentNode = t, this.indexInParent = n;
	}
	get averageColor() {
		return this.sampleCount === 0 ? [
			0,
			0,
			0
		] : [
			this.redSum / this.sampleCount,
			this.greenSum / this.sampleCount,
			this.blueSum / this.sampleCount
		];
	}
	addColor(t, n, r, i, a) {
		if (this.sampleCount += a, this.redSum += t * a, this.greenSum += n * a, this.blueSum += r * a, i === ue) {
			this.leafNodeCount === 0 && (this.leafNodeCount = 1);
			return;
		}
		let o = 7 - i, s = (t >> o & 1) << 2 | (n >> o & 1) << 1 | r >> o & 1, c = this.children[s];
		c || (c = new e(this.owner, this, s), this.children[s] = c, this.childCount++, this.owner.registerNodeAtDepth(c, i));
		let l = c.leafNodeCount;
		c.addColor(t, n, r, i + 1, a), this.leafNodeCount += c.leafNodeCount - l;
	}
	collectPaletteColors(e) {
		if (this.leafNodeCount !== 0) {
			if (this.childCount === 0) e.push({
				color: this.averageColor,
				sampleCount: this.sampleCount
			});
			else for (let t of this.children) t?.collectPaletteColors(e);
		}
	}
	mergeChildrenIntoThisNode() {
		if (this.childCount === 0 || this.leafNodeCount <= 1) return;
		let e = this.leafNodeCount;
		this.children.fill(null), this.childCount = 0, this.leafNodeCount = +(this.sampleCount > 0);
		let t = e - this.leafNodeCount, n = this.parentNode;
		for (; n;) n.leafNodeCount -= t, n = n.parentNode;
	}
	isAttachedToRoot() {
		let e = this;
		for (; e.parentNode;) {
			if (e.parentNode.children[e.indexInParent] !== e) return !1;
			e = e.parentNode;
		}
		return !0;
	}
}, fe = class {
	rootNode = new de(this, null, -1);
	nodesByDepth = Array.from({ length: ue }, () => []);
	registerNodeAtDepth(e, t) {
		this.nodesByDepth[t].push(e);
	}
	addColor(e, t) {
		t <= 0 || this.rootNode.addColor(e[0] & 255, e[1] & 255, e[2] & 255, 0, t);
	}
	getPalette(e) {
		if (e <= 0 || this.rootNode.leafNodeCount === 0) return [];
		let t = [];
		return this.rootNode.collectPaletteColors(t), t.length <= e ? t.map((e) => e.color) : (t.sort((e, t) => {
			let n = t.sampleCount - e.sampleCount;
			return n === 0 ? e.color[0] === t.color[0] ? e.color[1] === t.color[1] ? e.color[2] - t.color[2] : e.color[1] - t.color[1] : e.color[0] - t.color[0] : n;
		}), t.slice(0, Math.min(e, t.length)).map((e) => e.color));
	}
	reduceToColorCount(e) {
		if (e <= 0) return;
		let t = this.rootNode.leafNodeCount - e;
		if (!(t <= 0)) {
			for (let e = 6; e >= 0 && t > 0; e--) {
				let n = this.nodesByDepth[e];
				n.sort((e, t) => {
					let n = e.leafNodeCount - t.leafNodeCount;
					return n === 0 ? e.sampleCount - t.sampleCount : n;
				});
				for (let e = 0; e < n.length && t > 0; e++) {
					let r = n[e];
					if (r.childCount === 0) continue;
					let i = r.leafNodeCount - 1;
					i <= 0 || i > t || (t -= i, r.mergeChildrenIntoThisNode());
				}
			}
			for (; this.rootNode.leafNodeCount > e;) {
				let e = this.findBestMergeCandidate();
				if (!e) break;
				e.mergeChildrenIntoThisNode();
			}
		}
	}
	findBestMergeCandidate() {
		let e = null, t = Infinity, n = Infinity;
		for (let r = 6; r >= 0; r--) for (let i of this.nodesByDepth[r]) {
			if (!i.isAttachedToRoot() || i.childCount === 0) continue;
			let r = i.leafNodeCount - 1;
			r <= 0 || (r < t || r === t && i.sampleCount < n) && (e = i, t = r, n = i.sampleCount);
		}
		return e;
	}
};
function pe(e, t, n = L(e, !1, !0), r = !1, i = "accent") {
	let a = new fe(), o = e.length !== 1 && r, s = e.filter((e) => {
		let [t, r, a] = e.color;
		return o && t > 250 && r > 250 && a > 250 ? !1 : i === "dominant" ? !0 : n.colorIsDark ? A(e.color) : j(e.color);
	}), c = s.length > 0 ? s : e;
	for (let e of c) a.addColor(e.color, e.count);
	a.reduceToColorCount(t);
	let l = a.getPalette(t), u;
	if (l.length < t) {
		u = [];
		for (let e = 0; e < t; e++) u.push(l.length > 0 ? [...l[e % l.length]] : [
			0,
			0,
			0
		]);
	} else u = l;
	return {
		palette: u,
		paletteIsDark: n.colorIsDark,
		themeColor: n
	};
}
//#endregion
//#region src/bg-render/palette/auto.ts
function me(e) {
	if (e.length === 0) return 0;
	let t = e.map(w), n = 0, r = 0, i = 0;
	for (let [e, a, o] of t) n += e, r += a, i += o;
	n /= t.length, r /= t.length, i /= t.length;
	let a = 0;
	for (let [e, o, s] of t) {
		let t = e - n, c = o - r, l = s - i;
		a += t * t + c * c + l * l;
	}
	return a / t.length;
}
function he(e) {
	return new Set(e.map((e) => e.join(","))).size;
}
function ge(e, t, n = !1, r = !1, i = !1, a = "accent") {
	let o = P(F(e)), s = L(e, n, r, o), c = le(e, t, s, n, r, i, a, o), l = pe(e, t, s, n, a), u = he(c.palette), d = he(l.palette);
	if (u !== d) return u > d ? c : l;
	let f = me(c.palette), p = me(l.palette);
	return a === "dominant" || c.paletteIsDark ? f >= p ? c : l : f <= p || p === 0 ? c : l;
}
//#endregion
//#region src/utils/canvas.ts
function _e(e, t) {
	if (typeof OffscreenCanvas < "u") return new OffscreenCanvas(e, t);
	let n = document.createElement("canvas");
	return n.width = e, n.height = t, n;
}
//#endregion
//#region src/bg-render/palette/histogram.ts
var ve = 64;
function ye(e, t) {
	if (e instanceof ImageData) return e;
	let [n, r] = e instanceof HTMLVideoElement ? [e.videoWidth, e.videoHeight] : e instanceof HTMLImageElement ? [e.naturalWidth, e.naturalHeight] : [e.width, e.height];
	if (n <= 0 || r <= 0) return null;
	let i = Math.min(1, Math.max(1, Math.floor(t)) / Math.max(n, r)), a = Math.max(1, Math.round(n * i)), o = Math.max(1, Math.round(r * i)), s = _e(a, o).getContext("2d", { willReadFrequently: !0 });
	return s ? (s.drawImage(e, 0, 0, a, o), s.getImageData(0, 0, a, o)) : null;
}
function be(e, t = ve) {
	let n = ye(e, t);
	if (!n) return [];
	let { data: r } = n, i = /* @__PURE__ */ new Map();
	for (let e = 0; e < r.length; e += 4) {
		if (r[e + 3] === 0) continue;
		let t = r[e] << 16 | r[e + 1] << 8 | r[e + 2];
		i.set(t, (i.get(t) ?? 0) + 1);
	}
	return Array.from(i, ([e, t]) => ({
		color: [
			e >> 16 & 255,
			e >> 8 & 255,
			e & 255
		],
		count: t
	}));
}
//#endregion
//#region src/bg-render/palette/index.ts
function xe(e, t, n = {}) {
	let r = Math.max(0, Math.floor(t)), { algorithm: i = "auto", ignoreWhite: a = !1, toLab: o = !1, useKMeansPP: s = !1, intent: c = "accent", sampleSize: l } = n, u = be(e, l);
	if (u.length === 0) return {
		palette: Array.from({ length: r }, () => [
			0,
			0,
			0
		]),
		paletteIsDark: !0,
		themeColor: {
			color: [
				0,
				0,
				0
			],
			colorIsDark: !0
		}
	};
	switch (i) {
		case "kmeans": return le(u, r, L(u, a, o), a, o, s, c);
		case "octtree": return pe(u, r, L(u, a, !0), a, c);
		default: return ge(u, r, a, o, s, c);
	}
}
//#endregion
//#region src/bg-render/support.ts
var Se, Ce;
function we(e, t = () => !0) {
	try {
		let n = document.createElement("canvas");
		n.width = 1, n.height = 1;
		let r = n.getContext(e);
		if (!r) return !1;
		try {
			return t(r);
		} finally {
			r.getExtension("WEBGL_lose_context")?.loseContext();
		}
	} catch {
		return !1;
	}
}
function Te() {
	return Se === void 0 && (Se = we("webgl")), Se;
}
function Ee() {
	return Ce === void 0 && (Ce = we("webgl", (e) => (e.getShaderPrecisionFormat(e.FRAGMENT_SHADER, e.HIGH_FLOAT)?.precision ?? 0) > 0)), Ce;
}
//#endregion
//#region src/bg-render/isolation/isolation.frag.glsl?raw
var De = "// WebGL1 port of Storyteller-Studios/Cirrus' IsolationEffect.\n// The random values and flow parameters are re-rolled per album by\n// IsolationRenderer, so a cover gets a stable composition while different\n// covers do not share a layout.\n//\n// Everything that is constant for a whole draw call -- the sRGB to OkLab\n// conversion of the four colors, and the randomised flow parameters -- is\n// computed on the CPU and uploaded as uniforms instead of being recomputed per\n// fragment.\n//\n// highp is required rather than optional: u_time grows without bound and the\n// noise hash amplifies it by ~44000, which mediump's 10 significant bits cannot\n// carry. IsolationRenderer.isSupported() refuses environments without highp\n// fragment precision, so this shader simply fails to compile there instead of\n// silently rendering a broken picture.\nprecision highp float;\n\nuniform vec2 u_resolution;\nuniform float u_time;\n// The four gradient colors, already converted to OkLab by the CPU.\nuniform vec3 u_colors[4];\nuniform vec3 u_random;\n// x = ripple frequency, y = ripple amplitude divisor,\n// z = flow speed (sign carries the direction), w = gradient axis tilt in radians\nuniform vec4 u_flowParams;\n// Extra jitter added to the noise-driven gradient angle, in radians.\nuniform float u_angleJitter;\nuniform bool u_enableLightWave;\nuniform bool u_enableDithering;\n\nconst float PI = 3.141592653589793;\n\nvec2 rotatePoint(vec2 point, float angle) {\n	float sine = sin(angle);\n	float cosine = cos(angle);\n	return vec2(\n		point.x * cosine - point.y * sine,\n		point.x * sine + point.y * cosine\n	);\n}\n\nvec2 gradientHash(vec2 point) {\n	return fract(\n		sin(\n			vec2(\n				dot(point, vec2(127.1, 311.7)),\n				dot(point, vec2(269.5, 183.3))\n			)\n		) * 43758.5453\n	);\n}\n\nfloat gradientNoise(vec2 point) {\n	vec2 cell = floor(point);\n	vec2 offset = fract(point);\n	vec2 eased = offset * offset * (3.0 - 2.0 * offset);\n	float lower = mix(\n		dot(-1.0 + 2.0 * gradientHash(cell), offset),\n		dot(-1.0 + 2.0 * gradientHash(cell + vec2(1.0, 0.0)), offset - vec2(1.0, 0.0)),\n		eased.x\n	);\n	float upper = mix(\n		dot(-1.0 + 2.0 * gradientHash(cell + vec2(0.0, 1.0)), offset - vec2(0.0, 1.0)),\n		dot(-1.0 + 2.0 * gradientHash(cell + vec2(1.0, 1.0)), offset - vec2(1.0, 1.0)),\n		eased.x\n	);\n	return 0.5 + 0.5 * mix(lower, upper, eased.y);\n}\n\nfloat encodeSrgb(float channel) {\n	return channel <= 0.0031308\n		? 12.92 * channel\n		: 1.055 * pow(max(channel, 0.0), 1.0 / 2.4) - 0.055;\n}\n\nvec3 okLabToSrgb(vec3 color) {\n	float lRoot = color.x + 0.3963377774 * color.y + 0.2158037573 * color.z;\n	float mRoot = color.x - 0.1055613458 * color.y - 0.0638541728 * color.z;\n	float sRoot = color.x - 0.0894841775 * color.y - 1.2914855480 * color.z;\n	float l = lRoot * lRoot * lRoot;\n	float m = mRoot * mRoot * mRoot;\n	float s = sRoot * sRoot * sRoot;\n	vec3 linearColor = vec3(\n		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,\n		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,\n		-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s\n	);\n	return vec3(\n		encodeSrgb(linearColor.r),\n		encodeSrgb(linearColor.g),\n		encodeSrgb(linearColor.b)\n	);\n}\n\nvec3 applyLightWave(vec3 okLabColor, vec2 uv) {\n	vec2 point = -1.0 + 1.5 * uv;\n	float x = point.x;\n	float y = point.y;\n	float time = u_time * 0.2;\n	float yPhase = y / 0.3;\n	float xPhase = x / 0.2;\n	float timeWarp = cos(sin(time) * 2.0) * 0.1;\n	float movement = (x + y) * 0.001 + timeWarp + sin(x * 0.01);\n	float wave1 =\n		sin(yPhase + 2.0 * time + u_random.x) * 0.5 -\n		yPhase -\n		xPhase * 0.5;\n	float wave2 = cos(\n		wave1 +\n			sin(movement + time) +\n			sin(y * 0.025 + time) +\n			sin((x + y) * 0.01) * 3.0 +\n			u_random.y\n	);\n	float wave3 = abs(\n		sin(\n			wave2 +\n				cos(yPhase + time + xPhase + wave2) +\n				cos(xPhase) +\n				sin(x * 0.001) +\n				u_random.z\n		)\n	);\n	// 取色不再压暗，纯白封面的 L 能到 1.0，乘完必须钳住：让 L 溢出再靠末尾的\n	// RGB 钳位收场会逐通道削顶，把色相也一起改掉\n	okLabColor.x = clamp(okLabColor.x * (1.1 - 0.1 * wave3), 0.0, 1.0);\n	return okLabToSrgb(okLabColor);\n}\n\nfloat interleavedGradientNoise(vec2 position) {\n	return fract(\n		52.9829189 * fract(dot(position, vec2(0.06711056, 0.00583715)))\n	);\n}\n\nvec3 screenSpaceDither(vec2 screenPosition) {\n	vec2 position = screenPosition + u_random.xy * 97.0;\n	vec3 noise = vec3(\n		interleavedGradientNoise(position),\n		interleavedGradientNoise(position + vec2(17.0, 59.0)),\n		interleavedGradientNoise(position + vec2(71.0, 23.0))\n	);\n	return (noise - 0.5) / 255.0;\n}\n\nvoid main() {\n	vec2 uv = gl_FragCoord.xy / u_resolution;\n	vec2 gradientPoint = uv - 0.5;\n	float degree = gradientNoise(\n		vec2(\n			u_time * 0.1 + u_random.x * 0.07,\n			gradientPoint.x * gradientPoint.y + u_random.y * 0.07\n		)\n	);\n	float noiseAngle = ((degree - 0.5) * 720.0 + 180.0) * PI / 180.0;\n	gradientPoint = rotatePoint(gradientPoint, noiseAngle + u_angleJitter);\n\n	float frequency = u_flowParams.x;\n	float amplitude = u_flowParams.y;\n	float speed = u_time * u_flowParams.z;\n	gradientPoint.x += sin(gradientPoint.y * frequency + speed) / amplitude;\n	gradientPoint.y +=\n		sin(gradientPoint.x * frequency * 1.5 + speed) / (amplitude * 0.5);\n\n	float rotatedX = rotatePoint(gradientPoint, u_flowParams.w).x;\n	float horizontal = smoothstep(-0.3, 0.2, rotatedX);\n	vec3 okLabColor = mix(\n		mix(u_colors[0], u_colors[1], horizontal),\n		mix(u_colors[2], u_colors[3], horizontal),\n		1.0 - smoothstep(-0.3, 0.5, gradientPoint.y)\n	);\n	vec3 color = u_enableLightWave\n		? applyLightWave(okLabColor, uv)\n		: okLabToSrgb(okLabColor);\n\n	if (u_enableDithering) {\n		color += screenSpaceDither(gl_FragCoord.xy);\n	}\n\n	gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);\n}\n", Oe = "attribute vec2 a_position;\n\nvoid main() {\n	gl_Position = vec4(a_position, 0.0, 1.0);\n}\n", R = 1e3, ke = Math.PI * 2, Ae = Math.PI / 180, je = 4, Me = 5, Ne = [
	[
		.09,
		.09,
		.11
	],
	[
		.13,
		.13,
		.16
	],
	[
		.07,
		.07,
		.09
	],
	[
		.11,
		.11,
		.13
	]
];
function z(e, t, n) {
	return e + (t - e) * n;
}
var B = new Float32Array(Ne.flatMap(D)), Pe = class e extends u {
	static defaultOptions = {
		lightWave: !1,
		dithering: !0,
		paletteAlgorithm: "auto"
	};
	static isSupported() {
		return Te() && Ee();
	}
	gl;
	program;
	quadBuffer;
	contextLost = !1;
	_disposed = !1;
	options = { ...e.defaultOptions };
	tickHandle = 0;
	lastTickTime = 0;
	lastFrameTime = 0;
	frameTime = 0;
	maxFPS = 30;
	paused = !1;
	staticMode = !1;
	targetWidth = 0;
	targetHeight = 0;
	currentWidth = 0;
	currentHeight = 0;
	albumRequestId = 0;
	albumSource;
	paletteTransitionElapsed = R;
	fromColors = new Float32Array(B);
	toColors = new Float32Array(B);
	colorBuffer = new Float32Array(B);
	nextColors = /* @__PURE__ */ new Float32Array(12);
	randomValues = /* @__PURE__ */ new Float32Array(3);
	flowParams = /* @__PURE__ */ new Float32Array(4);
	angleJitter = 0;
	paletteOrder = new Uint8Array(je);
	constructor(e) {
		super(e);
		let t = e.getContext("webgl", {
			alpha: !1,
			antialias: !1,
			depth: !1,
			stencil: !1,
			powerPreference: "low-power"
		});
		if (!t) throw this.disconnectResizeObserver(), Error("WebGL not supported");
		this.gl = t;
		try {
			this.rollRandomParameters(), this.initializeGLResources();
		} catch (e) {
			throw this.program?.dispose(), t.getExtension("WEBGL_lose_context")?.loseContext(), this.disconnectResizeObserver(), e;
		}
		e.addEventListener("webglcontextlost", this.onContextLost), e.addEventListener("webglcontextrestored", this.onContextRestored), this.requestTick();
	}
	initializeGLResources() {
		let e = this.gl;
		this.program = new d(e, Oe, De, "isolation");
		let t = e.createBuffer();
		if (!t) throw Error("Failed to create quad buffer");
		this.quadBuffer = t, e.bindBuffer(e.ARRAY_BUFFER, t), e.bufferData(e.ARRAY_BUFFER, new Float32Array([
			-1,
			-1,
			1,
			-1,
			-1,
			1,
			-1,
			1,
			1,
			-1,
			1,
			1
		]), e.STATIC_DRAW);
		let n = this.program.attrs.a_position;
		e.enableVertexAttribArray(n), e.vertexAttribPointer(n, 2, e.FLOAT, !1, 0, 0);
	}
	onContextLost = (e) => {
		e.preventDefault(), this.contextLost = !0, this.tickHandle &&= (cancelAnimationFrame(this.tickHandle), 0);
	};
	onContextRestored = () => {
		if (!this._disposed) {
			try {
				this.initializeGLResources();
			} catch (e) {
				this.program?.dispose(), console.error("Failed to restore WebGL resources", e);
				return;
			}
			this.contextLost = !1, this.currentWidth = 0, this.currentHeight = 0, this.resetFrameClock(), this.requestTick();
		}
	};
	rollRandomParameters() {
		for (let e = 0; e < this.randomValues.length; e++) this.randomValues[e] = Math.random() * ke;
		let e = Math.random() < .5 ? -1 : 1;
		this.flowParams[0] = z(4.5, 5.5, Math.random()), this.flowParams[1] = z(22, 29, Math.random()), this.flowParams[2] = z(.65, .85, Math.random()) * e, this.flowParams[3] = (-5 + (Math.random() - .5) * 12) * Ae, this.angleJitter = (Math.random() - .5) * .3;
		for (let e = 0; e < this.paletteOrder.length; e++) this.paletteOrder[e] = e;
		for (let e = this.paletteOrder.length - 1; e > 0; e--) {
			let t = Math.floor(Math.random() * (e + 1));
			[this.paletteOrder[e], this.paletteOrder[t]] = [this.paletteOrder[t], this.paletteOrder[e]];
		}
	}
	setOptions(e) {
		let t = this.options, n = {
			lightWave: e.lightWave ?? t.lightWave,
			dithering: e.dithering ?? t.dithering,
			paletteAlgorithm: e.paletteAlgorithm ?? t.paletteAlgorithm
		}, r = n.paletteAlgorithm !== t.paletteAlgorithm;
		this.options = n, r && this.albumSource && this.updatePaletteFromSource(this.albumSource, !0), this.requestTick();
	}
	updatePaletteFromSource(e, t = !1) {
		let n;
		try {
			n = xe(e, je, {
				algorithm: this.options.paletteAlgorithm,
				intent: "dominant"
			}).palette;
		} catch (e) {
			console.warn("Failed to extract palette from album", e);
			return;
		}
		for (let e = 0; e < je; e++) {
			let [t, r, i] = n[this.paletteOrder[e]];
			this.nextColors.set(D([
				t / 255,
				r / 255,
				i / 255
			]), e * 3);
		}
		this.transitionToColors(this.nextColors, t), this.requestTick();
	}
	transitionToColors(e, t) {
		t ? this.fromColors.set(e) : (this.updateColorBuffer(), this.fromColors.set(this.colorBuffer)), this.toColors.set(e), this.paletteTransitionElapsed = t ? R : 0;
	}
	updateColorBuffer() {
		if (this.paletteTransitionElapsed >= R) {
			this.colorBuffer.set(this.toColors);
			return;
		}
		let e = this.paletteTransitionElapsed / R, t = e * e * (3 - 2 * e);
		for (let e = 0; e < this.colorBuffer.length; e++) this.colorBuffer[e] = z(this.fromColors[e], this.toColors[e], t);
	}
	checkIfResize() {
		(this.targetWidth !== this.currentWidth || this.targetHeight !== this.currentHeight) && (super.onResize(this.targetWidth, this.targetHeight), this.currentWidth = this.targetWidth, this.currentHeight = this.targetHeight, this.gl.viewport(0, 0, this.targetWidth, this.targetHeight));
	}
	onRedraw(e, t) {
		if (this.checkIfResize(), this.currentWidth <= 0 || this.currentHeight <= 0) return !1;
		this.paletteTransitionElapsed < R && (this.paletteTransitionElapsed += t), this.updateColorBuffer(), this.program.use(), this.program.setUniform2f("u_resolution", this.currentWidth, this.currentHeight), this.program.setUniform1f("u_time", e / 1e3), this.program.setUniform3fv("u_colors[0]", this.colorBuffer), this.program.setUniform3fv("u_random", this.randomValues), this.program.setUniform4f("u_flowParams", this.flowParams[0], this.flowParams[1], this.flowParams[2], this.flowParams[3]), this.program.setUniform1f("u_angleJitter", this.angleJitter), this.program.setUniform1i("u_enableLightWave", +!!this.options.lightWave), this.program.setUniform1i("u_enableDithering", +!!this.options.dithering);
		let n = this.gl;
		return n.drawArrays(n.TRIANGLES, 0, 6), this.paletteTransitionElapsed >= R;
	}
	onTick(e) {
		if (this.tickHandle = 0, this.paused || this._disposed || this.contextLost) return;
		let t = 1e3 / this.maxFPS, n = e - this.lastTickTime;
		if (n < t) {
			this.requestTick();
			return;
		}
		Number.isNaN(this.lastFrameTime) && (this.lastFrameTime = e);
		let r = Math.min(e - this.lastFrameTime, 250);
		this.lastFrameTime = e, this.lastTickTime = e - n % t, this.frameTime += r * this.flowSpeed, this.onRedraw(this.frameTime, r) && this.staticMode ? this.lastFrameTime = NaN : this.requestTick();
	}
	onTickBinded = this.onTick.bind(this);
	requestTick() {
		this._disposed || this.paused || this.contextLost || this.maxFPS > 0 && this.tickHandle === 0 && (this.tickHandle = requestAnimationFrame(this.onTickBinded));
	}
	onResize(e, t) {
		this.targetWidth = Math.ceil(e), this.targetHeight = Math.ceil(t), this.requestTick();
	}
	setStaticMode(e) {
		this.staticMode = e, this.resetFrameClock(), this.requestTick();
	}
	setFPS(e) {
		this.maxFPS = e, this.resetFrameClock(), this.requestTick();
	}
	pause() {
		this.tickHandle &&= (cancelAnimationFrame(this.tickHandle), 0), this.paused = !0;
	}
	resume() {
		this.paused = !1, this.resetFrameClock(), this.requestTick();
	}
	resetFrameClock() {
		let e = performance.now();
		this.lastFrameTime = e, this.lastTickTime = e;
	}
	isCurrentAlbumRequest(e) {
		return !this._disposed && e === this.albumRequestId;
	}
	async setAlbum(e, t) {
		let n = ++this.albumRequestId;
		if (e === void 0 || typeof e == "string" && e.trim().length === 0) {
			this.albumSource = void 0, this.transitionToColors(B, !1), this.requestTick();
			return;
		}
		let r = null, i = Me;
		for (; !r && i > 0;) try {
			r = typeof e == "string" ? await m(e, t) : await h(e);
		} catch (t) {
			if (!this.isCurrentAlbumRequest(n)) return;
			i--, console.warn(`failed on loading album resource, retrying (${i})`, {
				albumSource: e,
				error: t
			});
		}
		this.isCurrentAlbumRequest(n) && (r ? (this.albumSource = r, this.rollRandomParameters(), this.updatePaletteFromSource(r)) : console.error("Failed to load album resource", e));
	}
	setLowFreqVolume(e) {}
	setHasLyric(e) {}
	dispose() {
		this._disposed || (this._disposed = !0, this.tickHandle &&= (cancelAnimationFrame(this.tickHandle), 0), this.canvas.removeEventListener("webglcontextlost", this.onContextLost), this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored), this.program.dispose(), this.gl.deleteBuffer(this.quadBuffer), this.gl.getExtension("WEBGL_lose_context")?.loseContext(), super.dispose());
	}
}, Fe = new Float32Array([
	1,
	0,
	0,
	0,
	0,
	1,
	0,
	0,
	0,
	0,
	1,
	0,
	0,
	0,
	0,
	1
]), V = class e extends Float32Array {
	static BYTE_LENGTH = 16 * Float32Array.BYTES_PER_ELEMENT;
	constructor(...e) {
		switch (e.length) {
			case 16:
				super(e);
				break;
			case 2:
				super(e[0], e[1], 16);
				break;
			case 1:
				let t = e[0];
				typeof t == "number" ? super([
					t,
					t,
					t,
					t,
					t,
					t,
					t,
					t,
					t,
					t,
					t,
					t,
					t,
					t,
					t,
					t
				]) : super(t, 0, 16);
				break;
			default: super(Fe);
		}
	}
	get str() {
		return e.str(this);
	}
	copy(e) {
		return this.set(e), this;
	}
	identity() {
		return this.set(Fe), this;
	}
	multiply(t) {
		return e.multiply(this, this, t);
	}
	mul(e) {
		return this;
	}
	transpose() {
		return e.transpose(this, this);
	}
	invert() {
		return e.invert(this, this);
	}
	translate(t) {
		return e.translate(this, this, t);
	}
	rotate(t, n) {
		return e.rotate(this, this, t, n);
	}
	scale(t) {
		return e.scale(this, this, t);
	}
	rotateX(t) {
		return e.rotateX(this, this, t);
	}
	rotateY(t) {
		return e.rotateY(this, this, t);
	}
	rotateZ(t) {
		return e.rotateZ(this, this, t);
	}
	perspectiveNO(t, n, r, i) {
		return e.perspectiveNO(this, t, n, r, i);
	}
	perspectiveZO(t, n, r, i) {
		return e.perspectiveZO(this, t, n, r, i);
	}
	orthoNO(t, n, r, i, a, o) {
		return e.orthoNO(this, t, n, r, i, a, o);
	}
	orthoZO(t, n, r, i, a, o) {
		return e.orthoZO(this, t, n, r, i, a, o);
	}
	static create() {
		return new e();
	}
	static clone(t) {
		return new e(t);
	}
	static copy(e, t) {
		return e[0] = t[0], e[1] = t[1], e[2] = t[2], e[3] = t[3], e[4] = t[4], e[5] = t[5], e[6] = t[6], e[7] = t[7], e[8] = t[8], e[9] = t[9], e[10] = t[10], e[11] = t[11], e[12] = t[12], e[13] = t[13], e[14] = t[14], e[15] = t[15], e;
	}
	static fromValues(...t) {
		return new e(...t);
	}
	static set(e, ...t) {
		return e[0] = t[0], e[1] = t[1], e[2] = t[2], e[3] = t[3], e[4] = t[4], e[5] = t[5], e[6] = t[6], e[7] = t[7], e[8] = t[8], e[9] = t[9], e[10] = t[10], e[11] = t[11], e[12] = t[12], e[13] = t[13], e[14] = t[14], e[15] = t[15], e;
	}
	static identity(e) {
		return e[0] = 1, e[1] = 0, e[2] = 0, e[3] = 0, e[4] = 0, e[5] = 1, e[6] = 0, e[7] = 0, e[8] = 0, e[9] = 0, e[10] = 1, e[11] = 0, e[12] = 0, e[13] = 0, e[14] = 0, e[15] = 1, e;
	}
	static transpose(e, t) {
		if (e === t) {
			let n = t[1], r = t[2], i = t[3], a = t[6], o = t[7], s = t[11];
			e[1] = t[4], e[2] = t[8], e[3] = t[12], e[4] = n, e[6] = t[9], e[7] = t[13], e[8] = r, e[9] = a, e[11] = t[14], e[12] = i, e[13] = o, e[14] = s;
		} else e[0] = t[0], e[1] = t[4], e[2] = t[8], e[3] = t[12], e[4] = t[1], e[5] = t[5], e[6] = t[9], e[7] = t[13], e[8] = t[2], e[9] = t[6], e[10] = t[10], e[11] = t[14], e[12] = t[3], e[13] = t[7], e[14] = t[11], e[15] = t[15];
		return e;
	}
	static invert(e, t) {
		let n = t[0], r = t[1], i = t[2], a = t[3], o = t[4], s = t[5], c = t[6], l = t[7], u = t[8], d = t[9], f = t[10], p = t[11], m = t[12], h = t[13], g = t[14], _ = t[15], v = n * s - r * o, y = n * c - i * o, b = n * l - a * o, x = r * c - i * s, S = r * l - a * s, C = i * l - a * c, w = u * h - d * m, T = u * g - f * m, E = u * _ - p * m, D = d * g - f * h, O = d * _ - p * h, k = f * _ - p * g, A = v * k - y * O + b * D + x * E - S * T + C * w;
		return A ? (A = 1 / A, e[0] = (s * k - c * O + l * D) * A, e[1] = (i * O - r * k - a * D) * A, e[2] = (h * C - g * S + _ * x) * A, e[3] = (f * S - d * C - p * x) * A, e[4] = (c * E - o * k - l * T) * A, e[5] = (n * k - i * E + a * T) * A, e[6] = (g * b - m * C - _ * y) * A, e[7] = (u * C - f * b + p * y) * A, e[8] = (o * O - s * E + l * w) * A, e[9] = (r * E - n * O - a * w) * A, e[10] = (m * S - h * b + _ * v) * A, e[11] = (d * b - u * S - p * v) * A, e[12] = (s * T - o * D - c * w) * A, e[13] = (n * D - r * T + i * w) * A, e[14] = (h * y - m * x - g * v) * A, e[15] = (u * x - d * y + f * v) * A, e) : null;
	}
	static adjoint(e, t) {
		let n = t[0], r = t[1], i = t[2], a = t[3], o = t[4], s = t[5], c = t[6], l = t[7], u = t[8], d = t[9], f = t[10], p = t[11], m = t[12], h = t[13], g = t[14], _ = t[15], v = n * s - r * o, y = n * c - i * o, b = n * l - a * o, x = r * c - i * s, S = r * l - a * s, C = i * l - a * c, w = u * h - d * m, T = u * g - f * m, E = u * _ - p * m, D = d * g - f * h, O = d * _ - p * h, k = f * _ - p * g;
		return e[0] = s * k - c * O + l * D, e[1] = i * O - r * k - a * D, e[2] = h * C - g * S + _ * x, e[3] = f * S - d * C - p * x, e[4] = c * E - o * k - l * T, e[5] = n * k - i * E + a * T, e[6] = g * b - m * C - _ * y, e[7] = u * C - f * b + p * y, e[8] = o * O - s * E + l * w, e[9] = r * E - n * O - a * w, e[10] = m * S - h * b + _ * v, e[11] = d * b - u * S - p * v, e[12] = s * T - o * D - c * w, e[13] = n * D - r * T + i * w, e[14] = h * y - m * x - g * v, e[15] = u * x - d * y + f * v, e;
	}
	static determinant(e) {
		let t = e[0], n = e[1], r = e[2], i = e[3], a = e[4], o = e[5], s = e[6], c = e[7], l = e[8], u = e[9], d = e[10], f = e[11], p = e[12], m = e[13], h = e[14], g = e[15], _ = t * o - n * a, v = t * s - r * a, y = n * s - r * o, b = l * m - u * p, x = l * h - d * p, S = u * h - d * m, C = t * S - n * x + r * b, w = a * S - o * x + s * b, T = l * y - u * v + d * _, E = p * y - m * v + h * _;
		return c * C - i * w + g * T - f * E;
	}
	static multiply(e, t, n) {
		let r = t[0], i = t[1], a = t[2], o = t[3], s = t[4], c = t[5], l = t[6], u = t[7], d = t[8], f = t[9], p = t[10], m = t[11], h = t[12], g = t[13], _ = t[14], v = t[15], y = n[0], b = n[1], x = n[2], S = n[3];
		return e[0] = y * r + b * s + x * d + S * h, e[1] = y * i + b * c + x * f + S * g, e[2] = y * a + b * l + x * p + S * _, e[3] = y * o + b * u + x * m + S * v, y = n[4], b = n[5], x = n[6], S = n[7], e[4] = y * r + b * s + x * d + S * h, e[5] = y * i + b * c + x * f + S * g, e[6] = y * a + b * l + x * p + S * _, e[7] = y * o + b * u + x * m + S * v, y = n[8], b = n[9], x = n[10], S = n[11], e[8] = y * r + b * s + x * d + S * h, e[9] = y * i + b * c + x * f + S * g, e[10] = y * a + b * l + x * p + S * _, e[11] = y * o + b * u + x * m + S * v, y = n[12], b = n[13], x = n[14], S = n[15], e[12] = y * r + b * s + x * d + S * h, e[13] = y * i + b * c + x * f + S * g, e[14] = y * a + b * l + x * p + S * _, e[15] = y * o + b * u + x * m + S * v, e;
	}
	static mul(e, t, n) {
		return e;
	}
	static translate(e, t, n) {
		let r = n[0], i = n[1], a = n[2];
		if (t === e) e[12] = t[0] * r + t[4] * i + t[8] * a + t[12], e[13] = t[1] * r + t[5] * i + t[9] * a + t[13], e[14] = t[2] * r + t[6] * i + t[10] * a + t[14], e[15] = t[3] * r + t[7] * i + t[11] * a + t[15];
		else {
			let n = t[0], o = t[1], s = t[2], c = t[3], l = t[4], u = t[5], d = t[6], f = t[7], p = t[8], m = t[9], h = t[10], g = t[11];
			e[0] = n, e[1] = o, e[2] = s, e[3] = c, e[4] = l, e[5] = u, e[6] = d, e[7] = f, e[8] = p, e[9] = m, e[10] = h, e[11] = g, e[12] = n * r + l * i + p * a + t[12], e[13] = o * r + u * i + m * a + t[13], e[14] = s * r + d * i + h * a + t[14], e[15] = c * r + f * i + g * a + t[15];
		}
		return e;
	}
	static scale(e, t, n) {
		let r = n[0], i = n[1], a = n[2];
		return e[0] = t[0] * r, e[1] = t[1] * r, e[2] = t[2] * r, e[3] = t[3] * r, e[4] = t[4] * i, e[5] = t[5] * i, e[6] = t[6] * i, e[7] = t[7] * i, e[8] = t[8] * a, e[9] = t[9] * a, e[10] = t[10] * a, e[11] = t[11] * a, e[12] = t[12], e[13] = t[13], e[14] = t[14], e[15] = t[15], e;
	}
	static rotate(e, t, n, r) {
		let i = r[0], a = r[1], o = r[2], s = Math.sqrt(i * i + a * a + o * o);
		if (s < 1e-6) return null;
		s = 1 / s, i *= s, a *= s, o *= s;
		let c = Math.sin(n), l = Math.cos(n), u = 1 - l, d = t[0], f = t[1], p = t[2], m = t[3], h = t[4], g = t[5], _ = t[6], v = t[7], y = t[8], b = t[9], x = t[10], S = t[11], C = i * i * u + l, w = a * i * u + o * c, T = o * i * u - a * c, E = i * a * u - o * c, D = a * a * u + l, O = o * a * u + i * c, k = i * o * u + a * c, A = a * o * u - i * c, j = o * o * u + l;
		return e[0] = d * C + h * w + y * T, e[1] = f * C + g * w + b * T, e[2] = p * C + _ * w + x * T, e[3] = m * C + v * w + S * T, e[4] = d * E + h * D + y * O, e[5] = f * E + g * D + b * O, e[6] = p * E + _ * D + x * O, e[7] = m * E + v * D + S * O, e[8] = d * k + h * A + y * j, e[9] = f * k + g * A + b * j, e[10] = p * k + _ * A + x * j, e[11] = m * k + v * A + S * j, t !== e && (e[12] = t[12], e[13] = t[13], e[14] = t[14], e[15] = t[15]), e;
	}
	static rotateX(e, t, n) {
		let r = Math.sin(n), i = Math.cos(n), a = t[4], o = t[5], s = t[6], c = t[7], l = t[8], u = t[9], d = t[10], f = t[11];
		return t !== e && (e[0] = t[0], e[1] = t[1], e[2] = t[2], e[3] = t[3], e[12] = t[12], e[13] = t[13], e[14] = t[14], e[15] = t[15]), e[4] = a * i + l * r, e[5] = o * i + u * r, e[6] = s * i + d * r, e[7] = c * i + f * r, e[8] = l * i - a * r, e[9] = u * i - o * r, e[10] = d * i - s * r, e[11] = f * i - c * r, e;
	}
	static rotateY(e, t, n) {
		let r = Math.sin(n), i = Math.cos(n), a = t[0], o = t[1], s = t[2], c = t[3], l = t[8], u = t[9], d = t[10], f = t[11];
		return t !== e && (e[4] = t[4], e[5] = t[5], e[6] = t[6], e[7] = t[7], e[12] = t[12], e[13] = t[13], e[14] = t[14], e[15] = t[15]), e[0] = a * i - l * r, e[1] = o * i - u * r, e[2] = s * i - d * r, e[3] = c * i - f * r, e[8] = a * r + l * i, e[9] = o * r + u * i, e[10] = s * r + d * i, e[11] = c * r + f * i, e;
	}
	static rotateZ(e, t, n) {
		let r = Math.sin(n), i = Math.cos(n), a = t[0], o = t[1], s = t[2], c = t[3], l = t[4], u = t[5], d = t[6], f = t[7];
		return t !== e && (e[8] = t[8], e[9] = t[9], e[10] = t[10], e[11] = t[11], e[12] = t[12], e[13] = t[13], e[14] = t[14], e[15] = t[15]), e[0] = a * i + l * r, e[1] = o * i + u * r, e[2] = s * i + d * r, e[3] = c * i + f * r, e[4] = l * i - a * r, e[5] = u * i - o * r, e[6] = d * i - s * r, e[7] = f * i - c * r, e;
	}
	static fromTranslation(e, t) {
		return e[0] = 1, e[1] = 0, e[2] = 0, e[3] = 0, e[4] = 0, e[5] = 1, e[6] = 0, e[7] = 0, e[8] = 0, e[9] = 0, e[10] = 1, e[11] = 0, e[12] = t[0], e[13] = t[1], e[14] = t[2], e[15] = 1, e;
	}
	static fromScaling(e, t) {
		return e[0] = t[0], e[1] = 0, e[2] = 0, e[3] = 0, e[4] = 0, e[5] = t[1], e[6] = 0, e[7] = 0, e[8] = 0, e[9] = 0, e[10] = t[2], e[11] = 0, e[12] = 0, e[13] = 0, e[14] = 0, e[15] = 1, e;
	}
	static fromRotation(e, t, n) {
		let r = n[0], i = n[1], a = n[2], o = Math.sqrt(r * r + i * i + a * a);
		if (o < 1e-6) return null;
		o = 1 / o, r *= o, i *= o, a *= o;
		let s = Math.sin(t), c = Math.cos(t), l = 1 - c;
		return e[0] = r * r * l + c, e[1] = i * r * l + a * s, e[2] = a * r * l - i * s, e[3] = 0, e[4] = r * i * l - a * s, e[5] = i * i * l + c, e[6] = a * i * l + r * s, e[7] = 0, e[8] = r * a * l + i * s, e[9] = i * a * l - r * s, e[10] = a * a * l + c, e[11] = 0, e[12] = 0, e[13] = 0, e[14] = 0, e[15] = 1, e;
	}
	static fromXRotation(e, t) {
		let n = Math.sin(t), r = Math.cos(t);
		return e[0] = 1, e[1] = 0, e[2] = 0, e[3] = 0, e[4] = 0, e[5] = r, e[6] = n, e[7] = 0, e[8] = 0, e[9] = -n, e[10] = r, e[11] = 0, e[12] = 0, e[13] = 0, e[14] = 0, e[15] = 1, e;
	}
	static fromYRotation(e, t) {
		let n = Math.sin(t), r = Math.cos(t);
		return e[0] = r, e[1] = 0, e[2] = -n, e[3] = 0, e[4] = 0, e[5] = 1, e[6] = 0, e[7] = 0, e[8] = n, e[9] = 0, e[10] = r, e[11] = 0, e[12] = 0, e[13] = 0, e[14] = 0, e[15] = 1, e;
	}
	static fromZRotation(e, t) {
		let n = Math.sin(t), r = Math.cos(t);
		return e[0] = r, e[1] = n, e[2] = 0, e[3] = 0, e[4] = -n, e[5] = r, e[6] = 0, e[7] = 0, e[8] = 0, e[9] = 0, e[10] = 1, e[11] = 0, e[12] = 0, e[13] = 0, e[14] = 0, e[15] = 1, e;
	}
	static fromRotationTranslation(e, t, n) {
		let r = t[0], i = t[1], a = t[2], o = t[3], s = r + r, c = i + i, l = a + a, u = r * s, d = r * c, f = r * l, p = i * c, m = i * l, h = a * l, g = o * s, _ = o * c, v = o * l;
		return e[0] = 1 - (p + h), e[1] = d + v, e[2] = f - _, e[3] = 0, e[4] = d - v, e[5] = 1 - (u + h), e[6] = m + g, e[7] = 0, e[8] = f + _, e[9] = m - g, e[10] = 1 - (u + p), e[11] = 0, e[12] = n[0], e[13] = n[1], e[14] = n[2], e[15] = 1, e;
	}
	static fromQuat2(t, n) {
		let r = -n[0], i = -n[1], a = -n[2], o = n[3], s = n[4], c = n[5], l = n[6], u = n[7], d = r * r + i * i + a * a + o * o;
		return d > 0 ? (H[0] = (s * o + u * r + c * a - l * i) * 2 / d, H[1] = (c * o + u * i + l * r - s * a) * 2 / d, H[2] = (l * o + u * a + s * i - c * r) * 2 / d) : (H[0] = (s * o + u * r + c * a - l * i) * 2, H[1] = (c * o + u * i + l * r - s * a) * 2, H[2] = (l * o + u * a + s * i - c * r) * 2), e.fromRotationTranslation(t, n, H), t;
	}
	static normalFromMat4(e, t) {
		let n = t[0], r = t[1], i = t[2], a = t[3], o = t[4], s = t[5], c = t[6], l = t[7], u = t[8], d = t[9], f = t[10], p = t[11], m = t[12], h = t[13], g = t[14], _ = t[15], v = n * s - r * o, y = n * c - i * o, b = n * l - a * o, x = r * c - i * s, S = r * l - a * s, C = i * l - a * c, w = u * h - d * m, T = u * g - f * m, E = u * _ - p * m, D = d * g - f * h, O = d * _ - p * h, k = f * _ - p * g, A = v * k - y * O + b * D + x * E - S * T + C * w;
		return A ? (A = 1 / A, e[0] = (s * k - c * O + l * D) * A, e[1] = (c * E - o * k - l * T) * A, e[2] = (o * O - s * E + l * w) * A, e[3] = 0, e[4] = (i * O - r * k - a * D) * A, e[5] = (n * k - i * E + a * T) * A, e[6] = (r * E - n * O - a * w) * A, e[7] = 0, e[8] = (h * C - g * S + _ * x) * A, e[9] = (g * b - m * C - _ * y) * A, e[10] = (m * S - h * b + _ * v) * A, e[11] = 0, e[12] = 0, e[13] = 0, e[14] = 0, e[15] = 1, e) : null;
	}
	static normalFromMat4Fast(e, t) {
		let n = t[0], r = t[1], i = t[2], a = t[4], o = t[5], s = t[6], c = t[8], l = t[9], u = t[10];
		return e[0] = o * u - u * l, e[1] = s * c - c * u, e[2] = a * l - l * c, e[3] = 0, e[4] = l * i - u * r, e[5] = u * n - c * i, e[6] = c * r - l * n, e[7] = 0, e[8] = r * s - i * o, e[9] = i * a - n * s, e[10] = n * o - r * a, e[11] = 0, e[12] = 0, e[13] = 0, e[14] = 0, e[15] = 1, e;
	}
	static getTranslation(e, t) {
		return e[0] = t[12], e[1] = t[13], e[2] = t[14], e;
	}
	static getScaling(e, t) {
		let n = t[0], r = t[1], i = t[2], a = t[4], o = t[5], s = t[6], c = t[8], l = t[9], u = t[10];
		return e[0] = Math.sqrt(n * n + r * r + i * i), e[1] = Math.sqrt(a * a + o * o + s * s), e[2] = Math.sqrt(c * c + l * l + u * u), e;
	}
	static getRotation(t, n) {
		e.getScaling(H, n);
		let r = 1 / H[0], i = 1 / H[1], a = 1 / H[2], o = n[0] * r, s = n[1] * i, c = n[2] * a, l = n[4] * r, u = n[5] * i, d = n[6] * a, f = n[8] * r, p = n[9] * i, m = n[10] * a, h = o + u + m, g = 0;
		return h > 0 ? (g = Math.sqrt(h + 1) * 2, t[3] = .25 * g, t[0] = (d - p) / g, t[1] = (f - c) / g, t[2] = (s - l) / g) : o > u && o > m ? (g = Math.sqrt(1 + o - u - m) * 2, t[3] = (d - p) / g, t[0] = .25 * g, t[1] = (s + l) / g, t[2] = (f + c) / g) : u > m ? (g = Math.sqrt(1 + u - o - m) * 2, t[3] = (f - c) / g, t[0] = (s + l) / g, t[1] = .25 * g, t[2] = (d + p) / g) : (g = Math.sqrt(1 + m - o - u) * 2, t[3] = (s - l) / g, t[0] = (f + c) / g, t[1] = (d + p) / g, t[2] = .25 * g), t;
	}
	static decompose(e, t, n, r) {
		t[0] = r[12], t[1] = r[13], t[2] = r[14];
		let i = r[0], a = r[1], o = r[2], s = r[4], c = r[5], l = r[6], u = r[8], d = r[9], f = r[10];
		n[0] = Math.sqrt(i * i + a * a + o * o), n[1] = Math.sqrt(s * s + c * c + l * l), n[2] = Math.sqrt(u * u + d * d + f * f);
		let p = 1 / n[0], m = 1 / n[1], h = 1 / n[2], g = i * p, _ = a * m, v = o * h, y = s * p, b = c * m, x = l * h, S = u * p, C = d * m, w = f * h, T = g + b + w, E = 0;
		return T > 0 ? (E = Math.sqrt(T + 1) * 2, e[3] = .25 * E, e[0] = (x - C) / E, e[1] = (S - v) / E, e[2] = (_ - y) / E) : g > b && g > w ? (E = Math.sqrt(1 + g - b - w) * 2, e[3] = (x - C) / E, e[0] = .25 * E, e[1] = (_ + y) / E, e[2] = (S + v) / E) : b > w ? (E = Math.sqrt(1 + b - g - w) * 2, e[3] = (S - v) / E, e[0] = (_ + y) / E, e[1] = .25 * E, e[2] = (x + C) / E) : (E = Math.sqrt(1 + w - g - b) * 2, e[3] = (_ - y) / E, e[0] = (S + v) / E, e[1] = (x + C) / E, e[2] = .25 * E), e;
	}
	static fromRotationTranslationScale(e, t, n, r) {
		let i = t[0], a = t[1], o = t[2], s = t[3], c = i + i, l = a + a, u = o + o, d = i * c, f = i * l, p = i * u, m = a * l, h = a * u, g = o * u, _ = s * c, v = s * l, y = s * u, b = r[0], x = r[1], S = r[2];
		return e[0] = (1 - (m + g)) * b, e[1] = (f + y) * b, e[2] = (p - v) * b, e[3] = 0, e[4] = (f - y) * x, e[5] = (1 - (d + g)) * x, e[6] = (h + _) * x, e[7] = 0, e[8] = (p + v) * S, e[9] = (h - _) * S, e[10] = (1 - (d + m)) * S, e[11] = 0, e[12] = n[0], e[13] = n[1], e[14] = n[2], e[15] = 1, e;
	}
	static fromRotationTranslationScaleOrigin(e, t, n, r, i) {
		let a = t[0], o = t[1], s = t[2], c = t[3], l = a + a, u = o + o, d = s + s, f = a * l, p = a * u, m = a * d, h = o * u, g = o * d, _ = s * d, v = c * l, y = c * u, b = c * d, x = r[0], S = r[1], C = r[2], w = i[0], T = i[1], E = i[2], D = (1 - (h + _)) * x, O = (p + b) * x, k = (m - y) * x, A = (p - b) * S, j = (1 - (f + _)) * S, M = (g + v) * S, N = (m + y) * C, P = (g - v) * C, F = (1 - (f + h)) * C;
		return e[0] = D, e[1] = O, e[2] = k, e[3] = 0, e[4] = A, e[5] = j, e[6] = M, e[7] = 0, e[8] = N, e[9] = P, e[10] = F, e[11] = 0, e[12] = n[0] + w - (D * w + A * T + N * E), e[13] = n[1] + T - (O * w + j * T + P * E), e[14] = n[2] + E - (k * w + M * T + F * E), e[15] = 1, e;
	}
	static fromQuat(e, t) {
		let n = t[0], r = t[1], i = t[2], a = t[3], o = n + n, s = r + r, c = i + i, l = n * o, u = r * o, d = r * s, f = i * o, p = i * s, m = i * c, h = a * o, g = a * s, _ = a * c;
		return e[0] = 1 - d - m, e[1] = u + _, e[2] = f - g, e[3] = 0, e[4] = u - _, e[5] = 1 - l - m, e[6] = p + h, e[7] = 0, e[8] = f + g, e[9] = p - h, e[10] = 1 - l - d, e[11] = 0, e[12] = 0, e[13] = 0, e[14] = 0, e[15] = 1, e;
	}
	static frustumNO(e, t, n, r, i, a, o = Infinity) {
		let s = 1 / (n - t), c = 1 / (i - r);
		if (e[0] = a * 2 * s, e[1] = 0, e[2] = 0, e[3] = 0, e[4] = 0, e[5] = a * 2 * c, e[6] = 0, e[7] = 0, e[8] = (n + t) * s, e[9] = (i + r) * c, e[11] = -1, e[12] = 0, e[13] = 0, e[15] = 0, o != null && o !== Infinity) {
			let t = 1 / (a - o);
			e[10] = (o + a) * t, e[14] = 2 * o * a * t;
		} else e[10] = -1, e[14] = -2 * a;
		return e;
	}
	static frustum(e, t, n, r, i, a, o = Infinity) {
		return e;
	}
	static frustumZO(e, t, n, r, i, a, o = Infinity) {
		let s = 1 / (n - t), c = 1 / (i - r);
		if (e[0] = a * 2 * s, e[1] = 0, e[2] = 0, e[3] = 0, e[4] = 0, e[5] = a * 2 * c, e[6] = 0, e[7] = 0, e[8] = (n + t) * s, e[9] = (i + r) * c, e[11] = -1, e[12] = 0, e[13] = 0, e[15] = 0, o != null && o !== Infinity) {
			let t = 1 / (a - o);
			e[10] = o * t, e[14] = o * a * t;
		} else e[10] = -1, e[14] = -a;
		return e;
	}
	static perspectiveNO(e, t, n, r, i = Infinity) {
		let a = 1 / Math.tan(t / 2);
		if (e[0] = a / n, e[1] = 0, e[2] = 0, e[3] = 0, e[4] = 0, e[5] = a, e[6] = 0, e[7] = 0, e[8] = 0, e[9] = 0, e[11] = -1, e[12] = 0, e[13] = 0, e[15] = 0, i != null && i !== Infinity) {
			let t = 1 / (r - i);
			e[10] = (i + r) * t, e[14] = 2 * i * r * t;
		} else e[10] = -1, e[14] = -2 * r;
		return e;
	}
	static perspective(e, t, n, r, i = Infinity) {
		return e;
	}
	static perspectiveZO(e, t, n, r, i = Infinity) {
		let a = 1 / Math.tan(t / 2);
		if (e[0] = a / n, e[1] = 0, e[2] = 0, e[3] = 0, e[4] = 0, e[5] = a, e[6] = 0, e[7] = 0, e[8] = 0, e[9] = 0, e[11] = -1, e[12] = 0, e[13] = 0, e[15] = 0, i != null && i !== Infinity) {
			let t = 1 / (r - i);
			e[10] = i * t, e[14] = i * r * t;
		} else e[10] = -1, e[14] = -r;
		return e;
	}
	static perspectiveFromFieldOfView(e, t, n, r) {
		let i = Math.tan(t.upDegrees * Math.PI / 180), a = Math.tan(t.downDegrees * Math.PI / 180), o = Math.tan(t.leftDegrees * Math.PI / 180), s = Math.tan(t.rightDegrees * Math.PI / 180), c = 2 / (o + s), l = 2 / (i + a);
		return e[0] = c, e[1] = 0, e[2] = 0, e[3] = 0, e[4] = 0, e[5] = l, e[6] = 0, e[7] = 0, e[8] = -((o - s) * c * .5), e[9] = (i - a) * l * .5, e[10] = r / (n - r), e[11] = -1, e[12] = 0, e[13] = 0, e[14] = r * n / (n - r), e[15] = 0, e;
	}
	static orthoNO(e, t, n, r, i, a, o) {
		let s = 1 / (t - n), c = 1 / (r - i), l = 1 / (a - o);
		return e[0] = -2 * s, e[1] = 0, e[2] = 0, e[3] = 0, e[4] = 0, e[5] = -2 * c, e[6] = 0, e[7] = 0, e[8] = 0, e[9] = 0, e[10] = 2 * l, e[11] = 0, e[12] = (t + n) * s, e[13] = (i + r) * c, e[14] = (o + a) * l, e[15] = 1, e;
	}
	static ortho(e, t, n, r, i, a, o) {
		return e;
	}
	static orthoZO(e, t, n, r, i, a, o) {
		let s = 1 / (t - n), c = 1 / (r - i), l = 1 / (a - o);
		return e[0] = -2 * s, e[1] = 0, e[2] = 0, e[3] = 0, e[4] = 0, e[5] = -2 * c, e[6] = 0, e[7] = 0, e[8] = 0, e[9] = 0, e[10] = l, e[11] = 0, e[12] = (t + n) * s, e[13] = (i + r) * c, e[14] = a * l, e[15] = 1, e;
	}
	static lookAt(t, n, r, i) {
		let a = n[0], o = n[1], s = n[2], c = i[0], l = i[1], u = i[2], d = r[0], f = r[1], p = r[2];
		if (Math.abs(a - d) < 1e-6 && Math.abs(o - f) < 1e-6 && Math.abs(s - p) < 1e-6) return e.identity(t);
		let m = a - d, h = o - f, g = s - p, _ = 1 / Math.sqrt(m * m + h * h + g * g);
		m *= _, h *= _, g *= _;
		let v = l * g - u * h, y = u * m - c * g, b = c * h - l * m;
		_ = Math.sqrt(v * v + y * y + b * b), _ ? (_ = 1 / _, v *= _, y *= _, b *= _) : (v = 0, y = 0, b = 0);
		let x = h * b - g * y, S = g * v - m * b, C = m * y - h * v;
		return _ = Math.sqrt(x * x + S * S + C * C), _ ? (_ = 1 / _, x *= _, S *= _, C *= _) : (x = 0, S = 0, C = 0), t[0] = v, t[1] = x, t[2] = m, t[3] = 0, t[4] = y, t[5] = S, t[6] = h, t[7] = 0, t[8] = b, t[9] = C, t[10] = g, t[11] = 0, t[12] = -(v * a + y * o + b * s), t[13] = -(x * a + S * o + C * s), t[14] = -(m * a + h * o + g * s), t[15] = 1, t;
	}
	static targetTo(e, t, n, r) {
		let i = t[0], a = t[1], o = t[2], s = r[0], c = r[1], l = r[2], u = i - n[0], d = a - n[1], f = o - n[2], p = u * u + d * d + f * f;
		p > 0 && (p = 1 / Math.sqrt(p), u *= p, d *= p, f *= p);
		let m = c * f - l * d, h = l * u - s * f, g = s * d - c * u;
		return p = m * m + h * h + g * g, p > 0 && (p = 1 / Math.sqrt(p), m *= p, h *= p, g *= p), e[0] = m, e[1] = h, e[2] = g, e[3] = 0, e[4] = d * g - f * h, e[5] = f * m - u * g, e[6] = u * h - d * m, e[7] = 0, e[8] = u, e[9] = d, e[10] = f, e[11] = 0, e[12] = i, e[13] = a, e[14] = o, e[15] = 1, e;
	}
	static frob(e) {
		return Math.sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2] + e[3] * e[3] + e[4] * e[4] + e[5] * e[5] + e[6] * e[6] + e[7] * e[7] + e[8] * e[8] + e[9] * e[9] + e[10] * e[10] + e[11] * e[11] + e[12] * e[12] + e[13] * e[13] + e[14] * e[14] + e[15] * e[15]);
	}
	static add(e, t, n) {
		return e[0] = t[0] + n[0], e[1] = t[1] + n[1], e[2] = t[2] + n[2], e[3] = t[3] + n[3], e[4] = t[4] + n[4], e[5] = t[5] + n[5], e[6] = t[6] + n[6], e[7] = t[7] + n[7], e[8] = t[8] + n[8], e[9] = t[9] + n[9], e[10] = t[10] + n[10], e[11] = t[11] + n[11], e[12] = t[12] + n[12], e[13] = t[13] + n[13], e[14] = t[14] + n[14], e[15] = t[15] + n[15], e;
	}
	static subtract(e, t, n) {
		return e[0] = t[0] - n[0], e[1] = t[1] - n[1], e[2] = t[2] - n[2], e[3] = t[3] - n[3], e[4] = t[4] - n[4], e[5] = t[5] - n[5], e[6] = t[6] - n[6], e[7] = t[7] - n[7], e[8] = t[8] - n[8], e[9] = t[9] - n[9], e[10] = t[10] - n[10], e[11] = t[11] - n[11], e[12] = t[12] - n[12], e[13] = t[13] - n[13], e[14] = t[14] - n[14], e[15] = t[15] - n[15], e;
	}
	static sub(e, t, n) {
		return e;
	}
	static multiplyScalar(e, t, n) {
		return e[0] = t[0] * n, e[1] = t[1] * n, e[2] = t[2] * n, e[3] = t[3] * n, e[4] = t[4] * n, e[5] = t[5] * n, e[6] = t[6] * n, e[7] = t[7] * n, e[8] = t[8] * n, e[9] = t[9] * n, e[10] = t[10] * n, e[11] = t[11] * n, e[12] = t[12] * n, e[13] = t[13] * n, e[14] = t[14] * n, e[15] = t[15] * n, e;
	}
	static multiplyScalarAndAdd(e, t, n, r) {
		return e[0] = t[0] + n[0] * r, e[1] = t[1] + n[1] * r, e[2] = t[2] + n[2] * r, e[3] = t[3] + n[3] * r, e[4] = t[4] + n[4] * r, e[5] = t[5] + n[5] * r, e[6] = t[6] + n[6] * r, e[7] = t[7] + n[7] * r, e[8] = t[8] + n[8] * r, e[9] = t[9] + n[9] * r, e[10] = t[10] + n[10] * r, e[11] = t[11] + n[11] * r, e[12] = t[12] + n[12] * r, e[13] = t[13] + n[13] * r, e[14] = t[14] + n[14] * r, e[15] = t[15] + n[15] * r, e;
	}
	static exactEquals(e, t) {
		return e[0] === t[0] && e[1] === t[1] && e[2] === t[2] && e[3] === t[3] && e[4] === t[4] && e[5] === t[5] && e[6] === t[6] && e[7] === t[7] && e[8] === t[8] && e[9] === t[9] && e[10] === t[10] && e[11] === t[11] && e[12] === t[12] && e[13] === t[13] && e[14] === t[14] && e[15] === t[15];
	}
	static equals(e, t) {
		let n = e[0], r = e[1], i = e[2], a = e[3], o = e[4], s = e[5], c = e[6], l = e[7], u = e[8], d = e[9], f = e[10], p = e[11], m = e[12], h = e[13], g = e[14], _ = e[15], v = t[0], y = t[1], b = t[2], x = t[3], S = t[4], C = t[5], w = t[6], T = t[7], E = t[8], D = t[9], O = t[10], k = t[11], A = t[12], j = t[13], M = t[14], N = t[15];
		return Math.abs(n - v) <= 1e-6 * Math.max(1, Math.abs(n), Math.abs(v)) && Math.abs(r - y) <= 1e-6 * Math.max(1, Math.abs(r), Math.abs(y)) && Math.abs(i - b) <= 1e-6 * Math.max(1, Math.abs(i), Math.abs(b)) && Math.abs(a - x) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(x)) && Math.abs(o - S) <= 1e-6 * Math.max(1, Math.abs(o), Math.abs(S)) && Math.abs(s - C) <= 1e-6 * Math.max(1, Math.abs(s), Math.abs(C)) && Math.abs(c - w) <= 1e-6 * Math.max(1, Math.abs(c), Math.abs(w)) && Math.abs(l - T) <= 1e-6 * Math.max(1, Math.abs(l), Math.abs(T)) && Math.abs(u - E) <= 1e-6 * Math.max(1, Math.abs(u), Math.abs(E)) && Math.abs(d - D) <= 1e-6 * Math.max(1, Math.abs(d), Math.abs(D)) && Math.abs(f - O) <= 1e-6 * Math.max(1, Math.abs(f), Math.abs(O)) && Math.abs(p - k) <= 1e-6 * Math.max(1, Math.abs(p), Math.abs(k)) && Math.abs(m - A) <= 1e-6 * Math.max(1, Math.abs(m), Math.abs(A)) && Math.abs(h - j) <= 1e-6 * Math.max(1, Math.abs(h), Math.abs(j)) && Math.abs(g - M) <= 1e-6 * Math.max(1, Math.abs(g), Math.abs(M)) && Math.abs(_ - N) <= 1e-6 * Math.max(1, Math.abs(_), Math.abs(N));
	}
	static str(e) {
		return `Mat4(${e.join(", ")})`;
	}
}, H = /* @__PURE__ */ new Float32Array(3);
V.prototype.mul = V.prototype.multiply, V.sub = V.subtract, V.mul = V.multiply, V.frustum = V.frustumNO, V.perspective = V.perspectiveNO, V.ortho = V.orthoNO;
//#endregion
//#region ../../node_modules/.pnpm/gl-matrix@4.0.0-beta.2/node_modules/gl-matrix/dist/esm/vec3.js
var U = class e extends Float32Array {
	static BYTE_LENGTH = 3 * Float32Array.BYTES_PER_ELEMENT;
	constructor(...e) {
		switch (e.length) {
			case 3:
				super(e);
				break;
			case 2:
				super(e[0], e[1], 3);
				break;
			case 1: {
				let t = e[0];
				typeof t == "number" ? super([
					t,
					t,
					t
				]) : super(t, 0, 3);
				break;
			}
			default: super(3);
		}
	}
	get x() {
		return this[0];
	}
	set x(e) {
		this[0] = e;
	}
	get y() {
		return this[1];
	}
	set y(e) {
		this[1] = e;
	}
	get z() {
		return this[2];
	}
	set z(e) {
		this[2] = e;
	}
	get r() {
		return this[0];
	}
	set r(e) {
		this[0] = e;
	}
	get g() {
		return this[1];
	}
	set g(e) {
		this[1] = e;
	}
	get b() {
		return this[2];
	}
	set b(e) {
		this[2] = e;
	}
	get magnitude() {
		let e = this[0], t = this[1], n = this[2];
		return Math.sqrt(e * e + t * t + n * n);
	}
	get mag() {
		return this.magnitude;
	}
	get squaredMagnitude() {
		let e = this[0], t = this[1], n = this[2];
		return e * e + t * t + n * n;
	}
	get sqrMag() {
		return this.squaredMagnitude;
	}
	get str() {
		return e.str(this);
	}
	copy(e) {
		return this.set(e), this;
	}
	add(e) {
		return this[0] += e[0], this[1] += e[1], this[2] += e[2], this;
	}
	subtract(e) {
		return this[0] -= e[0], this[1] -= e[1], this[2] -= e[2], this;
	}
	sub(e) {
		return this;
	}
	multiply(e) {
		return this[0] *= e[0], this[1] *= e[1], this[2] *= e[2], this;
	}
	mul(e) {
		return this;
	}
	divide(e) {
		return this[0] /= e[0], this[1] /= e[1], this[2] /= e[2], this;
	}
	div(e) {
		return this;
	}
	scale(e) {
		return this[0] *= e, this[1] *= e, this[2] *= e, this;
	}
	scaleAndAdd(e, t) {
		return this[0] += e[0] * t, this[1] += e[1] * t, this[2] += e[2] * t, this;
	}
	distance(t) {
		return e.distance(this, t);
	}
	dist(e) {
		return 0;
	}
	squaredDistance(t) {
		return e.squaredDistance(this, t);
	}
	sqrDist(e) {
		return 0;
	}
	negate() {
		return this[0] *= -1, this[1] *= -1, this[2] *= -1, this;
	}
	invert() {
		return this[0] = 1 / this[0], this[1] = 1 / this[1], this[2] = 1 / this[2], this;
	}
	abs() {
		return this[0] = Math.abs(this[0]), this[1] = Math.abs(this[1]), this[2] = Math.abs(this[2]), this;
	}
	dot(e) {
		return this[0] * e[0] + this[1] * e[1] + this[2] * e[2];
	}
	normalize() {
		return e.normalize(this, this);
	}
	static create() {
		return new e();
	}
	static clone(t) {
		return new e(t);
	}
	static magnitude(e) {
		let t = e[0], n = e[1], r = e[2];
		return Math.sqrt(t * t + n * n + r * r);
	}
	static mag(e) {
		return 0;
	}
	static length(e) {
		return 0;
	}
	static len(e) {
		return 0;
	}
	static fromValues(t, n, r) {
		return new e(t, n, r);
	}
	static copy(e, t) {
		return e[0] = t[0], e[1] = t[1], e[2] = t[2], e;
	}
	static set(e, t, n, r) {
		return e[0] = t, e[1] = n, e[2] = r, e;
	}
	static add(e, t, n) {
		return e[0] = t[0] + n[0], e[1] = t[1] + n[1], e[2] = t[2] + n[2], e;
	}
	static subtract(e, t, n) {
		return e[0] = t[0] - n[0], e[1] = t[1] - n[1], e[2] = t[2] - n[2], e;
	}
	static sub(e, t, n) {
		return [
			0,
			0,
			0
		];
	}
	static multiply(e, t, n) {
		return e[0] = t[0] * n[0], e[1] = t[1] * n[1], e[2] = t[2] * n[2], e;
	}
	static mul(e, t, n) {
		return [
			0,
			0,
			0
		];
	}
	static divide(e, t, n) {
		return e[0] = t[0] / n[0], e[1] = t[1] / n[1], e[2] = t[2] / n[2], e;
	}
	static div(e, t, n) {
		return [
			0,
			0,
			0
		];
	}
	static ceil(e, t) {
		return e[0] = Math.ceil(t[0]), e[1] = Math.ceil(t[1]), e[2] = Math.ceil(t[2]), e;
	}
	static floor(e, t) {
		return e[0] = Math.floor(t[0]), e[1] = Math.floor(t[1]), e[2] = Math.floor(t[2]), e;
	}
	static min(e, t, n) {
		return e[0] = Math.min(t[0], n[0]), e[1] = Math.min(t[1], n[1]), e[2] = Math.min(t[2], n[2]), e;
	}
	static max(e, t, n) {
		return e[0] = Math.max(t[0], n[0]), e[1] = Math.max(t[1], n[1]), e[2] = Math.max(t[2], n[2]), e;
	}
	static scale(e, t, n) {
		return e[0] = t[0] * n, e[1] = t[1] * n, e[2] = t[2] * n, e;
	}
	static scaleAndAdd(e, t, n, r) {
		return e[0] = t[0] + n[0] * r, e[1] = t[1] + n[1] * r, e[2] = t[2] + n[2] * r, e;
	}
	static distance(e, t) {
		let n = t[0] - e[0], r = t[1] - e[1], i = t[2] - e[2];
		return Math.sqrt(n * n + r * r + i * i);
	}
	static dist(e, t) {
		return 0;
	}
	static squaredDistance(e, t) {
		let n = t[0] - e[0], r = t[1] - e[1], i = t[2] - e[2];
		return n * n + r * r + i * i;
	}
	static sqrDist(e, t) {
		return 0;
	}
	static squaredLength(e) {
		let t = e[0], n = e[1], r = e[2];
		return t * t + n * n + r * r;
	}
	static sqrLen(e, t) {
		return 0;
	}
	static negate(e, t) {
		return e[0] = -t[0], e[1] = -t[1], e[2] = -t[2], e;
	}
	static inverse(e, t) {
		return e[0] = 1 / t[0], e[1] = 1 / t[1], e[2] = 1 / t[2], e;
	}
	static abs(e, t) {
		return e[0] = Math.abs(t[0]), e[1] = Math.abs(t[1]), e[2] = Math.abs(t[2]), e;
	}
	static normalize(e, t) {
		let n = t[0], r = t[1], i = t[2], a = n * n + r * r + i * i;
		return a > 0 && (a = 1 / Math.sqrt(a)), e[0] = t[0] * a, e[1] = t[1] * a, e[2] = t[2] * a, e;
	}
	static dot(e, t) {
		return e[0] * t[0] + e[1] * t[1] + e[2] * t[2];
	}
	static cross(e, t, n) {
		let r = t[0], i = t[1], a = t[2], o = n[0], s = n[1], c = n[2];
		return e[0] = i * c - a * s, e[1] = a * o - r * c, e[2] = r * s - i * o, e;
	}
	static lerp(e, t, n, r) {
		let i = t[0], a = t[1], o = t[2];
		return e[0] = i + r * (n[0] - i), e[1] = a + r * (n[1] - a), e[2] = o + r * (n[2] - o), e;
	}
	static slerp(t, n, r, i) {
		let a = Math.acos(Math.min(Math.max(e.dot(n, r), -1), 1)), o = Math.sin(a), s = Math.sin((1 - i) * a) / o, c = Math.sin(i * a) / o;
		return t[0] = s * n[0] + c * r[0], t[1] = s * n[1] + c * r[1], t[2] = s * n[2] + c * r[2], t;
	}
	static hermite(e, t, n, r, i, a) {
		let o = a * a, s = o * (2 * a - 3) + 1, c = o * (a - 2) + a, l = o * (a - 1), u = o * (3 - 2 * a);
		return e[0] = t[0] * s + n[0] * c + r[0] * l + i[0] * u, e[1] = t[1] * s + n[1] * c + r[1] * l + i[1] * u, e[2] = t[2] * s + n[2] * c + r[2] * l + i[2] * u, e;
	}
	static bezier(e, t, n, r, i, a) {
		let o = 1 - a, s = o * o, c = a * a, l = s * o, u = 3 * a * s, d = 3 * c * o, f = c * a;
		return e[0] = t[0] * l + n[0] * u + r[0] * d + i[0] * f, e[1] = t[1] * l + n[1] * u + r[1] * d + i[1] * f, e[2] = t[2] * l + n[2] * u + r[2] * d + i[2] * f, e;
	}
	static transformMat4(e, t, n) {
		let r = t[0], i = t[1], a = t[2], o = n[3] * r + n[7] * i + n[11] * a + n[15] || 1;
		return e[0] = (n[0] * r + n[4] * i + n[8] * a + n[12]) / o, e[1] = (n[1] * r + n[5] * i + n[9] * a + n[13]) / o, e[2] = (n[2] * r + n[6] * i + n[10] * a + n[14]) / o, e;
	}
	static transformMat3(e, t, n) {
		let r = t[0], i = t[1], a = t[2];
		return e[0] = r * n[0] + i * n[3] + a * n[6], e[1] = r * n[1] + i * n[4] + a * n[7], e[2] = r * n[2] + i * n[5] + a * n[8], e;
	}
	static transformQuat(e, t, n) {
		let r = n[0], i = n[1], a = n[2], o = n[3] * 2, s = t[0], c = t[1], l = t[2], u = i * l - a * c, d = a * s - r * l, f = r * c - i * s, p = (i * f - a * d) * 2, m = (a * u - r * f) * 2, h = (r * d - i * u) * 2;
		return e[0] = s + u * o + p, e[1] = c + d * o + m, e[2] = l + f * o + h, e;
	}
	static rotateX(e, t, n, r) {
		let i = n[1], a = n[2], o = t[1] - i, s = t[2] - a;
		return e[0] = t[0], e[1] = o * Math.cos(r) - s * Math.sin(r) + i, e[2] = o * Math.sin(r) + s * Math.cos(r) + a, e;
	}
	static rotateY(e, t, n, r) {
		let i = n[0], a = n[2], o = t[0] - i, s = t[2] - a;
		return e[0] = s * Math.sin(r) + o * Math.cos(r) + i, e[1] = t[1], e[2] = s * Math.cos(r) - o * Math.sin(r) + a, e;
	}
	static rotateZ(e, t, n, r) {
		let i = n[0], a = n[1], o = t[0] - i, s = t[1] - a;
		return e[0] = o * Math.cos(r) - s * Math.sin(r) + i, e[1] = o * Math.sin(r) + s * Math.cos(r) + a, e[2] = n[2], e;
	}
	static angle(t, n) {
		let r = t[0], i = t[1], a = t[2], o = n[0], s = n[1], c = n[2], l = Math.sqrt((r * r + i * i + a * a) * (o * o + s * s + c * c)), u = l && e.dot(t, n) / l;
		return Math.acos(Math.min(Math.max(u, -1), 1));
	}
	static zero(e) {
		return e[0] = 0, e[1] = 0, e[2] = 0, e;
	}
	static str(e) {
		return `Vec3(${e.join(", ")})`;
	}
	static exactEquals(e, t) {
		return e[0] === t[0] && e[1] === t[1] && e[2] === t[2];
	}
	static equals(e, t) {
		let n = e[0], r = e[1], i = e[2], a = t[0], o = t[1], s = t[2];
		return Math.abs(n - a) <= 1e-6 * Math.max(1, Math.abs(n), Math.abs(a)) && Math.abs(r - o) <= 1e-6 * Math.max(1, Math.abs(r), Math.abs(o)) && Math.abs(i - s) <= 1e-6 * Math.max(1, Math.abs(i), Math.abs(s));
	}
};
U.prototype.sub = U.prototype.subtract, U.prototype.mul = U.prototype.multiply, U.prototype.div = U.prototype.divide, U.prototype.dist = U.prototype.distance, U.prototype.sqrDist = U.prototype.squaredDistance, U.sub = U.subtract, U.mul = U.multiply, U.div = U.divide, U.dist = U.distance, U.sqrDist = U.squaredDistance, U.sqrLen = U.squaredLength, U.mag = U.magnitude, U.length = U.magnitude, U.len = U.magnitude;
//#endregion
//#region ../../node_modules/.pnpm/gl-matrix@4.0.0-beta.2/node_modules/gl-matrix/dist/esm/vec4.js
var W = class e extends Float32Array {
	static BYTE_LENGTH = 4 * Float32Array.BYTES_PER_ELEMENT;
	constructor(...e) {
		switch (e.length) {
			case 4:
				super(e);
				break;
			case 2:
				super(e[0], e[1], 4);
				break;
			case 1: {
				let t = e[0];
				typeof t == "number" ? super([
					t,
					t,
					t,
					t
				]) : super(t, 0, 4);
				break;
			}
			default: super(4);
		}
	}
	get x() {
		return this[0];
	}
	set x(e) {
		this[0] = e;
	}
	get y() {
		return this[1];
	}
	set y(e) {
		this[1] = e;
	}
	get z() {
		return this[2];
	}
	set z(e) {
		this[2] = e;
	}
	get w() {
		return this[3];
	}
	set w(e) {
		this[3] = e;
	}
	get r() {
		return this[0];
	}
	set r(e) {
		this[0] = e;
	}
	get g() {
		return this[1];
	}
	set g(e) {
		this[1] = e;
	}
	get b() {
		return this[2];
	}
	set b(e) {
		this[2] = e;
	}
	get a() {
		return this[3];
	}
	set a(e) {
		this[3] = e;
	}
	get magnitude() {
		let e = this[0], t = this[1], n = this[2], r = this[3];
		return Math.sqrt(e * e + t * t + n * n + r * r);
	}
	get mag() {
		return this.magnitude;
	}
	get str() {
		return e.str(this);
	}
	copy(e) {
		return super.set(e), this;
	}
	add(e) {
		return this[0] += e[0], this[1] += e[1], this[2] += e[2], this[3] += e[3], this;
	}
	subtract(e) {
		return this[0] -= e[0], this[1] -= e[1], this[2] -= e[2], this[3] -= e[3], this;
	}
	sub(e) {
		return this;
	}
	multiply(e) {
		return this[0] *= e[0], this[1] *= e[1], this[2] *= e[2], this[3] *= e[3], this;
	}
	mul(e) {
		return this;
	}
	divide(e) {
		return this[0] /= e[0], this[1] /= e[1], this[2] /= e[2], this[3] /= e[3], this;
	}
	div(e) {
		return this;
	}
	scale(e) {
		return this[0] *= e, this[1] *= e, this[2] *= e, this[3] *= e, this;
	}
	scaleAndAdd(e, t) {
		return this[0] += e[0] * t, this[1] += e[1] * t, this[2] += e[2] * t, this[3] += e[3] * t, this;
	}
	distance(t) {
		return e.distance(this, t);
	}
	dist(e) {
		return 0;
	}
	squaredDistance(t) {
		return e.squaredDistance(this, t);
	}
	sqrDist(e) {
		return 0;
	}
	negate() {
		return this[0] *= -1, this[1] *= -1, this[2] *= -1, this[3] *= -1, this;
	}
	invert() {
		return this[0] = 1 / this[0], this[1] = 1 / this[1], this[2] = 1 / this[2], this[3] = 1 / this[3], this;
	}
	abs() {
		return this[0] = Math.abs(this[0]), this[1] = Math.abs(this[1]), this[2] = Math.abs(this[2]), this[3] = Math.abs(this[3]), this;
	}
	dot(e) {
		return this[0] * e[0] + this[1] * e[1] + this[2] * e[2] + this[3] * e[3];
	}
	normalize() {
		return e.normalize(this, this);
	}
	static create() {
		return new e();
	}
	static clone(t) {
		return new e(t);
	}
	static fromValues(t, n, r, i) {
		return new e(t, n, r, i);
	}
	static copy(e, t) {
		return e[0] = t[0], e[1] = t[1], e[2] = t[2], e[3] = t[3], e;
	}
	static set(e, t, n, r, i) {
		return e[0] = t, e[1] = n, e[2] = r, e[3] = i, e;
	}
	static add(e, t, n) {
		return e[0] = t[0] + n[0], e[1] = t[1] + n[1], e[2] = t[2] + n[2], e[3] = t[3] + n[3], e;
	}
	static subtract(e, t, n) {
		return e[0] = t[0] - n[0], e[1] = t[1] - n[1], e[2] = t[2] - n[2], e[3] = t[3] - n[3], e;
	}
	static sub(e, t, n) {
		return e;
	}
	static multiply(e, t, n) {
		return e[0] = t[0] * n[0], e[1] = t[1] * n[1], e[2] = t[2] * n[2], e[3] = t[3] * n[3], e;
	}
	static mul(e, t, n) {
		return e;
	}
	static divide(e, t, n) {
		return e[0] = t[0] / n[0], e[1] = t[1] / n[1], e[2] = t[2] / n[2], e[3] = t[3] / n[3], e;
	}
	static div(e, t, n) {
		return e;
	}
	static ceil(e, t) {
		return e[0] = Math.ceil(t[0]), e[1] = Math.ceil(t[1]), e[2] = Math.ceil(t[2]), e[3] = Math.ceil(t[3]), e;
	}
	static floor(e, t) {
		return e[0] = Math.floor(t[0]), e[1] = Math.floor(t[1]), e[2] = Math.floor(t[2]), e[3] = Math.floor(t[3]), e;
	}
	static min(e, t, n) {
		return e[0] = Math.min(t[0], n[0]), e[1] = Math.min(t[1], n[1]), e[2] = Math.min(t[2], n[2]), e[3] = Math.min(t[3], n[3]), e;
	}
	static max(e, t, n) {
		return e[0] = Math.max(t[0], n[0]), e[1] = Math.max(t[1], n[1]), e[2] = Math.max(t[2], n[2]), e[3] = Math.max(t[3], n[3]), e;
	}
	static round(e, t) {
		return e[0] = Math.round(t[0]), e[1] = Math.round(t[1]), e[2] = Math.round(t[2]), e[3] = Math.round(t[3]), e;
	}
	static scale(e, t, n) {
		return e[0] = t[0] * n, e[1] = t[1] * n, e[2] = t[2] * n, e[3] = t[3] * n, e;
	}
	static scaleAndAdd(e, t, n, r) {
		return e[0] = t[0] + n[0] * r, e[1] = t[1] + n[1] * r, e[2] = t[2] + n[2] * r, e[3] = t[3] + n[3] * r, e;
	}
	static distance(e, t) {
		let n = t[0] - e[0], r = t[1] - e[1], i = t[2] - e[2], a = t[3] - e[3];
		return Math.hypot(n, r, i, a);
	}
	static dist(e, t) {
		return 0;
	}
	static squaredDistance(e, t) {
		let n = t[0] - e[0], r = t[1] - e[1], i = t[2] - e[2], a = t[3] - e[3];
		return n * n + r * r + i * i + a * a;
	}
	static sqrDist(e, t) {
		return 0;
	}
	static magnitude(e) {
		let t = e[0], n = e[1], r = e[2], i = e[3];
		return Math.sqrt(t * t + n * n + r * r + i * i);
	}
	static mag(e) {
		return 0;
	}
	static length(e) {
		return 0;
	}
	static len(e) {
		return 0;
	}
	static squaredLength(e) {
		let t = e[0], n = e[1], r = e[2], i = e[3];
		return t * t + n * n + r * r + i * i;
	}
	static sqrLen(e) {
		return 0;
	}
	static negate(e, t) {
		return e[0] = -t[0], e[1] = -t[1], e[2] = -t[2], e[3] = -t[3], e;
	}
	static inverse(e, t) {
		return e[0] = 1 / t[0], e[1] = 1 / t[1], e[2] = 1 / t[2], e[3] = 1 / t[3], e;
	}
	static abs(e, t) {
		return e[0] = Math.abs(t[0]), e[1] = Math.abs(t[1]), e[2] = Math.abs(t[2]), e[3] = Math.abs(t[3]), e;
	}
	static normalize(e, t) {
		let n = t[0], r = t[1], i = t[2], a = t[3], o = n * n + r * r + i * i + a * a;
		return o > 0 && (o = 1 / Math.sqrt(o)), e[0] = n * o, e[1] = r * o, e[2] = i * o, e[3] = a * o, e;
	}
	static dot(e, t) {
		return e[0] * t[0] + e[1] * t[1] + e[2] * t[2] + e[3] * t[3];
	}
	static cross(e, t, n, r) {
		let i = n[0] * r[1] - n[1] * r[0], a = n[0] * r[2] - n[2] * r[0], o = n[0] * r[3] - n[3] * r[0], s = n[1] * r[2] - n[2] * r[1], c = n[1] * r[3] - n[3] * r[1], l = n[2] * r[3] - n[3] * r[2], u = t[0], d = t[1], f = t[2], p = t[3];
		return e[0] = d * l - f * c + p * s, e[1] = -(u * l) + f * o - p * a, e[2] = u * c - d * o + p * i, e[3] = -(u * s) + d * a - f * i, e;
	}
	static lerp(e, t, n, r) {
		let i = t[0], a = t[1], o = t[2], s = t[3];
		return e[0] = i + r * (n[0] - i), e[1] = a + r * (n[1] - a), e[2] = o + r * (n[2] - o), e[3] = s + r * (n[3] - s), e;
	}
	static transformMat4(e, t, n) {
		let r = t[0], i = t[1], a = t[2], o = t[3];
		return e[0] = n[0] * r + n[4] * i + n[8] * a + n[12] * o, e[1] = n[1] * r + n[5] * i + n[9] * a + n[13] * o, e[2] = n[2] * r + n[6] * i + n[10] * a + n[14] * o, e[3] = n[3] * r + n[7] * i + n[11] * a + n[15] * o, e;
	}
	static transformQuat(e, t, n) {
		let r = t[0], i = t[1], a = t[2], o = n[0], s = n[1], c = n[2], l = n[3], u = l * r + s * a - c * i, d = l * i + c * r - o * a, f = l * a + o * i - s * r, p = -o * r - s * i - c * a;
		return e[0] = u * l + p * -o + d * -c - f * -s, e[1] = d * l + p * -s + f * -o - u * -c, e[2] = f * l + p * -c + u * -s - d * -o, e[3] = t[3], e;
	}
	static zero(e) {
		return e[0] = 0, e[1] = 0, e[2] = 0, e[3] = 0, e;
	}
	static str(e) {
		return `Vec4(${e.join(", ")})`;
	}
	static exactEquals(e, t) {
		return e[0] === t[0] && e[1] === t[1] && e[2] === t[2] && e[3] === t[3];
	}
	static equals(e, t) {
		let n = e[0], r = e[1], i = e[2], a = e[3], o = t[0], s = t[1], c = t[2], l = t[3];
		return Math.abs(n - o) <= 1e-6 * Math.max(1, Math.abs(n), Math.abs(o)) && Math.abs(r - s) <= 1e-6 * Math.max(1, Math.abs(r), Math.abs(s)) && Math.abs(i - c) <= 1e-6 * Math.max(1, Math.abs(i), Math.abs(c)) && Math.abs(a - l) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(l));
	}
};
W.prototype.sub = W.prototype.subtract, W.prototype.mul = W.prototype.multiply, W.prototype.div = W.prototype.divide, W.prototype.dist = W.prototype.distance, W.prototype.sqrDist = W.prototype.squaredDistance, W.sub = W.subtract, W.mul = W.multiply, W.div = W.divide, W.dist = W.distance, W.sqrDist = W.squaredDistance, W.sqrLen = W.squaredLength, W.mag = W.magnitude, W.length = W.magnitude, W.len = W.magnitude;
//#endregion
//#region ../../node_modules/.pnpm/gl-matrix@4.0.0-beta.2/node_modules/gl-matrix/dist/esm/vec2.js
var G = class e extends Float32Array {
	static BYTE_LENGTH = 2 * Float32Array.BYTES_PER_ELEMENT;
	constructor(...e) {
		switch (e.length) {
			case 2: {
				let t = e[0];
				typeof t == "number" ? super([t, e[1]]) : super(t, e[1], 2);
				break;
			}
			case 1: {
				let t = e[0];
				typeof t == "number" ? super([t, t]) : super(t, 0, 2);
				break;
			}
			default: super(2);
		}
	}
	get x() {
		return this[0];
	}
	set x(e) {
		this[0] = e;
	}
	get y() {
		return this[1];
	}
	set y(e) {
		this[1] = e;
	}
	get r() {
		return this[0];
	}
	set r(e) {
		this[0] = e;
	}
	get g() {
		return this[1];
	}
	set g(e) {
		this[1] = e;
	}
	get magnitude() {
		return Math.hypot(this[0], this[1]);
	}
	get mag() {
		return this.magnitude;
	}
	get squaredMagnitude() {
		let e = this[0], t = this[1];
		return e * e + t * t;
	}
	get sqrMag() {
		return this.squaredMagnitude;
	}
	get str() {
		return e.str(this);
	}
	copy(e) {
		return this.set(e), this;
	}
	add(e) {
		return this[0] += e[0], this[1] += e[1], this;
	}
	subtract(e) {
		return this[0] -= e[0], this[1] -= e[1], this;
	}
	sub(e) {
		return this;
	}
	multiply(e) {
		return this[0] *= e[0], this[1] *= e[1], this;
	}
	mul(e) {
		return this;
	}
	divide(e) {
		return this[0] /= e[0], this[1] /= e[1], this;
	}
	div(e) {
		return this;
	}
	scale(e) {
		return this[0] *= e, this[1] *= e, this;
	}
	scaleAndAdd(e, t) {
		return this[0] += e[0] * t, this[1] += e[1] * t, this;
	}
	distance(t) {
		return e.distance(this, t);
	}
	dist(e) {
		return 0;
	}
	squaredDistance(t) {
		return e.squaredDistance(this, t);
	}
	sqrDist(e) {
		return 0;
	}
	negate() {
		return this[0] *= -1, this[1] *= -1, this;
	}
	invert() {
		return this[0] = 1 / this[0], this[1] = 1 / this[1], this;
	}
	abs() {
		return this[0] = Math.abs(this[0]), this[1] = Math.abs(this[1]), this;
	}
	dot(e) {
		return this[0] * e[0] + this[1] * e[1];
	}
	normalize() {
		return e.normalize(this, this);
	}
	static create() {
		return new e();
	}
	static clone(t) {
		return new e(t);
	}
	static fromValues(t, n) {
		return new e(t, n);
	}
	static copy(e, t) {
		return e[0] = t[0], e[1] = t[1], e;
	}
	static set(e, t, n) {
		return e[0] = t, e[1] = n, e;
	}
	static add(e, t, n) {
		return e[0] = t[0] + n[0], e[1] = t[1] + n[1], e;
	}
	static subtract(e, t, n) {
		return e[0] = t[0] - n[0], e[1] = t[1] - n[1], e;
	}
	static sub(e, t, n) {
		return [0, 0];
	}
	static multiply(e, t, n) {
		return e[0] = t[0] * n[0], e[1] = t[1] * n[1], e;
	}
	static mul(e, t, n) {
		return [0, 0];
	}
	static divide(e, t, n) {
		return e[0] = t[0] / n[0], e[1] = t[1] / n[1], e;
	}
	static div(e, t, n) {
		return [0, 0];
	}
	static ceil(e, t) {
		return e[0] = Math.ceil(t[0]), e[1] = Math.ceil(t[1]), e;
	}
	static floor(e, t) {
		return e[0] = Math.floor(t[0]), e[1] = Math.floor(t[1]), e;
	}
	static min(e, t, n) {
		return e[0] = Math.min(t[0], n[0]), e[1] = Math.min(t[1], n[1]), e;
	}
	static max(e, t, n) {
		return e[0] = Math.max(t[0], n[0]), e[1] = Math.max(t[1], n[1]), e;
	}
	static round(e, t) {
		return e[0] = Math.round(t[0]), e[1] = Math.round(t[1]), e;
	}
	static scale(e, t, n) {
		return e[0] = t[0] * n, e[1] = t[1] * n, e;
	}
	static scaleAndAdd(e, t, n, r) {
		return e[0] = t[0] + n[0] * r, e[1] = t[1] + n[1] * r, e;
	}
	static distance(e, t) {
		return Math.hypot(t[0] - e[0], t[1] - e[1]);
	}
	static dist(e, t) {
		return 0;
	}
	static squaredDistance(e, t) {
		let n = t[0] - e[0], r = t[1] - e[1];
		return n * n + r * r;
	}
	static sqrDist(e, t) {
		return 0;
	}
	static magnitude(e) {
		let t = e[0], n = e[1];
		return Math.sqrt(t * t + n * n);
	}
	static mag(e) {
		return 0;
	}
	static length(e) {
		return 0;
	}
	static len(e) {
		return 0;
	}
	static squaredLength(e) {
		let t = e[0], n = e[1];
		return t * t + n * n;
	}
	static sqrLen(e, t) {
		return 0;
	}
	static negate(e, t) {
		return e[0] = -t[0], e[1] = -t[1], e;
	}
	static inverse(e, t) {
		return e[0] = 1 / t[0], e[1] = 1 / t[1], e;
	}
	static abs(e, t) {
		return e[0] = Math.abs(t[0]), e[1] = Math.abs(t[1]), e;
	}
	static normalize(e, t) {
		let n = t[0], r = t[1], i = n * n + r * r;
		return i > 0 && (i = 1 / Math.sqrt(i)), e[0] = t[0] * i, e[1] = t[1] * i, e;
	}
	static dot(e, t) {
		return e[0] * t[0] + e[1] * t[1];
	}
	static cross(e, t, n) {
		let r = t[0] * n[1] - t[1] * n[0];
		return e[0] = e[1] = 0, e[2] = r, e;
	}
	static lerp(e, t, n, r) {
		let i = t[0], a = t[1];
		return e[0] = i + r * (n[0] - i), e[1] = a + r * (n[1] - a), e;
	}
	static transformMat2(e, t, n) {
		let r = t[0], i = t[1];
		return e[0] = n[0] * r + n[2] * i, e[1] = n[1] * r + n[3] * i, e;
	}
	static transformMat2d(e, t, n) {
		let r = t[0], i = t[1];
		return e[0] = n[0] * r + n[2] * i + n[4], e[1] = n[1] * r + n[3] * i + n[5], e;
	}
	static transformMat3(e, t, n) {
		let r = t[0], i = t[1];
		return e[0] = n[0] * r + n[3] * i + n[6], e[1] = n[1] * r + n[4] * i + n[7], e;
	}
	static transformMat4(e, t, n) {
		let r = t[0], i = t[1];
		return e[0] = n[0] * r + n[4] * i + n[12], e[1] = n[1] * r + n[5] * i + n[13], e;
	}
	static rotate(e, t, n, r) {
		let i = t[0] - n[0], a = t[1] - n[1], o = Math.sin(r), s = Math.cos(r);
		return e[0] = i * s - a * o + n[0], e[1] = i * o + a * s + n[1], e;
	}
	static angle(e, t) {
		let n = e[0], r = e[1], i = t[0], a = t[1], o = Math.sqrt(n * n + r * r) * Math.sqrt(i * i + a * a), s = o && (n * i + r * a) / o;
		return Math.acos(Math.min(Math.max(s, -1), 1));
	}
	static zero(e) {
		return e[0] = 0, e[1] = 0, e;
	}
	static exactEquals(e, t) {
		return e[0] === t[0] && e[1] === t[1];
	}
	static equals(e, t) {
		let n = e[0], r = e[1], i = t[0], a = t[1];
		return Math.abs(n - i) <= 1e-6 * Math.max(1, Math.abs(n), Math.abs(i)) && Math.abs(r - a) <= 1e-6 * Math.max(1, Math.abs(r), Math.abs(a));
	}
	static str(e) {
		return `Vec2(${e.join(", ")})`;
	}
};
G.prototype.sub = G.prototype.subtract, G.prototype.mul = G.prototype.multiply, G.prototype.div = G.prototype.divide, G.prototype.dist = G.prototype.distance, G.prototype.sqrDist = G.prototype.squaredDistance, G.sub = G.subtract, G.mul = G.multiply, G.div = G.divide, G.dist = G.distance, G.sqrDist = G.squaredDistance, G.sqrLen = G.squaredLength, G.mag = G.magnitude, G.length = G.magnitude, G.len = G.magnitude;
//#endregion
//#region src/utils/clamp.ts
function Ie(e, t, n) {
	return Math.min(Math.max(e, t), n);
}
function K(e) {
	return Ie(e, 0, 1);
}
function Le(e) {
	return Math.max(0, e);
}
//#endregion
//#region src/bg-render/img.ts
function Re(e, t, n) {
	let r = e.data, i = e.width, a = e.height, o, s, c, l, u, d, f, p, m, h, g, _, v, y = i - 1, b = a - 1, x = t + 1, S = t + x, C = t + 1, w = 1 / (S * (t + C)), T = [], E = [], D = [], O = [], k = [], A = [];
	for (; n-- > 0;) {
		for (v = _ = 0, d = 0; d < a; d++) {
			for (o = r[v] * x, s = r[v + 1] * x, c = r[v + 2] * x, l = r[v + 3] * x, f = 1; f <= t; f++) p = v + ((f > y ? y : f) << 2), o += r[p++], s += r[p++], c += r[p++], l += r[p];
			for (u = 0; u < i; u++) T[_] = o, E[_] = s, D[_] = c, O[_] = l, d === 0 && (k[u] = Math.min(u + x, y) << 2, A[u] = Math.max(u - t, 0) << 2), m = v + k[u], h = v + A[u], o += r[m++] - r[h++], s += r[m++] - r[h++], c += r[m++] - r[h++], l += r[m] - r[h], _++;
			v += i << 2;
		}
		for (u = 0; u < i; u++) {
			for (g = u, o = T[g] * C, s = E[g] * C, c = D[g] * C, l = O[g] * C, f = 1; f <= t; f++) g += f > b ? 0 : i, o += T[g], s += E[g], c += D[g], l += O[g];
			for (_ = u << 2, d = 0; d < a; d++) r[_] = o * w + .5 | 0, r[_ + 1] = s * w + .5 | 0, r[_ + 2] = c * w + .5 | 0, r[_ + 3] = l * w + .5 | 0, u === 0 && (k[d] = Math.min(d + C, b) * i, A[d] = Math.max(d - t, 0) * i), m = u + k[d], h = u + A[d], o += T[m] - T[h], s += E[m] - E[h], c += D[m] - D[h], l += O[m] - O[h], _ += i << 2;
		}
	}
}
//#endregion
//#region src/bg-render/mesh-renderer/cp-presets.ts
var q = (e, t, n, r, i = 0, a = 0, o = 1, s = 1) => Object.freeze({
	cx: e,
	cy: t,
	x: n,
	y: r,
	ur: i,
	vr: a,
	up: o,
	vp: s
}), J = (e, t, n) => Object.freeze({
	width: e,
	height: t,
	conf: n
}), ze = [
	J(5, 5, [
		q(0, 0, -1, -1, 0, 0, 1, 1),
		q(1, 0, -.5, -1, 0, 0, 1, 1),
		q(2, 0, 0, -1, 0, 0, 1, 1),
		q(3, 0, .5, -1, 0, 0, 1, 1),
		q(4, 0, 1, -1, 0, 0, 1, 1),
		q(0, 1, -1, -.5, 0, 0, 1, 1),
		q(1, 1, -.5, -.5, 0, 0, 1, 1),
		q(2, 1, -.0052029684413368305, -.6131420587090777, 0, 0, 1, 1),
		q(3, 1, .5884227308309977, -.3990805107556692, 0, 0, 1, 1),
		q(4, 1, 1, -.5, 0, 0, 1, 1),
		q(0, 2, -1, 0, 0, 0, 1, 1),
		q(1, 2, -.4210024670505933, -.11895058380429502, 0, 0, 1, 1),
		q(2, 2, -.1019613423315412, -.023812118047224606, 0, -47, .629, .849),
		q(3, 2, .40275125660925437, -.06345314544600389, 0, 0, 1, 1),
		q(4, 2, 1, 0, 0, 0, 1, 1),
		q(0, 3, -1, .5, 0, 0, 1, 1),
		q(1, 3, .06801958477287173, .5205913248960121, -31, -45, 1, 1),
		q(2, 3, .21446469120128908, .29331610114301043, 6, -56, .566, 1.321),
		q(3, 3, .5, .5, 0, 0, 1, 1),
		q(4, 3, 1, .5, 0, 0, 1, 1),
		q(0, 4, -1, 1, 0, 0, 1, 1),
		q(1, 4, -.31378372841550195, 1, 0, 0, 1, 1),
		q(2, 4, .26153633255328046, 1, 0, 0, 1, 1),
		q(3, 4, .5, 1, 0, 0, 1, 1),
		q(4, 4, 1, 1, 0, 0, 1, 1)
	]),
	J(4, 4, [
		q(0, 0, -1, -1, 0, 0, 1, 1),
		q(1, 0, -.33333333333333337, -1, 0, 0, 1, 1),
		q(2, 0, .33333333333333326, -1, 0, 0, 1, 1),
		q(3, 0, 1, -1, 0, 0, 1, 1),
		q(0, 1, -1, -.04495399932657351, 0, 0, 1, 1),
		q(1, 1, -.24056117520129328, -.22465999020104, 0, 0, 1, 1),
		q(2, 1, .334758885767489, -.00531297192779423, 0, 0, 1, 1),
		q(3, 1, .9989920470678106, -.3382976020775408, 8, 0, .566, 1.792),
		q(0, 2, -1, .33333333333333326, 0, 0, 1, 1),
		q(1, 2, -.3425497314639411, -27501607956947893e-21, 0, 0, 1, 1),
		q(2, 2, .3321437945812673, .1981776353859399, 0, 0, 1, 1),
		q(3, 2, 1, .0766118180296832, 0, 0, 1, 1),
		q(0, 3, -1, 1, 0, 0, 1, 1),
		q(1, 3, -.33333333333333337, 1, 0, 0, 1, 1),
		q(2, 3, .33333333333333326, 1, 0, 0, 1, 1),
		q(3, 3, 1, 1, 0, 0, 1, 1)
	]),
	J(4, 4, [
		q(0, 0, -1, -1, 0, 0, 1, 2.075),
		q(1, 0, -.33333333333333337, -1, 0, 0, 1, 1),
		q(2, 0, .33333333333333326, -1, 0, 0, 1, 1),
		q(3, 0, 1, -1, 0, 0, 1, 1),
		q(0, 1, -1, -.4545779491139603, 0, 0, 1, 1),
		q(1, 1, -.33333333333333337, -.33333333333333337, 0, 0, 1, 1),
		q(2, 1, .0889403142626457, -.6025711180694033, -32, 45, 1, 1),
		q(3, 1, 1, -.33333333333333337, 0, 0, 1, 1),
		q(0, 2, -1, -.07402408608567845, 1, 0, 1, .094),
		q(1, 2, -.2719422694359541, .09775369930903222, 25, -18, 1.321, 0),
		q(2, 2, .19877414408395877, .4307383294587789, 48, -40, .755, .975),
		q(3, 2, 1, .33333333333333326, -37, 0, 1, 1),
		q(0, 3, -1, 1, 0, 0, 1, 1),
		q(1, 3, -.33333333333333337, 1, 0, 0, 1, 1),
		q(2, 3, .5125850864305672, 1, -20, -18, 0, 1.604),
		q(3, 3, 1, 1, 0, 0, 1, 1)
	]),
	J(5, 5, [
		q(0, 0, -1, -1, 0, 0, 1, 1),
		q(1, 0, -.4501953125, -1, 0, 55, 1, 2.075),
		q(2, 0, .1953125, -1, 0, 0, 1, 1),
		q(3, 0, .4580078125, -1, 0, -25, 1, 1),
		q(4, 0, 1, -1, 0, 0, 1, 1),
		q(0, 1, -1, -.2514475377525607, -16, 0, 2.327, .943),
		q(1, 1, -.55859375, -.6609325945787148, 47, 0, 2.358, .377),
		q(2, 1, .232421875, -.5244375756366635, -66, -25, 1.855, 1.164),
		q(3, 1, .685546875, -.3753706470552125, 0, 0, 1, 1),
		q(4, 1, 1, -.6699125300354287, 0, 0, 1, 1),
		q(0, 2, -1, .035910396862284255, 0, 0, 1, 1),
		q(1, 2, -.4921875, .005378616309457018, 90, 23, 1, 1.981),
		q(2, 2, .021484375, -.1365043639066228, 0, 42, 1, 1),
		q(3, 2, .4765625, .05925822904974043, -30, 0, 1.95, .44),
		q(4, 2, 1, .251428847823418, 0, 0, 1, 1),
		q(0, 3, -1, .6968336464764276, -68, 0, 1, .786),
		q(1, 3, -.6904296875, .5890744209958608, -68, 0, 1, 1),
		q(2, 3, .1845703125, .3879238667654693, 61, 0, 1, 1),
		q(3, 3, .60546875, .4633553246018661, -47, -59, .849, 1.73),
		q(4, 3, 1, .6214021886400309, -33, 0, .377, 1.604),
		q(0, 4, -1, 1, 0, 0, 1, 1),
		q(1, 4, -.5, 1, 0, -73, 1, 1),
		q(2, 4, -.3271484375, 1, 0, -24, .314, 2.704),
		q(3, 4, .5, 1, 0, 0, 1, 1),
		q(4, 4, 1, 1, 0, 0, 1, 1)
	]),
	J(5, 5, [
		q(0, 0, -1, -1),
		q(1, 0, -.6393, -1, 0, 0, 1, 2.3884),
		q(2, 0, 0, -1),
		q(3, 0, .5, -1),
		q(4, 0, 1, -1),
		q(0, 1, -1, -.2301),
		q(1, 1, -.6934, -.331, 0, -.7188, 1, 1.063),
		q(2, 1, -.0082, -.6814, -.2583, 0, 1.0964, 1),
		q(3, 1, .5836, -.531, .7029, 0, 1.5466, 1),
		q(4, 1, 1, -.6407),
		q(0, 2, -1, .2973, 0, 0, 1.8352, 1),
		q(1, 2, -.4082, .0602),
		q(2, 2, -.1803, -.3646, -.2998, 0, 1.1513, 1),
		q(3, 2, .477, -.1027, .8903, -.1882, 1.0807, .8551),
		q(4, 2, 1, -.2973),
		q(0, 3, -1, .7628, 0, 0, 2.3868, 1),
		q(1, 3, -.2525, .4814, -.8406, -1.6199, 1.4093, 1.2215),
		q(2, 3, .3607, .2814, -1.0713, -.0529, 1.0025, .7611),
		q(3, 3, .4885, .623, 0, .8184, 1, 1.2876),
		q(4, 3, 1, .5),
		q(0, 4, -1, 1),
		q(1, 4, -.4033, 1),
		q(2, 4, .2672, 1),
		q(3, 4, .5967, 1),
		q(4, 4, 1, 1)
	]),
	J(5, 5, [
		q(0, 0, -1, -1),
		q(1, 0, -.2197, -1),
		q(2, 0, .0197, -1),
		q(3, 0, .8033, -1),
		q(4, 0, 1, -1),
		q(0, 1, -1, -.5451),
		q(1, 1, -.4885, -.4035, -1.0246, -.2268, 1.1936, .8005),
		q(2, 1, -.1213, -.2867, 0, -.6981, 1, .809),
		q(3, 1, .3246, -.5628, 0, -1.2188, 1, 1.044),
		q(4, 1, 1, -.3292),
		q(0, 2, -1, .1416),
		q(1, 2, -.341, -.0142, 0, -.4004, 1, 1.1293),
		q(2, 2, -.0393, -.023, .2915, -.373, 1.044, .9879),
		q(3, 2, .3148, -.0673, -.7853, -.8962, 1.4709, 1.0247),
		q(4, 2, 1, .1912),
		q(0, 3, -1, .5),
		q(1, 3, -.2689, .2743, .3404, -.5248, 1.0184, .4391),
		q(2, 3, .0721, .269, .5302, .1244, .6723, .3225),
		q(3, 3, .4148, .3894, -.6977, -.6783, .8094, .9247),
		q(4, 3, 1, .446),
		q(0, 4, -1, 1),
		q(1, 4, -.7311, 1),
		q(2, 4, .323, 1),
		q(3, 4, .6393, 1),
		q(4, 4, 1, 1)
	])
], Y = (e, t) => Math.random() * (t - e) + e;
function Be(e, t, n) {
	let r = K((n - e) / (t - e));
	return r * r * (3 - 2 * r);
}
function Ve(e, t, n, r = 2, i = .5, a = .1) {
	let o = [], s = i;
	for (let r = 0; r < n; r++) {
		o[r] = [];
		for (let n = 0; n < t; n++) o[r][n] = e[r * t + n];
	}
	let c = [
		[
			1,
			2,
			1
		],
		[
			2,
			4,
			2
		],
		[
			1,
			2,
			1
		]
	];
	for (let e = 0; e < r; e++) {
		let e = [];
		for (let r = 0; r < n; r++) {
			e[r] = [];
			for (let i = 0; i < t; i++) {
				if (i === 0 || i === t - 1 || r === 0 || r === n - 1) {
					e[r][i] = o[r][i];
					continue;
				}
				let a = 0, l = 0, u = 0, d = 0, f = 0, p = 0;
				for (let e = -1; e <= 1; e++) for (let t = -1; t <= 1; t++) {
					let n = c[e + 1][t + 1], s = o[r + e][i + t];
					a += s.x * n, l += s.y * n, u += s.ur * n, d += s.vr * n, f += s.up * n, p += s.vp * n;
				}
				let m = a / 16, h = l / 16, g = u / 16, _ = d / 16, v = f / 16, y = p / 16, b = o[r][i], x = b.x * (1 - s) + m * s, S = b.y * (1 - s) + h * s, C = b.ur * (1 - s) + g * s, w = b.vr * (1 - s) + _ * s, T = b.up * (1 - s) + v * s, E = b.vp * (1 - s) + y * s;
				e[r][i] = q(i, r, x, S, C, w, T, E);
			}
		}
		o = e, s = K(s + a);
	}
	for (let r = 0; r < n; r++) for (let n = 0; n < t; n++) e[r * t + n] = o[r][n];
}
function X(e, t) {
	return He(Math.sin(e * 12.9898 + t * 78.233) * 43758.5453);
}
function He(e) {
	return e - Math.floor(e);
}
function Ue(e, t) {
	let n = Math.floor(e), r = Math.floor(t), i = n + 1, a = r + 1, o = e - n, s = t - r, c = o * o * (3 - 2 * o), l = s * s * (3 - 2 * s), u = X(n, r), d = X(i, r), f = X(n, a), p = X(i, a), m = u * (1 - c) + d * c, h = f * (1 - c) + p * c;
	return m * (1 - l) + h * l;
}
function We(e, t, n, r = .001) {
	let i = e(t + r, n), a = e(t - r, n), o = e(t, n + r), s = e(t, n - r), c = (i - a) / (2 * r), l = (o - s) / (2 * r), u = Math.sqrt(c * c + l * l) || 1;
	return [c / u, l / u];
}
function Ge(e, t, n = Y(.4, .6), r = Y(.3, .6), i = .8, a = Math.floor(Y(3, 5)), o = Y(.2, .3), s = Y(-.1, -.05)) {
	let c = e ?? Math.floor(Y(3, 6)), l = t ?? Math.floor(Y(3, 6)), u = [], d = c === 1 ? 0 : 2 / (c - 1), f = l === 1 ? 0 : 2 / (l - 1);
	for (let e = 0; e < l; e++) for (let t = 0; t < c; t++) {
		let a = (c === 1 ? 0 : t / (c - 1)) * 2 - 1, o = (l === 1 ? 0 : e / (l - 1)) * 2 - 1, s = t === 0 || t === c - 1 || e === 0 || e === l - 1, p = s ? 0 : Y(-n * d, n * d), m = s ? 0 : Y(-n * f, n * f), h = a + p, g = o + m, _ = s ? 0 : Y(-60, 60), v = s ? 0 : Y(-60, 60), y = s ? 1 : Y(.8, 1.2), b = s ? 1 : Y(.8, 1.2);
		if (!s) {
			let e = (a + 1) / 2, t = (o + 1) / 2, [n, s] = We(Ue, e, t, .001), c = n * r, l = s * r, u = Be(0, 1, Math.min(e, 1 - e, t, 1 - t));
			c *= u, l *= u, h = h * (1 - i) + (h + c) * i, g = g * (1 - i) + (g + l) * i;
		}
		u.push(q(t, e, h, g, _, v, y, b));
	}
	return Ve(u, c, l, a, o, s), J(c, l, u);
}
//#endregion
//#region src/bg-render/mesh-renderer/mesh.frag.glsl?raw
var Ke = "precision mediump float;\n\nvarying vec3 v_color;\nvarying vec2 v_uv;\nuniform sampler2D u_texture;\nuniform float u_volume;\nuniform float u_alpha;\nuniform float u_sinAngle;\nuniform float u_cosAngle;\n\n// 预计算常量\nconst float INV_255 = 1.0 / 255.0;\nconst float HALF_INV_255 = 0.5 / 255.0;\nconst float GRADIENT_NOISE_A = 52.9829189;\nconst vec2 GRADIENT_NOISE_B = vec2(0.06711056, 0.00583715);\n\nfloat gradientNoise(in vec2 uv) {\n    return fract(GRADIENT_NOISE_A * fract(dot(uv, GRADIENT_NOISE_B)));\n}\n\nvoid main() {\n    float volumeEffect = u_volume * 2.0;\n\n    float dither = INV_255 * gradientNoise(gl_FragCoord.xy) - HALF_INV_255;\n\n    vec2 centeredUV = v_uv - vec2(0.2);\n\n    vec2 rotatedUV = vec2(\n        u_cosAngle * centeredUV.x - u_sinAngle * centeredUV.y,\n        u_sinAngle * centeredUV.x + u_cosAngle * centeredUV.y\n    );\n\n    vec2 finalUV = rotatedUV * max(0.001, 1.0 - volumeEffect) + vec2(0.5);\n    \n    vec4 result = texture2D(u_texture, finalUV);\n    \n    float alphaVolumeFactor = u_alpha * max(0.5, 1.0 - u_volume * 0.5);\n    result.rgb *= v_color * alphaVolumeFactor;\n    result.a *= alphaVolumeFactor;\n    \n    result.rgb += vec3(dither);\n    \n    float dist = distance(v_uv, vec2(0.5));\n    float vignette = smoothstep(0.8, 0.3, dist);\n    float mask = 0.6 + vignette * 0.4;\n    result.rgb *= mask;\n    \n    gl_FragColor = result;\n}\n", qe = "precision mediump float;\n\nattribute vec2 a_pos;\nattribute vec3 a_color;\nattribute vec2 a_uv;\nvarying vec3 v_color;\nvarying vec2 v_uv;\n\nuniform float u_aspect;\n\nvoid main() {\n    v_color = a_color;\n    v_uv = a_uv;\n    vec2 pos = a_pos;\n    if (u_aspect > 1.0) {\n        pos.y *= u_aspect;\n    } else {\n        pos.x /= u_aspect;\n    }\n    gl_Position = vec4(pos, 0.0, 1.0);\n}\n", Je = "\nattribute vec2 a_pos;\nvarying vec2 v_uv;\nvoid main() {\n    gl_Position = vec4(a_pos, 0.0, 1.0);\n    v_uv = a_pos * 0.5 + 0.5;\n}\n", Ye = "\nprecision mediump float;\nvarying vec2 v_uv;\nuniform sampler2D u_texture;\nuniform float u_alpha;\nvoid main() {\n    vec4 color = texture2D(u_texture, v_uv);\n    gl_FragColor = vec4(color.rgb, color.a * u_alpha);\n}\n";
function Xe(e) {
	return -(Math.cos(Math.PI * e) - 1) / 2;
}
var Ze = class {
	gl;
	attrPos;
	attrColor;
	attrUV;
	vertexWidth = 0;
	vertexHeight = 0;
	vertexBuffer;
	indexBuffer;
	vertexData;
	indexData;
	vertexIndexLength = 0;
	wireFrame = !1;
	constructor(e, t, n, r) {
		this.gl = e, this.attrPos = t, this.attrColor = n, this.attrUV = r;
		let i = e.createBuffer();
		if (!i) throw Error("Failed to create vertex buffer");
		this.vertexBuffer = i;
		let a = e.createBuffer();
		if (!a) throw Error("Failed to create index buffer");
		this.indexBuffer = a, this.bind(), this.vertexData = /* @__PURE__ */ new Float32Array(), this.indexData = /* @__PURE__ */ new Uint16Array(), this.resize(2, 2), this.update();
	}
	setWireFrame(e) {
		this.wireFrame = e, this.resize(this.vertexWidth, this.vertexHeight);
	}
	setVertexPos(e, t, n, r) {
		let i = (e + t * this.vertexWidth) * 7;
		i >= this.vertexData.length - 1 ? console.warn("Vertex position out of range", i, this.vertexData.length) : (this.vertexData[i] = n, this.vertexData[i + 1] = r);
	}
	setVertexColor(e, t, n, r, i) {
		let a = (e + t * this.vertexWidth) * 7 + 2;
		a >= this.vertexData.length - 2 ? console.warn("Vertex color out of range", a, this.vertexData.length) : (this.vertexData[a] = n, this.vertexData[a + 1] = r, this.vertexData[a + 2] = i);
	}
	setVertexUV(e, t, n, r) {
		let i = (e + t * this.vertexWidth) * 7 + 5;
		i >= this.vertexData.length - 1 ? console.warn("Vertex UV out of range", i, this.vertexData.length) : (this.vertexData[i] = n, this.vertexData[i + 1] = r);
	}
	setVertexData(e, t, n, r, i, a, o, s, c) {
		let l = (e + t * this.vertexWidth) * 7;
		if (l >= this.vertexData.length - 6) {
			console.warn("Vertex data out of range", l, this.vertexData.length);
			return;
		}
		let u = this.vertexData;
		u[l] = n, u[l + 1] = r, u[l + 2] = i, u[l + 3] = a, u[l + 4] = o, u[l + 5] = s, u[l + 6] = c;
	}
	getVertexIndexLength() {
		return this.vertexIndexLength;
	}
	draw() {
		let e = this.gl;
		this.wireFrame ? e.drawElements(e.LINES, this.vertexIndexLength, e.UNSIGNED_SHORT, 0) : e.drawElements(e.TRIANGLES, this.vertexIndexLength, e.UNSIGNED_SHORT, 0);
	}
	resize(e, t) {
		this.vertexWidth = e, this.vertexHeight = t, this.vertexIndexLength = e * t * 6, this.wireFrame && (this.vertexIndexLength = e * t * 10);
		let n = new Float32Array(e * t * 7), r = new Uint16Array(this.vertexIndexLength);
		this.vertexData = n, this.indexData = r;
		for (let n = 0; n < t; n++) for (let r = 0; r < e; r++) {
			let i = r / (e - 1) * 2 - 1, a = n / (t - 1) * 2 - 1;
			this.setVertexPos(r, n, i || 0, a || 0), this.setVertexColor(r, n, 1, 1, 1), this.setVertexUV(r, n, r / (e - 1), n / (t - 1));
		}
		for (let n = 0; n < t - 1; n++) for (let t = 0; t < e - 1; t++) if (this.wireFrame) {
			let i = (n * e + t) * 10;
			r[i] = n * e + t, r[i + 1] = n * e + t + 1, r[i + 2] = n * e + t + 1, r[i + 3] = (n + 1) * e + t, r[i + 4] = (n + 1) * e + t, r[i + 5] = (n + 1) * e + t + 1, r[i + 6] = (n + 1) * e + t + 1, r[i + 7] = n * e + t + 1, r[i + 8] = n * e + t, r[i + 9] = (n + 1) * e + t;
		} else {
			let i = (n * e + t) * 6;
			r[i] = n * e + t, r[i + 1] = n * e + t + 1, r[i + 2] = (n + 1) * e + t, r[i + 3] = n * e + t + 1, r[i + 4] = (n + 1) * e + t + 1, r[i + 5] = (n + 1) * e + t;
		}
		let i = this.gl;
		i.bindBuffer(i.ELEMENT_ARRAY_BUFFER, this.indexBuffer), i.bufferData(i.ELEMENT_ARRAY_BUFFER, this.indexData, i.STATIC_DRAW);
	}
	bind() {
		let e = this.gl;
		e.bindBuffer(e.ARRAY_BUFFER, this.vertexBuffer), e.bindBuffer(e.ELEMENT_ARRAY_BUFFER, this.indexBuffer), this.attrPos !== void 0 && (e.vertexAttribPointer(this.attrPos, 2, e.FLOAT, !1, 28, 0), e.enableVertexAttribArray(this.attrPos)), this.attrColor !== void 0 && (e.vertexAttribPointer(this.attrColor, 3, e.FLOAT, !1, 28, 8), e.enableVertexAttribArray(this.attrColor)), this.attrUV !== void 0 && (e.vertexAttribPointer(this.attrUV, 2, e.FLOAT, !1, 28, 20), e.enableVertexAttribArray(this.attrUV));
	}
	update() {
		let e = this.gl;
		e.bindBuffer(e.ARRAY_BUFFER, this.vertexBuffer), e.bufferData(e.ARRAY_BUFFER, this.vertexData, e.DYNAMIC_DRAW);
	}
	dispose() {
		this.gl.deleteBuffer(this.vertexBuffer), this.gl.deleteBuffer(this.indexBuffer);
	}
}, Qe = class {
	color = U.fromValues(1, 1, 1);
	location = G.fromValues(0, 0);
	uTangent = G.fromValues(0, 0);
	vTangent = G.fromValues(0, 0);
	_uRot = 0;
	_vRot = 0;
	_uScale = 1;
	_vScale = 1;
	constructor() {
		Object.seal(this);
	}
	get uRot() {
		return this._uRot;
	}
	get vRot() {
		return this._vRot;
	}
	set uRot(e) {
		this._uRot = e, this.updateUTangent();
	}
	set vRot(e) {
		this._vRot = e, this.updateVTangent();
	}
	get uScale() {
		return this._uScale;
	}
	get vScale() {
		return this._vScale;
	}
	set uScale(e) {
		this._uScale = e, this.updateUTangent();
	}
	set vScale(e) {
		this._vScale = e, this.updateVTangent();
	}
	updateUTangent() {
		this.uTangent[0] = Math.cos(this._uRot) * this._uScale, this.uTangent[1] = Math.sin(this._uRot) * this._uScale;
	}
	updateVTangent() {
		this.vTangent[0] = -Math.sin(this._vRot) * this._vScale, this.vTangent[1] = Math.cos(this._vRot) * this._vScale;
	}
}, $e = V.fromValues(2, -2, 1, 1, -3, 3, -2, -1, 0, 0, 1, 0, 1, 0, 0, 0), et = V.clone($e).transpose();
function tt(e, t, n, r, i, a = V.create()) {
	let o = (e) => e.location[i], s = (e) => e.uTangent[i], c = (e) => e.vTangent[i];
	return a[0] = o(e), a[1] = o(t), a[2] = c(e), a[3] = c(t), a[4] = o(n), a[5] = o(r), a[6] = c(n), a[7] = c(r), a[8] = s(e), a[9] = s(t), a[10] = 0, a[11] = 0, a[12] = s(n), a[13] = s(r), a[14] = 0, a[15] = 0, a;
}
function nt(e, t, n, r, i, a = V.create()) {
	let o = (e) => e.color[i];
	return a.fill(0), a[0] = o(e), a[1] = o(t), a[4] = o(n), a[5] = o(r), a;
}
var rt = class {
	_width = 0;
	_height = 0;
	_data = [];
	constructor(e, t) {
		this.resize(e, t), Object.seal(this);
	}
	resize(e, t) {
		this._width = e, this._height = t, this._data = Array(e * t).fill(0);
	}
	set(e, t, n) {
		this._data[e + t * this._width] = n;
	}
	get(e, t) {
		return this._data[e + t * this._width];
	}
	get width() {
		return this._width;
	}
	get height() {
		return this._height;
	}
}, it = class extends Ze {
	_subDivisions = 10;
	_controlPoints = new rt(3, 3);
	constructor(e, t, n, r) {
		super(e, t, n, r), this.resizeControlPoints(3, 3), Object.seal(this);
	}
	setWireFrame(e) {
		super.setWireFrame(e), this.updateMesh();
	}
	resetSubdivition(e) {
		this._subDivisions = e, super.resize((this._controlPoints.width - 1) * e, (this._controlPoints.height - 1) * e);
	}
	resizeControlPoints(e, t) {
		if (!(e >= 2 && t >= 2)) throw Error("Control points must be larger than 3x3 or equal");
		this._controlPoints.resize(e, t);
		for (let n = 0; n < t; n++) for (let r = 0; r < e; r++) {
			let i = new Qe();
			i.location.x = r / (e - 1) * 2 - 1, i.location.y = n / (t - 1) * 2 - 1, i.uTangent.x = 2 / (e - 1), i.vTangent.y = 2 / (t - 1), this._controlPoints.set(r, n, i);
		}
		this.resetSubdivition(this._subDivisions);
	}
	getControlPoint(e, t) {
		return this._controlPoints.get(e, t);
	}
	tempX = V.create();
	tempY = V.create();
	tempR = V.create();
	tempG = V.create();
	tempB = V.create();
	tempXAcc = V.create();
	tempYAcc = V.create();
	tempRAcc = V.create();
	tempGAcc = V.create();
	tempBAcc = V.create();
	tempUx = W.create();
	tempUy = W.create();
	tempUr = W.create();
	tempUg = W.create();
	tempUb = W.create();
	precomputeMatrix(e, t) {
		return t.copy(e).transpose(), V.mul(t, t, $e), V.mul(t, et, t), t;
	}
	updateMesh() {
		let e = this._subDivisions - 1, t = e * (this._controlPoints.height - 1), n = e * (this._controlPoints.width - 1), r = this._controlPoints.width, i = this._controlPoints.height, a = this._subDivisions, o = 1 / e, s = 1 / n, c = 1 / t, l = new Float32Array(a * 4);
		for (let e = 0; e < a; e++) {
			let t = e * o, n = e * 4;
			l[n] = t ** 3, l[n + 1] = t ** 2, l[n + 2] = t, l[n + 3] = 1;
		}
		for (let e = 0; e < r - 1; e++) for (let t = 0; t < i - 1; t++) {
			let n = this._controlPoints.get(e, t), o = this._controlPoints.get(e, t + 1), u = this._controlPoints.get(e + 1, t), d = this._controlPoints.get(e + 1, t + 1);
			tt(n, o, u, d, "x", this.tempX), tt(n, o, u, d, "y", this.tempY), nt(n, o, u, d, "r", this.tempR), nt(n, o, u, d, "g", this.tempG), nt(n, o, u, d, "b", this.tempB), this.precomputeMatrix(this.tempX, this.tempXAcc), this.precomputeMatrix(this.tempY, this.tempYAcc), this.precomputeMatrix(this.tempR, this.tempRAcc), this.precomputeMatrix(this.tempG, this.tempGAcc), this.precomputeMatrix(this.tempB, this.tempBAcc);
			let f = e / (r - 1), p = t / (i - 1), m = t * a, h = e * a;
			for (let e = 0; e < a; e++) {
				let t = m + e, n = e * 4;
				this.tempUx[0] = l[n], this.tempUx[1] = l[n + 1], this.tempUx[2] = l[n + 2], this.tempUx[3] = l[n + 3], W.transformMat4(this.tempUx, this.tempUx, this.tempXAcc), this.tempUy[0] = l[n], this.tempUy[1] = l[n + 1], this.tempUy[2] = l[n + 2], this.tempUy[3] = l[n + 3], W.transformMat4(this.tempUy, this.tempUy, this.tempYAcc), this.tempUr[0] = l[n], this.tempUr[1] = l[n + 1], this.tempUr[2] = l[n + 2], this.tempUr[3] = l[n + 3], W.transformMat4(this.tempUr, this.tempUr, this.tempRAcc), this.tempUg[0] = l[n], this.tempUg[1] = l[n + 1], this.tempUg[2] = l[n + 2], this.tempUg[3] = l[n + 3], W.transformMat4(this.tempUg, this.tempUg, this.tempGAcc), this.tempUb[0] = l[n], this.tempUb[1] = l[n + 1], this.tempUb[2] = l[n + 2], this.tempUb[3] = l[n + 3], W.transformMat4(this.tempUb, this.tempUb, this.tempBAcc);
				for (let n = 0; n < a; n++) {
					let r = h + n, i = n * 4, a = l[i], o = l[i + 1], u = l[i + 2], d = l[i + 3], m = a * this.tempUx[0] + o * this.tempUx[1] + u * this.tempUx[2] + d * this.tempUx[3], g = a * this.tempUy[0] + o * this.tempUy[1] + u * this.tempUy[2] + d * this.tempUy[3], _ = a * this.tempUr[0] + o * this.tempUr[1] + u * this.tempUr[2] + d * this.tempUr[3], v = a * this.tempUg[0] + o * this.tempUg[1] + u * this.tempUg[2] + d * this.tempUg[3], y = a * this.tempUb[0] + o * this.tempUb[1] + u * this.tempUb[2] + d * this.tempUb[3], b = f + n * s, x = 1 - p - e * c;
					this.setVertexData(t, r, m, g, _, v, y, b, x);
				}
			}
		}
		this.update();
	}
}, at = class {
	gl;
	tex;
	constructor(e, t) {
		this.gl = e;
		let n = e.createTexture();
		if (!n) throw Error("Failed to create texture");
		this.tex = n, e.activeTexture(e.TEXTURE0), e.bindTexture(e.TEXTURE_2D, n), e.texImage2D(e.TEXTURE_2D, 0, e.RGBA, e.RGBA, e.UNSIGNED_BYTE, t), e.texParameteri(e.TEXTURE_2D, e.TEXTURE_MIN_FILTER, e.LINEAR), e.texParameteri(e.TEXTURE_2D, e.TEXTURE_MAG_FILTER, e.LINEAR), e.texParameteri(e.TEXTURE_2D, e.TEXTURE_WRAP_S, e.MIRRORED_REPEAT), e.texParameteri(e.TEXTURE_2D, e.TEXTURE_WRAP_T, e.MIRRORED_REPEAT);
	}
	bind() {
		this.gl.bindTexture(this.gl.TEXTURE_2D, this.tex);
	}
	dispose() {
		this.gl.deleteTexture(this.tex);
	}
}, ot = class extends u {
	static isSupported() {
		return Te();
	}
	gl;
	contextLost = !1;
	albumRequestId = 0;
	albumLoadController;
	lastImageData;
	lastFrameTime = 0;
	frameTime = 0;
	lastTickTime = 0;
	smoothedVolume = 0;
	volume = 0;
	tickHandle = 0;
	maxFPS = 60;
	paused = !1;
	staticMode = !1;
	mainProgram;
	quadProgram;
	quadBuffer;
	fbo = null;
	fboTexture = null;
	manualControl = !1;
	reduceImageSizeCanvas = _e(32, 32);
	targetSize = G.fromValues(0, 0);
	currentSize = G.fromValues(0, 0);
	isNoCover = !0;
	meshStates = [];
	_disposed = !1;
	frameCount = 0;
	lastFPSUpdate = 0;
	currentFPS = 0;
	enablePerformanceMonitoring = !1;
	isCurrentAlbumRequest(e) {
		return !this._disposed && !this.contextLost && e === this.albumRequestId;
	}
	initializeGLResources() {
		let e = this.gl;
		e.getExtension("EXT_color_buffer_float") || console.warn("EXT_color_buffer_float not supported"), e.getExtension("EXT_float_blend") || console.warn("EXT_float_blend not supported"), e.getExtension("OES_texture_float_linear") || console.warn("OES_texture_float_linear not supported"), e.getExtension("OES_texture_float") || console.warn("OES_texture_float not supported"), e.enable(e.BLEND), e.blendFuncSeparate(e.SRC_ALPHA, e.ONE_MINUS_SRC_ALPHA, e.ONE, e.ONE_MINUS_SRC_ALPHA), e.enable(e.DEPTH_TEST), e.depthFunc(e.ALWAYS), this.mainProgram = new d(e, qe, Ke, "main-program-mg"), this.quadProgram = new d(e, Je, Ye, "quad-program");
		let t = e.createBuffer();
		if (!t) throw Error("Failed to create quad buffer");
		this.quadBuffer = t, e.bindBuffer(e.ARRAY_BUFFER, this.quadBuffer), e.bufferData(e.ARRAY_BUFFER, new Float32Array([
			-1,
			-1,
			1,
			-1,
			-1,
			1,
			-1,
			1,
			1,
			-1,
			1,
			1
		]), e.STATIC_DRAW);
	}
	createMeshState(e) {
		let t = new it(this.gl, this.mainProgram.attrs.a_pos, this.mainProgram.attrs.a_color, this.mainProgram.attrs.a_uv);
		t.resetSubdivition(50);
		let n = Math.random() > .8 ? Ge(6, 6) : ze[Math.floor(Math.random() * ze.length)];
		t.resizeControlPoints(n.width, n.height);
		let r = 2 / (n.width - 1), i = 2 / (n.height - 1);
		for (let e of n.conf) {
			let n = t.getControlPoint(e.cx, e.cy);
			n.location.x = e.x, n.location.y = e.y, n.uRot = e.ur * Math.PI / 180, n.vRot = e.vr * Math.PI / 180, n.uScale = r * e.up, n.vScale = i * e.vp;
		}
		return t.updateMesh(), {
			mesh: t,
			texture: new at(this.gl, e),
			alpha: 0
		};
	}
	onContextLost = (e) => {
		e.preventDefault(), this.contextLost = !0, this.albumLoadController?.abort(), this.tickHandle &&= (cancelAnimationFrame(this.tickHandle), 0);
	};
	onContextRestored = () => {
		this._disposed || (this.contextLost = !1, this.meshStates = [], this.fbo = null, this.fboTexture = null, this.currentSize = G.fromValues(0, 0), this.initializeGLResources(), this.lastFrameTime = performance.now(), this.isNoCover = !this.lastImageData, this.lastImageData && this.meshStates.push(this.createMeshState(this.lastImageData)), this.requestTick());
	};
	setManualControl(e) {
		this.manualControl = e;
	}
	setWireFrame(e) {
		for (let t of this.meshStates) t.mesh.setWireFrame(e);
	}
	getControlPoint(e, t) {
		return this.meshStates[this.meshStates.length - 1]?.mesh?.getControlPoint(e, t);
	}
	resizeControlPoints(e, t) {
		this.meshStates[this.meshStates.length - 1]?.mesh?.resizeControlPoints(e, t);
	}
	resetSubdivition(e) {
		this.meshStates[this.meshStates.length - 1]?.mesh?.resetSubdivition(e);
	}
	onTick(e) {
		if (this.tickHandle = 0, this.paused || this._disposed || this.contextLost) return;
		this.updatePerformanceStats(e);
		let t = 1e3 / this.maxFPS, n = e - this.lastTickTime;
		if (n < t) {
			this.requestTick();
			return;
		}
		Number.isNaN(this.lastFrameTime) && (this.lastFrameTime = e);
		let r = e - this.lastFrameTime;
		this.lastFrameTime = e, this.lastTickTime = e - n % t, this.frameTime += r * this.flowSpeed, this.onRedraw(this.frameTime, r) && this.staticMode ? this.staticMode && (this.lastFrameTime = NaN) : this.requestTick();
	}
	checkIfResize() {
		let [e, t] = [this.targetSize.x, this.targetSize.y], [n, r] = [this.currentSize.x, this.currentSize.y];
		if (e !== n || t !== r) {
			super.onResize(e, t);
			let n = this.gl;
			n.bindFramebuffer(n.FRAMEBUFFER, null), n.viewport(0, 0, e, t), this.currentSize.x = e, this.currentSize.y = t, e > 0 && t > 0 && this.updateFBO(e, t);
		}
	}
	updateFBO(e, t) {
		let n = this.gl;
		this.fbo && n.deleteFramebuffer(this.fbo), this.fboTexture && n.deleteTexture(this.fboTexture), this.fboTexture = n.createTexture(), n.bindTexture(n.TEXTURE_2D, this.fboTexture), n.texImage2D(n.TEXTURE_2D, 0, n.RGBA, e, t, 0, n.RGBA, n.UNSIGNED_BYTE, null), n.texParameteri(n.TEXTURE_2D, n.TEXTURE_MIN_FILTER, n.LINEAR), n.texParameteri(n.TEXTURE_2D, n.TEXTURE_MAG_FILTER, n.LINEAR), n.texParameteri(n.TEXTURE_2D, n.TEXTURE_WRAP_S, n.CLAMP_TO_EDGE), n.texParameteri(n.TEXTURE_2D, n.TEXTURE_WRAP_T, n.CLAMP_TO_EDGE), this.fbo = n.createFramebuffer(), n.bindFramebuffer(n.FRAMEBUFFER, this.fbo), n.framebufferTexture2D(n.FRAMEBUFFER, n.COLOR_ATTACHMENT0, n.TEXTURE_2D, this.fboTexture, 0), n.bindFramebuffer(n.FRAMEBUFFER, null);
	}
	onRedraw(e, t) {
		let n = this.meshStates[this.meshStates.length - 1], r = !1, i = t / 500;
		if (n) {
			if (n.mesh.bind(), this.manualControl && n.mesh.updateMesh(), this.isNoCover) {
				let e = !1;
				for (let t = this.meshStates.length - 1; t >= 0; t--) {
					let n = this.meshStates[t];
					n.alpha <= -.1 ? (n.mesh.dispose(), n.texture.dispose(), this.meshStates.splice(t, 1)) : (n.alpha = Math.max(-.1, n.alpha - i), e = !0);
				}
				r = !e;
			} else {
				if (n.alpha >= 1.1) {
					let e = this.meshStates.splice(0, this.meshStates.length - 1);
					for (let t of e) t.mesh.dispose(), t.texture.dispose();
				} else n.alpha = Math.min(1.1, n.alpha + i);
				r = this.meshStates.length === 1 && n.alpha >= 1.1;
			}
		}
		let a = this.gl;
		if (this.checkIfResize(), !this.fbo) return r;
		a.bindFramebuffer(a.FRAMEBUFFER, null), a.clearColor(0, 0, 0, 0), a.clear(a.COLOR_BUFFER_BIT);
		let o = Math.min(1, t / 100);
		this.smoothedVolume += (this.volume - this.smoothedVolume) * o;
		for (let t of this.meshStates) {
			a.bindFramebuffer(a.FRAMEBUFFER, this.fbo), a.disable(a.BLEND), a.clearColor(0, 0, 0, 0), a.clear(a.COLOR_BUFFER_BIT), this.mainProgram.use(), a.activeTexture(a.TEXTURE0);
			let n = e / 1e4;
			this.mainProgram.setUniform1f("u_aspect", this.manualControl ? 1 : this.canvas.width / this.canvas.height), this.mainProgram.setUniform1i("u_texture", 0), this.mainProgram.setUniform1f("u_volume", this.volume), this.mainProgram.setUniform1f("u_alpha", 1);
			let r = (n + this.volume) * 2;
			this.mainProgram.setUniform1f("u_sinAngle", Math.sin(r)), this.mainProgram.setUniform1f("u_cosAngle", Math.cos(r)), t.texture.bind(), t.mesh.bind(), t.mesh.draw(), a.bindFramebuffer(a.FRAMEBUFFER, null), a.enable(a.BLEND), a.blendFuncSeparate(a.SRC_ALPHA, a.ONE_MINUS_SRC_ALPHA, a.ONE, a.ONE_MINUS_SRC_ALPHA), this.quadProgram.use(), this.quadProgram.setUniform1i("u_texture", 0), this.quadProgram.setUniform1f("u_alpha", Xe(K(t.alpha))), a.activeTexture(a.TEXTURE0), a.bindTexture(a.TEXTURE_2D, this.fboTexture), a.bindBuffer(a.ARRAY_BUFFER, this.quadBuffer);
			let i = this.quadProgram.attrs.a_pos;
			a.vertexAttribPointer(i, 2, a.FLOAT, !1, 0, 0), a.enableVertexAttribArray(i), a.drawArrays(a.TRIANGLES, 0, 6), a.disableVertexAttribArray(i);
		}
		return a.flush(), r;
	}
	onTickBinded = this.onTick.bind(this);
	requestTick() {
		this._disposed || this.tickHandle === 0 && (this.tickHandle = requestAnimationFrame(this.onTickBinded));
	}
	constructor(e) {
		super(e);
		let t = e.getContext("webgl", { antialias: !0 });
		if (!t) throw Error("WebGL not supported");
		this.gl = t, this.initializeGLResources(), e.addEventListener("webglcontextlost", this.onContextLost), e.addEventListener("webglcontextrestored", this.onContextRestored), this.requestTick();
	}
	onResize(e, t) {
		this.targetSize.x = Math.ceil(e), this.targetSize.y = Math.ceil(t), this.requestTick();
	}
	setStaticMode(e) {
		this.staticMode = e, this.lastFrameTime = performance.now(), this.requestTick();
	}
	setFPS(e) {
		this.maxFPS = e;
	}
	pause() {
		this.tickHandle &&= (cancelAnimationFrame(this.tickHandle), 0), this.paused = !0;
	}
	resume() {
		this.paused = !1, this.requestTick();
	}
	async setAlbum(e, t) {
		let n = ++this.albumRequestId;
		this.albumLoadController?.abort();
		let r = new AbortController();
		if (this.albumLoadController = r, e === void 0 || typeof e == "string" && e.trim().length === 0) {
			this.isNoCover = !0, this.lastImageData = void 0;
			return;
		}
		let i = null, a = null, o, s = 5;
		for (; !i && s > 0;) try {
			if (typeof e == "string") {
				if (!t && "createImageBitmap" in window) {
					if (a = await (await fetch(e, { signal: r.signal })).blob(), !this.isCurrentAlbumRequest(n)) return;
					o = URL.createObjectURL(a), i = await m(o, !1);
				} else i = await m(e, t);
			} else i = await h(e);
			if (!this.isCurrentAlbumRequest(n)) {
				o && URL.revokeObjectURL(o);
				return;
			}
		} catch (t) {
			if (o &&= (URL.revokeObjectURL(o), void 0), !this.isCurrentAlbumRequest(n)) return;
			console.warn(`failed on loading album resource, retrying (${s})`, {
				albumSource: e,
				error: t
			}), s--;
		}
		if (!i) {
			if (!this.isCurrentAlbumRequest(n)) return;
			console.error("Failed to load album resource", e);
			return;
		}
		let c = this.reduceImageSizeCanvas, l = c.getContext("2d", { willReadFrequently: !0 });
		if (!l) throw Error("Failed to create canvas context");
		l.clearRect(0, 0, c.width, c.height);
		let u = i instanceof HTMLVideoElement ? i.videoWidth : i.naturalWidth, d = i instanceof HTMLVideoElement ? i.videoHeight : i.naturalHeight;
		if (u * d === 0) throw Error("Invalid image size");
		let f = null;
		try {
			"createImageBitmap" in window && (f = a ? await createImageBitmap(a, {
				resizeWidth: c.width,
				resizeHeight: c.height,
				resizeQuality: "low"
			}) : await createImageBitmap(i, {
				resizeWidth: c.width,
				resizeHeight: c.height,
				resizeQuality: "low"
			}));
		} catch (e) {
			console.warn("createImageBitmap failed", e);
		}
		if (!this.isCurrentAlbumRequest(n)) {
			f?.close(), o && URL.revokeObjectURL(o);
			return;
		}
		f ? (l.drawImage(f, 0, 0), f.close()) : l.drawImage(i, 0, 0, u, d, 0, 0, c.width, c.height);
		let p = l.getImageData(0, 0, c.width, c.height), g = p.data;
		for (let e = 0; e < g.length; e += 4) {
			let t = g[e], n = g[e + 1], r = g[e + 2];
			t = (t - 128) * .4 + 128, n = (n - 128) * .4 + 128, r = (r - 128) * .4 + 128;
			let i = t * .3 + n * .59 + r * .11;
			t = i * -2 + t * 3, n = i * -2 + n * 3, r = i * -2 + r * 3, t = (t - 128) * 1.7 + 128, n = (n - 128) * 1.7 + 128, r = (r - 128) * 1.7 + 128, g[e] = t * .75, g[e + 1] = n * .75, g[e + 2] = r * .75;
		}
		Re(p, 2, 4), this.manualControl && this.meshStates.length > 0 ? (this.meshStates[0].texture.dispose(), this.meshStates[0].texture = new at(this.gl, p)) : this.meshStates.push(this.createMeshState(p)), this.isNoCover = !1, this.lastImageData = p, o && URL.revokeObjectURL(o), this.requestTick();
	}
	setLowFreqVolume(e) {
		this.volume = e / 10;
	}
	setHasLyric(e) {}
	dispose() {
		super.dispose(), this.albumLoadController?.abort(), this.canvas.removeEventListener("webglcontextlost", this.onContextLost), this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored), this.tickHandle &&= (cancelAnimationFrame(this.tickHandle), 0), this._disposed = !0, this.mainProgram.dispose(), this.quadProgram.dispose(), this.gl.deleteBuffer(this.quadBuffer), this.fbo && this.gl.deleteFramebuffer(this.fbo), this.fboTexture && this.gl.deleteTexture(this.fboTexture);
		for (let e of this.meshStates) e.mesh.dispose(), e.texture.dispose();
	}
	enablePerformanceMonitor(e) {
		this.enablePerformanceMonitoring = e, e && (this.frameCount = 0, this.lastFPSUpdate = performance.now());
	}
	getCurrentFPS() {
		return this.currentFPS;
	}
	updatePerformanceStats(e) {
		this.enablePerformanceMonitoring && (this.frameCount++, e - this.lastFPSUpdate > 1e3 && (this.currentFPS = this.frameCount, this.frameCount = 0, this.lastFPSUpdate = e));
	}
}, st = class extends r {
	time = 0;
}, ct = class extends u {
	canvas;
	static isSupported() {
		return n.isWebGLSupported();
	}
	app;
	curContainer;
	staticMode = !1;
	lastContainer = /* @__PURE__ */ new Set();
	onTick = (e) => {
		for (let t of this.lastContainer) t.alpha = Le(t.alpha - e / 60), t.alpha <= 0 && (this.app.stage.removeChild(t), this.lastContainer.delete(t), t.destroy(!0));
		if (this.curContainer) {
			this.curContainer.alpha = Math.min(1, this.curContainer.alpha + e / 60);
			let [t, n, r, i] = this.curContainer.children, a = Math.max(this.app.screen.width, this.app.screen.height);
			t.position.set(this.app.screen.width / 2, this.app.screen.height / 2), n.position.set(this.app.screen.width / 2.5, this.app.screen.height / 2.5), r.position.set(this.app.screen.width / 2, this.app.screen.height / 2), i.position.set(this.app.screen.width / 2, this.app.screen.height / 2), t.width = a * Math.sqrt(2), t.height = t.width, n.width = a * .8, n.height = n.width, r.width = a * .5, r.height = r.width, i.width = a * .25, i.height = i.width, this.curContainer.time += e * this.flowSpeed, t.rotation += e / 1e3 * this.flowSpeed, n.rotation -= e / 500 * this.flowSpeed, r.rotation += e / 1e3 * this.flowSpeed, i.rotation -= e / 750 * this.flowSpeed, r.x = this.app.screen.width / 2 + this.app.screen.width / 4 * Math.cos(this.curContainer.time / 1e3 * .75), r.y = this.app.screen.height / 2 + this.app.screen.width / 4 * Math.cos(this.curContainer.time / 1e3 * .75), i.x = this.app.screen.width / 2 + this.app.screen.width / 4 * .1 + Math.cos(this.curContainer.time * .006 * .75), i.y = this.app.screen.height / 2 + this.app.screen.width / 4 * .1 + Math.cos(this.curContainer.time * .006 * .75), this.curContainer.alpha >= 1 && this.lastContainer.size === 0 && this.staticMode && this.app.ticker.stop();
		}
	};
	constructor(t) {
		super(t), this.canvas = t, this.app = new e({
			view: t,
			resizeTo: this.canvas,
			powerPreference: "low-power",
			backgroundAlpha: 1
		}), this.rebuildFilters(), this.app.ticker.maxFPS = 30, this.app.ticker.add(this.onTick), this.app.ticker.start();
	}
	onResize(e, t) {
		super.onResize(e, t), this.app.resize(), this.rebuildFilters();
	}
	setRenderScale(e) {
		super.setRenderScale(e), this.rebuildFilters();
	}
	rebuildFilters() {
		let e = Math.min(this.canvas.width, this.canvas.height), t = Math.max(this.canvas.width, this.canvas.height), n = new o();
		n.saturate(1.2, !1);
		let r = new o();
		r.brightness(.6, !1);
		let s = new o();
		s.contrast(.3, !0);
		for (let e of this.app.stage.filters ?? []) e.destroy();
		this.app.stage.filters = [], this.app.stage.filters.push(new i(5, 1)), this.app.stage.filters.push(new i(10, 1)), this.app.stage.filters.push(new i(20, 2)), this.app.stage.filters.push(new i(40, 2)), this.app.stage.filters.push(new i(80, 2)), e > 768 && this.app.stage.filters.push(new i(160, 4)), e > 1536 && this.app.stage.filters.push(new i(320, 4)), this.app.stage.filters.push(n, r, s), this.app.stage.filters.push(new i(5, 1)), Math.random() > .5 ? (this.app.stage.filters.push(new a({
			radius: (t + e) / 2,
			strength: 1,
			center: [.25, 1]
		})), this.app.stage.filters.push(new a({
			radius: (t + e) / 2,
			strength: 1,
			center: [.75, 0]
		}))) : (this.app.stage.filters.push(new a({
			radius: (t + e) / 2,
			strength: 1,
			center: [.75, 1]
		})), this.app.stage.filters.push(new a({
			radius: (t + e) / 2,
			strength: 1,
			center: [.25, 0]
		})));
	}
	setStaticMode(e = !1) {
		this.staticMode = e, this.app.ticker.start();
	}
	setFPS(e) {
		this.app.ticker.maxFPS = e;
	}
	pause() {
		this.app.ticker.stop(), this.app.render();
	}
	resume() {
		this.app.ticker.start();
	}
	setLowFreqVolume(e) {}
	setHasLyric(e) {}
	async setAlbum(e, n) {
		if (!e || typeof e == "string" && e.trim().length === 0) return;
		let r = null, i = 5, a = null;
		for (; !a?.baseTexture?.resource?.valid && i > 0;) try {
			r = typeof e == "string" ? await m(e, n) : await h(e), a = t.from(r, { resourceOptions: { autoLoad: !1 } }), await a.baseTexture.resource.load();
		} catch (t) {
			console.warn(`failed on loading album image, retrying (${i})`, e, t), a = null, i--;
		}
		if (!a) return;
		let o = new st(), c = new s(a), l = new s(a), u = new s(a), d = new s(a);
		c.anchor.set(.5, .5), l.anchor.set(.5, .5), u.anchor.set(.5, .5), d.anchor.set(.5, .5), c.rotation = Math.random() * Math.PI * 2, l.rotation = Math.random() * Math.PI * 2, u.rotation = Math.random() * Math.PI * 2, d.rotation = Math.random() * Math.PI * 2, o.addChild(c, l, u, d), this.curContainer && this.lastContainer.add(this.curContainer), this.curContainer = o, this.app.stage.addChild(o), this.curContainer.alpha = 0, this.app.ticker.start();
	}
	dispose() {
		super.dispose(), this.app.ticker.remove(this.onTick), this.app.destroy(!0);
	}
	getElement() {
		return this.canvas;
	}
}, lt = "precision highp float;\n\nuniform vec2 u_resolution;\n\nuniform float u_colorTime;\nuniform float u_flowTime;\nuniform float u_flowSpeed;\nuniform vec3 u_colors[4];\nuniform vec3 u_seed;\nuniform vec3 u_crestMotion;\nuniform vec2 u_grainOffset;\nuniform float u_aspect;\nuniform vec4 u_metal;\nuniform float u_lyricScrim;\nuniform float u_lowFreq;\nuniform bool u_enableDithering;\n\nconst vec3 LUMA_WEIGHT = vec3(0.2126, 0.7152, 0.0722);\nconst vec3 TITANIUM_TINT = vec3(1.02, 1.0, 0.97);\nconst vec3 HIGHLIGHT_COLOR = vec3(1.0, 0.99, 0.96);\n\nfloat encodeSrgb(float channel) {\n	return channel <= 0.0031308\n		? 12.92 * channel\n		: 1.055 * pow(max(channel, 0.0), 1.0 / 2.4) - 0.055;\n}\n\nvec3 okLabToSrgb(vec3 color) {\n	float lRoot = color.x + 0.3963377774 * color.y + 0.2158037573 * color.z;\n	float mRoot = color.x - 0.1055613458 * color.y - 0.0638541728 * color.z;\n	float sRoot = color.x - 0.0894841775 * color.y - 1.2914855480 * color.z;\n	float l = lRoot * lRoot * lRoot;\n	float m = mRoot * mRoot * mRoot;\n	float s = sRoot * sRoot * sRoot;\n	vec3 linearColor = vec3(\n		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,\n		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,\n		-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s\n	);\n	return vec3(\n		encodeSrgb(linearColor.r),\n		encodeSrgb(linearColor.g),\n		encodeSrgb(linearColor.b)\n	);\n}\n\nfloat interleavedGradientNoise(vec2 position) {\n	return fract(\n		52.9829189 * fract(dot(position, vec2(0.06711056, 0.00583715)))\n	);\n}\n\nvec4 hashGrid(vec2 cell) {\n	vec4 p = fract(vec4(cell.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099));\n	p += dot(p, p.wzxy + 33.33);\n	return fract((p.xxyz + p.yzzw) * p.zywx);\n}\n\nconst float MICRO_CELLS = 256.0;\nconst float HASH_PERIOD = 256.0;\nconst float GLINT_CELLS = 140.0;\nconst float SPARKLE_THRESHOLD = 0.95;\nconst float BRIGHT_FACE_PARTICLE_GAIN = 0.6;\nconst float BRIGHT_FACE_RAMP_START = 0.3;\nconst float BRIGHT_FACE_RAMP_END = 0.6;\n\nvec4 sampleSandLayer(\n	vec2 point,\n	float scale,\n	vec2 shift,\n	vec2 flowOffset,\n	vec3 surfaceNormal,\n	vec3 halfDir,\n	float gate\n) {\n	vec2 warped =\n		point +\n		0.08 *\n			vec2(\n				sin(point.y * 2.7 + u_seed.x * 3.0),\n				cos(point.x * 2.3 + u_seed.y * 2.0)\n			);\n	vec2 base = warped * (scale * MICRO_CELLS);\n	base +=\n		vec2(sin(base.y * 0.11 + u_seed.x), cos(base.x * 0.09 + u_seed.y)) * 0.6;\n	vec2 grid =\n		base +\n		shift +\n		mod(flowOffset * (scale * MICRO_CELLS), vec2(HASH_PERIOD));\n	vec2 cell = floor(grid);\n	vec2 local = fract(grid);\n	vec4 rnd = hashGrid(mod(cell, HASH_PERIOD));\n	float brightness = rnd.z;\n	float presentRand = rnd.w;\n	float sparkleRand = fract(rnd.z * 43.1 + rnd.w * 91.7);\n\n	float threshold = mix(0.73, 0.37, gate);\n	float present = smoothstep(threshold, threshold + 0.14, presentRand);\n	vec2 offset = (rnd.xy - 0.5) * 0.6;\n	float radius = (0.3 + 0.3 * brightness) * mix(0.55, 1.0, gate);\n	float distanceToCenter =\n		length(local - 0.5 - offset) / max(radius, 1e-3);\n	float mask = smoothstep(1.0, 0.5, distanceToCenter) * present;\n	float pixelsPerCell = u_resolution.y / (scale * MICRO_CELLS);\n	mask *= clamp(radius * pixelsPerCell, 0.2, 1.0);\n	vec4 posRand = hashGrid(floor(point * GLINT_CELLS + shift * 97.0));\n	vec3 grainNormal = normalize(\n		surfaceNormal +\n		vec3((rnd.xy - 0.5) * 0.8 + (posRand.xy - 0.5) * 1.4, 0.0)\n	);\n	float sparkle = step(SPARKLE_THRESHOLD, sparkleRand);\n	float alignment = dot(grainNormal, halfDir);\n	float light = smoothstep(\n		mix(0.74, 0.42, sparkle),\n		mix(0.94, 0.8, sparkle),\n		alignment\n	);\n	float glintGain = mix(0.9, 3.2, sparkle);\n\n	return vec4(mask, light * mask * glintGain, brightness * mask, 0.0);\n}\n\nvoid main() {\n	vec2 uv = gl_FragCoord.xy / u_resolution;\n	vec2 point = vec2((uv.x - 0.5) * u_aspect, uv.y - 0.5);\n	float colorPhase = u_colorTime * 6.28318530718;\n\n	vec2 warp =\n		vec2(\n			sin(point.y * 1.7 + colorPhase + u_seed.x),\n			cos(point.x * 1.4 - colorPhase * 2.0 + u_seed.y)\n		) * 0.08;\n	vec2 blended = point + warp;\n	float blendX = smoothstep(-0.6, 0.6, blended.x);\n	float blendY = smoothstep(-0.6, 0.6, blended.y);\n	vec3 okLab = mix(\n		mix(u_colors[2], u_colors[3], blendX),\n		mix(u_colors[0], u_colors[1], blendX),\n		blendY\n	);\n	vec3 base = okLabToSrgb(okLab);\n\n	float luma = dot(base, LUMA_WEIGHT);\n	base += TITANIUM_TINT * 0.02 * u_metal.z;\n	vec3 color = mix(base, vec3(luma) * TITANIUM_TINT, u_metal.w);\n\n	vec3 lightDir = normalize(\n		vec3(0.18 + 0.3 * sin(colorPhase), 0.8, 0.55)\n	);\n	vec3 halfDir = normalize(lightDir + vec3(0.0, 0.0, 1.0));\n\n	float f1 =\n		point.y -\n		(\n			0.45 * sin(point.x * 1.6 + u_seed.x + u_crestMotion.x) +\n			0.10 * sin(point.x * 3.4 + u_seed.y + u_crestMotion.y)\n		) -\n		u_crestMotion.z;\n	float slope1 =\n		-0.45 * 1.6 * cos(point.x * 1.6 + u_seed.x + u_crestMotion.x) -\n		0.10 * 3.4 * cos(point.x * 3.4 + u_seed.y + u_crestMotion.y);\n\n	float crest = f1;\n	float crestProximity = exp(-crest * crest * 6.0);\n\n	const float RIDGE_WIDTH = 0.018;\n	float ridgeHeight =\n		0.55 + 0.15 * sin(point.x * 1.1 + u_seed.z * 4.0);\n	float ridgeSlope =\n		-ridgeHeight * crest /\n		sqrt(crest * crest + RIDGE_WIDTH * RIDGE_WIDTH);\n	float duneX = point.x * 1.8 + u_seed.x * 3.0;\n	float duneY = point.y * 2.4 + point.x * 0.6 + u_seed.y * 5.0;\n	float dhdx =\n		ridgeSlope * (-slope1) +\n		0.10 * 1.8 * cos(duneX) +\n		0.10 * 0.6 * cos(duneY);\n	float dhdy = ridgeSlope + 0.10 * 2.4 * cos(duneY);\n	vec3 surfaceNormal = normalize(vec3(-dhdx, -dhdy, 1.0));\n\n	float diffuse = max(dot(surfaceNormal, lightDir), 0.0);\n	color *= 0.16 + 0.95 * diffuse;\n	color *= mix(1.0, mix(0.48, 1.0, crestProximity), diffuse);\n	color += TITANIUM_TINT * (diffuse * 0.05 + (1.0 - diffuse) * 0.015) * u_metal.z;\n	float lightLevel = clamp(\n		diffuse * mix(0.35, 1.0, crestProximity),\n		0.0,\n		1.0\n	);\n	float grainGate = 0.1 + 0.9 * lightLevel * lightLevel;\n	grainGate *= mix(0.7, 1.0, smoothstep(0.06, 0.45, luma));\n\n	float centerSlope =\n		-0.45 * 1.6 * cos(u_seed.x) - 0.10 * 3.4 * cos(u_seed.y);\n	vec2 tangent = normalize(vec2(1.0, -centerSlope));\n	float directionSign = step(0.0, f1) * 2.0 - 1.0;\n	const float FINE_SPEED = 1.35;\n	vec2 flowOffset =\n		tangent * directionSign * (u_flowTime * u_flowSpeed);\n	vec2 grainPoint = point + u_grainOffset;\n\n	vec4 coarse = sampleSandLayer(\n		grainPoint,\n		0.9,\n		vec2(0.0),\n		flowOffset,\n		surfaceNormal,\n		halfDir,\n		grainGate\n	);\n	vec4 fine = sampleSandLayer(\n		grainPoint,\n		2.9,\n		vec2(0.37, 0.61),\n		flowOffset * FINE_SPEED,\n		surfaceNormal,\n		halfDir,\n		grainGate\n	);\n	float sandMask = max(coarse.x, fine.x);\n	float glint = max(coarse.y, fine.y);\n	float grainBrightness =\n		(coarse.z + fine.z) / max(coarse.x + fine.x, 1e-3);\n\n	float grainGain =\n		mix(0.34, 1.0, smoothstep(0.0, 0.6, diffuse)) *\n		mix(0.32, 1.0, crestProximity);\n	grainGain *= mix(1.0, 0.7, u_lyricScrim);\n\n	float brightFaceGain = mix(\n		1.0,\n		BRIGHT_FACE_PARTICLE_GAIN,\n		smoothstep(\n			BRIGHT_FACE_RAMP_START,\n			BRIGHT_FACE_RAMP_END,\n			diffuse\n		)\n	);\n\n	color +=\n		HIGHLIGHT_COLOR *\n		sandMask *\n		(0.015 + 0.04 * grainBrightness) *\n		u_metal.x *\n		grainGain *\n		brightFaceGain;\n	color +=\n		HIGHLIGHT_COLOR *\n		glint *\n		(0.65 + 0.35 * grainBrightness) *\n		(0.35 + 0.65 * diffuse) *\n		u_metal.y *\n		grainGain *\n		brightFaceGain;\n\n	color *= 1.0 + (grainBrightness - 0.5) * 0.04 * u_metal.x;\n\n	color *= mix(1.0, 0.86, u_lyricScrim);\n\n	color *= 1.0 - 0.08 * u_lowFreq;\n\n	color = color / (1.0 + max(color, 0.0) * (0.28 + 0.35 * u_lyricScrim));\n\n	if (u_enableDithering) {\n		float dither = interleavedGradientNoise(gl_FragCoord.xy) - 0.5;\n		color += vec3(dither / 255.0);\n	}\n\n	gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);\n}\n", ut = "attribute vec2 a_pos;\n\nvarying vec2 v_uv;\n\nvoid main() {\n	gl_Position = vec4(a_pos, 0.0, 1.0);\n	v_uv = a_pos * 0.5 + 0.5;\n}\n", dt = 4, Z = 1400, ft = 5, Q = Math.PI * 2, pt = 8, mt = 4, ht = .04, gt = 30, _t = 2e3, vt = .12, yt = .35, $ = new Float32Array([
	[
		.13,
		.13,
		.15
	],
	[
		.1,
		.1,
		.12
	],
	[
		.17,
		.17,
		.19
	],
	[
		.11,
		.11,
		.13
	]
].flatMap(D));
function bt(e, t, n) {
	return e + (t - e) * n;
}
var xt = class e extends u {
	static defaultOptions = {
		grain: .7,
		sparkle: .75,
		sheen: .5,
		metalness: .35,
		dithering: !0,
		paletteAlgorithm: "auto",
		crestShiftMs: _t
	};
	static isSupported() {
		return Te() && Ee();
	}
	gl;
	program;
	quadBuffer;
	contextLost = !1;
	_disposed = !1;
	options = { ...e.defaultOptions };
	lyricScrim = 0;
	lyricScrimTarget = 0;
	volume = 0;
	smoothedVolume = 0;
	tickHandle = 0;
	lastTickTime = 0;
	lastFrameTime = 0;
	frameTime = 0;
	flowTime = 0;
	maxFPS = gt;
	paused = !1;
	staticMode = !1;
	targetWidth = 0;
	targetHeight = 0;
	currentWidth = 0;
	currentHeight = 0;
	albumRequestId = 0;
	albumSource;
	paletteTransitionElapsed = Z;
	fromColors = new Float32Array($);
	toColors = new Float32Array($);
	colorBuffer = new Float32Array($);
	nextColors = /* @__PURE__ */ new Float32Array(12);
	seed = /* @__PURE__ */ new Float32Array(3);
	crestMotion = /* @__PURE__ */ new Float32Array(3);
	crestFrom = /* @__PURE__ */ new Float32Array(3);
	crestTo = /* @__PURE__ */ new Float32Array(3);
	crestShiftElapsed = 0;
	grainOffset = /* @__PURE__ */ new Float32Array(2);
	paletteOrder = new Uint8Array(dt);
	constructor(e) {
		super(e);
		let t = e.getContext("webgl", {
			alpha: !1,
			antialias: !1,
			depth: !1,
			stencil: !1,
			powerPreference: "low-power"
		});
		if (!t) throw this.disconnectResizeObserver(), Error("WebGL not supported");
		this.gl = t;
		try {
			this.rollRandomParameters(), this.initializeGLResources();
		} catch (e) {
			throw this.program?.dispose(), t.getExtension("WEBGL_lose_context")?.loseContext(), this.disconnectResizeObserver(), e;
		}
		e.addEventListener("webglcontextlost", this.onContextLost), e.addEventListener("webglcontextrestored", this.onContextRestored), this.requestTick();
	}
	initializeGLResources() {
		let e = this.gl;
		this.program = new d(e, ut, lt, "titanium");
		let t = e.createBuffer();
		if (!t) throw Error("Failed to create quad buffer");
		this.quadBuffer = t, e.bindBuffer(e.ARRAY_BUFFER, t), e.bufferData(e.ARRAY_BUFFER, new Float32Array([
			-1,
			-1,
			1,
			-1,
			-1,
			1,
			-1,
			1,
			1,
			-1,
			1,
			1
		]), e.STATIC_DRAW);
		let n = this.program.attrs.a_pos;
		e.enableVertexAttribArray(n), e.vertexAttribPointer(n, 2, e.FLOAT, !1, 0, 0);
	}
	onContextLost = (e) => {
		e.preventDefault(), this.contextLost = !0, this.tickHandle &&= (cancelAnimationFrame(this.tickHandle), 0);
	};
	onContextRestored = () => {
		if (!this._disposed) {
			try {
				this.initializeGLResources();
			} catch (e) {
				this.program?.dispose(), console.error("Failed to restore WebGL resources", e);
				return;
			}
			this.contextLost = !1, this.currentWidth = 0, this.currentHeight = 0, this.resetFrameClock(), this.requestTick();
		}
	};
	rollRandomParameters() {
		for (let e = 0; e < this.seed.length; e++) this.seed[e] = Math.random() * Q;
		this.grainOffset[0] = Math.random(), this.grainOffset[1] = Math.random(), this.rollPaletteOrder();
	}
	rollPaletteOrder() {
		for (let e = 0; e < this.paletteOrder.length; e++) this.paletteOrder[e] = e;
		for (let e = this.paletteOrder.length - 1; e > 0; e--) {
			let t = Math.floor(Math.random() * (e + 1));
			[this.paletteOrder[e], this.paletteOrder[t]] = [this.paletteOrder[t], this.paletteOrder[e]];
		}
	}
	rollCrestTarget() {
		this.updateCrestMotion(), this.crestFrom.set(this.crestMotion);
		for (let e = 0; e < 2; e++) {
			let t = (.25 + Math.random() * .6) * Q;
			this.crestTo[e] = this.crestMotion[e] + (Math.random() < .5 ? -t : t);
		}
		this.crestTo[2] = (Math.random() - .5) * 2 * vt, this.crestShiftElapsed = 0;
	}
	updateCrestMotion() {
		let e = Math.max(0, this.options.crestShiftMs);
		if (e <= 0 || this.crestShiftElapsed >= e) {
			this.crestMotion.set(this.crestTo);
			for (let e = 0; e < 2; e++) this.crestMotion[e] = (this.crestMotion[e] % Q + Q) % Q;
			this.crestTo.set(this.crestMotion);
			return;
		}
		let t = this.crestShiftElapsed / e, n = t * t * t * (t * (t * 6 - 15) + 10);
		for (let e = 0; e < this.crestMotion.length; e++) this.crestMotion[e] = bt(this.crestFrom[e], this.crestTo[e], n);
	}
	setOptions(e) {
		let t = this.options, n = {
			grain: K(e.grain ?? t.grain),
			sparkle: K(e.sparkle ?? t.sparkle),
			sheen: K(e.sheen ?? t.sheen),
			metalness: K(e.metalness ?? t.metalness),
			dithering: e.dithering ?? t.dithering,
			paletteAlgorithm: e.paletteAlgorithm ?? t.paletteAlgorithm,
			crestShiftMs: Math.max(0, e.crestShiftMs ?? t.crestShiftMs)
		}, r = n.paletteAlgorithm !== t.paletteAlgorithm;
		this.options = n, r && this.albumSource && this.updatePaletteFromSource(this.albumSource, !0), this.requestTick();
	}
	updatePaletteFromSource(e, t = !1) {
		this.rollPaletteOrder();
		let n;
		try {
			n = xe(e, dt, {
				algorithm: this.options.paletteAlgorithm,
				intent: "dominant"
			}).palette;
		} catch (e) {
			console.warn("Failed to extract palette from album", e);
			return;
		}
		for (let e = 0; e < dt; e++) {
			let [t, r, i] = n[this.paletteOrder[e]];
			this.nextColors.set(D([
				t / 255,
				r / 255,
				i / 255
			]), e * 3);
		}
		this.transitionToColors(this.nextColors, t), this.requestTick();
	}
	transitionToColors(e, t) {
		t ? this.fromColors.set(e) : (this.updateColorBuffer(), this.fromColors.set(this.colorBuffer)), this.toColors.set(e), this.paletteTransitionElapsed = t ? Z : 0;
	}
	updateColorBuffer() {
		if (this.paletteTransitionElapsed >= Z) {
			this.colorBuffer.set(this.toColors);
			return;
		}
		let e = this.paletteTransitionElapsed / Z, t = .5 - .5 * Math.cos(Math.PI * e);
		for (let e = 0; e < this.colorBuffer.length; e++) this.colorBuffer[e] = bt(this.fromColors[e], this.toColors[e], t);
	}
	checkIfResize() {
		(this.targetWidth !== this.currentWidth || this.targetHeight !== this.currentHeight) && (super.onResize(this.targetWidth, this.targetHeight), this.currentWidth = this.targetWidth, this.currentHeight = this.targetHeight, this.gl.viewport(0, 0, this.targetWidth, this.targetHeight));
	}
	onRedraw(e, t) {
		this.checkIfResize();
		let n = Math.min(1, t / 350);
		if (this.lyricScrim += (this.lyricScrimTarget - this.lyricScrim) * n, this.currentWidth <= 0 || this.currentHeight <= 0) return !1;
		this.paletteTransitionElapsed < Z && (this.paletteTransitionElapsed += t), this.updateColorBuffer(), this.crestShiftElapsed < this.options.crestShiftMs && (this.crestShiftElapsed += t), this.updateCrestMotion();
		let r = this.gl, i = this.program;
		return i.use(), i.setUniform2f("u_resolution", this.currentWidth, this.currentHeight), i.setUniform1f("u_aspect", this.currentWidth / this.currentHeight), i.setUniform1f("u_colorTime", e / 1e3 / pt % 1), i.setUniform1f("u_flowTime", this.flowTime / 1e3), i.setUniform1f("u_flowSpeed", ht / mt), i.setUniform3fv("u_colors[0]", this.colorBuffer), i.setUniform3fv("u_seed", this.seed), i.setUniform3fv("u_crestMotion", this.crestMotion), i.setUniform2f("u_grainOffset", this.grainOffset[0], this.grainOffset[1]), i.setUniform4f("u_metal", this.options.grain, this.options.sparkle, this.options.sheen, this.options.metalness), i.setUniform1f("u_lyricScrim", this.lyricScrim), i.setUniform1f("u_lowFreq", this.smoothedVolume), i.setUniform1i("u_enableDithering", +!!this.options.dithering), r.drawArrays(r.TRIANGLES, 0, 6), this.paletteTransitionElapsed >= Z && Math.abs(this.lyricScrimTarget - this.lyricScrim) < .001 && this.crestShiftElapsed >= this.options.crestShiftMs;
	}
	onTick(e) {
		if (this.tickHandle = 0, this.paused || this._disposed || this.contextLost) return;
		let t = 1e3 / this.maxFPS, n = e - this.lastTickTime;
		if (n < t) {
			this.requestTick();
			return;
		}
		Number.isNaN(this.lastFrameTime) && (this.lastFrameTime = e);
		let r = Math.min(e - this.lastFrameTime, 250);
		this.lastFrameTime = e, this.lastTickTime = e - n % t, this.frameTime += r * this.flowSpeed;
		let i = Math.min(1, r / 120);
		this.smoothedVolume += (this.volume - this.smoothedVolume) * i, this.flowTime += r * this.flowSpeed * (1 + yt * this.smoothedVolume), this.onRedraw(this.frameTime, r) && this.staticMode ? this.lastFrameTime = NaN : this.requestTick();
	}
	onTickBinded = this.onTick.bind(this);
	requestTick() {
		this._disposed || this.paused || this.contextLost || this.maxFPS > 0 && this.tickHandle === 0 && (this.tickHandle = requestAnimationFrame(this.onTickBinded));
	}
	onResize(e, t) {
		this.targetWidth = Math.ceil(e), this.targetHeight = Math.ceil(t), this.requestTick();
	}
	setStaticMode(e) {
		this.staticMode = e, this.resetFrameClock(), this.requestTick();
	}
	setFPS(e) {
		this.maxFPS = e, this.resetFrameClock(), this.requestTick();
	}
	pause() {
		this.tickHandle &&= (cancelAnimationFrame(this.tickHandle), 0), this.paused = !0;
	}
	resume() {
		this.paused = !1, this.resetFrameClock(), this.requestTick();
	}
	resetFrameClock() {
		let e = performance.now();
		this.lastFrameTime = e, this.lastTickTime = e;
	}
	isCurrentAlbumRequest(e) {
		return !this._disposed && e === this.albumRequestId;
	}
	async setAlbum(e, t) {
		let n = ++this.albumRequestId;
		if (e === void 0 || typeof e == "string" && e.trim().length === 0) {
			this.albumSource = void 0, this.transitionToColors($, !1), this.requestTick();
			return;
		}
		let r = null, i = ft;
		for (; !r && i > 0;) try {
			r = typeof e == "string" ? await m(e, t) : await h(e);
		} catch (t) {
			if (!this.isCurrentAlbumRequest(n)) return;
			i--, console.warn(`failed on loading album resource, retrying (${i})`, {
				albumSource: e,
				error: t
			});
		}
		this.isCurrentAlbumRequest(n) && (r ? (this.albumSource = r, this.rollCrestTarget(), this.updatePaletteFromSource(r)) : console.error("Failed to load album resource", e));
	}
	setLowFreqVolume(e) {
		this.volume = K(e), this.staticMode || this.requestTick();
	}
	setHasLyric(e) {
		this.lyricScrimTarget = +!!e, this.requestTick();
	}
	dispose() {
		this._disposed || (this._disposed = !0, this.tickHandle &&= (cancelAnimationFrame(this.tickHandle), 0), this.canvas.removeEventListener("webglcontextlost", this.onContextLost), this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored), this.program.dispose(), this.gl.deleteBuffer(this.quadBuffer), this.gl.getExtension("WEBGL_lose_context")?.loseContext(), super.dispose());
	}
}, St = class e {
	element;
	renderer;
	constructor(e, t) {
		this.renderer = e, this.element = t, t.style.pointerEvents = "none", t.style.zIndex = "-1", t.style.contain = "strict";
	}
	getRenderer() {
		return this.renderer;
	}
	static new(t) {
		let n = document.createElement("canvas");
		return new e(new t(n), n);
	}
	setRenderScale(e) {
		this.renderer.setRenderScale(e);
	}
	setFlowSpeed(e) {
		this.renderer.setFlowSpeed(e);
	}
	setStaticMode(e) {
		this.renderer.setStaticMode(e);
	}
	setFPS(e) {
		this.renderer.setFPS(e);
	}
	pause() {
		this.renderer.pause();
	}
	resume() {
		this.renderer.resume();
	}
	setLowFreqVolume(e) {
		this.renderer.setLowFreqVolume(e);
	}
	setHasLyric(e) {
		this.renderer.setHasLyric(e);
	}
	setAlbum(e, t) {
		return this.renderer.setAlbum(e, t);
	}
	getElement() {
		return this.element;
	}
	dispose() {
		this.renderer.dispose(), this.element.remove();
	}
};
//#endregion
export { c as AbstractBaseRenderer, St as BackgroundRender, u as BaseRenderer, d as GLProgram, Pe as IsolationRenderer, ot as MeshGradientRenderer, ct as PixiRenderer, xt as TitaniumRenderer, be as buildColorHistogram, E as channelToLinear, ge as createAutoPalette, le as createKMeansPalette, pe as createOctTreePalette, xe as createPaletteFromImage, L as createThemeColor, _ as hsvToRgb, T as labToRgb, C as labToXyz, A as paletteRgbLStarIsDark, j as paletteRgbLStarIsLight, M as rgbLStarIsDark, g as rgbToHsv, w as rgbToLab, v as rgbToXyz, D as srgbToOkLab, S as xyzToLab, y as xyzToRgb, O as yToLStar };
