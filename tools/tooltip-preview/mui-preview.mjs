import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readMuiScene } from "./mui-source.mjs";
import { applyMuiAction, controlSnapshot } from "./mui-actions.mjs";
import { adjustableScripts, programCharacters, programTextures } from "./mui-export.mjs";
import { interactiveFragment } from "./mui-fragment.mjs";
import { chromaticBounds, placeMuiTooltip, screenScene, tooltipScene, tooltipWidthAt } from "./mui-tooltip.mjs";

class MeasureText extends Error {
  constructor(key,text,maxWidth,options) {super("Measure MUI2 text");Object.assign(this,{key,text,maxWidth,options});}
}

function mount(data, place, chromatic, widthAt, compose) {
  const panel=document.getElementById("panel"),stage=document.getElementById("stage"),surface=document.getElementById("surface");
  const {scale,width,height,widgets,frames,viewport,tooltipRenderer}=data;
  stage.style.width=viewport.width*scale+"px";stage.style.height=viewport.height*scale+"px";
  panel.style.left=viewport.x*scale+"px";panel.style.top=viewport.y*scale+"px";
  const images=new Map();
  const font=data.font?MuiDisplay.unpack(data.font):null;
  let current=null,tooltipBox=null,tipImage=null,revision=0,previousKey="",ready=Promise.resolve();
  function paint(frame,variant) {
    const bitmapUrl=frame.image??frames[0].image;
    const key=variant?JSON.stringify([frame.id,variant.limits,tooltipBox]):"";
    if(key===previousKey)return;
    previousKey=key;
    const version=++revision;
    if(!variant){surface.hidden=true;panel.hidden=false;ready=Promise.resolve();return;}
    const position=tooltipBox;
    ready=Promise.resolve().then(async()=>{
      if(version!==revision)return;
      if(!images.has(bitmapUrl))images.set(bitmapUrl,MuiDisplay.bitmap(bitmapUrl));
      const [bitmap,activeFont]=await Promise.all([images.get(bitmapUrl),font]);
      if(version!==revision)return;
      const background={ops:[{type:"bitmap",bitmap,box:[0,0,width,height]}]};
      const scene=compose(background,viewport,variant.scene,position);
      const canvas=await renderMui(scene,scale,{},op=>MuiText.draw(op,scale,activeFont,data.font.opts));
      if(version!==revision)return;
      surface.width=canvas.width;surface.height=canvas.height;
      surface.getContext("2d").drawImage(canvas,0,0);
      surface.hidden=false;panel.hidden=true;
    });
  }
  function hover(id,x,y) {
    const widget=widgets.find(w=>w.id===id);
    if(id!=null && !widget) throw Error("Unknown MUI2 widget "+id);
    const frame=frames.find(f=>f.id===id)??frames[0];
    if(current!==id || !panel.hasAttribute("src")) panel.src=frame.image??frames[0].image;
    current=id;tipImage=null;tooltipBox=null;
    let variant;
    if(frame.tips) {
      const [left,top,w,h]=widget.box;
      const pointer={x:Math.floor(x??viewport.x+left+w/2),y:Math.floor(y??viewport.y+top+h/2)};
      const limit=widthAt(frame.tips[0].initialWidth,viewport.width,pointer.x);
      variant=frame.tips.find(t=>t.limits?.includes(limit))??frame.tips[0];
      tipImage=variant.image;
      tooltipBox=place(tooltipRenderer,variant,viewport,pointer,chromatic);
    }
    paint(frame,variant);
    return id;
  }
  function pick(e) {
    const r=stage.getBoundingClientRect(),x=Math.floor((e.clientX-r.left)/scale),y=Math.floor((e.clientY-r.top)/scale);
    const widget=widgets.findLast(w=>{
      const [l,t,width,height]=w.box;
      return (w.hoverable||w.tooltip?.length) && x>=viewport.x+l&&y>=viewport.y+t&&x<viewport.x+l+width&&y<viewport.y+t+height;
    });
    hover(widget?.id??null,x,y);
  }
  stage.addEventListener("pointermove",pick);stage.addEventListener("pointerleave",()=>hover(null));
  hover(data.initialHover,data.mouse?.x,data.mouse?.y);
  globalThis.GTNHMuiScene=Object.freeze({hover,state:()=>({hover:current,width,height,widgets,viewport,tooltipBox}),
    panelPng:()=>panel.src,tooltipPng:()=>tipImage,ready:()=>ready});
}

export async function renderMuiSource(request,base,files,options,session,languageFiles) {
  const spec=request.java??{},scale=request.scale??2,ext=path.extname(options.out).toLowerCase();
  if(typeof spec.file!=="string"||!spec.file||![spec.method,spec.field].filter(Boolean).length||
    !!spec.method===!!spec.field || !/^[\w$]+$/.test(spec.method??spec.field)) throw Error("MUI2 needs java.file and one method or drawable field.");
  if(![".png",".html"].includes(ext)||!Number.isInteger(scale)||scale<1||scale>4)throw Error("Use a .png or .html MUI2 output and scale 1..4.");
  if(!Array.isArray(spec.sources??[])||(spec.sources??[]).length>24)throw Error("java.sources expects up to 24 source files.");
  if(spec.adapters!=null && (!spec.adapters || typeof spec.adapters!=="object" || Array.isArray(spec.adapters) ||
    Object.entries(spec.adapters).some(([from,to])=>!/^\w[\w$.]*\.(?:[\w$]+|<init>)\/\d+$/.test(from) ||
      typeof to!=="string" || !/^\w[\w$.]*\.[\w$]+\/\d+$/.test(to))))throw Error("java.adapters requires qualified source and replacement method signatures.");
  if(request.htmlMode!=null && !["document","fragment"].includes(request.htmlMode))throw Error("Use htmlMode document or fragment.");
  if(request.requireInteractive!=null && typeof request.requireInteractive!=="boolean")throw Error("requireInteractive expects a boolean.");
  const paths=[spec.file,...(spec.sources??[])].map(f=>path.resolve(base,f));
  const key=p=>process.platform==="win32"?path.resolve(p).toLowerCase():path.resolve(p);
  const outputs=new Set([options.out,options.report].filter(Boolean).map(key));
  for(const p of [...paths,...languageFiles])if(outputs.has(key(p)))throw Error("MUI2 output conflicts with source input "+p);
  const parser=fileURLToPath(new URL("MuiSource.java",import.meta.url));
  const {stdout}=await promisify(execFile)(options.java??"java",["-Dfile.encoding=UTF-8",parser,...new Set(paths)],
    {encoding:"utf8",windowsHide:true,timeout:45000,maxBuffer:32*1024*1024});
  const classes=JSON.parse(stdout),language=Object.create(null);
  for(const file of languageFiles)for(const line of (await readFile(file,"utf8")).replace(/^\uFEFF/,"").split(/\r?\n/)) {
    const i=line.indexOf("=");
    if(i>0&&!/^[#!]/.test(line.trimStart()))language[line.slice(0,i).trim()]=line.slice(i+1);
  }
  Object.assign(language,request.state?.language);
  const initialHover=request.state?.hover??null;
  const tooltipRenderer=request.tooltipRenderer??"chromatic",mouse=request.state?.mouse;
  if(!["chromatic","mui2"].includes(tooltipRenderer))throw Error("Unknown MUI2 tooltipRenderer.");
  if(mouse && (![mouse.x,mouse.y].every(Number.isSafeInteger)||!initialHover))throw Error("state.mouse requires integer screen coordinates and state.hover.");
  return session.render(files,async render=>{
    const metrics=new Map(),shared={fontMode:request.fontMode,timeMs:request.timeMs};
    function measure(text,maxWidth=0,options={}) {
      const key=JSON.stringify([text,maxWidth,options]);
      if(!metrics.has(key))throw new MeasureText(key,text,maxWidth,options);
      return metrics.get(key);
    }
    let state={...request.state};
    async function buildState(input,hover=input.hover??null) {
      for(;;) {
        try {return readMuiScene(classes,{...request,state:{...input,language,hover}},measure);}
        catch(error) {
          let cause=error;while(cause && !(cause instanceof MeasureText))cause=cause.cause;
          if(!cause || metrics.size>=512)throw error;
          const value=await render({source:"mui2-measure",...shared,text:cause.text,maxWidth:cause.maxWidth,options:cause.options});
          metrics.set(cause.key,value);
        }
      }
    }
    const actions=request.actions??[],receipts=[];
    if(!Array.isArray(actions) || actions.length>256)throw Error("MUI2 actions must be an array of up to 256 widget actions.");
    for(const [i,action] of actions.entries()){
      try {
        const result=await applyMuiAction(state,action,buildState);
        state=result.state;receipts.push(result.receipt);
      } catch(error){throw Error("MUI2 action "+(i+1)+" — "+error.message,{cause:error});}
    }
    const build=hover=>buildState(state,hover);
    const baseScene=await build(ext===".html"?null:initialHover);
    const {width,height,widgets,methods}=baseScene;
    const adjustable=widgets.some(w=>w.control);
    const viewport={x:0,y:0,width,height,...request.viewport};
    if(![viewport.x,viewport.y,viewport.width,viewport.height].every(Number.isSafeInteger) ||
       viewport.width<1||viewport.height<1||viewport.width*viewport.height*scale*scale>16000000)
      throw Error("Invalid MUI2 viewport.");
    if(initialHover!=null && !widgets.some(w=>w.id===initialHover))throw Error("Unknown initial MUI2 hover target "+initialHover);
    const raster=(scene,compare)=>render({source:"mui2-render",...shared,scene,scale,compare,crop:request.crop});
    const tooltipMetrics=new Map();
    async function tooltipAt(widget,limit) {
      const text=widget.tooltip.join("\n"),key=JSON.stringify([text,limit]);
      if(!tooltipMetrics.has(key)) {
        const metric=await render({source:"mui2-measure",...shared,text,maxWidth:limit,options:{rich:true}});
        tooltipMetrics.set(key,tooltipScene(metric,tooltipRenderer));
      }
      return tooltipMetrics.get(key);
    }
    // MUI2 determines its line breaks before Chromatic receives the compiled text.
    const initialLimit=viewport.width;
    const nativeTextWidth=scene=>Math.max(0,scene.width-8-(tooltipRenderer==="chromatic" ? 1 : 0));
    const center=widget=>({x:viewport.x+widget.box[0]+Math.floor(widget.box[2]/2),y:viewport.y+widget.box[1]+Math.floor(widget.box[3]/2)});
    const selected=widgets.find(w=>w.id===initialHover);
    const pointer=selected?(mouse??center(selected)):null;
    let initialTip=null,tooltipBox=null;
    if(selected?.tooltip.length) {
      const first=await tooltipAt(selected,initialLimit),initialWidth=nativeTextWidth(first);
      const limit=tooltipWidthAt(initialWidth,viewport.width,pointer.x);
      initialTip=limit<initialWidth+1?await tooltipAt(selected,limit):first;
      tooltipBox=placeMuiTooltip(tooltipRenderer,{...initialTip,initialWidth},viewport,pointer,chromaticBounds);
    }
    const output=path.resolve(options.out);
    let comparison=null;
    if(ext===".png") {
      const frame=await raster(screenScene(baseScene,viewport,initialTip,tooltipBox),true);
      comparison=frame.comparison;await writeFile(output,Buffer.from(frame.png,"base64"));
    } else {
      const baseFrame=await raster(baseScene,!request.viewport && initialHover===null);
      comparison=baseFrame.comparison;
      const url=png=>"data:image/png;base64,"+png;
      const frames=[{id:null,image:url(baseFrame.png)}];
      let bytes=baseFrame.png.length;
      for(const widget of adjustable?[]:widgets.filter(w=>w.hoverable||w.tooltip?.length||w.id===initialHover)) {
        const frame={id:widget.id};
        if(widget.hoverable||widget.id===initialHover) {
          const variant=await raster(await build(widget.id),false);
          if(variant.png!==baseFrame.png){frame.image=url(variant.png);bytes+=variant.png.length;}
        }
        if(widget.tooltip?.length) {
          const first=await tooltipAt(widget,initialLimit),initialWidth=nativeTextWidth(first);
          const limits=new Set([initialLimit]),images=new Map();
          for(let x=Math.max(0,viewport.x+widget.box[0]);x<Math.min(viewport.width,viewport.x+widget.box[0]+widget.box[2]);x++) {
            const limit=tooltipWidthAt(initialWidth,viewport.width,x);
            if(limit<initialWidth+1)limits.add(limit);
          }
          for(const limit of limits) {
            const scene=await tooltipAt(widget,limit),key=JSON.stringify(scene);
            if(!images.has(key)) {
              const {png}=await raster(scene,false);
              images.set(key,{width:scene.width,height:scene.height,initialWidth,image:url(png),scene,limits:[]});
              bytes+=png.length;
            }
            images.get(key).limits.push(limit);
          }
          frame.tips=[...images.values()];
        }
        if(bytes>64*1024**2)throw Error("Embedded MUI2 states exceed 64 MiB.");
        frames.push(frame);
      }
      if(files.reference && (initialHover!==null || request.viewport)) {
        const panel=initialHover===null?baseScene:await build(initialHover);
        comparison=(await raster(screenScene(panel,viewport,initialTip,tooltipBox),true)).comparison;
      }
      const texts=widgets.flatMap(w=>w.tooltip);
      const font=!adjustable && texts.length?await render({source:"mui2-font",...shared,texts}):null;
      const runtime=font||adjustable?(await Promise.all(["renderer.js",...(adjustable?["assets.js"]:[]),"mui-render.js","mui-text.js","mui-display.js"].map(
        name=>readFile(new URL(name,import.meta.url),"utf8")))).join("\n"):"";
      const data=JSON.stringify({width,height,scale,widgets,frames,initialHover,mouse,viewport,tooltipRenderer,font}).replaceAll("<","\\u003c");
      let boot,fragment;
      if(adjustable) {
        const program={classes,fitPanel:!request.viewport,request:{java:{file:path.basename(spec.file),class:spec.class,method:spec.method,field:spec.field,adapters:spec.adapters},
          state:{...state,language},theme:request.theme,size:request.size,timeMs:request.timeMs,locale:request.locale,
          textureQuadMode:request.textureQuadMode,requireInteractive:request.requireInteractive}};
        const bundle=await render({source:"mui2-bundle",...shared,texts:[programCharacters(program)],textures:programTextures(program,baseScene)});
        if(request.htmlMode==="fragment")fragment=await interactiveFragment(runtime,JSON.parse(data),program,bundle);
        else boot=await adjustableScripts(program,bundle);
      } else boot='<script>('+mount.toString()+')(JSON.parse(document.getElementById("scene-data").textContent),'+
        [placeMuiTooltip,chromaticBounds,tooltipWidthAt,screenScene].map(fn=>fn.toString()).join(",")+')</script>';
      if(request.htmlMode==="fragment" && !fragment)throw Error("Inline MUI2 requires a source panel with adjustable controls.");
      await writeFile(output,fragment??('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>MUI2</title><style>'+
        'html,body{margin:0;background:transparent}#stage{position:relative}img,canvas{position:absolute;image-rendering:pixelated;pointer-events:none}</style>'+
        '<div id="stage"><img id="panel" alt="MUI2"><canvas id="surface" hidden></canvas></div><script id="scene-data" type="application/json">'+data+
        '</script><script>'+runtime.replace(/<\/script/gi,"<\\/script")+'</script>'+boot+'</html>\n'),"utf8");
    }
    return {source:"mui2",entry:spec.method??spec.field,width,height,scale,drawCalls:baseScene.ops.length,
      methods,widgets,viewport,tooltipBox,comparison,...(adjustable||actions.length?{controlState:controlSnapshot(state),actions:receipts}:{}),
      [ext===".html"?"htmlPath":"pngPath"]:output};
  });
}
