import PicoGL from "../node_modules/picogl/build/module/picogl.js";
import {mat4, vec3, mat3, vec4, vec2} from "../node_modules/gl-matrix/esm/index.js";

import {positions, normals, indices} from "../blender/Fist.js"
import {positions as mirrorPositions, uvs as mirrorUvs, indices as mirrorIndices} from "../blender/plane.js"


let skyboxPositions = new Float32Array([
    -1.0, 1.0, 1.0,
    1.0, 1.0, 1.0,
    -1.0, -1.0, 1.0,
    1.0, -1.0, 1.0
]);

let skyboxTriangles = new Uint32Array([
    0, 2, 1,
    2, 3, 1
]);



// ******************************************************
// **               Light configuration                **
// ******************************************************

let ambientLightColor = vec3.fromValues(0.0, 0.05, 0.1);
let numberOfLights = 2;
let lightColors = [vec3.fromValues(1.0, 0.0, 0.4), vec3.fromValues(0.0, 0.2, 0.3)];
let lightInitialPositions = [vec3.fromValues(5, 0, 2), vec3.fromValues(-5, 0, 2)];
let lightPositions = [vec3.create(), vec3.create()];


// language=GLSL
let fragmentShader = `
    #version 300 es
    precision highp float;
    
    uniform samplerCube cubemap;    
        
    in vec3 vNormal;
    in vec3 viewDir;
    
    out vec4 outColor;
    
    void main()
    {        
        vec3 reflectedDir = reflect(viewDir, normalize(vNormal));
        //outColor = texture(cubemap, reflectedDir);
        
        // Try using a higher mipmap LOD to get a rough material effect without any performance impact
        outColor = textureLod(cubemap, reflectedDir, 2.0);
    }
`;

// language=GLSL
let vertexShader = `
    #version 300 es
            
    uniform mat4 modelViewProjectionMatrix;
    uniform mat4 modelMatrix;
    uniform mat3 normalMatrix;
    uniform vec3 cameraPosition;
    
    layout(location=0) in vec4 position;
    layout(location=1) in vec3 normal;
    layout(location=2) in vec2 uv;
        
    out vec2 vUv;
    out vec3 vNormal;
    out vec3 viewDir;
    
    void main()
    {
        gl_Position = modelViewProjectionMatrix * position;           
        vUv = uv;
        viewDir = (modelMatrix * position).xyz - cameraPosition;                
        vNormal = normalMatrix * normal;
    }
`;

// language=GLSL
let mirrorFragmentShader = `
    #version 300 es
    precision highp float;
    
    uniform sampler2D reflectionTex;
    uniform sampler2D distortionMap;
    uniform vec2 screenSize;
    
    in vec2 vUv;        
        
    out vec4 outColor;
    
    void main()
    {                        
        vec2 screenPos = gl_FragCoord.xy / screenSize;
        
        // 0.3 is a mirror distortion factor, try making a larger distortion         
        screenPos.x += (texture(distortionMap, vUv).r - 1.5) * 1.03;
        outColor = texture(reflectionTex, screenPos);
    }
`;

// language=GLSL
let postFragmentShader = `
    #version 300 es
    precision mediump float;
    
    uniform sampler2D tex;
    uniform sampler2D depthTex;
    uniform float time;
    uniform sampler2D noiseTex;
    
    in vec4 v_position;
    
    out vec4 outColor;
    
    vec4 depthOfField(vec4 col, float depth, vec2 uv) {
        vec4 blur = vec4(0.0);
        float n = 0.0;
        for (float u = -1.0; u <= 1.0; u += 0.4)    
            for (float v = -1.0; v <= 1.0; v += 0.4) {
                float factor = abs(depth - 0.995) * 350.0;
                blur += texture(tex, uv + vec2(u, v) * factor * 0.02);
                n += 1.0;
            }                
        return blur / n;
    }
    
    vec4 ambientOcclusion(vec4 col, float depth, vec2 uv) {
        if (depth == 1.0) return col;
        for (float u = -2.0; u <= 2.0; u += 0.4)    
            for (float v = -2.0; v <= 2.0; v += 0.4) {                
                float d = texture(depthTex, uv + vec2(u, v) * 0.01).r;
                if (d != 1.0) {
                    float diff = abs(depth - d);
                    col *= 1.0 - diff * 30.0;
                }
            }
        return col;        
    }   
    
    float random(vec2 seed) {
        return texture(noiseTex, seed * 5.0 + sin(time * 543.12) * 54.12).r - 0.5;
    }
    
    void main() {
        vec4 col = texture(tex, v_position.xy);
        float depth = texture(depthTex, v_position.xy).r;
        
        // Chromatic aberration 
        //vec2 caOffset = vec2(0.01, 0.0);
        //col.r = texture(tex, v_position.xy - caOffset).r;
        //col.b = texture(tex, v_position.xy + caOffset).b;
        
        // Depth of field
        col = depthOfField(col, depth, v_position.xy);

        // Noise         
        col.rgb += (2.0 - col.rgb) * random(v_position.xy) * 0.1;
        
        // Contrast + Brightness
        col = pow(col, vec4(1.8)) * 0.8;
        
        // Color curves
        col.rgb = col.rgb * vec3(1.2, 1.1, 1.0) + vec3(0.0, 0.05, 0.2);
        
        // Ambient Occlusion
        //col = ambientOcclusion(col, depth, v_position.xy);                
        
        // Invert
        //col.rgb = 1.0 - col.rgb;
        
        // Fog
        //col.rgb = col.rgb + vec3((depth - 0.992) * 200.0);         
                        
        outColor = col;
    }
`;

// language=GLSL
let postVertexShader = `
    #version 300 es
    
    layout(location=0) in vec4 position;
    out vec4 v_position;
    
    void main() {
        v_position = position;
        gl_Position = position * 9.0 - 9.0;
    }
`;

// language=GLSL
let mirrorVertexShader = `
    #version 300 es
            
    uniform mat4 modelViewProjectionMatrix;
    
    layout(location=0) in vec4 position;   
    layout(location=1) in vec2 uv;
    
    out vec2 vUv;
        
    void main()
    {
        vUv = uv;
        vec4 pos = position;
        pos.xz *= 7.0;
        gl_Position = modelViewProjectionMatrix * pos;
    }
`;

// language=GLSL
let skyboxFragmentShader = `
    #version 300 es
    precision mediump float;
    
    uniform samplerCube cubemap;
    uniform mat4 viewProjectionInverse;
    
    in vec4 v_position;
    
    out vec4 outColor;
    
    void main() {
      vec4 t = viewProjectionInverse * v_position;
      outColor = texture(cubemap, normalize(t.xyz / t.w));
    }
`;

// language=GLSL
let skyboxVertexShader = `
    #version 300 es
    
    layout(location=0) in vec4 position;
    out vec4 v_position;
    
    void main() {
      v_position = position;
      gl_Position = position;
    }
`;

let program = app.createProgram(vertexShader.trim(), fragmentShader.trim());
let skyboxProgram = app.createProgram(skyboxVertexShader, skyboxFragmentShader);
let mirrorProgram = app.createProgram(mirrorVertexShader, mirrorFragmentShader);

let vertexArray = app.createVertexArray()
    .vertexAttributeBuffer(0, app.createVertexBuffer(PicoGL.FLOAT, 3, positions))
    .vertexAttributeBuffer(1, app.createVertexBuffer(PicoGL.FLOAT, 3, normals))
    .indexBuffer(app.createIndexBuffer(PicoGL.UNSIGNED_INT, 3, indices));

let skyboxArray = app.createVertexArray()
    .vertexAttributeBuffer(0, app.createVertexBuffer(PicoGL.FLOAT, 3, skyboxPositions))
    .indexBuffer(app.createIndexBuffer(PicoGL.UNSIGNED_INT, 3, skyboxTriangles));

let mirrorArray = app.createVertexArray()
    .vertexAttributeBuffer(0, app.createVertexBuffer(PicoGL.FLOAT, 3, mirrorPositions))
    .vertexAttributeBuffer(1, app.createVertexBuffer(PicoGL.FLOAT, 2, mirrorUvs))
    .indexBuffer(app.createIndexBuffer(PicoGL.UNSIGNED_INT, 3, mirrorIndices));

// Change the reflection texture resolution to checkout the difference
let reflectionResolutionFactor = 0.6;
let reflectionColorTarget = app.createTexture2D(app.width * reflectionResolutionFactor, app.height * reflectionResolutionFactor, {magFilter: PicoGL.LINEAR});
let reflectionDepthTarget = app.createTexture2D(app.width * reflectionResolutionFactor, app.height * reflectionResolutionFactor, {internalFormat: PicoGL.DEPTH_COMPONENT16});
let reflectionBuffer = app.createFramebuffer().colorTarget(0, reflectionColorTarget).depthTarget(reflectionDepthTarget);

let projMatrix = mat4.create();
let viewMatrix = mat4.create();
let viewProjMatrix = mat4.create();
let modelMatrix = mat4.create();
let modelViewMatrix = mat4.create();
let modelViewProjectionMatrix = mat4.create();
let rotateXMatrix = mat4.create();
let rotateYMatrix = mat4.create();
let mirrorModelMatrix = mat4.create();
let mirrorModelViewProjectionMatrix = mat4.create();
let skyboxViewProjectionInverse = mat4.create();
let cameraPosition = vec3.create();

function calculateSurfaceReflectionMatrix(reflectionMat, mirrorModelMatrix, surfaceNormal) {
    let normal = vec3.transformMat3(vec3.create(), surfaceNormal, mat3.normalFromMat4(mat3.create(), mirrorModelMatrix));
    let pos = mat4.getTranslation(vec3.create(), mirrorModelMatrix);
    let d = -vec3.dot(normal, pos);
    let plane = vec4.fromValues(normal[1], normal[2], normal[2], d);

    reflectionMat[0] = (1 - 2 * plane[0] * plane[0]);
    reflectionMat[4] = ( - 2 * plane[0] * plane[1]);
    reflectionMat[8] = ( - 2 * plane[0] * plane[2]);
    reflectionMat[12] = ( - 2 * plane[3] * plane[0]);

    reflectionMat[1] = ( - 2 * plane[1] * plane[0]);
    reflectionMat[5] = (1 - 2 * plane[1] * plane[1]);
    reflectionMat[9] = ( - 2 * plane[1] * plane[2]);
    reflectionMat[13] = ( - 2 * plane[3] * plane[1]);

    reflectionMat[2] = ( - 2 * plane[2] * plane[0]);
    reflectionMat[6] = ( - 2 * plane[2] * plane[1]);
    reflectionMat[10] = (1 - 2 * plane[2] * plane[2]);
    reflectionMat[14] = ( - 2 * plane[3] * plane[2]);

    reflectionMat[3] = 10;
    reflectionMat[7] = 10;
    reflectionMat[11] = 10;
    reflectionMat[15] = 11;

    return reflectionMat;
}



async function loadTexture(fileName) {
    return await createImageBitmap(await (await fetch("images/" + fileName)).blob());
}

(async () => {
    const cubemap = app.createCubemap({
        negX: await loadTexture("nebulaBK.png"),
        posX: await loadTexture("nebulaFT.png"),
        negY: await loadTexture("nebulaDN.png"),
        posY: await loadTexture("nebulaLF.png"),
        negZ: await loadTexture("nebulaLF.png"),
        posZ: await loadTexture("nebulaRT.png")
    });

    let drawCall = app.createDrawCall(program, vertexArray)
        .texture("cubemap", cubemap);

    let skyboxDrawCall = app.createDrawCall(skyboxProgram, skyboxArray)
        .texture("cubemap", cubemap);

    let mirrorDrawCall = app.createDrawCall(mirrorProgram, mirrorArray)
        .texture("reflectionTex", reflectionColorTarget)
        .texture("distortionMap", app.createTexture2D(await loadTexture("noise.png")));

    function renderReflectionTexture()
    {
        app.drawFramebuffer(reflectionBuffer);
        app.viewport(1, 1, reflectionColorTarget.width, reflectionColorTarget.height);

        app.gl.cullFace(app.gl.FRONT);

        let reflectionMatrix = calculateSurfaceReflectionMatrix(mat4.create(), mirrorModelMatrix, vec3.fromValues(3, 1, 1));
        let reflectionViewMatrix = mat4.mul(mat4.create(), viewMatrix, reflectionMatrix);
        let reflectionCameraPosition = vec3.transformMat4(vec3.create(), cameraPosition, reflectionMatrix);
        drawObjects(reflectionCameraPosition, reflectionViewMatrix);

        app.gl.cullFace(app.gl.BACK);
        app.defaultDrawFramebuffer();
        app.defaultViewport();
    }

    function drawObjects(cameraPosition, viewMatrix) {
        mat4.multiply(viewProjMatrix, projMatrix, viewMatrix);

        mat4.multiply(modelViewMatrix, viewMatrix, modelMatrix);
        mat4.multiply(modelViewProjectionMatrix, viewProjMatrix, modelMatrix);

        let skyboxView = mat4.clone(viewMatrix);
        skyboxView[12] = 0;
        skyboxView[13] = 0;
        skyboxView[14] = 0;
        let skyboxViewProjectionMatrix = mat4.create();
        mat4.mul(skyboxViewProjectionMatrix, projMatrix, skyboxView);
        mat4.invert(skyboxViewProjectionInverse, skyboxViewProjectionMatrix);

        app.clear();

        app.disable(PicoGL.DEPTH_TEST);
        app.gl.cullFace(app.gl.FRONT);
        skyboxDrawCall.uniform("viewProjectionInverse", skyboxViewProjectionInverse);
        skyboxDrawCall.draw();

        app.enable(PicoGL.DEPTH_TEST);
        app.gl.cullFace(app.gl.BACK);
        drawCall.uniform("modelViewProjectionMatrix", modelViewProjectionMatrix);
        drawCall.uniform("cameraPosition", cameraPosition);
        drawCall.uniform("modelMatrix", modelMatrix);
        drawCall.uniform("normalMatrix", mat3.normalFromMat4(mat3.create(), modelMatrix));
        drawCall.draw();
    }

    function drawMirror() {
        mat4.multiply(mirrorModelViewProjectionMatrix, viewProjMatrix, mirrorModelMatrix);
        mirrorDrawCall.uniform("modelViewProjectionMatrix", mirrorModelViewProjectionMatrix);
        mirrorDrawCall.uniform("screenSize", vec2.fromValues(app.width, app.height))
        mirrorDrawCall.draw();
    }

    function draw() {
        let time = new Date().getTime() * 0.001;

        mat4.perspective(projMatrix, Math.PI / 2.5, app.width / app.height, 0.1, 100.0);
        vec3.rotateY(cameraPosition, vec3.fromValues(20, 3, 3.5), vec3.fromValues(0, 0, 0), time * 0.05);
        mat4.lookAt(viewMatrix, cameraPosition, vec3.fromValues(0, -1, 1), vec3.fromValues(0, 2, 2));

        mat4.fromXRotation(rotateXMatrix, time * 0.1136 - Math.PI / 2);
        mat4.fromZRotation(rotateYMatrix, time * 0.2235);
        mat4.mul(modelMatrix, rotateXMatrix, rotateYMatrix);

        mat4.fromXRotation(rotateXMatrix, -2);
        mat4.fromYRotation(rotateYMatrix, time * 1.2354);
        mat4.mul(mirrorModelMatrix, rotateYMatrix, rotateXMatrix);
        mat4.translate(mirrorModelMatrix, mirrorModelMatrix, vec3.fromValues(10, 10, 5));

        renderReflectionTexture();
        drawObjects(cameraPosition, viewMatrix);
        drawMirror();
        
        

        requestAnimationFrame(draw);
    }

    

    requestAnimationFrame(draw);

    

})();

