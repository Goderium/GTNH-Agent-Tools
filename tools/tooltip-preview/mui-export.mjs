import {readFile} from "node:fs/promises";
import {gzipSync} from "node:zlib";

export async function adjustableScripts(program, bundle) {
  const names=["mui-live.mjs","mui-source.mjs","mui-theme.mjs","mui-actions.mjs","mui-number.mjs","mui-slider.mjs","mui-tooltip.mjs","mui-collection.mjs","mui-pages.mjs","mui-snapshot.mjs","mui-press.mjs"];
  const imports={"gtnh/renderer.js":"data:text/javascript,export%20%7B%7D"};
  for(const name of names) {
    const raw=await readFile(new URL(name,import.meta.url),"utf8");
    const js=raw.replace(/^(import\s+[^\n]*?["'])\.\/([^"']+)(["'];?)/gm,"$1gtnh/$2$3");
    imports["gtnh/"+name]="data:text/javascript;base64,"+Buffer.from(js).toString("base64");
  }
  const compressed=gzipSync(JSON.stringify(program)).toString("base64");
  const safe=JSON.stringify(bundle).replaceAll("<","\\u003c");
  return '<script type="importmap">'+JSON.stringify({imports})+'</script>'+
    '<script type="application/octet-stream" id="mui-program">'+compressed+'</script>'+
    '<script type="application/json" id="mui-resources">'+safe+'</script>'+
    '<script type="module">import {mountLive} from "gtnh/mui-live.mjs";mountLive()</script>';
}

// Include translations and source literals reached only after changing a control.
export function programCharacters(program) {
  const characters=new Set("µ∞§−\u00a0\u202f");
  for(let code=32;code<127;code++)characters.add(String.fromCharCode(code));
  // Numeric drafts can use Java's Unicode decimal digits even when none occur in the source.
  for(let code=128;code<=0xffff;code++){
    const ch=String.fromCharCode(code);
    if(/\p{Nd}/u.test(ch))characters.add(ch);
  }
  function add(text) {for(const ch of text)characters.add(ch);}
  function visit(value) {
    if(typeof value==="string")add(value);
    else if(value && typeof value==="object")for(const item of Object.values(value))visit(item);
  }
  visit(program.classes);
  visit(program.request.state);
  return [...characters].join("");
}

import {readMuiTheme} from "./mui-theme.mjs";
import {paintSlider,sliderState} from "./mui-slider.mjs";

// Follow the entry through all branches, including dormant drawables and hover layers.
// Values are sets of string patterns. An unknown suffix preserves its known directory.
export function programTextures(program, scene) {
  const {classes,request}=program,{java,state={}}=request;
  const bindings=state.bindings??{},exact=new Set(),prefixes=new Set(),fields=new Map(),methods=new Map();
  const unknown="\u0000",any=[unknown],active=new Set();
  let unrestricted=false,budget=150000;
  function limit(values) {
    const choices=[...new Set(values)];
    if(!choices.length)return any;
    if(choices.length<=96)return choices;
    let prefix=String(choices[0]);
    for(const s of choices)while(prefix && !String(s).startsWith(prefix))prefix=prefix.slice(0,-1);
    return [prefix+unknown];
  }
  function resource(s) {
    if(typeof s!=="string"){unrestricted=true;return;}
    const path=s.replace(/^[^:]+:/,"").replace(/^textures\//,"").replace(/\.png$/,"");
    const i=path.search(/[\u0000%]/);
    if(i===0 || !path)unrestricted=true;
    else if(i<0)exact.add(path);
    else prefixes.add(path.slice(0,i));
  }
  function member(owner,group,key) {
    const seen=new Set();
    while(Object.hasOwn(classes,owner) && !seen.has(owner)){
      if(Object.hasOwn(classes[owner][group],key))return owner;
      seen.add(owner);owner=classes[owner].parent;
    }
  }
  function owners(owner,group,key,name) {
    const local=member(owner,group,key);
    if(local)return [local];
    const type=classes[owner],explicit=type?.imports?.[name];
    return explicit?[explicit]:(type?.wildcards??[]).map(t=>member(t,group,key)).filter(Boolean);
  }
  function qualified(n) {
    if(n?.[0]==="IDENTIFIER")return n[2];
    if(n?.[0]==="MEMBER_SELECT"){const base=qualified(n[2]);if(base)return base+"."+n[3];}
    if(n?.[0]==="NEW_CLASS")return n[2];
  }
  function cached(cache,key,fn) {
    if(cache.has(key))return cache.get(key);
    if(active.has(key) || --budget<0){unrestricted=true;return any;}
    active.add(key);
    const result=fn();active.delete(key);cache.set(key,result);return result;
  }
  function bound(key) {
    // Numeric and boolean snapshots may be changed by controls. String bindings are read-only.
    return typeof bindings[key]==="string"?[bindings[key]]:any;
  }
  function field(owner,key) {
    const full=owner+"."+key;
    if(Object.hasOwn(bindings,full))return bound(full);
    const source=member(owner,"fields",key);
    return source?cached(fields,source+"."+key,()=>walk(classes[source].fields[key],source,new Map(),[])):any;
  }
  function method(owner,name,args) {
    const key=name+"/"+args.length,source=member(owner,"methods",key);
    const spec=classes[source]?.methods[key];
    if(!spec)return any;
    return cached(methods,source+"."+key+JSON.stringify(args),()=>{
      const returned=[],env=new Map();
      spec[0].forEach((p,i)=>{env.set(p,args[i]);env.set("#"+p,spec[2][i]);});
      walk(spec[1],source,env,returned);return limit(returned);
    });
  }
  function walk(n,owner,env,returned) {
    if(!Array.isArray(n) || unrestricted)return any;
    if(--budget<0){unrestricted=true;return any;}
    const [kind,,a,b,c]=n,visit=v=>walk(v,owner,env,returned);
    const set=(key,values)=>env.set(key,limit([...(env.get(key)??[]),...values]));
    if(typeof kind!=="string"){n.forEach(visit);return any;}
    switch(kind){
      case "STRING_LITERAL":case "CHAR_LITERAL":case "INT_LITERAL":case "LONG_LITERAL":case "BOOLEAN_LITERAL":return [a];
      case "PARENTHESIZED":return visit(a);
      case "TYPE_CAST":{const values=visit(b);return a==="String"?values:any;}
      case "IDENTIFIER":{
        if(env.has(a))return env.get(a);
        const sources=owners(owner,"fields",a,a);
        if(sources.length)return limit(sources.flatMap(s=>field(s,a)));
        return bound(a);
      }
      case "MEMBER_SELECT":{
        visit(a);
        const q=qualified(a),source=q==="this"?owner:q;
        if(source)return field(env.get("#"+source)??source,b);
        return any;
      }
      case "PLUS":{
        const left=visit(a),right=visit(b);
        return limit(left.flatMap(x=>right.map(y=>typeof x==="string" || typeof y==="string"?String(x)+String(y):unknown)));
      }
      case "CONDITIONAL_EXPRESSION":visit(a);return limit([...visit(b),...visit(c)]);
      case "VARIABLE":set(a,visit(b));env.set("#"+a,c);return any;
      case "ASSIGNMENT":case "PLUS_ASSIGNMENT":case "MINUS_ASSIGNMENT":{
        const rhs=visit(b),v=kind==="ASSIGNMENT"?rhs:any;if(a[0]==="IDENTIFIER")set(a[2],v);return v;
      }
      case "POSTFIX_INCREMENT":case "PREFIX_INCREMENT":case "POSTFIX_DECREMENT":case "PREFIX_DECREMENT":
        if(a[0]==="IDENTIFIER")set(a[2],any);return any;
      case "ARRAY_ACCESS":visit(b);return visit(a);
      case "NEW_ARRAY":return limit((a??[]).flatMap(visit));
      case "RETURN":returned.push(...visit(a));return any;
      case "FOR_LOOP":{
        visit(a);
        // A later iteration can observe assignments made after its texture call.
        function widen(v) {
          if(!Array.isArray(v))return;
          if(typeof v[0]==="string" && /ASSIGNMENT$|INCREMENT$|DECREMENT$/.test(v[0]) && v[2]?.[0]==="IDENTIFIER")set(v[2][2],any);
          v.forEach(widen);
        }
        widen(c);widen(n[5]);visit(b);visit(c);visit(n[5]);return any;
      }
      case "LAMBDA_EXPRESSION":{
        const captured=new Map(env);for(const p of a)captured.set(p,any);
        walk(b,owner,captured,[]);return any;
      }
      case "MEMBER_REFERENCE":{
        visit(a);
        const q=qualified(a),source=q==="this"?owner:q;
        // An instance receiver may resolve to a subclass supplied by a caller.
        const possible=q==="this" || Object.hasOwn(classes,source)?[source]:Object.keys(classes);
        for(let type of possible){
          const seen=new Set();
          while(Object.hasOwn(classes,type) && !seen.has(type)){
            seen.add(type);
            for(const key of Object.keys(classes[type].methods))if(key.split("/")[0]===b)
              method(type,b,Array(Number(key.split("/")[1])).fill(any));
            type=classes[type].parent;
          }
        }
        return any;
      }
      case "NEW_CLASS":{
        b.forEach(visit);
        if(a==="SliderWidget")paintSlider({},[0,0,18,18],sliderState({},[0,0,18,18]),()=>{},d=>{if(d.resource)resource(d.resource);});
        return any;
      }
      case "METHOD_INVOCATION":{
        const name=a[0]==="IDENTIFIER"?a[2]:a[3],key=name+"/"+b.length;
        const receiver=a[0]==="MEMBER_SELECT"?a[2]:null;
        if(receiver)visit(receiver);
        const args=b.map(visit),q=qualified(receiver),type=q==="this"?owner:env.get("#"+q)??q;
        const sources=receiver?[member(type,"methods",key)].filter(Boolean):owners(owner,"methods",key,name);
        if(receiver && q!=="this" && !Object.hasOwn(classes,q) && !["location","fullImage"].includes(name))
          for(const candidate of Object.keys(classes))if(!sources.includes(candidate) && Object.hasOwn(classes[candidate].methods,key))sources.push(candidate);
        if(sources.some(s=>classes[s]?.methods[key]))return limit(sources.flatMap(s=>method(s,name,args)));
        if(args.length && (name==="location" || name==="fullImage")){
          const last=b.at(-1),sym=qualified(last),imported=classes[owner]?.imports?.[sym];
          const color=name==="fullImage" && (b.length===3 || sym?.startsWith("ColorType.") || imported==="ColorType" || env.get("#"+sym)==="ColorType");
          for(const v of args[color?args.length-2:args.length-1]??any)resource(v);
        }
        if(!args.length)return bound((type??owner)+"."+name);
        return any;
      }
      default:n.slice(2).forEach(visit);return any;
    }
  }
  function explicit(v) {
    if(typeof v==="string"){
      const split=v.lastIndexOf(".");
      if(split>0 && classes[v.slice(0,split)])field(v.slice(0,split),v.slice(split+1));
    }else if(v && typeof v==="object"){
      if(typeof v.resource==="string")resource(v.resource);
      Object.values(v).forEach(explicit);
    }
  }
  for(const op of scene.ops)if(op.resource)resource(op.resource);
  explicit(state.slots);explicit(bindings);explicit(readMuiTheme(classes,request.theme,bindings));
  for(const target of Object.values(java.adapters??{})){
    const m=/^([\w$.]+)\.(\w+)\/(\d+)$/.exec(target);
    if(m)method(m[1],m[2],Array.from({length:Number(m[3])},()=>any));
  }
  const entry=java.class??java.file.split(/[\\/]/).pop().replace(/\.java$/,"");
  const available=new Set(),ancestors=new Set();
  for(let source=entry;classes[source] && !ancestors.has(source);source=classes[source].parent){
    ancestors.add(source);
    for(const key of Object.keys(classes[source].methods))available.add(key);
  }
  if(java.field)field(entry,java.field);
  else for(const key of available){
    const [name,arity]=key.split("/");
    if(name===java.method && (!state.args || state.args.length===Number(arity)))
      method(entry,name,Array.from({length:Number(arity)},(_,i)=>["number","boolean","string"].includes(typeof state.args?.[i])?[state.args[i]]:any));
  }
  return unrestricted?null:{exact:[...exact].sort(),prefixes:[...prefixes].sort()};
}
