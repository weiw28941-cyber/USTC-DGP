export function initProgram(viewer) {
    const gl = viewer.gl;
    const vs = `#version 300 es
in vec3 aPos;
in vec3 aNormal;
in vec3 aColor;
in vec2 aUV;
uniform mat4 uMvp;
uniform mat4 uModel;
uniform float uPointSize;
out vec3 vNormal;
out vec3 vColor;
out vec2 vUV;
void main() {
    gl_Position = uMvp * vec4(aPos, 1.0);
    gl_PointSize = uPointSize;
    vNormal = mat3(uModel) * aNormal;
    vColor = aColor;
    vUV = aUV;
}`;
    const fs = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vColor;
in vec2 vUV;
uniform vec3 uLightDir;
uniform float uLightIntensity;
uniform float uRenderMode;
uniform float uColorMode;
uniform bool uHasTexture;
uniform sampler2D uTex;
uniform sampler2D uColorbar;
out vec4 fragColor;
vec3 checker(vec2 uv) {
    vec2 grid = floor(fract(uv * 4.0) * 8.0);
    float c = mod(grid.x + grid.y, 2.0);
    return mix(vec3(0.22), vec3(0.86), c);
}
void main() {
    if (uRenderMode > 1.5) {
        vec2 pointUv = gl_PointCoord * 2.0 - 1.0;
        if (dot(pointUv, pointUv) > 1.0) {
            discard;
        }
        if (uColorMode > 0.5 && uColorMode < 1.5) {
            float tPoint = clamp(dot(clamp(vColor, 0.0, 1.0), vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
            fragColor = vec4(texture(uColorbar, vec2(tPoint, 0.5)).rgb, 1.0);
        } else {
            vec3 pointBase = clamp(vColor, 0.0, 1.0);
            vec3 pointColor = mix(pointBase, vec3(0.08, 0.1, 0.14), 0.8);
            if (length(pointBase) < 0.001) {
                pointColor = vec3(0.08, 0.1, 0.14);
            }
            fragColor = vec4(pointColor, 1.0);
        }
        return;
    }
    if (uRenderMode > 0.5) {
        if (uColorMode > 0.5 && uColorMode < 1.5) {
            float tLine = clamp(dot(clamp(vColor, 0.0, 1.0), vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
            fragColor = vec4(texture(uColorbar, vec2(tLine, 0.5)).rgb, 1.0);
        } else {
            vec3 lineBase = clamp(vColor, 0.0, 1.0);
            vec3 lineColor = mix(lineBase, vec3(0.06, 0.08, 0.12), 0.85);
            if (length(lineBase) < 0.001) {
                lineColor = vec3(0.06, 0.08, 0.12);
            }
            fragColor = vec4(lineColor, 1.0);
        }
        return;
    }
    vec3 n = normalize(vNormal);
    float ndl = abs(dot(n, normalize(uLightDir)));
    float diffuse = pow(ndl, 0.8) * clamp(uLightIntensity, 0.0, 4.0);
    vec3 base = clamp(vColor, 0.0, 1.0);
    if (uColorMode > 1.5) {
        base = uHasTexture ? texture(uTex, vUV).rgb : checker(vUV);
    } else if (uColorMode > 0.5) {
        float t = clamp(dot(clamp(vColor, 0.0, 1.0), vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
        base = texture(uColorbar, vec2(t, 0.5)).rgb;
    } else if (uColorMode < -0.5) {
        base = vColor;
    }
    if (!gl_FrontFacing) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }
    vec3 color = base * (0.55 + 0.45 * diffuse);
    color += vec3(0.03, 0.04, 0.05);
    fragColor = vec4(color, 1.0);
}`;

    const compile = (type, src) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, src);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            throw new Error(gl.getShaderInfoLog(shader) || 'Shader compile failed');
        }
        return shader;
    };
    const v = compile(gl.VERTEX_SHADER, vs);
    const f = compile(gl.FRAGMENT_SHADER, fs);
    viewer.program = gl.createProgram();
    gl.attachShader(viewer.program, v);
    gl.attachShader(viewer.program, f);
    gl.linkProgram(viewer.program);
    if (!gl.getProgramParameter(viewer.program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(viewer.program) || 'Program link failed');
    }
    gl.deleteShader(v);
    gl.deleteShader(f);

    viewer.attribs = {
        pos: gl.getAttribLocation(viewer.program, 'aPos'),
        normal: gl.getAttribLocation(viewer.program, 'aNormal'),
        color: gl.getAttribLocation(viewer.program, 'aColor'),
        uv: gl.getAttribLocation(viewer.program, 'aUV')
    };
    viewer.uniforms = {
        mvp: gl.getUniformLocation(viewer.program, 'uMvp'),
        model: gl.getUniformLocation(viewer.program, 'uModel'),
        light: gl.getUniformLocation(viewer.program, 'uLightDir'),
        lightIntensity: gl.getUniformLocation(viewer.program, 'uLightIntensity'),
        renderMode: gl.getUniformLocation(viewer.program, 'uRenderMode'),
        pointSize: gl.getUniformLocation(viewer.program, 'uPointSize'),
        colorMode: gl.getUniformLocation(viewer.program, 'uColorMode'),
        hasTexture: gl.getUniformLocation(viewer.program, 'uHasTexture'),
        tex: gl.getUniformLocation(viewer.program, 'uTex'),
        colorbar: gl.getUniformLocation(viewer.program, 'uColorbar')
    };
}
