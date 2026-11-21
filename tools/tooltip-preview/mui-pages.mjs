// MUI2 2.3.94 PagedWidget keeps all its children alive and enables exactly
// the current page. PageButton follows that selection instead of owning a value.
export const unusedPageCall = Symbol("unhandled page member");

export function newPageObject(name,args,widget,localValue,site) {
  if (name === "PagedWidget.Controller" && !args.length) return {type:"pageController",pager:null};
  if (name === "PagedWidget" && !args.length) {
    const pager=widget("PagedWidget");
    pager.pageValue=localValue(0,"page."+site);
    return pager;
  }
  if (name === "PageButton") {
    if (args.length!==2 || !Number.isInteger(args[0]) || args[1]?.type!=="pageController")
      throw Error("PageButton requires a page index and a PagedWidget.Controller.");
    return {...widget("PageButton"),pageIndex:args[0],controller:args[1],disableHoverTheme:true};
  }
  if (name==="TabTexture" && args.length===11) {
    return {type:"tabTexture",faces:args.slice(0,6),width:args[6],height:args[7],
      inset:args[8],axis:args[9],positive:args[10]};
  }
  return null;
}

function tabAtlas(texture,axis,positive,width,height,inset) {
  if (texture?.type!=="texture" || !["GuiAxis.X","GuiAxis.Y"].includes(axis?.ref) || typeof positive!=="boolean")
    throw Error("TabTexture.of requires a UITexture, native GuiAxis and orientation.");
  const vertical=axis.ref==="GuiAxis.Y",f=Math.fround;
  const uv=texture.pixelUV?texture.pixelUV.map((v,i)=>v/texture.imageSize[i%2]):texture.uv;
  const faces=[];
  for(const active of [true,false]){
    const bank=active===positive?0:0.5;
    for(let pos=0;pos<3;pos++){
      const start=f(pos/3),end=f((pos+1)/3);
      const slice=vertical?[start,bank,end,bank+.5]:[bank,start,bank+.5,end];
      const mapped=slice.map((v,i)=>f(uv[i%2]+f(f(uv[i%2+2]-uv[i%2])*v)));
      // UITexture.getSubArea keeps colorType; AdaptableUITexture additionally
      // preserves its borders, pixel dimensions and nonOpaque flag.
      const image={...texture,uv:mapped,pixelUV:null};
      if(!image.border?.some(n=>n))image.blend=false;
      faces.push(image);
    }
  }
  return {type:"tabTexture",faces,width,height,inset,axis,positive};
}

function tabFace(tab,location,selected) {
  return tab.faces[(selected?0:3)+(location<0?0:location>0?2:1)];
}

function checkedIndex(pager,read) {
  const value=read(pager.pageValue);
  if(!Number.isInteger(value) || value<0 || value>=pager.children.length)
    throw Error("PagedWidget page index "+value+" is outside its "+pager.children.length+" pages.");
  return value;
}

function requireController(controller) {
  if (!controller?.pager?.pageReady) throw Error("PagedWidget.Controller has no initialized PagedWidget.");
  return controller.pager;
}

function setInitial(pager,page) {
  if (!Number.isInteger(page) || page<0 || page>=pager.children.length)
    throw Error("PagedWidget cannot select page "+page+" of "+pager.children.length+".");
  pager.pageValue.initial=page;
  pager.pageAssigned=true;
}

export function pageCall(obj,name,args,read,functions) {
  const [a,b]=args;
  if(obj?.ref==="TabTexture" && name==="of" && args.length===6)return tabAtlas(...args);
  if(obj?.type==="tabTexture"){
    switch(name){
      case "get":return tabFace(obj,a,b);
      case "getStart":return tabFace(obj,-1,a);
      case "getMiddle":return tabFace(obj,0,a);
      case "getEnd":return tabFace(obj,1,a);
      case "getWidth":return obj.width;
      case "getHeight":return obj.height;
      case "getTextureInset":return obj.inset;
      case "getAxis":return obj.axis;
      case "isPositive":return obj.positive;
    }
  }
  if(obj?.widget==="PagedWidget"){
    switch(name){
      case "addPage":
        if(a?.type!=="widget")throw Error("PagedWidget.addPage requires a widget.");
        obj.children.push(a);return obj;
      case "controller":
        if(a?.type!=="pageController")throw Error("PagedWidget.controller requires a Controller.");
        a.pager=obj;return obj;
      case "initialPage":
        if(!Number.isInteger(a))throw Error("initialPage requires an integer.");
        if(!obj.pageReady)obj.pageValue.initial=a;
        return obj;
      case "onPageChange":{
        const body=functions.get(a)?.body;
        if(a!=null && !(body?.[0]==="BLOCK" && body[2].length===0))
          throw Error("Custom PagedWidget.onPageChange callbacks are unsupported. Their side effects cannot be replayed.");
        return obj;
      }
      case "getPages":return obj.children;
      case "getCurrentPage":return obj.pageReady || obj.pageAssigned?obj.children[checkedIndex(obj,read)]:null;
      case "getCurrentPageIndex":return read(obj.pageValue);
      case "setPage":case "nextPage":case "previousPage":{
        const value=read(obj.pageValue);
        const index=name==="setPage"?a:(value+(name==="nextPage"?1:-1)+obj.children.length)%obj.children.length;
        if(obj.pageReady)throw Error("Change a live PagedWidget through a page control.");
        setInitial(obj,index);
        return;
      }
    }
  }
  if(obj?.type==="pageController"){
    if(name==="isInitialised")return !!obj.pager?.pageReady;
    const pager=requireController(obj);
    if(name==="getActivePageIndex")return checkedIndex(pager,read);
    if(name==="getActivePage")return pager.children[checkedIndex(pager,read)];
    if(["setPage","nextPage","previousPage"].includes(name))throw Error("Change a live PagedWidget through a page control.");
  }
  if(obj?.widget==="PageButton"){
    switch(name){
      case "background":
        if(typeof a!=="boolean")return unusedPageCall;
        if(a){obj.background=args.slice(1);obj.disableTheme=true;}
        else obj.pageInactive=args.length>1?args.slice(1):null;
        return obj;
      case "tab":{
        if(a?.type!=="tabTexture" || !Number.isInteger(b))throw Error("PageButton.tab requires TabTexture and a location.");
        obj.background=[tabFace(a,b,true)];
        obj.pageInactive=[tabFace(a,b,false)];
        obj.disableTheme=true;obj.disableHoverTheme=true;
        obj.w=a.width;obj.h=a.height;return obj;
      }
      case "isActive":return checkedIndex(requireController(obj.controller),read)===obj.pageIndex;
      case "invertSelected":if(!args.length)return !!obj.invertSelected;obj.invertSelected=a;return obj;
      case "isInvert":return !!obj.invertSelected;
      case "getIndex":return obj.pageIndex;
      case "getController":return obj.controller;
    }
  }
  return unusedPageCall;
}

// The interpreter indexes the full tree before drawing either the tabs or the pager.
export function initializePager(pager,id,read) {
  pager.pageValue.sourceKey="$page."+id;
  const active=checkedIndex(pager,read);
  pager.pageReady=true;
  for(const [index,page] of pager.children.entries())page.pageVisible=(index===active);
}

export function pageButtonChoice(w,read,targetOf) {
  const pager=requireController(w.controller),value=checkedIndex(pager,read);
  const choice=w.pageIndex;
  if(choice<0 || choice>=pager.children.length)throw Error("PageButton selects a page outside its controller.");
  return {kind:"choice",target:targetOf(pager.pageValue),value,choice,enabled:true};
}

// Widget callbacks may select an absolute page or step the native controller.
// Other statements require the real Java event implementation.
export function pageCallbackChoice(cb,receiver,read,targetOf) {
  const statements=cb?.body?.[0]==="BLOCK"?cb.body[2]:null;
  if(statements?.length!==2 || statements[1][0]!=="RETURN" || statements[1][2]?.[0]!=="BOOLEAN_LITERAL" || !statements[1][2][2])return null;
  const n=statements[0][0]==="EXPRESSION_STATEMENT"?statements[0][2]:null;
  if(n?.[0]!=="METHOD_INVOCATION" || n[2][0]!=="MEMBER_SELECT")return null;
  const target=receiver(n[2][2]),method=n[2][3];
  const pager=target?.type==="pageController"?requireController(target):target?.widget==="PagedWidget"?target:null;
  if(!pager || !["setPage","nextPage","previousPage"].includes(method))return null;
  const value=checkedIndex(pager,read),len=pager.children.length;
  let choice;
  if(method==="setPage"){
    const arg=n[3][0];
    if(n[3].length!==1)return null;
    choice=arg[0]==="INT_LITERAL"?arg[2]:arg[0]==="IDENTIFIER"?cb.env.get(arg[2]):null;
    if(!Number.isInteger(choice))return null;
    if(choice<0 || choice>=len)throw Error("Controller.setPage selects a page outside its controller.");
  }else{
    if(n[3].length)return null;
    choice=(value+(method==="nextPage"?1:-1)+len)%len;
  }
  return {kind:"choice",target:targetOf(pager.pageValue),value,choice,enabled:true};
}
