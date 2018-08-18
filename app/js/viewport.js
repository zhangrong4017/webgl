'use strict';

let _ = require('underscore');
let glslify = require('glslify')
let glm = require('gl-matrix');
let ch = require('convex-hull');

////////////////////////////////////////////////////////////////////////////////

let ui = require('./ui.js');
let printer = require('./printer.js');

let canvas = document.getElementById("canvas");
let gl = canvas.getContext("experimental-webgl");

////////////////////////////////////////////////////////////////////////////////

let mouse = {};

// Model object模型对象
let mesh = {"loaded": false};
let quad = makeQuad();
let base = makeBase();

let scene = {"roll": 45, "pitch": 45};

let slice = makeSlice();

////////////////////////////////////////////////////////////////////////////////

function makeSlice()
{
    let slice = {"fbo": gl.createFramebuffer(),
                 "tex": gl.createTexture(),
                 "buf": gl.createRenderbuffer()};

    slice.prog = makeProgram(
        glslify(__dirname + '/../shaders/slice.vert'),
        glslify(__dirname + '/../shaders/slice.frag'),
        ['model','bounds','frac','aspect'], ['v']);

    gl.bindTexture(gl.TEXTURE_2D, slice.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA,
                  printer.resolution.x, printer.resolution.y,
                  0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindTexture(gl.TEXTURE_2D, null);

    return slice;
}

////////////////////////////////////////////////////////////////////////////////
//滑动条移动，绘制切片
document.getElementById("slider").oninput = function(event)
{
    //滑动条的位置
    quad.frac = event.target.valueAsNumber / 100.0;
    //渲染切片
    renderSlice();
    //绘制图片
    draw();
}

////////////////////////////////////////////////////////////////////////////////

function mouseDownListener(event)
{
    mouse.down = true;
    mouse.pos = {"x": event.clientX,
                 "y": event.clientY};
    mouse.shift = event.shiftKey;
}

function mouseUpListener(event)
{
    mouse.down = false;
}

function mouseMoveListener(event)
{
    if (mouse.down)
    {
        if (mouse.shift)
        {
            mesh.roll  += (mouse.pos.x - event.clientX) / 100.0;
            mesh.pitch += (mouse.pos.y - event.clientY) / 100.0;
            getMeshBounds();
            renderSlice();
        }
        else
        {
            scene.roll  -= (mouse.pos.x - event.clientX) / 100.0;
            scene.pitch += (mouse.pos.y - event.clientY) / 100.0;
        }

        mouse.pos = {"x": event.clientX,
                     "y": event.clientY};
        draw();
    }
}
//创建着色器
//txt-着色器源代码
//type-gl.VERTEX_SHADER 点 gl.FRAGMENT_SHADER线段
//返回着色器s
function buildShader(txt, type)
{
    //创建一个webGL着色器，type：gl.VERTEX_SHADER 点 gl.FRAGMENT_SHADER线段
    let s = gl.createShader(type);
    //设置webGL着色器的源代码，s-着色器对象，txt-包含待设置的GLSL原代码
    gl.shaderSource(s, txt);
    //编译着色器
    gl.compileShader(s);

    //判断是否成功编译
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    {
        throw "Could not compile shader:" + gl.getShaderInfoLog(s);
    }
    //返回着色器
    return s;
}

function setUniforms(prog, u)
{
    prog.uniform = {};
    _.each(u, function(u){ prog.uniform[u] = gl.getUniformLocation(prog, u); });
}

function setAttribs(prog, a)
{
    prog.attrib = {};
    _.each(a, function(a){ prog.attrib[a] = gl.getAttribLocation(prog, a); });
}

//=======================================================
//=====================================================
function makeProgram(vert, frag, uniforms, attribs)
{
    //创建着色器
    let v = buildShader(vert, gl.VERTEX_SHADER);//点类型
    let f = buildShader(frag, gl.FRAGMENT_SHADER);//线段类型


    //创建和初始化一个webGLProgram对象
    let prog = gl.createProgram();

    //附着着色器v，f，链接prog程序对象
    gl.attachShader(prog, v);
    gl.attachShader(prog, f);
    gl.linkProgram(prog);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
    {
        throw "Could not link program:" + gl.getProgramInfoLog(prog);
    }

    setUniforms(prog, uniforms);
    setAttribs(prog, attribs);

    return prog;
}

function init()
{
    canvas.addEventListener("mousedown", mouseDownListener, false);
    canvas.addEventListener("mousemove", mouseMoveListener, false);
    canvas.addEventListener("mouseup",   mouseUpListener, false);

    gl.enable(gl.DEPTH_TEST);
    draw();
}

function viewMatrix()
{
    let v = glm.mat4.create();
    glm.mat4.scale(v, v, [1, 1, 0.5]);
    glm.mat4.rotateX(v, v, scene.pitch);
    glm.mat4.rotateZ(v, v, scene.roll);
    glm.mat4.scale(v, v, [0.5, 0.5, -0.5]);

    return v;
}

function modelMatrix()
{
    let m = glm.mat4.create();
    glm.mat4.rotateZ(m, m, mesh.roll);
    glm.mat4.rotateX(m, m, mesh.pitch);
    glm.mat4.rotateY(m, m, mesh.yaw);

    let out = glm.mat4.create();
    glm.mat4.mul(out, m, mesh.M);
    return out;
}

function drawMesh(mesh)
{
    gl.useProgram(mesh.prog);

    gl.uniformMatrix4fv(mesh.prog.uniform.view, false, viewMatrix());
    gl.uniformMatrix4fv(mesh.prog.uniform.model, false, modelMatrix());

    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vert);
    gl.enableVertexAttribArray(mesh.prog.attrib.v);
    gl.vertexAttribPointer(mesh.prog.attrib.v, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.norm);
    gl.enableVertexAttribArray(mesh.prog.attrib.n);
    gl.vertexAttribPointer(mesh.prog.attrib.n, 3, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, mesh.triangles);
}

//绘制坐标系
function drawBase(base)
{
    //激活多边形的剔除
    gl.enable(gl.CULL_FACE);
    //GLenum指定前面或后面的多边形是否适合剔除。
    //默认值为gl.BACK。 可能的值是：gl.FRONT,gl.BACK,gl.FRONT_AND_BACK
    gl.cullFace(gl.FRONT);
    //将指定的WebGLProgram设置为当前呈现状态的一部分。
    gl.useProgram(base.prog);

    gl.uniformMatrix4fv(base.prog.uniform.view, false, viewMatrix());
    if (mesh.loaded)
    {
        gl.uniform1f(base.prog.uniform.zmin, mesh.bounds.zmin);
    }
    else
    {
        gl.uniform1f(base.prog.uniform.zmin, 0);
    }
    gl.uniform1f(base.prog.uniform.aspect, printer.aspectRatio());

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.bindBuffer(gl.ARRAY_BUFFER, base.vert);
    gl.enableVertexAttribArray(base.prog.attrib.v);
    gl.vertexAttribPointer(base.prog.attrib.v, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.disable(gl.CULL_FACE);
}

//参数：quad，来源于makequad

function drawQuad(quad)
{
    gl.useProgram(quad.prog);

    gl.disable(gl.DEPTH_TEST);
    gl.uniformMatrix4fv(quad.prog.uniform.view, false, viewMatrix());

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, slice.tex);
    gl.uniform1i(quad.prog.uniform.tex, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, quad.vert);
    gl.enableVertexAttribArray(quad.prog.attrib.v);
    gl.vertexAttribPointer(quad.prog.attrib.v, 2, gl.FLOAT, false, 0, 0);

    gl.uniform1f(quad.prog.uniform.frac, quad.frac);
    gl.uniform1f(quad.prog.uniform.aspect, printer.aspectRatio());
    gl.uniform2f(quad.prog.uniform.bounds, mesh.bounds.zmin, mesh.bounds.zmax);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.enable(gl.DEPTH_TEST);
}

function draw()
{
    //清除颜色（r，g，b，透明度）
    gl.clearColor(1, 1, 1, 1);
    //清除颜色缓冲
    gl.clear(gl.COLOR_BUFFER_BIT);

    //绘制坐标轴
     drawBase(base);

    if (mesh.loaded)
    {
        //绘制3D模型
        drawMesh(mesh, true);
        //绘制截面
        drawQuad(quad);
    }
}

//
function makeQuad()
{
    let quad = {};
    quad.prog = makeProgram(
        glslify(__dirname + '/../shaders/quad.vert'),
        glslify(__dirname + '/../shaders/quad.frag'),
        ['view','tex','frac','aspect','bounds'], ['v']);

    quad.vert = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad.vert);
    gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1,
                          -1,  1,
                           1, -1,
                           1,  1]),
        gl.STATIC_DRAW);

    quad.frac = 0.5;
    return quad;
}

function makeBase()
{
    let base = {};
    base.prog = makeProgram(
        glslify(__dirname + '/../shaders/base.vert'),
        glslify(__dirname + '/../shaders/base.frag'),
        ['view', 'zmin', 'aspect'], ['v']);

    base.vert = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, base.vert);
    gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1,
                          -1,  1,
                           1, -1,
                           1,  1]),
        gl.STATIC_DRAW);

    base.frac = 0.5;
    return base;
}

function getMeshBounds()
{
    let M = modelMatrix();

    let vs = _.map(mesh.ch, function(i){
        let out = glm.vec3.create();
        glm.mat4.mul(out, M, [mesh.verts[i][0],
                              mesh.verts[i][1],
                              mesh.verts[i][2], 1]);
        return out;});

    // Find bounds and center, then store them in matrix M
    let xyz = _.unzip(vs);

    mesh.bounds = {};
    mesh.bounds.xmin = _.min(xyz[0]);
    mesh.bounds.xmax = _.max(xyz[0]);

    mesh.bounds.ymin = _.min(xyz[1]);
    mesh.bounds.ymax = _.max(xyz[1]);

    mesh.bounds.zmin = _.min(xyz[2]);
    mesh.bounds.zmax = _.max(xyz[2]);
}

function updateScale()
{
    // Create identity transform matrix
    mesh.M = glm.mat4.create();

    // Find bounds and center, then store them in matrix M
    getMeshBounds();

    let scale = ui.getStlScale() * printer.getGLscale();

    // Store mesh transform matrix
    mesh.M = glm.mat4.create();
    glm.mat4.scale(mesh.M, mesh.M, [scale, scale, scale]);
    glm.mat4.translate(mesh.M, mesh.M, [
        -(mesh.bounds.xmin + mesh.bounds.xmax) / 2,
        -(mesh.bounds.ymin + mesh.bounds.ymax) / 2,
        -(mesh.bounds.zmin + mesh.bounds.zmax) / 2]);

    // Recalculate mesh bounds with the transform matrix
    getMeshBounds();
}

function loadMesh(stl)
{
    // Clear the status field
    ui.setStatus("");

    // Reset pitch and roll
    mesh.roll = 0;
    mesh.pitch = 0;
    mesh.yaw = 0;

    // Compile shader program for mesh
    mesh.prog = makeProgram(
        glslify(__dirname + '/../shaders/mesh.vert'),
        glslify(__dirname + '/../shaders/mesh.frag'),
        ['view', 'model'], ['v', 'n']);

    // Store unique vertices
    mesh.verts = stl.positions;

    // Store mesh's convex hull (as indices into vertex list)
    mesh.ch = _.unique(_.flatten(ch(stl.positions)));

    // Work out mesh scale
    updateScale();

    // Load vertex positions into a buffer
    let flattened = _.flatten(stl.positions);
    mesh.vert = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vert);
    gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array(flattened),
        gl.STATIC_DRAW);

    // Load normals into a second buffer
    let norms = new Float32Array(flattened.length);
    for (let i=0; i < stl.positions.length; i += 3)
    {
        let a = glm.vec3.create();
        let b = glm.vec3.create();
        let c = glm.vec3.create();

        glm.vec3.sub(a, stl.positions[i], stl.positions[i+1]);
        glm.vec3.sub(b, stl.positions[i], stl.positions[i+2]);
        glm.vec3.cross(c, a, b);
        glm.vec3.normalize(c, c);

        for (let j=0; j < 3; ++j)
        {
            for (let k=0; k < 3; ++k)
            {
                norms[i*3 + j*3 + k] = c[k];
            }
        }
    }
    mesh.norm = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.norm);
    gl.bufferData(
        gl.ARRAY_BUFFER,
        norms,
        gl.STATIC_DRAW);

    // Store the number of triangles
    mesh.triangles = stl.positions.length;

    // Get bounds with new transform matrix applied
    mesh.loaded = true;

    renderSlice();
    window.requestAnimationFrame(draw);
}

////////////////////////////////////////////////////////////////////////////////
//渲染切片
function renderSlice()
{
    // We won't be using the depth test in this rendering pass
    //此处不会使用到深度测试
    gl.disable(gl.DEPTH_TEST);//禁用深度测试
    //设置模版测试的前、后功能和参考值。
    //模版可以在每个像素的基础上启用和禁用绘图。它通常用于多通道渲染以获得特殊效果。
    gl.enable(gl.STENCIL_TEST);//激活模板测试并更新模板缓冲区
    //设置视窗，指定从设备与显示设备之间，x和y的仿射变换，printer.resolution.x/y为画布大小参数
    gl.viewport(0, 0, printer.resolution.x, printer.resolution.y);

    // Bind the target framebuffer
    //绑定目标帧缓冲区
    //gl.FRAMEBUFFER：用于渲染图像的颜色、alpha（透明度）、深度和模板缓冲区的收集缓冲区数据存储。
    //slice.fbo：待绑定的WebGLFramebuffer对象
    gl.bindFramebuffer(gl.FRAMEBUFFER, slice.fbo);

    
    //为framebuffer附上输出纹理
    //gl.FRAMEBUFFER:将纹理附加到帧缓冲区的颜色缓冲区
    //gl.COLOR_ATTACHMENT0:将纹理附加到帧缓冲区的颜色缓冲区
    //gl.TEXTURE_2D:指定纹理目标对象为2D图像
    //slice.tex:webGL待附上的纹理
    gl.framebufferTexture2D(
        gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D, slice.tex, 0);

    // Bind the renderbuffer to get a stencil buffer
    //绑定渲染缓冲区以获取模板缓冲区
    //绑定渲染缓冲区，slice.buf:待绑定的渲染缓冲区对象
    gl.bindRenderbuffer(gl.RENDERBUFFER, slice.buf);
    //创建并初始化渲染缓冲区对象的数据存储区。
    // printer.resolution.x渲染缓冲区的像素宽度
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_STENCIL,
                           printer.resolution.x, printer.resolution.y);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT,
                               gl.RENDERBUFFER, slice.buf);

    // Clear texture清除质地
    //清除颜色
    gl.clearColor(0, 0, 0, 0);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

    gl.useProgram(slice.prog);

    // Load model matrix加载模型矩阵
    gl.uniformMatrix4fv(slice.prog.uniform.model, false, modelMatrix());

    // Load slice position and mesh bounds加载切片位置和网格边界
    gl.uniform1f(slice.prog.uniform.frac, quad.frac);
    gl.uniform1f(slice.prog.uniform.aspect, printer.aspectRatio());
    gl.uniform2f(slice.prog.uniform.bounds, mesh.bounds.zmin, mesh.bounds.zmax);

    // Load mesh vertices加载网格顶点
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vert);
    gl.enableVertexAttribArray(mesh.prog.attrib.v);
    gl.vertexAttribPointer(mesh.prog.attrib.v, 3, gl.FLOAT, false, 0, 0);

    // Draw twice, adding and subtracting values in the stencil buffer
    //绘制两次，在模板缓冲区中添加和减去值
    // based on the handedness of faces that we encounter
    //基于我们遇到的面孔的手性
    gl.stencilFunc(gl.ALWAYS, 0, 0xFF);
    gl.stencilOpSeparate(gl.BACK,  gl.KEEP, gl.KEEP, gl.INCR);
    gl.stencilOpSeparate(gl.FRONT, gl.KEEP, gl.KEEP, gl.KEEP);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.triangles);

    gl.stencilOpSeparate(gl.BACK,  gl.KEEP, gl.KEEP, gl.KEEP);
    gl.stencilOpSeparate(gl.FRONT, gl.KEEP, gl.KEEP, gl.DECR);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.triangles);

    // Clear the color bit in preparation for a redraw
    //清除颜色位以准备重绘
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Draw again, discarding samples if the stencil buffer != 0
    //如果模板缓冲区！= 0，则再次绘制，丢弃样本
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP, gl.KEEP);
    gl.stencilFunc(gl.NOTEQUAL, 0, 0xFF);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.triangles);

    // Load the data from the framebuffer
    //从帧缓冲区加载数据
    let data = new Uint8Array(printer.pixels() * 4);
    gl.readPixels(0, 0, printer.resolution.x, printer.resolution.y, gl.RGBA,
                  gl.UNSIGNED_BYTE, data);

    // Restore the default framebuffer0
    //恢复默认的framebuffer0
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);

    gl.viewport(0, 0, canvas.width, canvas.height);

    return data;
}

function getSliceAt(frac)
{
    quad.frac = frac;
    document.getElementById("slider").valueAsNumber = frac * 100;
    draw();
    return renderSlice();
}

function getBounds()
{
    return mesh.bounds;
}

function hasModel()
{
    return mesh.loaded;
}

document.getElementById("rot_reset").onclick = function(event) {
    mesh.roll  = 0;
    mesh.pitch = 0;
    mesh.yaw = 0;
    getMeshBounds();
    renderSlice();
    draw();
}

document.getElementById("rot_x_plus").onclick = function(event) {
    mesh.pitch += Math.PI/2;
    getMeshBounds();
    renderSlice();
    draw();
}

document.getElementById("rot_x_minus").onclick = function(event) {
    mesh.pitch -= Math.PI/2;
    getMeshBounds();
    renderSlice();
    draw();
}


document.getElementById("rot_y_plus").onclick = function(event) {
    mesh.yaw += Math.PI/2;
    getMeshBounds();
    renderSlice();
    draw();
}

document.getElementById("rot_y_minus").onclick = function(event) {
    mesh.yaw -= Math.PI/2;
    getMeshBounds();
    renderSlice();
    draw();
}

document.getElementById("rot_z_plus").onclick = function(event) {
    mesh.roll  += Math.PI/2;
    getMeshBounds();
    renderSlice();
    draw();
}

document.getElementById("rot_z_minus").onclick = function(event) {
    mesh.roll  -= Math.PI/2;
    mesh.pitch += 0;
    getMeshBounds();
    renderSlice();
    draw();
}

document.getElementById("mm").onchange = function(event) {
    updateScale();
    renderSlice();
    draw();
}

module.exports = {'init': init,
                  'loadMesh': loadMesh,
                  'getSliceAt': getSliceAt,
                  'getBounds': getBounds,
                  'hasModel': hasModel};
