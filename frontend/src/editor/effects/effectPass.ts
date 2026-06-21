/** EffectPass — GPU 全屏后处理（WebGL2），Canvas2D 不可用时回退 registry.applySceneEffect */

export interface EffectPassUniforms {
  brightness: number
  contrast: number
  saturate: number
}

export interface EffectPassDefinition {
  uniforms: EffectPassUniforms
  fragmentShader: string
}

const FULLSCREEN_VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

const FILTER_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturate;
out vec4 outColor;

vec3 applyBrightness(vec3 c, float amount) {
  return clamp(c * amount, 0.0, 1.0);
}

vec3 applyContrast(vec3 c, float amount) {
  return clamp((c - 0.5) * amount + 0.5, 0.0, 1.0);
}

vec3 applySaturate(vec3 c, float amount) {
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return clamp(vec3(luma) + amount * (c - vec3(luma)), 0.0, 1.0);
}

void main() {
  vec4 src = texture(u_source, v_uv);
  vec3 rgb = applySaturate(applyContrast(applyBrightness(src.rgb, u_brightness), u_contrast), u_saturate);
  outColor = vec4(rgb, src.a);
}
`

export const FILTER_EFFECT_PASS: EffectPassDefinition = {
  uniforms: { brightness: 1, contrast: 1, saturate: 1 },
  fragmentShader: FILTER_FRAGMENT_SHADER,
}

export const FILTER_EFFECT_PASS_PRESETS: Record<string, EffectPassUniforms> = {
  'visual_filter.mono_soft': { brightness: 1.02, contrast: 1.05, saturate: 0.65 },
  'visual_filter.mono_contrast': { brightness: 0.97, contrast: 1.18, saturate: 0.55 },
  'visual_filter.mono_cool': { brightness: 1.01, contrast: 1, saturate: 0.5 },
  'visual_filter.mono_warm': { brightness: 1.03, contrast: 1.06, saturate: 0.62 },
}

interface CompiledPass {
  program: WebGLProgram
  uniforms: EffectPassUniforms
}

interface GpuContext {
  gl: WebGL2RenderingContext
  canvas: HTMLCanvasElement
  quad: WebGLBuffer
  passes: Map<string, CompiledPass>
}

let gpuContext: GpuContext | null = null

const createShader = (gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null => {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

const createProgram = (
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string
): WebGLProgram | null => {
  const vertex = createShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  if (!vertex || !fragment) return null
  const program = gl.createProgram()
  if (!program) return null
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    return null
  }
  return program
}

const getGpuContext = (): GpuContext | null => {
  if (gpuContext) return gpuContext
  if (typeof document === 'undefined') return null

  const canvas = document.createElement('canvas')
  let gl: WebGL2RenderingContext | null = null
  try {
    gl = canvas.getContext('webgl2', { premultipliedAlpha: false })
  } catch {
    gl = null
  }
  if (!gl) return null

  const quad = gl.createBuffer()
  if (!quad) return null
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)

  gpuContext = { gl, canvas, quad, passes: new Map() }
  return gpuContext
}

const compilePass = (effectId: string, definition: EffectPassDefinition): CompiledPass | null => {
  const ctx = getGpuContext()
  if (!ctx) return null

  const cached = ctx.passes.get(effectId)
  if (cached) return cached

  const program = createProgram(ctx.gl, FULLSCREEN_VERTEX_SHADER, definition.fragmentShader)
  if (!program) return null

  const compiled: CompiledPass = { program, uniforms: definition.uniforms }
  ctx.passes.set(effectId, compiled)
  return compiled
}

export function isGpuEffectPassAvailable(): boolean {
  return getGpuContext() !== null
}

export function applyGpuEffectPass(
  targetCtx: CanvasRenderingContext2D,
  width: number,
  height: number,
  effectId: string,
  definition: EffectPassDefinition,
  uniforms: EffectPassUniforms = definition.uniforms
): boolean {
  const ctx = getGpuContext()
  if (!ctx || width <= 0 || height <= 0) return false

  const pass = compilePass(effectId, definition)
  if (!pass) return false

  const { gl, canvas, quad } = ctx
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }

  const texture = gl.createTexture()
  if (!texture) return false

  const sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = width
  sourceCanvas.height = height
  const sourceCtx = sourceCanvas.getContext('2d')
  if (!sourceCtx) {
    gl.deleteTexture(texture)
    return false
  }
  sourceCtx.drawImage(targetCtx.canvas, 0, 0)

  gl.viewport(0, 0, width, height)
  gl.useProgram(pass.program)

  const positionLoc = gl.getAttribLocation(pass.program, 'a_position')
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.enableVertexAttribArray(positionLoc)
  gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0)

  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas)

  const sourceLoc = gl.getUniformLocation(pass.program, 'u_source')
  gl.uniform1i(sourceLoc, 0)
  gl.uniform1f(gl.getUniformLocation(pass.program, 'u_brightness'), uniforms.brightness)
  gl.uniform1f(gl.getUniformLocation(pass.program, 'u_contrast'), uniforms.contrast)
  gl.uniform1f(gl.getUniformLocation(pass.program, 'u_saturate'), uniforms.saturate)

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

  targetCtx.setTransform(1, 0, 0, 1, 0, 0)
  targetCtx.clearRect(0, 0, width, height)
  targetCtx.drawImage(canvas, 0, 0, width, height)

  gl.deleteTexture(texture)
  return true
}

export function resolveEffectPassUniforms(effectId: string): EffectPassUniforms | null {
  return FILTER_EFFECT_PASS_PRESETS[effectId] ?? null
}

export function applyRegisteredEffectPass(
  targetCtx: CanvasRenderingContext2D,
  width: number,
  height: number,
  effectId: string,
  definition: EffectPassDefinition
): boolean {
  const uniforms = resolveEffectPassUniforms(effectId) ?? definition.uniforms
  return applyGpuEffectPass(targetCtx, width, height, effectId, definition, uniforms)
}
