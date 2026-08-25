export const FULLSCREEN_VERTEX_SHADER = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

export const DEV_COMPOSITE_FRAGMENT_SHADER = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uCurrentAlbum;
uniform sampler2D uPreviousAlbum;
uniform vec2 uResolution;
uniform vec2 uCurrentAlbumSize;
uniform vec2 uPreviousAlbumSize;
uniform float uTransition;
uniform float uTime;
uniform float uPulse;
uniform float uFlow;
uniform float uDisplacement;
uniform float uDistortion;
uniform float uSeed;

vec2 coverUv(vec2 uv, vec2 imageSize) {
  float viewportAspect = uResolution.x / max(1.0, uResolution.y);
  float imageAspect = imageSize.x / max(1.0, imageSize.y);
  vec2 scale = imageAspect > viewportAspect
    ? vec2(viewportAspect / imageAspect, 1.0)
    : vec2(1.0, imageAspect / viewportAspect);
  return (uv - 0.5) * scale + 0.5;
}

vec2 rotatePoint(vec2 point, float angle) {
  float sine = sin(angle);
  float cosine = cos(angle);
  return mat2(cosine, -sine, sine, cosine) * point;
}

vec2 mirrorUv(vec2 uv) {
  return 1.0 - abs(mod(uv, 2.0) - 1.0);
}

vec3 sampleAlbum(vec2 uv) {
  vec2 currentUv = coverUv(uv, uCurrentAlbumSize);
  vec2 previousUv = coverUv(uv, uPreviousAlbumSize);
  vec3 current = texture2D(uCurrentAlbum, mirrorUv(currentUv)).rgb;
  vec3 previous = texture2D(uPreviousAlbum, mirrorUv(previousUv)).rgb;
  return mix(previous, current, uTransition);
}

void main() {
  vec2 point = vUv * 2.0 - 1.0;
  point.x *= uResolution.x / max(1.0, uResolution.y);
  vec2 originalPoint = point;
  float distortion = clamp(uDistortion, 0.0, 2.0);
  float distortionAmount = distortion <= 1.0
    ? distortion * 0.68
    : 0.68 + (distortion - 1.0) * 0.32;
  float pulseScale = 1.0 + uPulse * 0.12;
  point /= pulseScale;
  float phase = uTime * 0.105 * uFlow + uSeed * 13.7;
  float globalRotation = (phase * 0.09 + sin(phase * 0.37) * 0.14) * distortionAmount;
  point = rotatePoint(point, globalRotation);

  vec2 firstCenter = vec2(sin(phase * 0.71), cos(phase * 0.53)) * 0.26;
  vec2 first = point - firstCenter;
  float firstRadius = length(first);
  float firstTwist = (sin(phase * 0.83) * 1.45 + (2.4 + uDisplacement * 5.2)
    * exp(-firstRadius * 0.72)) * distortionAmount;
  point = firstCenter + rotatePoint(first, firstTwist);

  vec2 secondCenter = vec2(cos(phase * 0.47 + 2.1), sin(phase * 0.61 - 0.8)) * 0.38;
  vec2 second = point - secondCenter;
  float secondRadius = length(second);
  float secondTwist = (-sin(phase * 0.69 + 1.4) * 1.2
    - (1.8 + uDisplacement * 3.8) * exp(-secondRadius * 1.15)) * distortionAmount;
  point = secondCenter + rotatePoint(second, secondTwist);

  float rollCenter = sin(phase * 0.29 + uSeed * 5.1) * 0.34;
  float rollDistance = (point.x - rollCenter) / (0.24 + uDisplacement * 0.42);
  float rollWeight = exp(-rollDistance * rollDistance)
    * (0.78 + uDisplacement * 1.1) * distortionAmount;
  point.x -= rollWeight * (0.92 + sin(phase * 0.41) * 0.16)
    * (uResolution.x / max(1.0, uResolution.y));
  point.y += sin(rollDistance * 4.6 - phase * 1.17) * rollWeight * 0.28;

  float fold = (0.24 + uDisplacement * 0.9) * distortionAmount;
  point.x += sin(point.y * 4.7 + phase * 1.13) * fold;
  point.y += sin(point.x * 3.9 - phase * 0.91) * fold * 0.82;
  float pointRadius = max(length(point), 0.0001);
  point += point / pointRadius * sin(pointRadius * 7.4 - phase)
    * (0.055 + uDisplacement * 0.13) * distortionAmount;
  float edgeDistance = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
  float interiorMask = smoothstep(0.0, 0.18, edgeDistance);
  float edgeAmount = step(1.0, distortion) * 0.03
    + smoothstep(1.0, 2.0, distortion) * 0.97;
  point = mix(originalPoint / pulseScale, point, mix(interiorMask, 1.0, edgeAmount));
  point.x /= uResolution.x / max(1.0, uResolution.y);

  gl_FragColor = vec4(sampleAlbum(point * 0.5 + 0.5), 1.0);
}`;

export const BETA_COMPOSITE_FRAGMENT_SHADER = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uCurrentAlbum;
uniform sampler2D uPreviousAlbum;
uniform vec2 uCurrentAlbumSize;
uniform vec2 uPreviousAlbumSize;
uniform float uTransition;
uniform float uTime;
uniform float uPulse;
uniform float uFlow;
uniform float uDisplacement;
uniform float uSeed;

float hash11(float value) {
  return fract(sin(value * 127.1) * 43758.5453123);
}

vec2 rotatePoint(vec2 point, float angle) {
  float sine = sin(angle);
  float cosine = cos(angle);
  return mat2(cosine, -sine, sine, cosine) * point;
}

vec2 squareUv(vec2 uv, vec2 imageSize) {
  float imageAspect = imageSize.x / max(1.0, imageSize.y);
  vec2 scale = imageAspect > 1.0
    ? vec2(1.0 / imageAspect, 1.0)
    : vec2(1.0, imageAspect);
  return (uv - 0.5) * scale + 0.5;
}

vec3 sampleAlbum(vec2 uv, float transition) {
  vec2 currentUv = squareUv(uv, uCurrentAlbumSize);
  vec2 previousUv = squareUv(uv, uPreviousAlbumSize);
  vec3 current = texture2D(uCurrentAlbum, clamp(currentUv, 0.001, 0.999)).rgb;
  vec3 previous = texture2D(uPreviousAlbum, clamp(previousUv, 0.001, 0.999)).rgb;
  return mix(previous, current, transition);
}

vec4 sampleTile(float index, vec2 point) {
  float seed = uSeed * 19.73 + index * 8.31;
  float randomX = hash11(seed + 0.17) - 0.5;
  float randomY = hash11(seed + 1.91) - 0.5;
  float direction = mod(index, 2.0) < 0.5 ? 1.0 : -1.0;
  vec2 corner;
  vec2 quadrant;
  if (index < 0.5) {
    corner = vec2(-1.0, -1.0);
    quadrant = vec2(0.0, 0.0);
  } else if (index < 1.5) {
    corner = vec2(1.0, -1.0);
    quadrant = vec2(0.5, 0.0);
  } else if (index < 2.5) {
    corner = vec2(-1.0, 1.0);
    quadrant = vec2(0.0, 0.5);
  } else {
    corner = vec2(1.0, 1.0);
    quadrant = vec2(0.5, 0.5);
  }

  float phase = uTime * (0.055 + hash11(seed + 3.7) * 0.035) * uFlow + seed;
  vec2 jump = vec2(sin(phase * 1.13), cos(phase * 0.91 + seed));
  jump *= 0.04;
  vec2 center = corner * 0.5 + vec2(randomX, randomY) * 0.18 + jump;
  float breathing = 1.0 + sin(phase * 0.73) * 0.026;
  vec2 halfSize = vec2(1.28, 1.22) * breathing;
  float angle = direction * (0.08 + hash11(seed + 5.3) * 0.16);
  angle += direction * phase * 0.085 + sin(phase) * 0.075;
  float tilePulseScale = 1.0 + uPulse * 0.12;
  vec2 local = rotatePoint(point - center, -angle) / (halfSize * tilePulseScale);

  float radial = length(local);
  float warpAmount = 0.04 + uDisplacement * 0.3;
  vec2 warp = vec2(
    sin(local.y * 4.2 + phase * 1.31 + seed),
    cos(local.x * 3.8 - phase * 1.07 + seed * 0.7)
  );
  warp += rotatePoint(local, sin(phase * 0.61) * 0.9)
    * sin(radial * 7.0 - phase) * 0.42;
  vec2 tileUv = local * 0.5 + 0.5 + warp * warpAmount;
  vec2 albumUv = quadrant + clamp(tileUv, 0.004, 0.996) * 0.5;
  float transitionDelay = hash11(seed + 9.7) * 0.14;
  float tileTransition = smoothstep(transitionDelay, min(1.0, transitionDelay + 0.86), uTransition);
  float transitionGradient = (local.x * direction + local.y * 0.35) * 0.1;
  float albumTransition = tileTransition <= 0.0
    ? 0.0
    : tileTransition >= 1.0
      ? 1.0
      : smoothstep(0.0, 1.0, clamp(tileTransition + transitionGradient, 0.0, 1.0));

  float edge = max(abs(local.x), abs(local.y));
  float weight = exp(-1.35 * dot(local, local));
  weight *= 0.72 + (1.0 - smoothstep(0.62, 1.18, edge)) * 0.48;
  float territoryX = corner.x < 0.0
    ? 1.0 - smoothstep(-0.4, 0.65, point.x)
    : smoothstep(-0.65, 0.4, point.x);
  float territoryY = corner.y < 0.0
    ? 1.0 - smoothstep(-0.4, 0.65, point.y)
    : smoothstep(-0.65, 0.4, point.y);
  weight *= 0.42 + territoryX * territoryY * 1.45;
  weight *= 0.92 + hash11(seed + 7.1) * 0.16;
  return vec4(sampleAlbum(albumUv, albumTransition) * weight, weight);
}

void main() {
  vec2 point = vUv * 2.0 - 1.0;
  vec4 first = sampleTile(0.0, point);
  vec4 second = sampleTile(1.0, point);
  vec4 third = sampleTile(2.0, point);
  vec4 fourth = sampleTile(3.0, point);
  vec3 color = (first.rgb + second.rgb + third.rgb + fourth.rgb)
    / max(0.001, first.a + second.a + third.a + fourth.a);
  gl_FragColor = vec4(color, 1.0);
}`;

export const DUAL_KAWASE_DOWNSAMPLE_FRAGMENT_SHADER = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uOffset;
void main() {
  vec2 offset = uTexel * uOffset;
  vec3 color = texture2D(uSource, vUv).rgb * 4.0;
  color += texture2D(uSource, vUv + vec2(-offset.x, -offset.y)).rgb;
  color += texture2D(uSource, vUv + vec2(offset.x, -offset.y)).rgb;
  color += texture2D(uSource, vUv + vec2(-offset.x, offset.y)).rgb;
  color += texture2D(uSource, vUv + vec2(offset.x, offset.y)).rgb;
  gl_FragColor = vec4(color * 0.125, 1.0);
}`;

export const DUAL_KAWASE_UPSAMPLE_FRAGMENT_SHADER = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uOffset;
void main() {
  vec2 offset = uTexel * uOffset;
  vec3 color = vec3(0.0);
  color += texture2D(uSource, vUv + vec2(-2.0 * offset.x, 0.0)).rgb;
  color += texture2D(uSource, vUv + vec2(-offset.x, offset.y)).rgb * 2.0;
  color += texture2D(uSource, vUv + vec2(0.0, 2.0 * offset.y)).rgb;
  color += texture2D(uSource, vUv + vec2(offset.x, offset.y)).rgb * 2.0;
  color += texture2D(uSource, vUv + vec2(2.0 * offset.x, 0.0)).rgb;
  color += texture2D(uSource, vUv + vec2(offset.x, -offset.y)).rgb * 2.0;
  color += texture2D(uSource, vUv + vec2(0.0, -2.0 * offset.y)).rgb;
  color += texture2D(uSource, vUv + vec2(-offset.x, -offset.y)).rgb * 2.0;
  gl_FragColor = vec4(color / 12.0, 1.0);
}`;

export const MATERIAL_FRAGMENT_SHADER = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uSource;
uniform float uDarkOverlay;
uniform float uDetail;

vec3 saturateColor(vec3 color, float saturation) {
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(luminance), color, saturation);
}

void main() {
  vec3 color = texture2D(uSource, clamp(vUv, 0.001, 0.999)).rgb;
  color = saturateColor(color, 1.28);
  color = mix(color, color * color * (3.0 - 2.0 * color), 0.34);
  float vignette = 1.0 - smoothstep(0.18, 0.88, length(vUv - 0.5));
  color *= 0.7 + vignette * 0.3;
  color *= 1.0 - uDarkOverlay;
  float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;
  color += noise * (0.45 + uDetail * 0.35) / 255.0;
  gl_FragColor = vec4(clamp(color, 0.035, 0.97), 1.0);
}`;
