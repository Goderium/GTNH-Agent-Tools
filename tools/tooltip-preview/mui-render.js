"use strict";
// Draw in GUI units. Rasterization takes place at the physical resolution (including texture sampling).
globalThis.renderMui = async function(scene,scale,files,drawText) {
  const canvas=document.createElement("canvas");
  if(!Number.isInteger(scale)||scale<1||scale>4||scene.width*scene.height*scale*scale>16000000) throw Error("Invalid MUI2 render size.");
  canvas.width=scene.width*scale;canvas.height=scene.height*scale;
  const gl=canvas.getContext("webgl",{alpha:true,antialias:false,preserveDrawingBuffer:true,premultipliedAlpha:true});
  if(!gl) throw Error("MUI2 rendering requires WebGL.");
  const vertex="attribute vec2 p,uv;attribute vec4 rgba;varying highp vec2 t;varying highp vec4 c;uniform mat4 ortho;void main(){gl_Position=ortho*vec4(p,0.,1.);t=uv;c=rgba;}";
  const derivatives=gl.getExtension("OES_standard_derivatives");
  const tapCode=mode=>TooltipCore.samples[mode].map(([u,v])=>
    "sum+=sampleGlyph(t+factor*vec2("+u.toFixed(1)+","+v.toFixed(1)+"));").join("\n");
  const fragment=(derivatives?"#extension GL_OES_standard_derivatives : enable\n":"")+`
    precision highp float;
    varying vec2 t; varying vec4 c;
    uniform sampler2D tex;
    uniform bool textured;
    uniform int fontPass,cutout;
    uniform float strength,brightness;
    uniform vec4 bounds;
    float sampleGlyph(vec2 uv) {
      if (uv.x<bounds.x || uv.x>bounds.z || uv.y<bounds.y || uv.y>bounds.w) return 0.;
      return texture2D(tex,uv).a;
    }
    void main(){
      vec4 v=c;
      if(fontPass>0) {
        float coverage=texture2D(tex,t).a;
        ${derivatives?`if(fontPass>1) {
          vec2 scaled=t*strength, factor=abs(dFdx(scaled))+abs(dFdy(scaled));
          float sum=0.;
          if(fontPass==2){${tapCode(1)}coverage=sum/4.;}
          else{${tapCode(2)}coverage=sum/16.;}
          coverage=(brightness*coverage)/(brightness*coverage+(1.-brightness)*(1.-coverage));
        }`:""}
        v.a*=coverage;
      } else if(textured) v*=texture2D(tex,t);
      if(cutout>0 && v.a<=0.1)discard;
      // Native unblended fluid sprites replace the visible RGB framebuffer after the alpha test.
      if(cutout==2)v.a=1.;
      gl_FragColor=v;
    }`;
  const program=gl.createProgram();
  const images=new Map();
  try {
    for(const [type,src] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]) {
      const shader=gl.createShader(type);gl.shaderSource(shader,src);gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));
      gl.attachShader(program,shader);
    }
    gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);gl.viewport(0,0,canvas.width,canvas.height);
    gl.disable(gl.DITHER);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());
    for(const [name,n,offset] of [["p",2,0],["uv",2,8],["rgba",4,16]]) {
      const idx=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(idx);gl.vertexAttribPointer(idx,n,gl.FLOAT,false,32,offset);
    }
    gl.uniformMatrix4fv(gl.getUniformLocation(program,"ortho"),false,new Float32Array([
      2/scene.width,0,0,0, 0,-2/scene.height,0,0, 0,0,-1,0, -1,1,0,1
    ]));
    const textured=gl.getUniformLocation(program,"textured"),cutout=gl.getUniformLocation(program,"cutout");
    const fontPass=gl.getUniformLocation(program,"fontPass"),uvBounds=gl.getUniformLocation(program,"bounds"),
      strength=gl.getUniformLocation(program,"strength"),brightness=gl.getUniformLocation(program,"brightness");
    const atlases=new Map();
    const rgba=n=>[(n>>>16&255)/255,(n>>>8&255)/255,(n&255)/255,(n>>>24)/255];
    const white=[1,1,1,1];
    function drawShape(mode,points) {
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(points.flatMap(([x,y,c])=>[x,y,0,0,...c])),gl.STREAM_DRAW);
      gl.drawArrays(mode,0,points.length);
    }
    function roundedRect(x,y,w,h,radius,segments,colors) {
      const [tl,tr,bl,br]=colors;
      // Color.average uses RMS for RGB and the integer arithmetic mean for alpha.
      const center=tl.map((_,i)=>{
        const bytes=colors.map(c=>Math.round(c[i]*255));
        const total=bytes.reduce((sum,b)=>sum+(i===3?b:b*b),0);
        return Math.trunc(i===3?total/4:Math.sqrt(total/4))/255;
      });
      const points=[[x+w/2,y+h/2,center],[x,y+radius,tl],[x,y+h-radius,bl]];
      function arc(cx,cy,color,dx,dy) {
        for(let i=1;i<=segments;i++){
          const angle=Math.PI/2/segments*i;
          points.push([cx+radius*dx(angle),cy+radius*dy(angle),color]);
        }
      }
      const negCos=a=>-Math.cos(a),negSin=a=>-Math.sin(a);
      arc(x+radius,y+h-radius,bl,negCos,Math.sin);
      points.push([x+w-radius,y+h,br]);
      arc(x+w-radius,y+h-radius,br,Math.sin,Math.cos);
      points.push([x+w,y+radius,tr]);
      arc(x+w-radius,y+radius,tr,Math.cos,negSin);
      points.push([x+radius,y,tl]);
      arc(x+radius,y+radius,tl,negSin,negCos);
      points.push([x,y+radius,tl]);
      drawShape(gl.TRIANGLE_FAN,points);
    }
    const colorIndices=[0,1,2,0,2,3],textureIndices=[1,2,3,1,3,0];
    // GuiDraw emits BL, BR, TR, TL. Angelica's QuadConverter submits (a,b,d), (b,c,d).
    const angelicaTextureIndices=[1,2,0,2,3,0];
    function quad(x0,y0,x1,y1,u0,v0,u1,v1,colors,indices=colorIndices,batch=null) {
      const [tl,tr,bl,br]=colors;
      const verts=[[x0,y0,u0,v0,...tl],[x0,y1,u0,v1,...bl],[x1,y1,u1,v1,...br],[x1,y0,u1,v0,...tr]];
      const values=indices.flatMap(i=>verts[i]);
      if(batch){batch.push(...values);return;}
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(values),gl.STREAM_DRAW);
      gl.drawArrays(gl.TRIANGLES,0,6);
    }
    function upload(img) {
      const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
      for(const p of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,p,gl.NEAREST);
      for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE);
      if(img.floatPixels) {
        if(!gl.getExtension("OES_texture_float"))throw Error("MUI2 text requires floating-point WebGL textures.");
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,img.width,img.height,0,gl.RGBA,gl.FLOAT,img.floatPixels);
      } else gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
      return tex;
    }
    // BatchingFontRenderer.pushTexRect expands the UVs along with the quad for the AA sample kernel.
    function drawGlyphs(label,originX,originY) {
      const {settings,scale:fontScale}=label,aa=settings.aaMode;
      if(aa && !derivatives)throw Error("Angelica font antialiasing requires WebGL fragment derivatives.");
      // Java's pushTexRect rounds positions and texture coordinates after each float operation.
      // At a texel boundary, rounding only when uploading the final vertex can change an AA tap.
      const f=Math.fround,weight=f(settings.aaStrength/120);
      gl.uniform1f(strength,weight);gl.uniform1f(brightness,.625*settings.brightness+.1875);
      gl.enable(gl.BLEND);gl.uniform1i(cutout,1);
      for(const stroke of label.strokes) {
        const s=stroke.shape,color=[...stroke.rgb.slice(0,3).map(n=>n/255),label.alpha];
        if(!s) {
          gl.uniform1i(textured,0);gl.uniform1i(fontPass,0);
          quad(originX+stroke.x*fontScale,originY+stroke.y*fontScale,
            originX+(stroke.x+stroke.w)*fontScale,originY+(stroke.y+stroke.h)*fontScale,
            0,0,1,1,Array(4).fill(color));
          continue;
        }
        if(!atlases.has(s.image))atlases.set(s.image,upload(s.image));
        gl.bindTexture(gl.TEXTURE_2D,atlases.get(s.image));gl.uniform1i(fontPass,aa+1);
        const inset=s.unicode ? .01 : 0,atlasW=s.image.width,atlasH=s.image.height;
        const glyphWidth=s.unicode?f(f((s.width-1)*2)-f(.02)):s.sw;
        const widthPixels=s.unicode?f(glyphWidth-f(.02)):s.sw;
        let u=f(f(s.sx+inset)/atlasW),v=f(f(s.sy+inset)/atlasH),du=f(widthPixels/atlasW),dv=f(s.sh/atlasH);
        gl.uniform4f(uvBounds,u,v,u+du,v+dv);
        let x=f(originX/fontScale+stroke.x),y=f(originY/fontScale+stroke.y+s.offsetY);
        let w=s.unicode?f(f(f(glyphWidth/2)+1)-1):f(s.w),h=f(s.h),italic=stroke.italic?1:0;
        if(aa) {
          const pad=f(f((aa===1?6:8)*weight)+.5),pu=f(pad*f(du/w)),pv=f(pad*f(dv/h));
          italic=f(italic*f(f(h+2*pad)/h));
          x=f(x-pad);y=f(y-pad);w=f(w+2*pad);h=f(h+2*pad);
          u=f(u-pu);v=f(v-pv);du=f(du+2*pu);dv=f(dv+2*pv);
        }
        const point=(px,py,tu,tv)=>[f(px)*fontScale,f(py)*fontScale,tu,tv,...color];
        const leftTop=f(x+italic),leftBottom=f(x-italic);
        const points=[point(leftTop,y,u,v),point(leftBottom,y+h,u,v+dv),
          point(leftTop+w,y,u+du,v),point(leftBottom+w,y+h,u+du,v+dv)];
        gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(points.flat()),gl.STREAM_DRAW);
        gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
      }
      gl.uniform1i(fontPass,0);
    }
    // WebGL requires a complete sampler even when the untextured shader branch is used.
    const blank=document.createElement("canvas");blank.width=blank.height=1;upload(blank);
    const archives=await Promise.all((files.resources??[]).map(f=>TooltipAssets.archive(f)));
    async function image(name) {
      if(images.has(name))return images.get(name);
      const [mod,asset]=name.includes(":")?name.split(":"):["minecraft",name];
      if(!/^[a-z0-9_-]+$/.test(mod)||!/^[a-zA-Z0-9_./-]+$/.test(asset)||asset.includes(".."))throw Error("Invalid resource location "+name);
      const path="assets/"+mod+"/"+(asset.startsWith("textures/")?asset:"textures/"+asset)+(asset.endsWith(".png")?"":".png");
      let bytes;
      for(let i=archives.length-1;i>=0&&!bytes;i--)bytes=await archives[i].get(path);
      if(!bytes)throw Error("Missing MUI2 texture "+path);
      const bitmap=await createImageBitmap(new Blob([bytes],{type:"image/png"}),{premultiplyAlpha:"none",colorSpaceConversion:"none"});
      try {const tex=upload(bitmap);images.set(name,tex);return tex;} finally {bitmap.close();}
    }
    for(const op of scene.ops) {
      const [x,y,w,h]=op.box;
      if(w<=0||h<=0)continue;
      if(op.clip){
        const [left,top,width,height]=op.clip;
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(Math.round(left*scale),canvas.height-Math.round((top+height)*scale),
          Math.max(0,Math.round(width*scale)),Math.max(0,Math.round(height*scale)));
      }else gl.disable(gl.SCISSOR_TEST);
      if(op.type==="bitmap"){
        gl.bindTexture(gl.TEXTURE_2D,upload(op.bitmap));
        gl.enable(gl.BLEND);gl.uniform1i(textured,1);gl.uniform1i(cutout,0);
        quad(x,y,x+w,y+h,0,0,1,1,Array(4).fill(white),textureIndices);
        continue;
      }
      if(op.type==="rect"){
        gl.enable(gl.BLEND);gl.uniform1i(textured,0);gl.uniform1i(cutout,0);
        const colors=op.colors.map(rgba),d=op.border;
        if(!d && op.radius>0) {
          const segments=op.segments??6;
          if(!Number.isSafeInteger(segments)||segments<0||segments>4096)throw Error("Invalid MUI2 corner segment count.");
          roundedRect(x,y,w,h,op.radius,segments,colors);
        }
        else if(!d)quad(x,y,x+w,y+h,0,0,1,1,colors);
        else {
          const [tl,tr,bl,br]=colors;
          const coords=[[x,y,tl],[x+w-d,y+d,tr],[x+w,y,tr],[x+w-d,y+h-d,br],[x+w,y+h,br],
            [x+d,y+h-d,bl],[x,y+h,bl],[x+d,y+d,tl],[x,y,tl],[x+w-d,y+d,tr]];
          drawShape(gl.TRIANGLE_STRIP,coords);
        }
        continue;
      }
      if(op.type==="text"){
        const label=await drawText(op);
        if(label.strokes){drawGlyphs(label,x,y);continue;}
        gl.bindTexture(gl.TEXTURE_2D,upload(label));gl.enable(gl.BLEND);gl.uniform1i(textured,1);gl.uniform1i(cutout,0);
        quad(x,y,x+w,y+h,0,0,1,1,Array(4).fill(white));continue;
      }
      const tex=await image(op.resource);
      const indices=op.textureQuadMode==="angelica-2.2.43"?angelicaTextureIndices:textureIndices;
      gl.bindTexture(gl.TEXTURE_2D,tex);gl.uniform1i(textured,1);gl.uniform1i(cutout,op.opaqueCutout?2:1);
      if(op.blend)gl.enable(gl.BLEND);else gl.disable(gl.BLEND);
      const [iw,ih]=op.imageSize,uv=op.pixelUV?op.pixelUV.map((n,i)=>n/(i%2?ih:iw)):op.uv;
      const [u0,v0,u1,v1]=uv,[l,t,r,b]=op.border,colors=Array(4).fill(rgba(op.tint??0xffffffff));
      const batch=[];
      function flush() {
        if(!batch.length)return;
        gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(batch),gl.STREAM_DRAW);
        gl.drawArrays(gl.TRIANGLES,0,batch.length/8);batch.length=0;
      }
      function patch(x0,y0,x1,y1,us,vs,ue,ve,tw,th) {
        if(x1===x0||y1===y0)return;
        if(!op.tiled||tw===undefined){quad(x0,y0,x1,y1,us,vs,ue,ve,colors,indices,batch);return;}
        if(tw<=0||th<=0)throw Error("Invalid MUI2 texture tile dimensions.");
        // The last partial tile ends partway through the UV range.
        for(let yy=y0;yy<y1;yy+=th)for(let xx=x0;xx<x1;xx+=tw){
          const dw=Math.min(tw,x1-xx),dh=Math.min(th,y1-yy);
          const f=Math.fround;
          const endU=dw===tw?ue:f(us+f(f(f(ue-us)*dw)/tw)),endV=dh===th?ve:f(vs+f(f(f(ve-vs)*dh)/th));
          quad(xx,yy,xx+dw,yy+dh,us,vs,endU,endV,colors,indices,batch);
          if(batch.length>=24576)flush();
        }
      }
      if(iw===w&&ih===h){quad(x,y,x+w,y+h,...uv,colors,indices);continue;}
      if(!(l||r||t||b)){patch(x,y,x+w,y+h,...uv,iw,ih);flush();continue;}
      const xs=[x,x+l,x+w-r,x+w],ys=[y,y+t,y+h-b,y+h];
      const f=Math.fround;
      const us=[u0,f(u0+f(l/iw)),f(u1-f(r/iw)),u1],vs=[v0,f(v0+f(t/ih)),f(v1-f(b/ih)),v1];
      const tileW=[l,Math.trunc(f(iw*f(u1-u0)))-l-r,r],tileH=[t,Math.trunc(f(ih*f(v1-v0)))-t-b,b];
      for(const [i,j] of [[0,0],[2,0],[0,2],[2,2],[0,1],[1,0],[2,1],[1,2],[1,1]]){
        patch(xs[i],ys[j],xs[i+1],ys[j+1],us[i],vs[j],us[i+1],vs[j+1],tileW[i],tileH[j]);
      }
      flush();
    }
    if(gl.getError()!==gl.NO_ERROR || gl.isContextLost())throw Error("MUI2 rasterization failed.");
    const out=document.createElement("canvas");out.width=canvas.width;out.height=canvas.height;
    out.getContext("2d",{willReadFrequently:true}).drawImage(canvas,0,0);return out;
  } finally {gl.getExtension("WEBGL_lose_context")?.loseContext();}
};
