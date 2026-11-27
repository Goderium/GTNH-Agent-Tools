import {readMuiTheme} from "./mui-theme.mjs";
import {configureSlider,sliderState,paintSlider} from "./mui-slider.mjs";
import {collectionWidget,expandFlow,resizeOnlyListener,fillGrid,gridMetrics} from "./mui-collection.mjs";
import {snapshotCall,noSnapshotCall,receiveSnapshot,hoverIndexListener} from "./mui-snapshot.mjs";
import {checkPressNode,pressStatement} from "./mui-press.mjs";
import {newPageObject,pageCall,unusedPageCall,initializePager,pageButtonChoice,pageCallbackChoice} from "./mui-pages.mjs";

// NumberFormat.AMOUNT_TEXT uses four significant places including the SI prefix, rounding down.
function slotAmount(value) {
  let factor=1,suffix="";
  if(value>=10000){
    const exponent=Math.floor(Math.log10(value)/3);
    factor=1000**exponent;suffix=["","k","M","G","T","P"][exponent];
  }else if(value>0 && value<1){factor=.001;suffix="m";}
  const scaled=value/factor;
  const decimals=Math.max(0,4-suffix.length-Math.max(1,Math.floor(Math.log10(scaled||1))+1));
  return new Intl.NumberFormat("en-US",{useGrouping:false,maximumFractionDigits:decimals,roundingMode:"trunc"}).format(scaled)+suffix;
}

function manualSlot(w,id,box,state) {
  const fluid=w.widget==="FluidSlot",provided=Object.hasOwn(state.slots??{},id);
  if(!provided && w.boundSlot && state.emptyBoundSlots!==true)throw Error("Supply state.slots["+id+"] for the bound "+w.widget+" ({} for an empty slot).");
  const value=provided?state.slots[id]:{};
  if(!value || typeof value!=="object" || Array.isArray(value))throw Error("Invalid slot state for "+id);
  const allowed=new Set(["resource","renderer","size","frame","tint","tooltip",...(fluid?
    ["amount","capacity","gaseous","controlsAmount"]:["count"])]);
  for(const key of Object.keys(value))if(!allowed.has(key))throw Error("Unsupported "+w.widget+" field "+id+"."+key);
  if(value.renderer!==undefined && value.renderer!=="flat")throw Error("Only flat sprite rendering is supported for "+id);
  const resource=value.resource;
  if(resource!==undefined && (typeof resource!=="string" || !/^[a-z0-9_-]+:[\w./-]+$/.test(resource) || resource.includes("..")))
    throw Error("Invalid texture resource for "+id);
  const tooltip=value.tooltip??[];
  if(!Array.isArray(tooltip) || tooltip.some(line=>typeof line!=="string"))throw Error("Expected string tooltip lines for "+id);
  const contentKeys=["count","amount","tint","frame","size","gaseous","controlsAmount"];
  if(!resource && contentKeys.some(k=>Object.hasOwn(value,k)))throw Error("Missing slot texture resource for "+id);
  const [x,y,width,height]=box,hoverBox=fluid?[x+1,y+1,width-2,height-2]:[x+1,y+1,16,16];
  const content={kind:fluid?"fluid":"item",resource:resource??null,tooltip,hoverBox,
    highlight:fluid || ((provided || w.boundSlot && state.emptyBoundSlots===true) && state.itemHoverOverlay!==false)};
  if(!resource)return content;
  const amount=fluid?value.amount:(value.count??1);
  if(!Number.isInteger(amount) || amount<=0 || amount>2147483647)throw Error("Invalid "+(fluid?"amount":"count")+" for "+id);
  if(value.tint!=null && (!Number.isInteger(value.tint) || value.tint< -2147483648 || value.tint>0xffffffff))throw Error("Invalid ARGB tint for "+id);
  let tint=(value.tint??0xffffffff)>>>0;if((tint>>>24)===0)tint=(tint|0xff000000)>>>0;
  if(!fluid && (tint>>>24)!==255)throw Error("The flat item pass supports an opaque RGB multiplier.");
  let uv=[0,0,1,1];
  if(value.frame!==undefined || value.size!==undefined) {
    const size=value.size;
    if(!Array.isArray(size)||size.length!==2||!size.every(n=>Number.isSafeInteger(n)&&n>0))throw Error("Supply size [textureWidth,textureHeight] for "+id);
    const frame=value.frame??[0,0,...size];
    if(!Array.isArray(frame)||frame.length!==4||!frame.every(Number.isSafeInteger))throw Error("Invalid sprite frame for "+id);
    const [l,t,sw,sh]=frame;
    if(l<0||t<0||sw<1||sh<1||l+sw>size[0]||t+sh>size[1])throw Error("Sprite frame exceeds texture bounds for "+id);
    uv=[l/size[0],t/size[1],(l+sw)/size[0],(t+sh)/size[1]];
  }
  Object.assign(content,{uv,tint,iconBox:[x+1,y+1,16,16],labelBox:box});
  if(!fluid){content.count=amount;content.label=amount>1?slotAmount(amount):"";return content;}
  for(const k of ["controlsAmount","gaseous"])if(k in value && typeof value[k]!=="boolean")throw Error("Expected boolean "+k+" for "+id);
  const [l,t,r,b]=w.contentPadding;
  const dw=width-l-r,dh=height-t-b;
  if(dw<1 || dh<1)throw Error("Fluid content padding exceeds "+id);
  let filled=dh,top=y+t;
  if(w.alwaysShowFull===false){
    const capacity=value.capacity;
    if(!Number.isInteger(capacity)||capacity<amount||capacity>2147483647)throw Error("Partial fluid slot requires capacity >= amount for "+id);
    const f=Math.fround;
    filled=Math.trunc(f(1+f((dh-1)*f(f(amount)/f(capacity)))));
    if(!value.gaseous || w.flipLighterThanAir===false)top+=dh-filled;
  }
  const milli=state.useForgeFluidMillibuckets===true;
  const multiplier=w.unitMultiplier??(milli ? 0.001 : 1),unit=w.fluidUnit??(milli?"B":"L");
  const controlsAmount=value.controlsAmount??w.slotBinding?.controlsAmount??true;
  return {...content,amount,iconBox:[x+l,top,dw,filled],labelBox:[x,y,width-l,height],textPos:[l,0],
    label:controlsAmount?slotAmount(amount*multiplier)+unit:""};
}

// Interpret javac trees. A symbolic name must resolve before it can contribute pixels.
export function readMuiScene(classes, request, measure) {
  const {java,state={},size,textureQuadMode}=request;
  if(textureQuadMode!==undefined && textureQuadMode!=="angelica-2.2.43")
    throw Error("Unsupported MUI2 textureQuadMode: "+textureQuadMode);
  const theme=readMuiTheme(classes,request.theme,state.bindings);
  let activeSkin=theme;
  const entry=java.class ?? java.file.split(/[\\/]/).pop().replace(/\.java$/,"");
  const fields=new Map(), evaluating=new Set(), methods=new Set(), ops=[], widgets=[];
  const slotIds=new Set();
  const ref=name=>({ref:name});
  const typed=(n,javaType)=>Object.assign(new Number(n),{javaType});
  const floating=(n,single=false)=>typed(single?Math.fround(n):n,single?"float":"double");
  const isReal=n=>n?.javaType==="double" || n?.javaType==="float" || typeof n==="number" && !Number.isInteger(n);
  const long=n=>{
    if(!Number.isSafeInteger(n))throw Error("Java long exceeds the preview's exact integer range.");
    return typed(n,"long");
  };
  const scalar=n=>{
    if(typeof n!=="number" && !(n instanceof Number) || !Number.isFinite(+n)) throw Error("Expected a finite number: "+JSON.stringify(n));
    return +n;
  };
  function declared(v,type){
    if(v==null)return v;
    if(type==="float" || type==="double")return floating(scalar(v),type==="float");
    if(type==="long")return long(Math.trunc(scalar(v)));
    if(["int","short","byte"].includes(type)){
      let n=Math.trunc(scalar(v));
      if(isReal(v))n=Math.max(-2147483648,Math.min(2147483647,n));
      if(type==="byte")return n<<24>>24;
      if(type==="short")return n<<16>>16;
      return n|0;
    }
    return v;
  }
  function printable(value){
    if(value==null || ["number","string","boolean"].includes(typeof value) || value instanceof Number)return String(value);
    throw Error("Unresolved text value "+(value?.ref??JSON.stringify(value)));
  }
  const rect=color=>({type:"rect",colors:[color,color,color,color],radius:0,segments:6});
  const texture=()=>({type:"texture",uv:[0,0,1,1],border:[0,0,0,0],imageSize:[16,16]});
  const widget=type=>({type:"widget",widget:type,origin:location,children:[],background:null,overlay:[],
    padding:type==="TextFieldWidget"?[4,0,4,0]:[0,0,0,0],margin:[0,0,0,0]});
  const usedIds=new Set(),widgetIds=new WeakMap(),syncValues=new Map();
  const functions=new WeakMap(),localValues=new Map();
  function localValue(initial,site) {
    const index=(localValues.get(site)??0)+1;localValues.set(site,index);
    return {type:"sync",local:true,initial,sourceKey:"$local."+site+"."+index};
  }
  function bindingKey(fn) {
    const meta=functions.get(fn);
    if(meta?.reference)return meta.reference;
    if(!meta || meta.params.length)return null;
    let n=meta.body;
    if(n[0]==="BLOCK" && n[2].length===1 && n[2][0][0]==="RETURN")n=n[2][0][2];
    if(n?.[0]==="METHOD_INVOCATION" && !n[3].length){
      n=n[2];
      if(n[0]==="IDENTIFIER")return (memberOwner(meta.owner,"methods",n[2]+"/0")??meta.owner)+"."+n[2];
    }
    if(n?.[0]==="IDENTIFIER" && !meta.env.has(n[2])){
      return memberOwner(meta.owner,"fields",n[2])?meta.owner+"."+n[2]:n[2];
    }
    if(n?.[0]==="MEMBER_SELECT" && n[2][0]==="IDENTIFIER") {
      const base=n[2][2];
      return (base==="this"?meta.owner:meta.env.get(base)?.ref??base)+"."+n[3];
    }
    return null;
  }
  function targetOf(value) {
    if(value?.type!=="sync" || !value.local && !(value.c2s && typeof value.set==="function"))return null;
    if(value.local && value.set){
      const setter=functions.get(value.set);
      const getter=bindingKey(value.get);
      let body=setter?.body;
      if(body?.[0]==="BLOCK" && body[2].length===1)body=body[2][0];
      if(body?.[0]==="EXPRESSION_STATEMENT")body=body[2];
      if(setter?.reference){
        if(getter?.slice(0,getter.lastIndexOf("."))!==setter.reference.slice(0,setter.reference.lastIndexOf(".")))return null;
      }else{
        if(!(body?.[0]==="ASSIGNMENT" && body[3][0]==="IDENTIFIER" && body[3][2]===setter?.params[0]))return null;
        const field=body[2];
        let receiver,name;
        if(field[0]==="IDENTIFIER"){name=field[2];receiver=memberOwner(setter.owner,"fields",name);}
        else if(field[0]==="MEMBER_SELECT" && field[2][0]==="IDENTIFIER"){
          name=field[3];receiver=field[2][2]==="this"?setter.owner:setter.env.get(field[2][2])?.ref??field[2][2];
        }
        if(!name || getter!==(receiver?receiver+"."+name:name))return null;
      }
    }
    if(value.key!=null)return {group:"sync",key:value.key};
    const key=value.sourceKey??bindingKey(value.get);
    return key?{group:"bindings",key}:null;
  }
  const enumCodes="BLACK DARK_BLUE DARK_GREEN DARK_AQUA DARK_RED DARK_PURPLE GOLD GRAY DARK_GRAY BLUE GREEN AQUA RED LIGHT_PURPLE YELLOW WHITE OBFUSCATED BOLD STRIKETHROUGH UNDERLINE ITALIC RESET".split(" ");
  function memberOwner(owner,group,key){
    const seen=new Set();
    while(classes[owner] && !seen.has(owner)){
      if(Object.hasOwn(classes[owner][group],key))return owner;
      seen.add(owner);owner=classes[owner].parent;
    }
    return null;
  }
  function importedOwner(owner,name,group,arity) {
    const type=classes[owner],explicit=type?.imports?.[name];
    if(explicit)return explicit;
    const member=arity==null?name:name+"/"+arity;
    const candidates=(type?.wildcards??[]).filter(source=>memberOwner(source,group,member) ||
      Object.hasOwn(state.bindings??{},source+"."+name));
    if(candidates.length>1)throw Error("Ambiguous static import "+name+" from "+candidates.join(", "));
    return candidates[0];
  }
  let budget=250000,location=entry,rootBox,pressReplay;
  function field(owner,key) {
    owner=memberOwner(owner,"fields",key)??owner;
    const full=owner+"."+key;
    if(pressReplay?.assignments.has("bindings:"+full))return pressReplay.assignments.get("bindings:"+full).after;
    if(Object.hasOwn(state.bindings ?? {},full)) return state.bindings[full];
    if(owner==="EnumChatFormatting" && enumCodes.includes(key))return "§"+"0123456789abcdefklmnor"[enumCodes.indexOf(key)];
    if(full==="Integer.MAX_VALUE")return 2147483647;
    if(fields.has(full)) return fields.get(full);
    if(!Object.hasOwn(classes[owner]?.fields ?? {},key)) return ref(full);
    if(pressReplay){
      const initializer=classes[owner].fields[key];
      return initializer?visit(initializer,new Map(),owner):ref(key);
    }
    if(evaluating.has(full)) throw Error("Recursive field "+full);
    evaluating.add(full);
    const initializer=classes[owner].fields[key];
    const value=initializer?visit(initializer,new Map(),owner):registeredField(owner,key)??ref(key);
    evaluating.delete(full); fields.set(full,value);
    return value;
  }
  // A screen often wires its field in registerSyncValues, separately from its layout factory.
  function registeredField(owner,key) {
    const registration=classes[owner]?.methods["registerSyncValues/1"];
    if(!registration || registration[2][0]!=="PanelSyncManager")return null;
    const scope=new Map([[registration[0][0],ref("$sync")]]);
    let value;
    const isField=n=>n?.[0]==="IDENTIFIER" && n[2]===key ||
      n?.[0]==="MEMBER_SELECT" && n[2][0]==="IDENTIFIER" && n[2][2]==="this" && n[3]===key;
    for(const statement of registration[1][2]){
      if(statement[0]!=="EXPRESSION_STATEMENT")continue;
      const n=statement[2];
      if(n[0]==="ASSIGNMENT" && isField(n[2]))value=visit(n[3],scope,owner);
      if(value?.type!=="sync" || n[0]!=="METHOD_INVOCATION" || n[2][3]!=="syncValue" ||
        n[2][2]?.[2]!==registration[0][0] || n[3][0]?.[0]!=="STRING_LITERAL" || !isField(n[3][1]))continue;
      value.key=n[3][0][2];syncValues.set(value.key,value);return value;
    }
    return null;
  }
  function method(owner,name,args) {
    const id=name+"/"+args.length;
    const replacement=java.adapters?.[owner+"."+id];
    if(replacement){
      const match=/^([\w$.]+)\.(\w+)\/(\d+)$/.exec(replacement);
      if(!match || ![0,args.length].includes(+match[3]) || !classes[match[1]]?.methods[match[2]+"/"+match[3]])
        throw Error("Invalid source adapter for "+owner+"."+id);
      (pressReplay?.methods??methods).add(owner+"."+id+" -> "+replacement);
      owner=match[1];name=match[2];if(+match[3]===0)args=[];
    }
    const actualId=name+"/"+args.length;
    owner=memberOwner(owner,"methods",actualId)??owner;
    const m=classes[owner]?.methods[actualId];
    if(!m) throw Error("Missing or ambiguous method "+owner+"."+id);
    (pressReplay?.methods??methods).add(owner+"."+actualId);
    return execute(m[1],new Map(m[0].map((p,i)=>{
      const type=m[2][i],value=args[i]??(type==="PanelSyncManager"?ref("$sync"):null);
      return [p,declared(value,type)];
    })),owner);
  }
  function execute(node,env,owner) {
    try {return visit(node,env,owner);} catch(e) {if(e instanceof Returned) return e.value;throw e;}
  }
  class Returned {constructor(value){this.value=value;}}
  function invoke(fn,args=[]) {
    if(typeof fn!=="function") throw Error("Expected a drawable or supplier lambda.");
    return fn(...args);
  }
  const hoverSync=new Map();
  let hoverSender=null;
  function readValue(value) {
    if(value?.type==="sync") {
      if(hoverSync.has(value))return hoverSync.get(value);
      if(Object.hasOwn(state.sync??{},value.key))return state.sync[value.key];
      const snapshotKey=value.sourceKey??bindingKey(value.get);
      if(snapshotKey && Object.hasOwn(state.bindings??{},snapshotKey))return state.bindings[snapshotKey];
      if(Object.hasOwn(value,"initial"))return value.initial;
      return invoke(value.get);
    }
    return typeof value==="function"?invoke(value):value;
  }
  function operator(op,a,b) {
    if(op==="EQUAL_TO" || op==="NOT_EQUAL_TO"){
      if(a?.ref || b?.ref)throw Error("Unresolved equality operand "+(a?.ref??b?.ref));
      const eq=(a instanceof Number ? +a : a)===(b instanceof Number ? +b : b);
      return op==="EQUAL_TO" ? eq : !eq;
    }
    if(op==="PLUS" && (typeof a==="string" || typeof b==="string")) return printable(a)+printable(b);
    const x=scalar(a), y=scalar(b),real=isReal(a)||isReal(b);
    const wide=a?.javaType==="long" || b?.javaType==="long";
    const result=n=>real?floating(n,a?.javaType!=="double" && b?.javaType!=="double"):wide?long(n):n|0;
    if(wide && ["LEFT_SHIFT","RIGHT_SHIFT","UNSIGNED_RIGHT_SHIFT","OR","AND","XOR"].includes(op))throw Error("Unsupported Java long bitwise operator "+op);
    switch(op) {
      case "PLUS": return result(x+y);
      case "MINUS": return result(x-y);
      case "MULTIPLY": return real||wide?result(x*y):Math.imul(x,y);
      case "DIVIDE":case "REMAINDER":
        if(!real && y===0)throw Error("Integer division by zero.");
        return result(op==="REMAINDER"?x%y:real?x/y:Math.trunc(x/y));
      case "LEFT_SHIFT": return x<<y; case "RIGHT_SHIFT": return x>>y; case "UNSIGNED_RIGHT_SHIFT": return x>>>y;
      case "OR": return x|y; case "AND": return x&y; case "XOR": return x^y;
      case "LESS_THAN": return x<y; case "LESS_THAN_EQUAL": return x<=y;
      case "GREATER_THAN": return x>y; case "GREATER_THAN_EQUAL": return x>=y;
      default: throw Error("Unsupported operator "+op);
    }
  }
  function visit(n,env,owner) {
    if(!n) return null;
    const [k,line,a,b,c,d]=n;
    if(pressReplay)checkPressNode(k,pressReplay);
    location=owner+":"+line;
    if(!pressReplay && --budget<0) throw Error("MUI source evaluation budget exceeded.");
    switch(k) {
      case "INT_LITERAL":case "BOOLEAN_LITERAL":case "CHAR_LITERAL":case "STRING_LITERAL":case "NULL_LITERAL":return a;
      case "LONG_LITERAL":return long(a);
      case "FLOAT_LITERAL":case "DOUBLE_LITERAL": return floating(a,k==="FLOAT_LITERAL");
      case "IDENTIFIER":{
        if(env.has(a)) return env.get(a);
        if(a==="this") return ref(owner);
        if(a==="super") return ref(classes[owner]?.parent);
        if(Object.hasOwn(classes,owner+"."+a))return ref(owner+"."+a);
        if(memberOwner(owner,"fields",a)) return field(owner,a);
        if(Object.hasOwn(state.bindings ?? {},a)) return state.bindings[a];
        const imported=importedOwner(owner,a,"fields");
        if(imported){
          const v=field(imported,a);
          return v?.ref?{...v,alias:a}:v;
        }
        return ref(a);
      }
      case "MEMBER_REFERENCE": {
        const target=visit(a,env,owner);
        const fn=(...args)=>call(target,b,args);
        if(target?.ref)functions.set(fn,{reference:target.ref+"."+b});
        return fn;
      }
      case "MEMBER_SELECT": {
        const obj=visit(a,env,owner);
        if(obj?.ref) {
          if(obj.ref==="GTWidgetThemes")return ref(obj.ref+"."+b);
          const alias=obj.alias+"."+b;
          return obj.alias && Object.hasOwn(state.bindings??{},alias)?state.bindings[alias]:field(obj.ref,b);
        }
        if(obj && Object.hasOwn(obj,b)) return obj[b];
        throw Error("Unknown member "+b);
      }
      case "VARIABLE": env.set("#type:"+a,c);env.set(a,declared(visit(b,env,owner),c)); return;
      case "BLOCK": for(const stmt of a) visit(stmt,env,owner); return;
      case "RETURN": throw new Returned(visit(a,env,owner));
      case "PARENTHESIZED":case "EXPRESSION_STATEMENT": return visit(a,env,owner);
      case "IF":case "CONDITIONAL_EXPRESSION": {
        const flag=visit(a,env,owner); if(typeof flag!=="boolean") throw Error("Unresolved condition.");
        return visit(flag?b:c,env,owner);
      }
      case "FOR_LOOP":
        for(const stmt of a) visit(stmt,env,owner);
        for(;;){
          const flag=b?visit(b,env,owner):true;
          if(typeof flag!=="boolean")throw Error("Unresolved loop condition.");
          if(!flag)break;
          if(--budget<0)throw Error("MUI source evaluation budget exceeded.");
          visit(d,env,owner);for(const step of c) visit(step,env,owner);
        }
        return;
      case "ENHANCED_FOR_LOOP":{
        const values=visit(b,env,owner);
        if(!Array.isArray(values))throw Error("Expected an iterable list of widgets.");
        for(const value of values){const scope=new Map(env);scope.set(a,value);visit(c,scope,owner);}
        return;
      }
      case "INSTANCE_OF":{
        const obj=visit(a,env,owner);
        if(!obj || obj.type!=="widget")throw Error("Unsupported instanceof operand "+b);
        if(!["IWidget","Widget","ParentWidget","ButtonWidget","ItemSlot","FluidSlot","TextWidget","ToggleButton","DrawableWidget"].includes(b))throw Error("Unsupported widget type "+b);
        const matches=["IWidget","Widget",obj.widget].includes(b);
        if(matches && c)env.set(c,obj);
        return matches;
      }
      case "ASSIGNMENT":case "PLUS_ASSIGNMENT":case "MINUS_ASSIGNMENT": {
        if(pressReplay && k==="ASSIGNMENT" && (a[0]==="IDENTIFIER" && !env.has(a[2]) ||
          a[0]==="MEMBER_SELECT" && a[2][0]==="IDENTIFIER" && a[2][2]==="this")){
          const name=a[0]==="IDENTIFIER"?a[2]:a[3],declaring=memberOwner(owner,"fields",name);
          if(!declaring)throw Error("Undeclared source button field "+name);
          return pressWrite({group:"bindings",key:declaring+"."+name},visit(b,env,owner));
        }
        if(a[0]!=="IDENTIFIER" || !env.has(a[2])) throw Error("Expected a local assignment.");
        const next=visit(b,env,owner);
        const value=k==="ASSIGNMENT"?next:operator(k.split("_")[0],env.get(a[2]),next);
        env.set(a[2],declared(value,env.get("#type:"+a[2])));return env.get(a[2]);
      }
      case "PREFIX_INCREMENT":case "POSTFIX_INCREMENT":case "PREFIX_DECREMENT":case "POSTFIX_DECREMENT": {
        if(a[0]!=="IDENTIFIER" || !env.has(a[2])) throw Error("Expected a local counter.");
        const old=env.get(a[2]),next=declared(operator("PLUS",old,k.endsWith("INCREMENT")?1:-1),env.get("#type:"+a[2]));
        env.set(a[2],next);return k.startsWith("POSTFIX")?old:next;
      }
      case "TYPE_CAST": return declared(visit(b,env,owner),a);
      case "LOGICAL_COMPLEMENT": {const v=visit(a,env,owner);if(typeof v!=="boolean")throw Error("Unresolved boolean.");return !v;}
      case "UNARY_MINUS": return operator("MINUS",0,visit(a,env,owner));
      case "CONDITIONAL_AND":case "CONDITIONAL_OR": {
        const v=visit(a,env,owner); if(typeof v!=="boolean") throw Error("Unresolved boolean.");
        return k==="CONDITIONAL_AND" ? v && visit(b,env,owner) : v || visit(b,env,owner);
      }
      case "NEW_ARRAY": return a.map(v=>visit(v,env,owner));
      case "ARRAY_ACCESS": return visit(a,env,owner)[scalar(visit(b,env,owner))];
      case "LAMBDA_EXPRESSION": {
        const captured=new Map(env);
        const fn=(...args)=>{const e=new Map(captured);a.forEach((p,i)=>e.set(p,args[i]));return execute(b,e,owner);};
        functions.set(fn,{params:a,body:b,owner,env:captured});return fn;
      }
      case "NEW_CLASS": {
        if(c?.some(name=>!["onMousePressed","onMouseRelease","onMouseReleased"].includes(name) &&
          !(name==="onChildChangeEnabled" && a==="Flow" && resizeOnlyListener(d)))) throw Error("Unsupported anonymous overrides: "+c.join(", "));
        if(["FluidSlotSyncHandler","ItemSlotSH","ModularSlot"].includes(a)){
          const valid=a==="FluidSlotSyncHandler"?[1,2]:a==="ItemSlotSH"?[1]:[2];
          if(!valid.includes(b.length))throw Error("Unsupported "+a+" constructor with "+b.length+" arguments.");
          return {type:"slotBinding",bindingClass:a};
        }
        const args=b.map(v=>visit(v,env,owner));
        location=owner+":"+line;
        if(a==="NBTTagCompound" && !args.length)return {type:"nbt",data:{}};
        if(java.adapters?.[a+".<init>/"+args.length])return method(a,"<init>",args);
        const collection=collectionWidget(a,args,widget);
        if(collection)return collection;
        if(a==="StringJoiner" && args.length===1 && typeof args[0]==="string")
          return {type:"stringJoiner",delimiter:args[0],parts:[]};
        if(a==="SlotGroup" && args.length===2 && typeof args[0]==="string" && Number.isInteger(args[1]) && args[1]>0)
          return {type:"slotGroup"};
        const pageObject=newPageObject(a,args,widget,localValue,location);
        if(pageObject)return pageObject;
        if(a==="Rectangle") return rect(0xffffffff);
        if(a==="DynamicDrawable") return {type:"dynamic",value:args[0]};
        if(["IntSyncValue","LongSyncValue","BooleanSyncValue","StringSyncValue","DoubleSyncValue","FloatSyncValue"].includes(a))
          return {type:"sync",get:args[0],set:args[1]};
        if(["IntValue","LongValue","BoolValue","DoubleValue","FloatValue"].includes(a) && args.length===1)
          return localValue(args[0],location);
        if(["IntValue.Dynamic","LongValue.Dynamic","BoolValue.Dynamic","DoubleValue.Dynamic","FloatValue.Dynamic"].includes(a) && args.length===2)
          return {type:"sync",local:true,get:args[0],set:args[1]};
        if(["ModularPanel","DrawableWidget","IDrawable.DrawableWidget","ParentWidget","ButtonWidget","ToggleButton","CycleButtonWidget","SliderWidget","ItemSlot","FluidSlot","TextWidget","TextFieldWidget"].includes(a)) {
          if(["ItemSlot","FluidSlot"].includes(a) && args.length)throw Error("Unsupported slot constructor "+a);
          const w=widget(a.replace("IDrawable.","")); if(a==="ModularPanel")w.id=args[0];
          if(c?.length)w.customInteraction=true;
          if(a==="FluidSlot")w.contentPadding=[1,1,1,1];
          if(a==="TextWidget")w.text=args[0];if(w.widget==="DrawableWidget")w.drawable=args[0];return w;
        }
        if(Object.hasOwn(classes,a) && !args.length) return ref(a);
        throw Error("Unsupported constructor "+a);
      }
      case "METHOD_INVOCATION": {
        const explicit=a[0]==="MEMBER_SELECT",name=explicit?a[3]:a[2];
        const obj=explicit?visit(a[2],env,owner):ref(memberOwner(owner,"methods",name+"/"+b.length) ??
          importedOwner(owner,name,"methods",b.length) ?? owner);
        if(pressReplay)return call(obj,name,b.map(arg=>visit(arg,env,owner)));
        // These arguments select the container inventory / tank; the preview reads its explicit snapshot.
        if((obj?.widget==="ItemSlot" && ["slot","syncHandler"].includes(name)) ||
          (obj?.widget==="FluidSlot" && ["tank","syncHandler"].includes(name))){
          if(b.length<1 || b.length>2)throw Error("Unsupported "+obj.widget+"."+name+" with "+b.length+" arguments.");
          obj.boundSlot=true;
          if(obj.widget==="FluidSlot" && name==="syncHandler" && b.length===1) {
            let base=b[0];
            while(base?.[0]==="METHOD_INVOCATION" && base[2]?.[0]==="MEMBER_SELECT")base=base[2][2];
            if(base?.[0]==="NEW_CLASS" && base[2]==="FluidSlotSyncHandler" ||
              base?.[0]==="IDENTIFIER" && env.get(base[2])?.type==="slotBinding")obj.slotBinding=visit(b[0],env,owner);
          }
          return obj;
        }
        if(obj?.type==="slotBinding" && obj.bindingClass==="FluidSlotSyncHandler" && b.length===1 &&
          ["setChangeListener","canFillSlot","canDrainSlot","phantom","filter"].includes(name))return obj;
        if(obj?.type==="widget" && name==="tooltipShowUpTimer") return obj;
        if(obj?.type==="texture" && name==="name") return obj;
        const args=b.map(v=>visit(v,env,owner));
        location=owner+":"+line;
        return call(obj,name,args);
      }
      case "EMPTY_STATEMENT": return;
      default: if(b) return operator(k,visit(a,env,owner),visit(b,env,owner));
    }
    throw Error("Unsupported Java expression "+k);
  }
  function call(obj,name,args) {
    const [a,b,c,d]=args,key=obj?.ref,full=key+"."+name;
    if(pressReplay){
      if(memberOwner(key,"methods",name+"/"+args.length) || java.adapters?.[full+"/"+args.length])return method(key,name,args);
      if(!args.length && Object.hasOwn(state.bindings??{},full))return state.bindings[full];
      if(obj?.type==="sync"){
        const target=targetOf(obj),pending=target && pressReplay.assignments.get(target.group+":"+target.key);
        if(!args.length && ["getIntValue","getBoolValue","getBooleanValue"].includes(name))return pending?pending.after:readValue(obj);
        if(target && ["setIntValue","setBoolValue","setBooleanValue"].includes(name) && args.length===3 && b===true && c===true)
          return pressWrite(target,a);
      }
      if(!(key==="Math" && ["min","max","abs"].includes(name)) &&
        !(Array.isArray(obj) && ["size","get"].includes(name)))throw Error("Unmodeled source button call "+full);
    }
    const snapshotResult=snapshotCall(obj,name,args);
    if(snapshotResult!==noSnapshotCall)return snapshotResult;
    if(hoverSender && obj===hoverSender && name==="isHovering" && !args.length)return obj.hovering;
    if(hoverSender && obj?.type==="sync" && obj.c2s && name==="setIntValue" && args.length===3 && Number.isInteger(a) && b===true && c===true){
      hoverSync.set(obj,a);return;
    }
    const pageResult=pageCall(obj,name,args,readValue,functions);
    if(pageResult!==unusedPageCall)return pageResult;
    if(Array.isArray(obj) && name==="size" && !args.length)return obj.length;
    if(obj?.type==="slotGroup" && name==="setAllowSorting" && args.length===1 && typeof a==="boolean")return obj;
    if(key==="$sync" && name==="registerSlotGroup" && args.length===1 && a?.type==="slotGroup")return;
    if(obj?.widget==="Grid" && name==="gridOfWidthHeight" && args.length===3){fillGrid(obj,a,b,c);return obj;}
    if(full==="Arrays.asList"){
      if(args.length===1 && Array.isArray(a))throw Error("Arrays.asList with an array argument requires its component type.");
      return [...args];
    }
    if(obj?.type==="stringJoiner"){
      if(name==="add" && args.length===1 && (a===null || typeof a==="string")){obj.parts.push(String(a));return obj;}
      if(name==="toString" && !args.length)return obj.parts.join(obj.delimiter);
    }
    if(typeof obj==="string"){
      if(name==="equals" && args.length===1)return obj===a;
      if(name==="length" && !args.length)return obj.length;
      if(name==="split" && args.length===1 && a==="\n"){
        const lines=obj.split("\n");
        if(obj.length)while(lines.at(-1)==="")lines.pop();
        return lines;
      }
      if(name==="isEmpty" && args.length===0)return obj.length===0;
      if(name==="replace" && args.length===2 && typeof a==="string" && typeof b==="string")return obj.split(a).join(b);
    }
    if(typeof obj==="function" && name==="applyAsInt" && args.length===1)return scalar(invoke(obj,[a]));
    if(full==="TextRenderer.getFontRenderer" && !args.length)return ref("$font");
    if(full==="$font.getStringWidth" && args.length===1 && typeof a==="string")return Math.trunc(measure(a,0,{scale:1}).width);
    if(obj?.type==="widget" && name==="getChildren" && !args.length)return obj.children;
    if(obj?.bindingClass==="FluidSlotSyncHandler" && name==="controlsAmount" && args.length===1 && typeof a==="boolean"){
      obj.controlsAmount=a;return obj;
    }
    if(full==="ItemSlot.create" && args.length===1 && a===false)return widget("ItemSlot");
    if(java.adapters?.[full+"/"+args.length])return method(key,name,args);
    if(full==="ButtonWidget.panelCloseButton" && !args.length){
      return {...widget("ButtonWidget"),themeId:"IThemeApi.CLOSE_BUTTON",y:4,right:4,
        overlay:[field("GuiTextures","CROSS_TINY")],closePanel:true};
    }
    if(memberOwner(key,"methods",name+"/"+args.length))return method(key,name,args);
    if(Object.hasOwn(state.bindings ?? {},full) && !args.length) return state.bindings[full];
    if(obj===activeSkin && !args.length) {
      const styleKey={getColor:"color",getTextColor:"textColor",getIconColor:"iconColor",getTextShadow:"textShadow"}[name];
      if(styleKey)return obj[styleKey]??theme[styleKey]??(styleKey==="textShadow"?false:styleKey==="textColor"?0xff404040:0xffffffff);
    }
    if(full==="System.nanoTime") return long(Math.trunc(scalar(request.timeMs??0)*1000000));
    if(full==="Math.floorMod") return ((a%b)+b)%b;
    if(key==="GuiDraw" && ["drawRect","drawHorizontalGradientRect","drawVerticalGradientRect"].includes(name)) {
      const colors=args.slice(4).map(scalar),geometry=args.slice(0,4).map(scalar);
      const draw=rect(colors[0]);
      if(name==="drawRect" && colors.length===4)draw.colors=colors;
      else if(name==="drawHorizontalGradientRect" && colors.length===2)draw.colors=[...colors,...colors];
      else if(name==="drawVerticalGradientRect" && colors.length===2)draw.colors=[colors[0],colors[0],colors[1],colors[1]];
      else if(name!=="drawRect" || colors.length!==1)throw Error("Unsupported "+full+" overload.");
      paint(draw,geometry);return;
    }
    if(key==="Math" && ["floor","ceil","min","max","abs","round","clamp"].includes(name)) {
      const numbers=args.map(scalar);
      if(name==="clamp" && (args.length!==3 || numbers[1]>numbers[2]))throw Error("Invalid Math.clamp bounds.");
      const value=name==="clamp"?Math.min(numbers[2],Math.max(numbers[1],numbers[0])):Math[name](...numbers);
      if(name==="floor" || name==="ceil")return floating(value);
      if(name==="round")return a?.javaType==="float"?value|0:long(value);
      if(args.some(isReal))return floating(value,!args.some(v=>v?.javaType==="double"));
      return args.some(v=>v?.javaType==="long")?long(value):value|0;
    }
    if(["getAsDouble","getAsInt","getAsLong","getAsBoolean","getValue","getIntValue","getLongValue","getDoubleValue","getFloatValue","getBooleanValue","getBoolValue","getStringValue"].includes(name)) {
      const v=readValue(obj);
      if(name==="getValue" && obj?.type==="sync")return v;
      if(["boolean","number","string"].includes(typeof v) || v instanceof Number) return name==="getAsDouble"?floating(v):v;
    }
    if(name==="findSyncHandler" && typeof a==="string") {
      if(syncValues.has(a))return syncValues.get(a);
      if(Object.hasOwn(state.sync??{},a))return {type:"sync",key:a};
      throw Error("Missing synchronized value "+a);
    }
    if(key==="$sync" && name==="syncValue" && b?.type==="sync"){
      b.key=a;syncValues.set(a,b);
      if(Object.hasOwn(state.sync??{},a))receiveSnapshot(b,functions.get(b.set));
      return;
    }
    if(obj?.type==="sync" && name==="allowC2S"){obj.c2s=args.length===0 || a===true;return obj;}
    if(full==="UITexture.builder") return texture();
    if(full==="UITexture.fullImage"){
      const t=texture(),colorType=args.at(-1)?.ref;
      if(colorType?.startsWith("ColorType."))call(t,"colorType",[args.at(-1)]);
      return call(t,"location",colorType?args.slice(0,-1):args);
    }
    if(full==="Flow.row" || full==="Flow.column" || full==="Flow.col") return {...widget(name==="col"?"column":name),wRel:1,hRel:1};
    if(full==="ModularPanel.defaultPanel") return {...widget("ModularPanel"),id:a,w:b??176,h:c??166};
    if(full==="IKey.str") return {type:"text",text:printable(a)};
    if(full==="IKey.lang" || full==="StatCollector.translateToLocal" || full==="StatCollector.translateToLocalFormatted") {
      if(typeof a!=="string") throw Error("Expected a localization key.");
      const translated=Object.hasOwn(state.language??{},a)?state.language[a]:a;
      let next=1;
      const s=translated.replace(/%%|%(?:(\d+)\$)?([sd])/g,(match,index)=>{
        if(match==="%%")return "%";
        const arg=args[index?Number(index):next++];
        if(arg===undefined)throw Error("Missing translation argument "+a);
        return printable(arg);
      });
      return key==="IKey"?{type:"text",text:s}:s;
    }
    if(full==="IKey.dynamic")return {type:"text",text:()=>printable(invoke(a))};
    if(obj?.type==="text" && ["color","scale","shadow","alignment"].includes(name)){
      const styled={...obj,styled:true};
      if(name==="alignment")styled.align=a.ref;
      else styled[name]=name==="scale"?scalar(a):a;
      return styled;
    }
    if(name==="asWidget" && (obj?.type || typeof obj==="function")) {
      if(obj.type==="text")return {...widget("TextWidget"),text:obj,color:obj.color,
        textAlign:obj.styled?obj.align??"Alignment.Center":undefined,textScale:obj.scale,shadow:obj.shadow};
      return {...widget("DrawableWidget"),drawable:obj};
    }
    if(name==="draw" && (obj?.type || typeof obj==="function")) {paint(obj,args.slice(1,5).map(scalar));return;}
    if(obj?.type==="rect") {
      if(name==="color") {obj.colors=args.length===1?Array(4).fill(a):args;}
      else if(name==="horizontalGradient") obj.colors=[a,b,a,b];
      else if(name==="verticalGradient") obj.colors=[a,a,b,b];
      else if(name==="hollow") obj.border=a??1;
      else if(name==="solid") obj.border=0;
      else if(name==="cornerRadius")obj.radius=Math.max(0,scalar(a));
      else if(name==="cornerSegments")obj.segments=scalar(a);
      else throw Error("Unsupported Rectangle."+name);
      return obj;
    }
    if(obj?.type==="texture") {
      switch(name) {
        case "location":
          if(!args.every(v=>typeof v==="string"))throw Error("Unresolved texture location: "+args.map(v=>v?.ref??v).join(":"));
          obj.resource=args.length===2?args.join(":"):a;break;
        case "imageSize":obj.imageSize=args.map(scalar);break;
        case "adaptable":obj.border=args.length===1?Array(4).fill(a):args.length===2?[a,b,a,b]:args;break;
        case "tiled":obj.tiled=true;if(args.length)obj.imageSize=args.map(scalar);break;
        case "xy":case "subAreaXYWH":obj.pixelUV=[a,b,a+c,b+d];break;
        case "uv":case "subAreaUV":obj.uv=args.map(scalar);break;
        case "canApplyTheme":case "defaultColorType":obj.colorType="color";break;
        case "textColorType":obj.colorType="textColor";break;
        case "iconColorType":obj.colorType="iconColor";break;
        case "colorType":{
          obj.colorType={"ColorType.DEFAULT":"color","ColorType.ICON":"iconColor","ColorType.TEXT":"textColor"}[a?.ref];
          if(!obj.colorType && a!==null)throw Error("Unsupported UITexture.ColorType: "+a?.ref);
          break;
        }
        case "nonOpaque":obj.blend=true;break;
        case "build":case "fullImage":break;
        default:throw Error("Unsupported UITexture."+name);
      }
      return obj;
    }
    if(obj?.type==="widget") {
      if(configureSlider(obj,name,args,scalar,isReal))return obj;
      switch(name) {
        case "size":obj.w=scalar(a);obj.h=scalar(b??a);delete obj.wRel;delete obj.hRel;break;
        case "width":obj.w=scalar(a);delete obj.wRel;break;case "height":obj.h=scalar(a);delete obj.hRel;break;
        case "pos":obj.x=scalar(a);obj.y=scalar(b);break;
        case "left":obj.x=scalar(a);break;case "top":obj.y=scalar(a);break;
        case "right":obj.right=scalar(a);break;case "bottom":obj.bottom=scalar(a);break;
        case "relative":if(obj.widget!=="ModularPanel")throw Error("External child layout reference requires a parent panel.");break;
        case "topRel":case "leftRel":case "rightRel":case "bottomRel":
          if(obj.widget!=="ModularPanel")throw Error("Unsupported relative child anchor: "+name);
          break; // Export the complete panel in its own coordinate system.
        case "widthRel":obj.wRel=scalar(a);break;case "heightRel":obj.hRel=scalar(a);break;
        case "sizeRel":obj.wRel=scalar(a);obj.hRel=scalar(b??a);break;
        case "fullWidth":obj.wRel=1;break;case "fullHeight":obj.hRel=1;break;
        case "full":obj.wRel=obj.hRel=1;break;
        case "expanded":if(args.length)throw Error("Unsupported expanded overload.");obj.expanded=true;break;
        case "collapseDisabledChild":obj.collapseDisabled=a??true;break;
        case "coverChildren":
          if(args.length>2)throw Error("Unsupported coverChildren overload.");
          obj.wCover=scalar(a??8);obj.hCover=scalar(b??a??8);
          delete obj.w;delete obj.h;delete obj.wRel;delete obj.hRel;break;
        case "coverChildrenHeight":case "coverChildrenWidth":{
          const axis=name==="coverChildrenWidth"?"w":"h";
          obj[axis+"Cover"]=scalar(a??8);delete obj[axis];delete obj[axis+"Rel"];break;
        }
        case "name":obj.id=printable(a);break;case "widgetTheme":obj.themeId=a?.ref??a;break;
        case "padding":case "margin":case "contentPadding":
          if(![1,2,4].includes(args.length))throw Error("Expected one, two or four values for "+name);
          obj[name]=args.length===4?[a,c,b,d].map(scalar):[scalar(a),scalar(b??a),scalar(a),scalar(b??a)];break;
        case "contentPaddingLeft":case "contentPaddingRight":case "contentPaddingTop":case "contentPaddingBottom":
        case "paddingLeft":case "marginLeft":case "paddingTop":case "marginTop":
        case "paddingRight":case "marginRight":case "paddingBottom":case "marginBottom":{
          const [,property,edge]=/^(padding|margin|contentPadding)(Left|Top|Right|Bottom)$/.exec(name);
          obj[property][["Left","Top","Right","Bottom"].indexOf(edge)]=scalar(a);break;
        }
        case "mainAxisAlignment":case "crossAxisAlignment":obj[name]=a.ref.split(".").pop();break;
        case "childPadding":obj.gap=scalar(a);break;
        case "child":obj.children.push(...args);break;
        case "childIf":if(typeof a!=="boolean")throw Error("Unresolved childIf condition.");if(a)obj.children.push(invoke(b));break;
        case "background":case "backgroundOverlay":case "selectedBackground":case "overlay":
        case "hoverBackground":case "hoverBackgroundOverlay":case "selectedHoverBackground":case "hoverOverlay":{
          const property={backgroundOverlay:"background",hoverBackgroundOverlay:"hoverBackground",
            selectedBackground:"background",selectedHoverBackground:"hoverBackground"}[name]??name;
          const selected=name.startsWith("selected");
          const indexed=obj.widget==="ToggleButton" && (selected || typeof a==="boolean");
          if(indexed) (obj.stateLayers??={})[property+Number(selected||a)]=selected?args:args.slice(1);
          else obj[property]=args;
          if(["background","selectedBackground"].includes(name))obj.disableTheme=true;
          if(["hoverBackground","selectedHoverBackground"].includes(name) ||
            obj.widget==="ToggleButton" && name==="hoverBackgroundOverlay")obj.disableHoverTheme=true;
          break;
        }
        case "disableThemeBackground":obj.disableTheme=a;break;
        case "disableHoverThemeBackground":obj.disableHoverTheme=a;break;
        case "disableHoverBackground":obj.hoverBackground=null;obj.disableHoverTheme=true;break;
        case "disableHoverOverlay":obj.hoverOverlay=null;break;
        case "alwaysShowFull":case "flipLighterThanAir":obj[name]=a;break;
        case "contentOffset":obj.contentPadding[0]=scalar(a);obj.contentPadding[1]=scalar(b);break;
        case "overlayTexture":obj.overlay=[a];break;
        case "fluidUnit":
          if(typeof a!=="string" || !["SIPrefix.One","SIPrefix.Milli"].includes(b?.ref))throw Error("Unsupported fluidUnit.");
          obj.fluidUnit=a;obj.unitMultiplier=b.ref==="SIPrefix.Milli" ? 0.001 : 1;break;
        case "invisible":
          obj.disableTheme=true;obj.disableHoverTheme=true;obj.hoverBackground=null;
          // ModularPanel.canHover() excludes the invisible host itself. Its children still receive input.
          if(obj.widget==="ModularPanel")obj.invisiblePanel=true;
          break;
        case "invertSelected":obj.invertSelected=a;break;
        case "value":obj.value=a;break;
        case "horizontalCenter":obj.cx=true;break;case "verticalCenter":obj.cy=true;break;
        case "center":obj.cx=obj.cy=true;break;
        case "align":obj.align=a.ref;break;
        case "textAlign":case "setTextAlignment":obj.textAlign=a.ref;break;
        case "scale":case "setScale":obj.textScale=scalar(a);break;
        case "maxWidth":obj.maxWidth=scalar(a);break;
        case "color":case "setTextColor":obj.color=a;break;case "shadow":obj.shadow=a??true;break;
        case "setMarkedColor":obj.markedColor=scalar(a);break;
        case "setMaxLength":obj.maxLength=scalar(a);break;
        case "setTooltipOverride":obj.tooltipOverride=a;break;
        case "showScrollShadows":obj.showScrollShadows=a;break;
        case "formatAsInteger":case "setFormatAsInteger":obj.formatInteger=a;break;
        case "acceptsExpressions":obj.acceptsExpression=a;break;
        case "autoUpdateOnChange":obj.autoUpdateOnChange=a;break;
        case "defaultNumber":case "setDefaultNumber":obj.defaultNumber=scalar(a);break;
        case "onMousePressed":case "onMouseReleased":obj[name]=a;break;
        case "onUpdateListener":
          if(!hoverIndexListener(functions.get(a)))throw Error("Unsupported widget update listener.");
          obj.hoverListener=a;break;
        case "setEnabled":case "setEnabledIf":obj.enabled=a;break;
        case "tooltipAutoUpdate":break;
        case "stateCount":case "length":
          if(obj.widget!=="CycleButtonWidget" || !Number.isInteger(a) || a<1 || a>256)throw Error("Unsupported cycle state count.");
          obj.stateCount=a;break;
        case "stateBackground":case "stateHoverBackground":case "stateOverlay":case "stateHoverOverlay":{
          const index=typeof a==="boolean"?Number(a):a;
          if(obj.widget!=="CycleButtonWidget" || !Number.isInteger(index) || index<0 || index>255)throw Error("Unsupported cycle state.");
          const prop=name[5].toLowerCase()+name.slice(6);
          (obj.stateLayers??={})[prop+index]=args.slice(1);obj.impliedStates=Math.max(obj.impliedStates??1,index+1);
          if(prop==="background")obj.disableTheme=true;
          if(prop==="hoverBackground")obj.disableHoverTheme=true;
          break;
        }
        case "numbersInt":case "numbersLong":case "setNumbers":case "numbersDouble":
          obj.integer=name!=="numbersDouble";obj.numberMode=name;obj.boundArgs=args;
          if(["numbersInt","numbersLong"].includes(name) && args.length>=2)obj.formatInteger=true;
          if(!obj.wheel?.enabled && name.startsWith("numbers") && obj.integer)
            obj.wheel={base:1,shift:100,ctrl:10000,alt:1000000,enabled:false};
          break;
        case "scrollValues":case "setScrollValues":
          if(args.length!==(name==="scrollValues"?4:3))throw Error("Unsupported scrollValues signature.");
          obj.wheel={base:scalar(a),shift:scalar(name==="scrollValues"?b:c),ctrl:scalar(name==="scrollValues"?c:b),alt:d==null?0:scalar(d),enabled:true};break;
        case "usingScrollStep":
          obj.wheel={base:1,shift:100,ctrl:0.1,alt:10000,...obj.wheel,enabled:a??true};break;
        case "tooltipBuilder":case "tooltip":
          if(obj.widget==="TextFieldWidget")obj.tooltipOverride=true;
          if(obj.widget==="ToggleButton" && typeof a==="boolean" || obj.widget==="CycleButtonWidget" && Number.isInteger(a))(obj.stateTips??={})[Number(a)]=b;
          else obj.tip=a;
          break;
        default:throw Error("Unsupported "+obj.widget+"."+name);
      }
      return obj;
    }
    if(obj?.type==="tip" && ["addLine","add"].includes(name)){
      const line=readValue(a?.text??a);
      if(typeof line!=="string")throw Error("Expected tooltip text.");
      obj.lines.push(line);return obj;
    }
    throw Error("Unsupported call "+(key??obj?.type??"value")+"."+name);
  }
  function resolve(v) {
    if(typeof v==="string") {
      const [owner,member]=v.split(".");
      return field(owner,member);
    }
    return v;
  }
  function documentationId(w) {
    const base=w.id??("widget-"+usedIds.size);
    let id=base,serial=1;
    while(usedIds.has(id)) id=base+"-"+(++serial);
    usedIds.add(id);
    return id;
  }
  function indexWidgets(w,panelId) {
    if(w?.type!=="widget")return;
    const id=documentationId(w);widgetIds.set(w,id);
    if(w.widget==="ModularPanel")panelId=id;
    if(w.closePanel)w.ownerPanel=panelId;
    if(w.widget==="PagedWidget")initializePager(w,id,readValue);
    if(["ItemSlot","FluidSlot"].includes(w.widget))slotIds.add(id);
    w.children.forEach(child=>indexWidgets(child,panelId));
  }
  function skinFor(w) {
    if(w.themeId && !Object.hasOwn(theme,w.themeId))throw Error("Missing widget theme "+w.themeId);
    const widgetTheme=w.widget==="PageButton"?"ToggleButton":w.widget==="CycleButtonWidget"?"ButtonWidget":w.widget;
    return {...theme[widgetTheme],...theme[w.themeId]};
  }
  function numberControl(w,target) {
    if(!w.numberMode)return null;
    const current=readValue(w.value);
    if(typeof current!=="number" && !(current instanceof Number))return null;
    let min,max;
    if(w.numberMode==="numbersInt" || w.numberMode==="setNumbers"){min=-2147483648;max=2147483647;}
    if(w.boundArgs.length===2 && w.numberMode!=="numbersDouble"){
      if(w.boundArgs[0]!=null)min=scalar(readValue(w.boundArgs[0]));
      if(w.boundArgs[1]!=null)max=scalar(readValue(w.boundArgs[1]));
    }else if(w.boundArgs.length)return null; // Arbitrary Java validator.
    if(min>max)throw Error("Numeric field minimum exceeds maximum.");
    return {kind:"number",target,value:scalar(current),min,max,integer:w.integer,
      rounding:w.integer?(w.numberMode==="setNumbers"?"truncate":"round"):"none",bounds:"clamp",step:w.integer?1:undefined,
      numberMode:w.numberMode,autoUpdateOnChange:w.autoUpdateOnChange??false,
      acceptsExpression:w.acceptsExpression??true,defaultNumber:w.defaultNumber??0,
      maxLength:w.maxLength>=0?w.maxLength:undefined,
      relativeToMax:["numbersInt","numbersLong"].includes(w.numberMode) && w.boundArgs[1]!=null,
      wheel:{base:1,shift:100,ctrl:0.1,alt:10000,enabled:false,...w.wheel,requiresFocus:true},enabled:true};
  }
  // Recognize an entire press callback before exposing any of its writes. Never invoke it.
  function pressControl(fn) {
    const cb=functions.get(fn);
    if(cb?.body?.[0]!=="BLOCK")return null;
    const statements=cb.body[2],last=statements.at(-1);
    if(last?.[0]!=="RETURN" || last[2]?.[0]!=="BOOLEAN_LITERAL" || !last[2][2])return null;
    let control,button;const writes=[],pending=new Map();
    const unwrap=n=>n?.[0]==="PARENTHESIZED"?unwrap(n[2]):n;
    let scope=cb;
    const receiver=n=>{
      if(n?.[0]==="IDENTIFIER")return scope.env.has(n[2])?scope.env.get(n[2]):field(scope.owner,n[2]);
      if(n?.[0]==="MEMBER_SELECT" && n[2][0]==="IDENTIFIER" && n[2][2]==="this")return field(scope.owner,n[3]);
      return null;
    };
    const pageChoice=pageCallbackChoice(cb,receiver,readValue,targetOf);
    if(pageChoice)return pageChoice;
    const accessor=(n,methodNames,arity)=>{
      if(n?.[0]!=="METHOD_INVOCATION" || !arity.includes(n[3].length) || n[2][0]!=="MEMBER_SELECT")return null;
      if(!methodNames.includes(n[2][3]))return null;
      const v=receiver(n[2][2]);return v?.type==="sync"?v:null;
    };
    for(const stmt of statements.slice(0,-1)){
      scope=cb;
      if(stmt===statements[0] && stmt[0]==="IF"){
        const test=unwrap(stmt[2]),body=stmt[3][0]==="BLOCK" && stmt[3][2].length===1?stmt[3][2][0]:stmt[3];
        if(test?.[0]!=="NOT_EQUAL_TO" || test[2][0]!=="IDENTIFIER" || test[2][2]!==cb.params[0] ||
          test[3][0]!=="INT_LITERAL" || ![0,1].includes(test[3][2]) || body[0]!=="RETURN" ||
          body[2]?.[0]!=="BOOLEAN_LITERAL" || body[2][2]!==false || stmt[4])return null;
        button=test[3][2];continue;
      }
      if(stmt[0]!=="EXPRESSION_STATEMENT")return null;
      let n=stmt[2];
      if(n[0]==="METHOD_INVOCATION" && n[2][3]==="run" && n[3].length===0){
        scope=functions.get(receiver(n[2][2]));
        if(!scope || scope.params?.length!==0)return null;
        n=scope.body;
        if(n[0]==="BLOCK"){
          if(n[2].length!==1 || n[2][0][0]!=="EXPRESSION_STATEMENT")return null;
          n=n[2][0][2];
        }
      }
      const dest=accessor(n,["setValue","setBoolValue","setBooleanValue","setIntValue","setLongValue","setDoubleValue"],[1,3]);
      const target=targetOf(dest);if(!target)return null;
      if(n[3].slice(1).some(flag=>flag[0]!=="BOOLEAN_LITERAL" || !flag[2]))return null;
      let arg=n[3][0];const invert=arg[0]==="LOGICAL_COMPLEMENT";
      if(invert)arg=arg[2];
      const from=accessor(arg,["getValue","getBoolValue","getBooleanValue","getIntValue","getLongValue","getDoubleValue"],[0]);
      const raw=from?(pending.has(from)?pending.get(from):readValue(from)):
        arg[0].endsWith("_LITERAL")?arg[2]:arg[0]==="IDENTIFIER"?receiver(arg):undefined;
      if(invert && typeof raw!=="boolean" || !["number","boolean"].includes(typeof raw) && !(raw instanceof Number))return null;
      const value=invert?!raw:raw instanceof Number?+raw:raw;
      if(!control){
        if(invert && from===dest)control={kind:"toggle",target,value:raw,enabled:true};
        else if(!invert)control={kind:"choice",target,value:readValue(dest),choice:value,enabled:true};
        else return null;
      }else{
        if(dest===from && invert || target.group===control.target.group && target.key===control.target.key)return null;
        writes.push({target,value});
      }
      pending.set(dest,value);
    }
    if(control && button!=null)control.button=button;
    if(writes.length)control.writes=writes;
    return control;
  }
  function pressWrite(target,after){
    const before=state[target.group]?.[target.key];
    if(!Object.hasOwn(state[target.group]??{},target.key) || !(typeof before==="boolean" && typeof after==="boolean" ||
      Number.isSafeInteger(before) && Number.isSafeInteger(after)))throw Error("Declare a primitive button binding for "+target.key);
    pressReplay.assignments.set(target.group+":"+target.key,{target,before,after});return after;
  }
  function sourcePress(w){
    const callback=functions.get(w.onMousePressed),stmt=pressStatement(callback);
    if(!stmt)return null;
    const previousLocation=location;
    pressReplay={remaining:1024,assignments:new Map(),methods:new Set()};
    try{
      visit(stmt,new Map(callback.env),callback.owner);
      if(!pressReplay.methods.size)return null;
      for(const name of pressReplay.methods)methods.add(name);
      return {kind:"press",enabled:true,assignments:[...pressReplay.assignments.values()],methods:[...pressReplay.methods]};
    }catch(error){w.pressReason=error.message;return null;}
    finally{pressReplay=null;location=previousLocation;}
  }
  function controlFor(w,selected) {
    if(w.customInteraction || w.onMouseReleased)return null;
    if(w.closePanel && !w.onMousePressed){
      if(!w.ownerPanel)throw Error("panelCloseButton requires a containing ModularPanel.");
      return {kind:"choice",target:{group:"bindings",key:"$closedPanel."+w.ownerPanel},value:false,choice:true,enabled:true};
    }
    if(w.widget==="ButtonWidget")return pressControl(w.onMousePressed)??sourcePress(w);
    if(w.onMousePressed)return null;
    const target=targetOf(w.value);
    if(!target)return null;
    if(w.widget==="TextFieldWidget")return numberControl(w,target);
    if(w.widget==="ToggleButton")return {kind:"toggle",target,value:selected,enabled:true};
    if(w.widget==="CycleButtonWidget")return {kind:"cycle",target,value:selected,enabled:true,
      options:Array.from({length:w.stateCount??w.impliedStates??1},(_,index)=>index)};
    return null;
  }
  function decoratedNumber(w,raw){
    const text=String(raw);
    if(w.formatInteger && /^[+-]?\d+$/.test(text)) {
      const number=BigInt(text);
      if(BigInt.asIntN(64,number)===number)return number.toLocaleString(request.locale??"en-US");
    }
    return text;
  }
  function textValue(w){
    if(w.widget==="TextFieldWidget") {
      const v=readValue(w.value??"");
      if(!["number","string"].includes(typeof v) && !(v instanceof Number))throw Error("Expected synchronized text or number.");
      return decoratedNumber(w,v);
    }
    const text=readValue(w.text?.text??w.text);
    if(typeof text!=="string")throw Error("Expected widget text in "+w.widget);
    return text;
  }
  function textSize(w,maxWidth) {
    if(!measure)throw Error("Font measurement is required for "+w.widget);
    return measure(textValue(w),maxWidth,{scale:w.textScale??1});
  }
  function emitText(w,box,skin,id,record){
    const [x,y,width,height]=box,[left,top,right,bottom]=w.padding;
    const field=w.widget==="TextFieldWidget",scale=w.textScale??1;
    const paddedW=width-left-right;
    const maxWidth=paddedW+(field?0:scale);
    const edit=field && state.edit?.id===id?state.edit:null;
    const control=record.control;
    if(edit && (typeof edit.text!=="string" || /[\r\n]/.test(edit.text) || edit.text.length>4096 ||
        ![edit.anchor,edit.caret].every(pos=>Number.isInteger(pos) && pos>=0 && pos<=edit.text.length)))
      throw Error("Invalid single-line draft text or cursor for "+id);
    const text=edit?decoratedNumber(w,edit.text):textValue(w);
    if(w.scrollingText && textSize(w,0).width>paddedW)throw Error("Overflowing ScrollingTextWidget requires marquee rendering.");
    const measured=edit?measure(text,0,{scale}):textSize(w,field?0:maxWidth);
    const scrollSize=field?Math.round(measured.width):0,maxScroll=Math.max(0,scrollSize-width);
    if(field){
      if(!w.tooltipOverride && !maxScroll)record.tooltip=[];
      else if(maxScroll && !w.tip && !w.tooltipOverride)record.tooltip=[edit?.text??String(readValue(w.value??""))];
    }
    const paddedH=height-top-bottom-(maxScroll?4:0);
    const clip=field?[x+1,y+1,width-2,height-2]:null,firstOp=ops.length;
    const align=w.textAlign??"Alignment.CenterLeft",color=readValue(w.color)??skin.textColor??theme.textColor??0xff404040;
    let cursor,scroll=0;
    if(edit){
      const ax=align.endsWith("Left")?0:align.endsWith("Right")?1:0.5;
      const ay=align.includes("Top")?0:align.includes("Bottom")?1:0.5;
      const startX=left+Math.max(0,Math.round(paddedW*ax)-Math.round(measured.width*ax));
      const startY=top+Math.round(paddedH*ay)-Math.round(8*scale*ay);
      const sep=new Intl.NumberFormat(request.locale??"en-US").formatToParts(1000).find(part=>part.type==="group")?.value;
      if(control){
        const stops=[x+startX],thresholds=[],advances=new Map();let cx=x+startX;
        for(let i=0;i<text.length;i++){
          const c=text[i];
          if(!advances.has(c))advances.set(c,measure(c,0,{scale}).width);
          const delta=advances.get(c);
          if(!w.formatInteger || c!==sep){thresholds.push(cx+delta/2);stops.push(cx+delta);}
          cx+=delta;
        }
        control.caretStops=stops;control.caretThresholds=thresholds;
      }
      const pos=offset=>{
        let end=Math.min(text.length,offset),i=0,skipped=0;
        if(w.formatInteger)while(i<end && i+skipped<text.length){
          if(text[i+skipped]===sep)skipped++;else i++;
        }
        return startX+measure(text.slice(0,Math.min(text.length,end+skipped)),0,{scale}).width;
      };
      const caret=pos(edit.caret);
      if(maxScroll){
        // TextFieldHandler.setMainCursor centers the raw (undecorated) cursor after its scroll animation.
        const rawWidth=measure(edit.text,0,{scale}).width;
        const rawStart=left+Math.max(0,Math.round(paddedW*ax)-Math.round(rawWidth*ax));
        const desired=Math.trunc(rawStart+measure(edit.text.slice(0,edit.caret),0,{scale}).width)-Math.trunc(width/2);
        const requested=edit.scrollX??desired;
        if(!Number.isInteger(requested))throw Error("Numeric field scrollX must be a logical pixel offset.");
        scroll=Math.max(0,Math.min(maxScroll,requested));
      }
      if(control){control.scrollX=scroll;control.maxScrollX=maxScroll;
        control.caretStops=control.caretStops.map(v=>v-scroll);control.caretThresholds=control.caretThresholds.map(v=>v-scroll);}
      if(edit.anchor!==edit.caret){
        const anchor=pos(edit.anchor);
        const marked=(w.markedColor??skin.markedColor??0xff2f72a8)>>>0;
        paint(rect(marked>>>24?marked:(marked|0xff000000)>>>0),
          [x+Math.min(caret,anchor)*scale,y+(startY-1)*scale,Math.abs(caret-anchor)*scale,9*scale*scale]);
      }
      if(edit.showCaret!==false)cursor=[x+caret+(edit.text.length?0:0.7)-0.8,y+startY-1,0.6*scale,9*scale];
    }
    ops.push({type:"text",text,scale,
      lines:measured.lines,maxWidth,align,color,
      shadow:w.shadow??(!field && (skin.textShadow??theme.textShadow??false)),
      box:[x+left,y+top,paddedW,paddedH]});
    if(cursor)paint(rect((color>>>24)?color:color|0xff000000),cursor);
    if(clip)for(const op of ops.slice(firstOp)){op.clip=clip;op.box[0]-=scroll;}
    if(maxScroll)drawFieldScrollbar(w,box,scroll,scrollSize);
  }
  function drawFieldScrollbar(w,box,scroll,scrollSize){
    const [x,y,width,height]=box,thickness=4;
    const length=Math.max(5,Math.trunc(Math.fround(width*width/scrollSize)));
    const left=x+Math.trunc((width-length)*scroll/(scrollSize-width)),top=y+height-thickness;
    paint(rect(0x3f000000),[x,top,width,thickness]);
    const skin=theme.Scrollbar??{},tint=skin.color??theme.color??0xffffffff;
    const mix=shade=>{
      let n=tint&0xff000000;
      for(const shift of [0,8,16])n|=Math.trunc(((tint>>>shift)&255)*shade/255)<<shift;
      return n>>>0;
    };
    if(skin.background)paint(skin.background,[left,top,length,thickness]);
    else {
      // IThemeApi.SCROLLBAR defaults to Scrollbar.VANILLA. At 4px high the optional stripes have zero height.
      paint(rect(mix(238)),[left,top,length,thickness]);
      paint(rect(mix(102)),[left+1,top+1,length-1,thickness-1]);
      paint(rect(mix(170)),[left+1,top+1,length-2,thickness-2]);
    }
    if(w.showScrollShadows===false)return;
    for(const [atLeft,distance] of [[true,scroll],[false,scrollSize-width-scroll]]){
      const progress=Math.min(1,distance/30),extent=Math.min(Math.trunc(progress*12),Math.trunc(width/3));
      if(!extent)continue;
      const color=(Math.trunc(progress*.8*255)<<24)|0x202020,shades=atLeft?[color,0]:[0,color];
      paint({type:"rect",colors:[...shades,...shades]},[atLeft?x:x+width-extent,y,extent,height-thickness]);
    }
  }
  function paint(v,box,uiTexture=true) {
    v=resolve(v);
    if(v?.missingTexture)throw Error("No source texture builder registered with id "+v.missingTexture);
    if(Array.isArray(v)){layer(v,box);return;}
    if(!v || ["IDrawable.EMPTY","IDrawable.NONE"].includes(v.ref)) return;
    if(typeof v==="function"){invoke(v,[null,...box,activeSkin]);return;}
    if(v.type==="dynamic"){paint(invoke(v.value),box);return;}
    if(v.type==="widget"){layout(v,box);return;}
    if(v.type==="rect" || v.type==="texture" || v.type==="text"){
      if(v.type==="texture" && typeof v.resource!=="string") throw Error("Unresolved texture resource.");
      if(v.type==="text"){
        if(!measure)throw Error("Font measurement is required for IKey.");
        const text=readValue(v.text),scale=v.scale??1,measured=measure(text,box[2],{scale});
        ops.push({type:"text",text,box,scale,lines:measured.lines,maxWidth:box[2],align:v.align??"Alignment.Center",
          color:readValue(v.color)??activeSkin.textColor??theme.textColor??0xff404040,
          shadow:v.shadow??activeSkin.textShadow??theme.textShadow??false});return;
      }
      const op={...v,box};
      if(v.type==="texture") {
        if(v.colorType)op.tint=activeSkin[v.colorType]??theme[v.colorType]??0xffffffff;
        if(uiTexture && textureQuadMode)op.textureQuadMode=textureQuadMode;
      }
      ops.push(op);
      return;
    }
    throw Error("Unresolved drawable "+JSON.stringify(v));
  }
  function layer(list,box) {for(const v of list??[]) paint(v,box);}
  function slotLabel(slot) {
    if(!slot.label)return;
    if(!measure)throw Error("The MUI2 slot amount requires font measurement.");
    const box=slot.labelBox,width=box[2],natural=measure(slot.label,0,{scale:1}).width;
    const scale=slot.label.length>2 && width>16?Math.min(1,Math.fround(width/natural)):1;
    const lines=measure(slot.label,0,{scale}).lines;
    ops.push({type:"text",text:slot.label,box,textPos:slot.textPos,lines,maxWidth:width,scale,shadow:true,color:0xffffffff,align:"Alignment.BottomRight"});
  }
  function dimensions(child,parentBox,padding,measureContent=true) {
    // ItemSlot.onInit() fixes both dimensions even when the caller requested another size.
    if(child.widget==="ItemSlot")return [18,18];
    const [l,t,r,b]=padding,[left,top,right,bottom]=child.margin;
    const availableW=parentBox[2]-l-r-left-right, availableH=parentBox[3]-t-b-top-bottom;
    let w=child.wRel!=null?Math.trunc(availableW*child.wRel):child.w;
    let h=child.hRel!=null?Math.trunc(availableH*child.hRel):child.h;
    // Collapse mode excludes intrinsic measurements for disabled children. Explicit dimensions
    // remain available in their hidden records without evaluating their content suppliers.
    if(!measureContent)return [w??0,h??0];
    if(child.widget==="Grid"){
      if(child.children.some(c=>(w==null && c.wRel!=null)||(h==null && c.hRel!=null)))
        throw Error("Grid cover dimensions require independent child dimensions.");
      const metrics=gridMetrics(child,(c,visible)=>dimensions(c,[0,0,w??availableW,h??availableH],child.padding,visible),enabledValue);
      return [w??Math.max(child.wCover??0,metrics.width),h??Math.max(child.hCover??0,metrics.height)];
    }
    if(child.wCover!=null || child.hCover!=null) {
      const axis=child.widget==="column"?1:0,pad=child.padding;
      if(!["row","column"].includes(child.widget) || (child.mainAxisAlignment??"START")!=="START")
        throw Error("coverChildren requires a start-aligned flow.");
      const children=child.collapseDisabled?child.children.filter(c=>enabledValue(c)):child.children;
      if(children.some(c=>c.align || child.wCover!=null && (c.wRel!=null || c.x!=null || c.right!=null || c.cx) ||
        child.hCover!=null && (c.hRel!=null || c.y!=null || c.bottom!=null || c.cy)))
        throw Error("coverChildren requires independent child dimensions along each covered axis.");
      const needed=[0,0];needed[axis]=(child.gap??0)*Math.max(0,children.length-1);
      for(const c of children){
        const wh=dimensions(c,[0,0,w??availableW,h??availableH],pad).map((n,i)=>n+c.margin[i]+c.margin[i+2]);
        needed[axis]+=wh[axis];needed[1-axis]=Math.max(needed[1-axis],wh[1-axis]);
      }
      if(child.wCover!=null)w=Math.max(child.wCover,needed[0]+pad[0]+pad[2]);
      if(child.hCover!=null)h=Math.max(child.hCover,needed[1]+pad[1]+pad[3]);
    }
    if(child.widget==="TextWidget" && (w==null || h==null)){
      const [pl,pt,pr,pb]=child.padding;
      w??=Math.max(1,Math.ceil(textSize(child,child.maxWidth>0?Math.max(5,child.maxWidth):parentBox[2]).width+pl+pr));
      h??=Math.max(1,Math.ceil(textSize(child,w+(child.textScale??1)).height+pt+pb));
    }
    const skin=skinFor(child);
    w??=skin.width??(child.widget==="TextFieldWidget"?56:18);
    h??=skin.height??18;
    if(![w,h].every(n=>Number.isInteger(n)&&n>=0))throw Error("Invalid dimensions for "+child.widget);
    return [w,h];
  }
  function alignmentOf(n) {
    return n?.split(".").pop().replaceAll("_","").toLowerCase()??"";
  }
  function enabledValue(w){return w.pageVisible===false?false:typeof w.enabled==="function"?invoke(w.enabled,[w]):w.enabled??true;}
  function layout(w,box,enabled=enabledValue(w),parentId) {
    if(w?.type!=="widget") throw Error("Expected a widget child.");
    const [x,y,width,height]=box,[pl,pt,pr,pb]=w.padding, id=widgetIds.get(w)??documentationId(w);
    if(w.widget==="ModularPanel" && state.bindings?.["$closedPanel."+id]===true)enabled=false;
    if(typeof enabled!=="boolean")throw Error("Unresolved enabled condition for "+id);
    if(!enabled){widgets.push({id,type:w.widget,box,visible:false,enabled:false,hoverable:false,tooltip:[]});return;}
    const hover=!w.invisiblePanel && state.hover===id,skin=skinFor(w);
    if(w.hoverListener){
      hoverSender=w;w.hovering=hover;
      try {invoke(w.hoverListener,[w]);} finally {hoverSender=null;}
    }
    const toggle=w.widget==="ToggleButton",cycle=w.widget==="CycleButtonWidget";
    if((toggle || cycle) && !w.value)w.value=localValue(toggle?false:0,"widget."+id);
    if(w.widget==="TextFieldWidget" && w.numberMode && !w.value){
      w.value=localValue(w.defaultNumber??0,"widget."+id);
      const spec=numberControl(w,targetOf(w.value));
      if(!spec)throw Error("A local numeric field with a custom validator needs a supported validator.");
      const initial=w.value.initial;
      const rounded=spec.rounding==="round"?Math.round(initial):spec.rounding==="truncate"?Math.trunc(initial):initial;
      w.value.initial=Math.max(spec.min??-Infinity,Math.min(spec.max??Infinity,rounded));
    }
    const selected=toggle || cycle?readValue(w.value):false;
    if(toggle && typeof selected!=="boolean")throw Error("Expected synchronized boolean for ToggleButton.");
    if(cycle && (!Number.isInteger(selected) || selected<0 || selected>=(w.stateCount??w.impliedStates??1)))throw Error("Invalid CycleButtonWidget state.");
    const pageChoice=w.widget==="PageButton"?pageButtonChoice(w,readValue,targetOf):null;
    const activePage=pageChoice && pageChoice.choice===pageChoice.value;
    const pressed=pageChoice?activePage!==!!w.invertSelected:toggle && selected!==!!w.invertSelected;
    const parentSkin=activeSkin;
    activeSkin={...skin,color:(pressed?skin.pressedColor:null)??skin.color??theme.color,
      textColor:(hover?skin.hoverTextColor:null)??skin.textColor??theme.textColor,iconColor:skin.iconColor??theme.iconColor};
    const indexed=prop=>w.stateLayers?.[prop+Number(selected)]??w[prop];
    const normal=pageChoice && !activePage && w.pageInactive?w.pageInactive:indexed("background"),onHover=indexed("hoverBackground");
    const themeBg=pressed?skin.pressed??skin.background:skin.background;
    const themeHover=pressed?skin.pressedHover??themeBg:skin.hover??themeBg;
    const normalTheme=w.disableTheme?null:themeBg;
    const hoveredTheme=w.disableTheme && w.disableHoverTheme?null:w.disableHoverTheme?themeBg:themeHover;
    const changes=list=>list?.length && !(list.length===1 && list[0]?.ref==="IDrawable.NONE");
    const hasHover=!w.invisiblePanel && !!(changes(onHover)||changes(indexed("hoverOverlay"))||normalTheme!==hoveredTheme||skin.hoverTextColor!=null);
    const tip={type:"tip",lines:[]};if(w.tip && !w.invisiblePanel)invoke(w.tip,[tip]);
    if(!tip.lines.length && w.stateTips?.[Number(selected)])invoke(w.stateTips[Number(selected)],[tip]);
    let slot;
    if(["ItemSlot","FluidSlot"].includes(w.widget)){
      location=w.origin;slotIds.add(id);slot=manualSlot(w,id,box,state);
    }
    let slider,control=pageChoice??controlFor(w,selected);
    if(w.widget==="SliderWidget"){
      if(!w.value)w.value=localValue(sliderState(w,box).value,"widget."+id);
      slider=sliderState(w,box,readValue(w.value));
      const target=targetOf(w.value);
      if(target && !w.customInteraction)control={...slider,target,enabled:true};
    }
    const caption=(indexed("overlay")??[]).find(d=>d?.type==="text");
    const record={id,type:w.widget,box,parentId,...(caption?{label:readValue(caption.text)}:{}),tooltip:[...tip.lines,...(slot?.tooltip??[])],hoverable:hasHover||!!slot?.highlight,
      ...(control?{control}:{}),
      ...(!control && (w.customInteraction || w.onMousePressed || w.onMouseReleased)?{controlUnavailable:w.pressReason??"Unsupported custom input callback"}:{}),
      ...(slot?{slot}:{})};
    widgets.push(record);
    if(!w.disableTheme && !themeBg && ["ModularPanel","ButtonWidget","ToggleButton","ItemSlot","FluidSlot","TextFieldWidget"].includes(w.widget))
      throw Error("Missing theme background for "+w.widget);
    const background=hover?hoveredTheme:normalTheme;
    if(background)paint(background,box);
    if(!slot?.resource || state.showSlotOverlay!==false)layer(hover && changes(onHover)?onHover:normal,box);
    const highlight=()=>paint(rect(skin.slotHoverColor??0x60ffffff),slot.hoverBox);
    if(slot?.resource)paint({...texture(),resource:slot.resource,uv:slot.uv,tint:slot.tint,
      tiled:slot.kind==="fluid",opaqueCutout:slot.kind==="fluid",blend:slot.kind==="item"},slot.iconBox,false);
    if(slot?.kind==="item"){slotLabel(slot);if(hover && slot.highlight)highlight();}
    if(slider){
      const previous=activeSkin;
      const withSkin=style=>(drawable,b)=>{activeSkin=style;paint(drawable,b);activeSkin=previous;};
      paintSlider(w,box,slider,withSkin({color:0xffffffff,iconColor:0xffffffff,textColor:0xff404040}),withSkin({...theme,...theme.ButtonWidget}));
    }
    if(w.drawable)paint(w.drawable,box);
    if(w.text!==undefined || w.widget==="TextFieldWidget")emitText(w,box,hover?{...skin,textColor:skin.hoverTextColor??skin.textColor}:skin,id,record);
    layer(hover && changes(indexed("hoverOverlay"))?indexed("hoverOverlay"):indexed("overlay"),[x+pl,y+pt,width-pl-pr,height-pt-pb]);
    if(slot?.kind==="fluid"){slotLabel(slot);if(hover)highlight();}

    if(w.widget==="Grid"){
      const metrics=gridMetrics(w,(c,visible)=>dimensions(c,box,w.padding,visible),enabledValue);
      if(metrics.width>width || metrics.height>height)throw Error("Overflowing Grid requires viewport clipping.");
      for(const cell of metrics.children){
        const [cx,cy,cw,ch]=cell.box;
        layout(cell.child,[x+cx,y+cy,cw,ch],cell.enabled,id);
      }
      activeSkin=parentSkin;return;
    }
    const horizontal=w.widget==="row",flow=horizontal||w.widget==="column",axis=horizontal?0:1,other=1-axis;
    const total=[width,height],pad=w.padding;
    const slots=w.children.map(child=>{
      const enabled=w.collapseDisabled?enabledValue(child):undefined;
      return {child,wh:dimensions(child,box,pad,enabled!==false),enabled};
    });
    const hasPos=(child,k)=>k===0?child.x!=null||child.right!=null||child.cx||child.align:child.y!=null||child.bottom!=null||child.cy||child.align;
    const arranged=flow?slots.filter(({child,enabled})=>enabled!==false && !hasPos(child,axis)):[];
    let gap=w.gap??0,mode=w.mainAxisAlignment??"START",cursor=pad[axis];
    if(expandFlow(arranged,axis,total[axis]-pad[axis]-pad[axis+2],gap))mode="START";
    if(arranged.length){
      const ext=arranged.reduce((s,{child,wh})=>s+wh[axis]+child.margin[axis]+child.margin[axis+2],0)+gap*(arranged.length-1);
      const space=total[axis]-pad[axis]-pad[axis+2]-ext;
      if(w.list && space<0)throw Error("Overflowing ListWidget requires scrolling support.");
      if(arranged.length===1 && ["SPACE_AROUND","SPACE_BETWEEN"].includes(mode))mode="CENTER";
      if(mode==="CENTER")cursor+=Math.trunc(space/2);
      else if(mode==="END")cursor+=space;
      else if(mode==="SPACE_BETWEEN")gap=Math.trunc(space/(arranged.length-1));
      else if(mode==="SPACE_AROUND"){gap=Math.trunc(space/arranged.length);cursor+=Math.trunc(gap/2);}
      else if(mode!=="START")throw Error("Unsupported main-axis alignment "+mode);
    }
    for(const {child,wh,enabled} of slots) {
      const margin=child.margin,a=alignmentOf(child.align);
      const pos=[0,0].map((_,k)=>{
        const delta=k===0?child.x:child.y,end=k===0?child.right:child.bottom;
        const middle=k===0?child.cx||["center","topcenter","bottomcenter"].includes(a):child.cy||["center","centerleft","centerright"].includes(a);
        if(end!=null || (k===0?a.endsWith("right"):a.startsWith("bottom")))return total[k]-pad[k+2]-margin[k+2]-wh[k]-(end??0);
        if(middle)return Math.trunc((total[k]-wh[k])/2);
        return pad[k]+margin[k]+(delta??0);
      });
      if(flow && enabled!==false && !hasPos(child,axis)){
        pos[axis]=cursor+margin[axis];
        cursor+=wh[axis]+margin[axis]+margin[axis+2]+gap;
        if(!hasPos(child,other)){
          const lo=pad[other]+margin[other],hi=total[other]-wh[other]-pad[other+2]-margin[other+2];
          switch(w.crossAxisAlignment??"CENTER"){
            case "START":pos[other]=lo;break;
            case "END":pos[other]=hi;break;
            case "CENTER":{
              const center=Math.trunc((total[other]-wh[other])/2);
              pos[other]=lo>hi?center:Math.max(lo,Math.min(hi,center));break;
            }
            default:throw Error("Unsupported cross-axis alignment "+w.crossAxisAlignment);
          }
        }
      }
      layout(child,[x+pos[0],y+pos[1],...wh],enabled,id);
    }
    activeSkin=parentSkin;
  }
  try {
    if(!Object.hasOwn(classes,entry))throw Error("Unknown source class "+entry);
    if(state.slots!=null && (!state.slots || typeof state.slots!=="object" || Array.isArray(state.slots)))
      throw Error("state.slots expects an object keyed by widget id.");
    let args=state.args;
    if(java.method && args===undefined){
      const candidates=Object.entries(classes[entry].methods).filter(([name,m])=>name.split("/")[0]===java.method && m &&
        m[2].every(type=>type==="PanelSyncManager" || type==="ModularPanel"));
      if(candidates.length!==1)throw Error("Supply state.args to select "+java.method+" and its parameters.");
      args=Array(candidates[0][1][0].length).fill(null);
    }
    const root=java.method?method(entry,java.method,args):field(entry,java.field);
    const slotRoot=["ItemSlot","FluidSlot"].includes(root?.widget);
    rootBox=root?.widget==="ItemSlot"?[0,0,18,18]:
      [0,0,root?.w??size?.width??(slotRoot?18:null),root?.h??size?.height??(slotRoot?18:null)];
    if(root?.wCover!=null || root?.hCover!=null){
      const wh=dimensions(root,[0,0,rootBox[2]??0,rootBox[3]??0],[0,0,0,0]);
      if(root.wCover!=null)rootBox[2]=wh[0];
      if(root.hCover!=null)rootBox[3]=wh[1];
    }
    if(!rootBox.slice(2).every(n=>Number.isInteger(n)&&n>0&&n<=2048))throw Error("Drawable entry needs size.width and size.height in 1..2048.");
    indexWidgets(root);paint(root,rootBox);
    if(state.edit!=null && !widgets.some(w=>w.id===state.edit.id && w.control?.kind==="number"))
      throw Error("state.edit requires a visible, editable numeric field.");
    location=entry+" / state.slots";
    for(const id of Object.keys(state.slots??{}))if(!slotIds.has(id))throw Error("No ItemSlot or FluidSlot with id "+id);
    if(request.requireInteractive){
      const missing=widgets.filter(w=>w.controlUnavailable);
      if(missing.length)throw Error("Unresolved visible input callbacks: "+missing.map(w=>w.id+" ("+(w.label??w.type)+")").join(", "));
    }
    return {width:rootBox[2],height:rootBox[3],ops,widgets,methods:[...methods]};
  } catch(e) {throw Error(location+" — "+e.message,{cause:e});}
}
