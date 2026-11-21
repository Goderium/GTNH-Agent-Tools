import {readMuiScene} from "./mui-source.mjs";
import {applyMuiAction,controlSnapshot} from "./mui-actions.mjs";
import {chromaticBounds,placeMuiTooltip,screenScene,tooltipScene,tooltipWidthAt} from "./mui-tooltip.mjs";

// The exported page runs the same source interpreter, transitions and WebGL renderer as the CLI.
export function mountLive(embedded) {
  const data=embedded?.data??JSON.parse(document.getElementById("scene-data").textContent);
  const element=id=>embedded?embedded.root.querySelector('[data-mui="'+id+'"]'):document.getElementById(id);
  const stage=element("stage"),panel=element("panel"),surface=element("surface");
  const {scale,tooltipRenderer}=data;
  let viewport=data.viewport;
  function resize(view,panelWidth) {
    Object.assign(stage.style,embedded?{width:"100%",aspectRatio:view.width+"/"+view.height}:
      {width:view.width*scale+"px",height:view.height*scale+"px"});
    panel.style.left=100*view.x/view.width+"%";panel.style.top=100*view.y/view.height+"%";
    panel.style.width=100*panelWidth/view.width+"%";surface.style.width="100%";
  }
  resize(viewport,data.width);stage.style.touchAction="none";panel.src=data.frames[0].image;
  const input=document.createElement("input");
  input.type="text";input.inputMode="decimal";input.setAttribute("aria-label","MUI2 numeric input");
  input.tabIndex=-1;input.autocomplete="off";input.spellcheck=false;
  Object.assign(input.style,{position:"absolute",width:"1px",height:"1px",padding:"0",border:"0",opacity:"0",pointerEvents:"none"});
  stage.append(input);

  let program,bundle,font,files,initial,state,scene,hovered=data.initialHover,pointer=data.mouse;
  let panelUrl=panel.src,tipUrl=null,tooltipBox=null,drag=null,visibleEdit=null;
  const metrics=new Map(),tips=new Map();
  const accessible=new Map();
  function updateButtons(current,view) {
    const active=new Set();
    for(const w of current.widgets){
      const c=w.control;
      if(!c || c.enabled===false || !["choice","toggle","cycle","press"].includes(c.kind))continue;
      active.add(w.id);
      let button=accessible.get(w.id);
      if(!button){
        button=document.createElement("button");button.type="button";button.dataset.widget=w.id;
        Object.assign(button.style,{position:"absolute",pointerEvents:"none",border:"0",padding:"0",background:"transparent"});
        button.addEventListener("click",()=>native({type:"click",id:w.id,button:c.button??0}));
        stage.append(button);accessible.set(w.id,button);
      }
      button.setAttribute("aria-label",(w.label||w.tooltip[0]||w.id).replace(/§./g,""));
      if(c.kind==="choice" || c.kind==="toggle")button.setAttribute("aria-pressed",String(c.kind==="choice"?c.value===c.choice:!!c.value));
      else button.removeAttribute("aria-pressed");
      const [x,y,width,height]=w.box;
      Object.assign(button.style,{left:100*(view.x+x)/view.width+"%",top:100*(view.y+y)/view.height+"%",
        width:100*width/view.width+"%",height:100*height/view.height+"%"});
    }
    for(const [id,button] of accessible)if(!active.has(id)){button.remove();accessible.delete(id);}
  }
  function measure(text,maxWidth=0,config={}) {
    const key=JSON.stringify([text,maxWidth,config]);
    if(!metrics.has(key)){
      if(metrics.size>2048)metrics.clear();
      metrics.set(key,MuiText.measure(text,maxWidth,config,font,bundle.opts));
    }
    return metrics.get(key);
  }
  const build=(snapshot,hover=hovered)=>readMuiScene(program.classes,{...program.request,state:{...snapshot,hover}},measure);
  const raster=s=>renderMui(s,scale,files,op=>MuiText.draw(op,scale,font,bundle.opts));
  async function draw(next,id,point,force=false) {
    let current=next===state && id===hovered && scene && !force?scene:build(next,id);
    let w=current.widgets.find(w=>w.id===id);
    if(id!=null && !w){id=null;current=build(next,null);}
    const view=program.fitPanel?{...viewport,width:current.width,height:current.height}:viewport;
    const panelChanged=current!==scene;
    const nextPanel=panelChanged?(await raster(current)).toDataURL():panelUrl;
    let tip=null,box=null,tipPng=null;
    if(w?.tooltip.length) {
      const [x,y,width,height]=w.box;
      const mouse=point??{x:view.x+x+Math.floor(width/2),y:view.y+y+Math.floor(height/2)};
      const lines=w.tooltip.join("\n");
      const metric=limit=>measure(lines,limit,{rich:true});
      const initialWidth=Math.max(0,Math.trunc(metric(view.width).width)-1);
      const limit=tooltipWidthAt(initialWidth,view.width,mouse.x);
      const wrap=limit<initialWidth+1?limit:view.width;
      const key=JSON.stringify([lines,wrap]);
      if(!tips.has(key)){
        if(tips.size>128)tips.clear();
        const geometry=tooltipScene(metric(wrap),tooltipRenderer);
        tips.set(key,{scene:geometry,png:(await raster(geometry)).toDataURL()});
      }
      const entry=tips.get(key);tip=entry.scene;tipPng=entry.png;
      box=placeMuiTooltip(tooltipRenderer,{...tip,initialWidth},view,mouse,chromaticBounds);
    }
    let overlay;
    if(tip && (panelChanged || tipPng!==tipUrl || JSON.stringify(box)!==JSON.stringify(tooltipBox))) {
      overlay=await raster(screenScene(current,view,tip,box));
    }
    if(overlay){
      surface.width=overlay.width;surface.height=overlay.height;
      surface.getContext("2d").drawImage(overlay,0,0);
    }
    if(panelChanged)panel.src=nextPanel;
    if(view.width!==viewport.width || view.height!==viewport.height || current.width!==scene?.width)resize(view,current.width);
    viewport=view;
    if(panelChanged)updateButtons(current,view);
    surface.hidden=!tip;panel.hidden=!!tip;
    state=next;scene=current;hovered=id;pointer=point;panelUrl=nextPanel;tipUrl=tipPng;tooltipBox=box;
  }

  async function initialize() {
    const base64=embedded?.program??document.getElementById("mui-program").textContent;
    const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
    const decoded=new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    program=await new Response(decoded).json();
    bundle=embedded?.bundle??JSON.parse(document.getElementById("mui-resources").textContent);
    font=bundle.font?await MuiDisplay.unpack(bundle.font):null;
    files={resources:bundle.archives.map(url=>new Blob([
      Uint8Array.from(atob(url.slice(url.indexOf(",")+1)),c=>c.charCodeAt(0))
    ],{type:"application/zip"}))};
    initial=program.request.state;
    await draw({...initial},hovered,pointer,true);
  }
  const initialized=initialize();
  let pending=initialized;
  function enqueue(fn) {
    pending=pending.catch(()=>{}).then(()=>initialized).then(fn);
    pending.catch(error=>{stage.dataset.error=error.message;});
    return pending;
  }
  function act(action,fromInput=false) {
    return enqueue(async()=>{
      const result=await applyMuiAction(state,action,s=>build(s));
      await draw(result.state,hovered,pointer);
      if(!fromInput && visibleEdit) {
        if(state.edit?.id===visibleEdit && !(action.type==="edit" && action.showCaret!==undefined)){
          const {text,anchor,caret}=state.edit;
          input.value=text;
          input.setSelectionRange(Math.min(anchor,caret),Math.max(anchor,caret),caret<anchor?"backward":"forward");
        }else{
          visibleEdit=null;input.blur();clearInterval(blinkTimer);
        }
      }
      delete stage.dataset.error;
      return result.receipt;
    });
  }
  function hover(id,x,y) {
    if(id!=null && !(scene?.widgets??data.widgets).some(w=>w.id===id))throw Error("Unknown MUI2 widget "+id);
    const point=x==null||y==null?null:{x:Math.floor(x),y:Math.floor(y)};
    enqueue(()=>draw(state,id,point));return id;
  }
  function local(e) {
    const r=stage.getBoundingClientRect();
    return {x:Math.floor((e.clientX-r.left)*viewport.width/r.width),
      y:Math.floor((e.clientY-r.top)*viewport.height/r.height)};
  }
  function hit(p,forAction=false) {
    let w=scene?.widgets.findLast(w=>{
      const [x,y,width,height]=w.box,l=x+viewport.x,t=y+viewport.y;
      return (w.control||w.hoverable||w.tooltip?.length) && p.x>=l && p.y>=t && p.x<l+width && p.y<t+height;
    });
    if(forAction)while(w && !w.control)w=scene.widgets.find(node=>node.id===w.parentId);
    return w;
  }
  function native(action) {act(action,true).catch(()=>{});}
  function selection() {
    return input.selectionDirection==="backward"?{anchor:input.selectionEnd,caret:input.selectionStart}:
      {anchor:input.selectionStart,caret:input.selectionEnd};
  }
  let blinkTimer;
  function edit(options={}) {
    if(visibleEdit)native({type:"edit",id:visibleEdit,text:input.value,...selection(),...options});
  }
  function startBlink() {
    clearInterval(blinkTimer);
    let visible=true;
    // BaseTextFieldWidget.onUpdate toggles the cursor every ten client ticks.
    blinkTimer=setInterval(()=>{
      if(!visibleEdit){clearInterval(blinkTimer);return;}
      const id=visibleEdit;visible=!visible;
      const phase=visible;
      enqueue(async()=>{
        if(visibleEdit===id && state.edit?.id===id && state.edit.showCaret!==phase)
          await draw({...state,edit:{...state.edit,showCaret:phase}},hovered,pointer);
      });
    },500);
  }
  function moveCaret(w,p,extend) {
    const raw=input.value;
    const focused={...state,edit:{id:w.id,text:raw,...selection(),scrollX:w.control.scrollX,showCaret:false}};
    const c=build(focused,w.id).widgets.find(item=>item.id===w.id).control;
    const pos=(c.caretThresholds??[]).filter(x=>p.x-viewport.x>x).length;
    const anchor=extend?selection().anchor:pos;
    input.setSelectionRange(Math.min(pos,anchor),Math.max(pos,anchor),pos<anchor?"backward":"forward");
  }
  function slider(w,p) {
    native({id:w.id,type:"drag",x:p.x-viewport.x-w.box[0],y:p.y-viewport.y-w.box[1]});
  }
  stage.addEventListener("pointerdown",e=>{
    if(!scene || ![0,2].includes(e.button))return;
    const p=local(e),w=hit(p,true);
    if(!w?.control || w.control.enabled===false){input.blur();return;}
    e.preventDefault();
    if(w.control.kind==="number"){
      if(visibleEdit!==w.id){
        input.value=state.edit?.id===w.id?state.edit.text:String(w.control.value);
        startBlink();
      }
      visibleEdit=w.id;input.focus({preventScroll:true});
      const width=w.box[2],maxScroll=w.control.maxScrollX;
      if(maxScroll && p.y-viewport.y-w.box[1]>=w.box[3]-4){
        const thumb=Math.max(5,Math.trunc(Math.fround(width*width/(width+maxScroll))));
        const start=Math.trunc((width-thumb)*w.control.scrollX/maxScroll);
        const offset=p.x-viewport.x-w.box[0]-start;
        drag={id:w.id,kind:"scrollbar",pointer:e.pointerId,thumb,offset:offset>=0 && offset<=thumb?offset:Math.trunc(thumb/2)};
      }else{
        if(e.button===2){input.value="";input.setSelectionRange(0,0);}
        else if(e.detail>=2)input.select();
        else moveCaret(w,p,e.shiftKey);
        edit();drag={id:w.id,kind:"selection",pointer:e.pointerId};
      }
    }else{
      input.blur();
      if(w.control.kind==="slider"){
        slider(w,p);drag={id:w.id,kind:"slider",pointer:e.pointerId};
      }else native({id:w.id,type:"click",button:e.button===2?1:0});
    }
    if(drag)stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener("pointermove",e=>{
    if(!scene)return;
    const p=local(e),w=hit(p);
    if(drag?.pointer===e.pointerId && !e.buttons)drag=null;
    if(drag && e.pointerId===drag.pointer){
      const target=scene.widgets.find(w=>w.id===drag.id);
      if(!target)return;
      if(drag.kind==="slider")slider(target,p);
      else if(drag.kind==="scrollbar"){
        const progress=(p.x-viewport.x-target.box[0]-drag.offset)/(target.box[2]-drag.thumb);
        const max=target.control.maxScrollX;
        edit({scrollX:Math.max(0,Math.min(max,Math.trunc(progress*(max+4))))});
      }
      else {moveCaret(target,p,true);edit();}
    }else hover(w?.id??null,p.x,p.y);
  });
  function finishDrag(e) {
    if(drag?.pointer===e.pointerId)drag=null;
  }
  stage.addEventListener("pointerup",finishDrag);
  stage.addEventListener("pointercancel",finishDrag);
  stage.addEventListener("lostpointercapture",finishDrag);
  stage.addEventListener("pointerleave",()=>{if(!drag)hover(null);});
  stage.addEventListener("contextmenu",e=>e.preventDefault());
  stage.addEventListener("wheel",e=>{
    const w=hit(local(e));
    if(!e.deltaY || !w?.control)return;
    const c=w.control;
    if(c.scrollEnabled || (c.wheel?.enabled || c.maxScrollX>0) && visibleEdit===w.id){
      e.preventDefault();
      act({id:w.id,type:"scroll",direction:e.deltaY<0?"up":"down",modifiers:{shift:e.shiftKey,ctrl:e.ctrlKey,alt:e.altKey}},true)
        .then(()=>{
          if(visibleEdit!==w.id || !state.edit || input.value===state.edit.text)return;
          input.value=state.edit.text;
          const {anchor,caret}=state.edit;
          input.setSelectionRange(Math.min(anchor,caret),Math.max(anchor,caret),caret<anchor?"backward":"forward");
        }).catch(()=>{});
    }
  },{passive:false});
  input.addEventListener("beforeinput",e=>{
    const c=scene?.widgets.find(w=>w.id===visibleEdit)?.control;
    if(e.data && (/[\r\n§]/.test(e.data) || c?.maxLength>=0 &&
      input.value.length-(input.selectionEnd-input.selectionStart)+e.data.length>c.maxLength))e.preventDefault();
  });
  input.addEventListener("input",()=>edit());
  input.addEventListener("keyup",e=>{if(["ArrowLeft","ArrowRight","Home","End","a","A"].includes(e.key))edit();});
  input.addEventListener("keydown",e=>{
    if(!visibleEdit || !["Enter","Escape","Tab"].includes(e.key))return;
    e.preventDefault();
    const id=visibleEdit;visibleEdit=null;
    native({type:e.key==="Escape" && state.escRestoreLastText?"cancel":"commit",id});input.blur();
  });
  input.addEventListener("blur",()=>{if(visibleEdit){const id=visibleEdit;visibleEdit=null;native({type:"commit",id});}});
  stage.addEventListener("dblclick",e=>{if(visibleEdit && hit(local(e))?.id===visibleEdit){input.select();edit();}});
  globalThis.GTNHMuiScene=Object.freeze({act:action=>act(action),hover,ready:()=>pending,
    reset:()=>enqueue(async()=>{visibleEdit=null;input.blur();clearInterval(blinkTimer);await draw({...initial},data.initialHover,data.mouse,true);delete stage.dataset.error;}),
    state:()=>structuredClone({hover:hovered,width:scene?.width??data.width,height:scene?.height??data.height,
      widgets:scene?.widgets??data.widgets,viewport,tooltipBox,...(state?{controlState:controlSnapshot(state)}:{})}),
    panelPng:()=>panelUrl,tooltipPng:()=>tipUrl});
}
