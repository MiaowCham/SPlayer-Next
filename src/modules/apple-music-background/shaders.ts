/**
 * 将 Lyricify-Backgrounds bdd31b5 的两套 HLSL 改写为 GLSL ES 3.00，Apache-2.0。
 * 几何与封面保持上原点 UV；仅渲染目标采样翻转 Y，避免跨管线累积镜像。
 */
import { blurCenterWeight, blurOffsets, blurWeights } from "./blur-kernel";

const header = `#version 300 es
precision highp float;
precision highp int;
`;

export const quadVertex = `${header}
layout(location=0) in vec2 position;
layout(location=1) in vec2 texCoord;
out vec2 uv;
out vec2 screenUV;
void main() {
  gl_Position = vec4(position, 0., 1.);
  uv = texCoord;
  screenUV = texCoord;
}`;

export const artworkVertex = `${header}
layout(location=0) in vec2 position;
layout(location=1) in vec2 texCoord;
uniform float timeMs;
uniform float rotationScale;
uniform vec2 viewScale;
uniform float imageScale;
uniform bool classic;
uniform int layer;
out vec2 uv;
vec2 rotate(vec2 p, float angle) {
  float s = sin(angle), c = cos(angle);
  return vec2(c*p.x-s*p.y, s*p.x+c*p.y);
}
void main() {
  uv = texCoord;
  if (layer < 0) {
    gl_Position = vec4(position, 0., 1.);
    uv = (uv-.5)/viewScale+.5;
    return;
  }
  float period = layer == 0 ? 120. : (layer == 1 ? (classic ? 90. : 70.) : (classic ? 70. : 90.));
  float angle = timeMs*.001*rotationScale*6.283185307179586/period;
  vec2 p;
  if (classic) {
    vec2 translation = layer == 0 ? vec2(0.) : (layer == 1 ? vec2(-.5,.7) : vec2(-.95,-.7));
    p = (rotate(position, -angle)+translation)*1.8;
    if (layer == 1) p = rotate(p, -angle);
    p *= viewScale;
  } else {
    vec2 translation = layer == 0 ? vec2(0.) : (layer == 1 ? vec2(-.25,.15) : vec2(.7));
    p = (rotate(position, angle)*(layer == 0 ? 1.4 : .7)+translation)*viewScale;
    if (layer == 2) p = rotate(p, timeMs*.001*rotationScale*6.283185307179586/120.);
    p *= imageScale;
  }
  gl_Position = vec4(p, 0., 1.);
}`;

const classicSaturation = `
vec3 classicSaturate(vec3 color, float saturation) {
  float luma = dot(color, vec3(.300048828125,.58984375,.1099853515625));
  return vec3(luma)+(color-vec3(luma))*saturation;
}`;

export const artworkFragment = `${header}
in vec2 uv;
uniform sampler2D currentCover;
uniform sampler2D previousCover;
uniform float coverMix;
uniform bool classic;
out vec4 outputColor;
${classicSaturation}
void main() {
  vec3 color = mix(texture(previousCover,uv).rgb, texture(currentCover,uv).rgb, coverMix);
  if (classic) color = classicSaturate(color,1.3);
  outputColor = vec4(color,1.);
}`;

export const blurFragment = `${header}
in vec2 uv;
uniform sampler2D source;
uniform vec2 direction;
uniform bool normalizeOutput;
out vec4 outputColor;
const float offsets[77] = float[77](${blurOffsets
  .map(String)
  .map((v) => (v.includes(".") ? v : v + ".0"))
  .join(",")});
const float weights[77] = float[77](${blurWeights.join(",")});
// WebGL 没有透明边界采样器；边缘覆盖率也要包含半像素双线性过渡。
vec4 sampleBorder(vec2 coord) {
  vec2 size = vec2(textureSize(source,0));
  vec2 coverage = clamp(coord*size+.5,0.,1.)*clamp((1.-coord)*size+.5,0.,1.);
  return texture(source,vec2(coord.x,1.-coord.y))*coverage.x*coverage.y;
}
void main() {
  vec4 color = sampleBorder(uv)*${blurCenterWeight};
  for (int i=0; i<77; i++) {
    vec2 offset = direction*offsets[i];
    color += (sampleBorder(uv+offset)+sampleBorder(uv-offset))*weights[i];
  }
  if (normalizeOutput) color = vec4(color.rgb/max(color.a,1./65535.),1.);
  outputColor = color;
}`;

export const pinchVertex = `${header}
layout(location=0) in vec2 fromPosition;
layout(location=1) in vec2 toPosition;
layout(location=2) in vec2 texCoord;
uniform float timeMs;
uniform bool classic;
uniform float uvScale;
out vec2 uv;
out vec2 screenUV;
void main() {
  float phase = acos(sin(timeMs*.001*3.141592653589793/5.))/3.141592653589793;
  float inversePhase = 1.-phase;
  float amount = classic
    ? 3.*inversePhase*inversePhase*phase*.18+3.*inversePhase*phase*phase*.82+phase*phase*phase
    : phase*phase*(3.-2.*phase);
  vec2 p = mix(fromPosition,toPosition,amount);
  gl_Position = vec4(p,0.,1.);
  uv = (texCoord-.5)*uvScale+.5;
  screenUV = vec2(p.x*.5+.5,.5-p.y*.5);
}`;

export const materialFragment = `${header}
in vec2 uv;
in vec2 screenUV;
uniform sampler2D lyricSource;
uniform sampler2D ordinarySource;
uniform bool classic;
uniform float lyricsMix;
uniform float darkMix;
uniform float scrimAlpha;
uniform float ditherStrength;
out vec4 outputColor;
${classicSaturation}
vec3 saturateModern(vec3 color, float saturation) {
  return mix(vec3(dot(color,vec3(.2126,.7152,.0722))),color,saturation);
}
vec3 treatModern(vec3 color) {
  color = clamp(saturateModern(color,1.4),-.752941,1.25098);
  return saturateModern(color,.70)*(1.-scrimAlpha);
}
vec3 sampleSurface(sampler2D source, vec2 coord) {
  vec4 color = texture(source,vec2(coord.x,1.-coord.y));
  return color.rgb/max(color.a,1./65535.);
}
void main() {
  vec3 lyric = sampleSurface(lyricSource,uv);
  vec3 ordinary = sampleSurface(ordinarySource,screenUV);
  if (classic) {
    vec3 blackMixed = min(classicSaturate(lyric,2.),vec3(.998046875))*.75;
    lyric = mix(blackMixed+.08,blackMixed*.90-.10,darkMix);
  } else {
    lyric = treatModern(lyric);
    ordinary = treatModern(ordinary);
  }
  vec3 color = mix(ordinary,lyric,lyricsMix);
  if (classic) outputColor = vec4(clamp(color,0.,1.),1.);
  else {
    float dither = fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))))-.5;
    outputColor = vec4(clamp(color+dither*(ditherStrength/255.),.07,.97),1.);
  }
}`;
