import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const slug=/^[a-z0-9][a-z0-9-]{0,63}$/;
const dataUrl=png=>"data:image/png;base64,"+png;
const headerHeight=14;

function buildCells(layout) {
  return [
    ...layout.grids.flatMap(({role,x,y,count,columns})=>Array.from({length:count},(_,i)=>({
      id:role+"-"+i,role,x:x+i%columns*layout.step,y:y+Math.floor(i/columns)*layout.step,
      width:layout.step-2,height:layout.step-2
    }))),
    ...layout.cells
  ];
}

function inRange(value,min,max) {
  return Number.isInteger(value) && value>=min && value<=max;
}

function readLayout(data) {
  const {width,height,step=18,grids=[],cells=[],decorations=[]}=data ?? {};
  if(!inRange(width,24,1920) || !inRange(height,12,900) || !inRange(step,4,64) ||
    !Array.isArray(grids) || !Array.isArray(cells) || !Array.isArray(decorations) ||
    grids.length>16 || cells.length>384 || decorations.length>32) throw Error("Invalid NEI layout.");
  for(const grid of grids) {
    if(typeof grid?.role!=="string" || !slug.test(grid.role) || !inRange(grid.x,1,width-2) || !inRange(grid.y,1,height-2) ||
      !inRange(grid.count,0,384) || !inRange(grid.columns,1,64)) throw Error("Invalid NEI slot grid.");
  }
  function validateRects(rects,margin) {
    const ids=new Set();
    for(const rect of rects) {
      const {id,x,y,width:w,height:h}=rect ?? {};
      if(typeof id!=="string" || !slug.test(id) || ids.has(id) || !inRange(w,1,width) ||
        !inRange(h,1,height) || !inRange(x,margin,width-w-margin) ||
        !inRange(y,margin,height-h-margin)) throw Error("Invalid or duplicate NEI rectangle: "+id);
      ids.add(id);
    }
  }
  const layout={width,height,step,grids,cells,decorations};
  const generated=buildCells(layout);
  if(generated.length>384) throw Error("Too many NEI slots.");
  validateRects(generated,1);
  validateRects(decorations,0);
  return layout;
}

export async function writeNeiScene(request,requestPath,options,withRenderer,quantityCache,resources) {
  const {viewport,scenes}=request;
  if(!inRange(viewport?.width,40,1920) || !inRange(viewport.height,40,1080) ||
    !inRange(viewport.scale,1,4)) throw Error("NEI scene requires a logical viewport and integer GUI scale.");
  if(!Array.isArray(scenes) || !inRange(scenes.length,1,12)) throw Error("Provide 1..12 NEI scenes.");
  const output=path.resolve(options.out), report=options.report && path.resolve(options.report);
  if(path.extname(output).toLowerCase()!==".html" || options.exact) throw Error("Use an .html output for NEI scenes.");
  const normalize=value=>process.platform==="win32" ? value.toLowerCase() : value;
  const outputs=new Set([output,report].filter(Boolean).map(normalize));
  const base=path.dirname(requestPath);
  async function asset(file,root,limit) {
    if(typeof file!=="string" || !file) throw Error("Each NEI scene asset needs a local file path.");
    const resolved=path.resolve(root,file);
    if(outputs.has(normalize(resolved))) throw Error("Input and output paths must be distinct.");
    if((await stat(resolved)).size>limit) throw Error("NEI scene asset is too large: "+file);
    return readFile(resolved);
  }
  async function document(value) {
    if(typeof value!=="string") return {value,root:base};
    const source=await asset(value,base,1024**2);
    return {value:JSON.parse(source.toString("utf8").replace(/^\uFEFF/,"")),root:path.dirname(path.resolve(base,value))};
  }
  let imageBytes=0;
  function imageUrl(png) {
    imageBytes+=png.length;
    if(imageBytes>32*1024**2) throw Error("Combined NEI scene images exceed 32 MiB.");
    return dataUrl(png.toString("base64"));
  }
  async function texture(file,root) {
    const png=await asset(file,root,1024**2);
    if(png.length<33 || png.toString("hex",0,8)!=="89504e470d0a1a0a" || png.toString("ascii",12,16)!=="IHDR" ||
      !inRange(png.readUInt32BE(16),1,512) || !inRange(png.readUInt32BE(20),1,512)) throw Error("Invalid NEI texture: "+file);
    return imageUrl(png);
  }
  const jobs=[];
  const quantityLabels={requested:0,rendered:0,hits:0};
  const settings={...viewport,"font-mode":request.fontMode ?? "modern",amp:false,screen:false};
  function add(job,apply,quantity=false) {
    jobs.push({request:{source:"editable",strict:true,...job},apply,quantity});
  }
  function glyphs(lines,width,color,shadow,apply,quantity=false) {
    const height=lines.length*10;
    add({profile:"text",settings,lines,drawRegion:{width,height},draws:lines.map((_,i)=>({x:0,y:i*10,color,shadow}))},
      ({rows},image)=>{
        const w=Math.max(...rows.map(row=>row.width))+(shadow ? 1 : 0);
        if(w>width) throw Error("NEI text exceeds the layout width: "+lines.join(" / "));
        apply({image,width:w,height});
      },quantity);
  }
  const compiled=[], sceneIds=new Set();
  for(const scene of scenes) {
    if(typeof scene?.id!=="string" || !slug.test(scene.id) || sceneIds.has(scene.id) ||
      ["panel","slots","details","recipeCapture"].some(key=>Object.hasOwn(scene,key))) {
      throw Error("Use a unique scene id, layout and manual content.");
    }
    sceneIds.add(scene.id);
    const layout=readLayout((await document(scene.layout)).value);
    const {value:content,root}=await document(scene.content);
    const description=content?.description ?? [], items=content?.slots ?? {};
    const x=scene.origin?.x ?? Math.floor((viewport.width-layout.width)/2);
    const y=scene.origin?.y ?? 4;
    const title=content?.title;
    if(typeof title!=="string" || !title.trim() || title.length>200 || !Array.isArray(description) ||
      description.length>40 || description.some(line=>typeof line!=="string" || line.length>500) ||
      !items || typeof items!=="object" || Array.isArray(items) ||
      !inRange(x,0,viewport.width-layout.width) || !inRange(y,0,viewport.height-1)) {
      throw Error("Invalid manual NEI content or origin: "+scene.id);
    }
    const height=headerHeight+layout.height+(description.length ? 5+description.length*10 : 0);
    if(layout.width*height*viewport.scale**2>16000000) throw Error("NEI panel exceeds the render limit.");
    const page={id:scene.id,title,menu:scene.title ?? title,x,y,height,layout,slots:{},textures:{}};
    for(const {id} of layout.decorations) {
      const file=scene.textures?.[id];
      if(file) page.textures[id]=await texture(file,base);
    }
    glyphs([title],layout.width-6,0xffffff,true,stamp=>{page.heading=stamp;});
    if(description.length) glyphs(description,layout.width-12,0,false,stamp=>{page.description=stamp;});
    const cells=new Map(buildCells(layout).map(cell=>[cell.id,cell]));
    for(const [id,entry] of Object.entries(items)) {
      const cell=cells.get(id);
      if(!cell) throw Error("Manual content refers to an unknown NEI slot: "+id);
      const {name,icon,quantity,tooltip=[],kind=cell.role?.startsWith("fluid-") ? "fluid" : "item"}=entry ?? {};
      if(typeof name!=="string" || !name.trim() || name.length>200 || !["fluid","item"].includes(kind) ||
        !Array.isArray(tooltip) || tooltip.length>32 ||
        tooltip.some(line=>typeof line!=="string" || line.length>500 || /^@/.test(line)) ||
        quantity!==undefined && (typeof quantity!=="string" || quantity.length>20)) {
        throw Error("Invalid manual content for NEI slot: "+id);
      }
      const slot={name,kind,lines:[name,...tooltip]};
      page.slots[id]=slot;
      if(icon) slot.icon=await texture(icon,root);
      if(quantity) glyphs([quantity],128,0xffffff,true,stamp=>{
        const ratio=kind==="fluid" ? 0.5 : quantity.length>=3 ? 0.8 : 1;
        slot.quantity={...stamp,ratio:Math.min(ratio,cell.width/stamp.width)};
      },true);
      add({profile:"nei",settings:{...settings,skin:"chromatic",wrap:viewport.width-16,paginate:false},
        lines:["@title "+name,"@body",...tooltip]},({box,renderer},image)=>{
        if(renderer!=="chromatic" || box.w>viewport.width-4 || box.h>Math.max(height+y,viewport.height)-4) {
          throw Error("NEI tooltip exceeds the preview area: "+id);
        }
        slot.tip={width:box.w,height:box.h,image};
      });
    }
    compiled.push(page);
  }
  async function renderQuantity(label,render) {
    quantityLabels.requested++;
    // Obfuscated glyphs can depend on the current animation frame.
    const key=/§k/i.test(label.lines[0]) ? null : JSON.stringify([resources,label]);
    if(quantityCache.has(key)) {
      quantityLabels.hits++;
      return quantityCache.get(key);
    }
    const result=await render(label);
    quantityLabels.rendered++;
    if(key!==null) {
      if(quantityCache.size>=512) quantityCache.delete(quantityCache.keys().next().value);
      quantityCache.set(key,result);
    }
    return result;
  }
  await withRenderer(async render=>{
    for(const job of jobs) {
      const result=job.quantity ? await renderQuantity(job.request,render) : await render(job.request);
      job.apply(result,imageUrl(Buffer.from(result.png,"base64")));
    }
  });
  const renderer=await readFile(new URL("renderer.js",import.meta.url),"utf8");
  const pages=JSON.stringify({viewport,scenes:compiled,headerHeight}).replaceAll("<","\\u003c");
  const stage='<div id="stage" aria-label="NEI 配方窗口"><canvas id="panel"></canvas><div id="slots"></div><img id="tip" alt="" hidden></div>';
  const nav=compiled.length>1 ? '<nav><select id="recipe" aria-label="配方"></select></nav>' : "";
  const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>GTNH NEI 配方预览</title><style>'+css+'</style><main>'+stage+nav+'</main>' +
    '<script id="scene-data" type="application/json">'+pages+'</script><script>'+renderer+'</script><script>('+
    mount.toString()+')('+buildCells.toString()+')</script></html>\n';
  const metadata={source:"nei-scene",htmlPath:output,viewport,quantityLabels,scenes:compiled.map(page=>{
    const cells=buildCells(page.layout);
    return {id:page.id,title:page.title,panelHeight:page.height,bodyWidth:page.layout.width,bodyHeight:page.layout.height,
      decorations:page.layout.decorations.map(({id,x,y,width,height})=>({id,x,y,width,height,hasTexture:Object.hasOwn(page.textures,id)})),
      totalSlots:cells.length,occupiedSlots:Object.keys(page.slots).length,cells:cells.map(cell=>({
        ...cell,name:page.slots[cell.id]?.name,icon:!!page.slots[cell.id]?.icon
      }))};
  })};
  await writeFile(output,html,"utf8");
  return metadata;
}

const css=
  "html{color-scheme:dark;background:#171a1e;color:#eee;font:14px system-ui,sans-serif}body{margin:0}" +
  "main{margin:0 auto;padding:14px}nav{display:flex;justify-content:center;margin-top:9px}select{font:inherit;padding:5px 8px}" +
  "#stage{position:relative;width:100%;isolation:isolate;overflow:hidden}" +
  "#stage canvas,#stage img,#stage button{position:absolute;box-sizing:border-box}" +
  "#stage canvas,#stage img{image-rendering:pixelated;pointer-events:none;user-select:none}" +
  "#stage button{border:0;background:transparent;padding:0;cursor:default}" +
  "#stage button.active{background:#ffffff45}#stage button:focus-visible{outline:1px solid #fff}#tip{z-index:2}";

function mount(buildCells) {
  const {viewport,scenes,headerHeight}=JSON.parse(document.getElementById("scene-data").textContent);
  const {width,height,scale}=viewport;
  const stage=document.getElementById("stage"), select=document.getElementById("recipe");
  const panel=document.getElementById("panel"), slots=document.getElementById("slots"), tip=document.getElementById("tip");
  stage.parentElement.style.maxWidth=width*scale+"px";
  const surfaces=new WeakMap();
  let scene=scenes[0], active=null, buttons=new Map(), visibleHeight=height, targets=[], ready;
  async function drawPage(page) {
    const layout=page.layout, w=layout.width, h=page.height;
    const canvas=document.createElement("canvas");
    canvas.width=w*scale;
    canvas.height=h*scale;
    const ctx=canvas.getContext("2d");
    ctx.scale(scale,scale);
    ctx.imageSmoothingEnabled=false;
    function fill(color,x,y,width,height) {
      ctx.fillStyle=color;
      ctx.fillRect(x,y,width,height);
    }
    async function sprite(url,x,y,w,h,sampleWidth) {
      const image=new Image();
      image.src=url;
      await image.decode();
      if(sampleWidth) ctx.drawImage(image,0,0,sampleWidth*scale,image.height,x,y,w,h);
      else ctx.drawImage(image,x,y,w,h);
    }
    fill("#656565",0,0,w,h);
    fill("#c6c6c6",1,1,w-2,h-2);
    fill("#efefef",1,1,w-2,1);
    fill("#efefef",1,1,1,h-2);
    fill("#a1a1a1",2,2,w-4,headerHeight-3);
    fill("#e5e5e5",2,headerHeight-1,w-4,1);
    await sprite(page.heading.image,Math.floor((w-page.heading.width)/2),3,
      page.heading.width,page.heading.height,page.heading.width);
    const cells=buildCells(layout);
    for(const {role,x,y:row,width,height} of cells) {
      const y=headerHeight+row;
      fill("#eeeeee",x-1,y-1,width+2,height+2);
      fill("#565656",x-1,y-1,width+2,1);
      fill("#565656",x-1,y-1,1,height+2);
      fill(role?.startsWith("fluid-") ? "#343434" : "#8b8b8b",x,y,width,height);
    }
    for(const {id,x,y,width,height} of layout.decorations) {
      if(page.textures[id]) await sprite(page.textures[id],x,headerHeight+y,width,height);
    }
    for(const {id,x,y:row,width,height} of cells) {
      const slot=page.slots[id];
      if(!slot) continue;
      const y=headerHeight+row;
      if(slot.icon) await sprite(slot.icon,x,y,width,height);
      if(slot.quantity) {
        const {image,width:sourceWidth,height:sourceHeight,ratio}=slot.quantity;
        const labelWidth=sourceWidth*ratio, labelHeight=sourceHeight*ratio;
        await sprite(image,slot.kind==="fluid" ? x : x+width-labelWidth,
          y+height-labelHeight,labelWidth,labelHeight,sourceWidth);
      }
    }
    if(page.description) {
      const y=headerHeight+layout.height;
      fill("#8b8b8b",3,y,w-6,1);
      fill("#e6e6e6",3,y+1,w-6,1);
      const {image,width,height}=page.description;
      await sprite(image,6,y+4,width,height,width);
    }
    return canvas;
  }
  function surface(page) {
    if(!surfaces.has(page)) surfaces.set(page,drawPage(page));
    return surfaces.get(page);
  }
  function place(element,region) {
    const pct=(value,full)=>value/full*100+"%";
    Object.assign(element.style,{left:pct(region.x,width),top:pct(region.y,visibleHeight),
      width:pct(region.width,width),height:pct(region.height,visibleHeight)});
  }
  function show(slot,x,y) {
    if(active!==slot) {
      buttons.get(active?.id)?.classList.remove("active");
      active=slot;
      tip.hidden=!slot;
      if(slot) {
        buttons.get(slot.id).classList.add("active");
        tip.src=slot.tip.image;
        tip.alt=slot.lines.map(line=>line.replace(/§./g,"")).join("\n");
      }
    }
    if(!slot) return null;
    const box=TooltipCore.chromaticBounds(slot.tip.width,slot.tip.height,{width,height:visibleHeight,x,y});
    place(tip,{x:box.bx,y:box.by,width:box.w,height:box.h});
    return box;
  }
  function center({x,y,width,height}) {
    return {x:x+Math.floor(width/2),y:y+Math.floor(height/2)};
  }
  function render() {
    show(null);
    const page=scene;
    const box={x:page.x,y:page.y,width:page.layout.width,height:page.height};
    visibleHeight=Math.max(height,box.y+box.height);
    stage.style.aspectRatio=width+" / "+visibleHeight;
    panel.width=box.width*scale;
    panel.height=box.height*scale;
    place(panel,box);
    ready=surface(page).then(image=>{if(page===scene) panel.getContext("2d").drawImage(image,0,0);});
    ready.catch(error=>{if(page===scene) panel.textContent=error.message;});
    targets=buildCells(page.layout).filter(({id})=>Object.hasOwn(page.slots,id)).map(({id,x,y,width,height})=>({
      ...page.slots[id],id,region:{x:page.x+x,y:page.y+headerHeight+y,width,height}
    }));
    buttons=new Map(targets.map(slot=>{
      const button=document.createElement("button");
      button.type="button";
      button.dataset.slot=slot.id;
      button.setAttribute("aria-label",slot.name.replace(/§./g,""));
      place(button,slot.region);
      button.onfocus=()=>{const {x,y}=center(slot.region);show(slot,x,y);};
      button.onblur=()=>{if(active===slot) show(null);};
      return [slot.id,button];
    }));
    slots.replaceChildren(...buttons.values());
  }
  function choose(id) {
    const page=scenes.find(entry=>entry.id===id);
    if(!page) throw Error("Unknown NEI scene: "+id);
    scene=page;
    if(select) select.value=id;
    render();
  }
  if(select) {
    for(const page of scenes) select.add(new Option(page.menu,page.id));
    select.onchange=()=>choose(select.value);
  }
  stage.addEventListener("pointermove",event=>{
    const b=stage.getBoundingClientRect();
    const x=Math.floor((event.clientX-b.left)*width/b.width);
    const y=Math.floor((event.clientY-b.top)*visibleHeight/b.height);
    const slot=targets.find(({region:r})=>x>=r.x && x<r.x+r.width && y>=r.y && y<r.y+r.height);
    show(slot ?? null,x,y);
  });
  stage.addEventListener("pointerleave",()=>show(null));
  stage.addEventListener("keydown",event=>{if(event.key==="Escape") show(null);});
  globalThis.GTNHNeiScene=Object.freeze({
    async panelPng() {return (await surface(scene)).toDataURL("image/png");},
    select:choose,
    hover(id) {
      if(id===null) {show(null);return null;}
      const slot=targets.find(entry=>entry.id===id);
      if(!slot) throw Error("Unknown occupied NEI slot: "+id);
      const {x,y}=center(slot.region);
      return {id,box:show(slot,x,y),lines:[...slot.lines]};
    },
    state() {return {scene:scene.id,slot:active?.id ?? null};}
  });
  render();
}
