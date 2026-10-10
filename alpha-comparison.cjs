const { chromium } = require(require('node:path').join(process.cwd(), 'node_modules/@playwright/test'));
const fs = require('node:fs');
const http = require('node:http');

(async () => {
  const root = __dirname;
  const server = http.createServer((req, res) => {
    if (req.url === '/font.ttf') {
      res.setHeader('Content-Type','font/ttf');
      res.end(fs.readFileSync(`${root}/font.ttf`));
    } else {
      res.end('<!doctype html><body style="margin:0;font-family:TestMono"></body>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({headless: true, args: ['--no-sandbox', '--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
    const page = await browser.newPage({viewport: {width: 1000, height: 400}});
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const result = await page.evaluate(async () => {
      const font = await new FontFace('TestMono','url(/font.ttf)').load();
      document.fonts.add(font);
      if (!navigator.gpu) throw Error('WebGPU unavailable');
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw Error('No WebGPU adapter');
      const device = await adapter.requestDevice();
      const errors = [];
      device.addEventListener('uncapturederror', e => errors.push(e.error.message));
      const shader = device.createShaderModule({code: `
        struct Out { @builtin(position) position: vec4f, @location(0) uv: vec2f }
        @vertex fn vs(@builtin(vertex_index) i: u32) -> Out {
          let p = array<vec2f, 6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1))[i];
          var o: Out; o.position = vec4f(p * vec2f(2,-2) + vec2f(-1,1),0,1); o.uv = p; return o;
        }
        @group(0) @binding(0) var tex: texture_2d<f32>;
        @group(0) @binding(1) var samp: sampler;
        @fragment fn fs(o: Out) -> @location(0) vec4f { return textureSample(tex,samp,o.uv); }
      `});
      const compilation = await shader.getCompilationInfo();
      for (const message of compilation.messages) if (message.type === 'error') errors.push(message.message);
      const results = [];
      for (const dpr of [1,2]) {
        const w = 448*dpr, h = 72*dpr;
        const atlas = new OffscreenCanvas(w,h);
        const ctx = atlas.getContext('2d', {alpha:true,willReadFrequently:true});
        ctx.font = `${14*dpr}px TestMono`;
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#aa5500';
        ctx.fillText('"editor.experimentalGpuAcceleration": "on",', 8*dpr, 8*dpr);
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#008000';
        ctx.fillText('Dim text and antialiased glyph edges', 8*dpr, 30*dpr);
        ctx.fillStyle = '#663399';
        ctx.fillRect(8*dpr,54*dpr,150*dpr,10*dpr);
        const pixels = ctx.getImageData(0,0,w,h).data;
        const atlasTexture = device.createTexture({size:[w,h],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
        device.queue.copyExternalImageToTexture({source:atlas},{texture:atlasTexture},[w,h]);
        for (const theme of ['light','dark']) {
          const background = theme === 'light' ? [245,245,245] : [30,30,30];
          for (const alphaFactor of ['src-alpha','one']) {
            const pipeline = device.createRenderPipeline({layout:'auto',vertex:{module:shader,entryPoint:'vs'},fragment:{module:shader,entryPoint:'fs',targets:[{format:'rgba8unorm',blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:alphaFactor,dstFactor:'one-minus-src-alpha'}}}]},primitive:{topology:'triangle-list'}});
            const target = device.createTexture({size:[w,h],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC|GPUTextureUsage.TEXTURE_BINDING});
            const group = device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:atlasTexture.createView()},{binding:1,resource:device.createSampler({magFilter:'nearest',minFilter:'nearest'})}]});
            const bytesPerRow = Math.ceil(w*4/256)*256;
            const buffer = device.createBuffer({size:bytesPerRow*h,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
            const encoder = device.createCommandEncoder();
            const pass = encoder.beginRenderPass({colorAttachments:[{view:target.createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,0]}]});
            pass.setPipeline(pipeline); pass.setBindGroup(0,group); pass.draw(6); pass.end();
            encoder.copyTextureToBuffer({texture:target},{buffer,bytesPerRow},[w,h]);
            device.queue.submit([encoder.finish()]);
            await buffer.mapAsync(GPUMapMode.READ);
            const data = new Uint8Array(buffer.getMappedRange());
            let maxAlphaError=0, maxColorError=0, affected=0;
            const image = new ImageData(w,h);
            for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
              const p=(y*w+x)*4, q=y*bytesPerRow+x*4;
              const a=pixels[p+3]/255, gpuA=data[q+3]/255;
              maxAlphaError=Math.max(maxAlphaError,Math.abs(gpuA-a));
              let pixelError=0;
              for (let c=0;c<3;c++) {
                const expected=pixels[p+c]*a+background[c]*(1-a);
                const actual=Math.min(255,data[q+c]+background[c]*(1-gpuA));
                pixelError=Math.max(pixelError,Math.abs(actual-expected));
                image.data[p+c]=actual;
              }
              image.data[p+3]=255;
              maxColorError=Math.max(maxColorError,pixelError);
              if(pixelError>2) affected++;
            }
            results.push({dpr,theme,alphaFactor,maxAlphaError,maxColorError,affected});
            if(dpr===1 && theme==='light') {
              const label=document.createElement('p'); label.textContent=alphaFactor==='one'?'Corrected alpha blending':'Original alpha blending';document.body.append(label);
              const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;canvas.getContext('2d').putImageData(image,0,0);document.body.append(canvas);
            }
            buffer.unmap(); buffer.destroy(); target.destroy();
          }
        }
        atlasTexture.destroy();
      }
      await device.queue.onSubmittedWorkDone();
      if(errors.length) throw Error(errors.join('\n'));
      for(const r of results) {
        if(r.alphaFactor==='one' && (r.maxAlphaError>1/255 || r.maxColorError>2 || r.affected!==0)) throw Error('Corrected blend failed: '+JSON.stringify(r));
        if(r.alphaFactor==='src-alpha' && (r.maxAlphaError<0.2 || r.affected<100)) throw Error('Original did not reproduce: '+JSON.stringify(r));
      }
      return {adapter:adapter.info,results,errors};
    });
    fs.writeFileSync(`${root}/webgpu-results.json`,JSON.stringify(result,null,2)+'\n');
    await page.screenshot({path:`${root}/webgpu-comparison.png`});
    console.log(JSON.stringify(result,null,2));
  } finally {
    await browser?.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
