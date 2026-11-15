// Converts the finished frame (an RGBA canvas) to planar YUV 4:2:0 on the GPU, so each frame leaves
// the page as 1.5 bytes per pixel instead of 4 and goes into the encoder without another conversion.
// BT.709, limited range (16–235 / 16–240), chroma sited left like MPEG-2/H.264: the same numbers
// ffmpeg's own converter would produce from the RGB frame.
const VS = `#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `#version 300 es
precision highp float;
uniform sampler2D src;
uniform vec2 size;
out vec4 o;
const vec3 K = vec3(0.2126, 0.7152, 0.0722);
void main() {
  vec2 p = gl_FragCoord.xy;
  float v;
  if (p.y < size.y) {
    v = (16.0 + 219.0 * dot(texture(src, p / size).rgb, K)) / 255.0;
  } else {
    float hw = size.x * 0.5;
    bool isV = p.x >= hw;
    float lx = ((isV ? p.x - hw : p.x) - 0.5) * 2.0;   // luma column 2k of chroma sample k
    float ly = (p.y - size.y - 0.5) * 2.0 + 1.0;       // edge between luma rows 2j and 2j+1
    // two bilinear taps = weights (1,2,1)/4 across columns 2k-1..2k+1, averaged over both rows
    vec3 c = 0.5 * (texture(src, vec2(lx, ly) / size).rgb + texture(src, vec2(lx + 1.0, ly) / size).rgb);
    float y = dot(c, K);
    v = (128.0 + 224.0 * (isV ? (c.r - y) / 1.5748 : (c.b - y) / 1.8556)) / 255.0;
  }
  o = vec4(v, 0.0, 0.0, 1.0);
}`;

export class YuvPacker {
  /** Returns null when this GPU/browser cannot do it (the caller then sends RGBA). */
  static create(w, h) {
    if (w % 2 || h % 2) return null;
    try { const p = new YuvPacker(w, h); return p.ok ? p : null; } catch { return null; }
  }
  constructor(w, h) {
    this.w = w; this.h = h;
    const H = h + h / 2;
    const gl = (this.gl = new OffscreenCanvas(w, H).getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }));
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(gl.getUniformLocation(prog, 'size'), w, h);
    this.src = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.src);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const dst = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, dst);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, w, H);
    gl.activeTexture(gl.TEXTURE0);
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst, 0);
    gl.viewport(0, 0, w, H);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
    this.ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
      && gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT) === gl.RED && gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE) === gl.UNSIGNED_BYTE;
    this.buf = new Uint8Array(w * h + (w * h) / 2); // Y plane, then U, then V (I420)
  }
  /** canvas → Uint8Array of I420 bytes (reused between calls). */
  pack(canvas) {
    const gl = this.gl, { w, h, buf } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.src);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, w, h, gl.RED, gl.UNSIGNED_BYTE, buf, 0);
    gl.readPixels(0, h, w / 2, h / 2, gl.RED, gl.UNSIGNED_BYTE, buf, w * h);
    gl.readPixels(w / 2, h, w / 2, h / 2, gl.RED, gl.UNSIGNED_BYTE, buf, w * h + (w * h) / 4);
    return buf;
  }
}
