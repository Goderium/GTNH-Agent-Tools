import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {gzipSync} from "node:zlib";

// The conversation iframe supports classic scripts. Bundle only the workbench's
// own small ES modules; the supplied Java remains inert JSON syntax trees.
async function browserModules() {
  const loaded=new Set(["renderer.js"]),parts=[];
  async function include(name) {
    if(loaded.has(name))return;
    loaded.add(name);
    let source=await readFile(new URL(name,import.meta.url),"utf8");
    const deps=[],exports=[];
    source=source.replace(/^import\s+(?:\{([^}]+)\}\s*from\s*)?["']\.\/([\w.-]+)["'];/gm,
      (_,symbols,dep)=>{deps.push(dep);return symbols?'const {'+symbols+'}=modules['+JSON.stringify(dep)+'];':'';});
    source=source.replace(/^export\s+((?:async\s+)?(?:function|const|class))\s+(\w+)/gm,
      (_,kind,symbol)=>{exports.push(symbol);return kind+' '+symbol;});
    for(const dep of deps)await include(dep);
    parts.push('modules['+JSON.stringify(name)+']=(()=>{\n'+source+'\nreturn {'+exports.join(',')+'};})();');
  }
  await include("mui-live.mjs");
  return parts.join("\n");
}

export async function interactiveFragment(runtime,data,program,bundle) {
  const packed=gzipSync(JSON.stringify({data,bundle})).toString("base64");
  const source=gzipSync(JSON.stringify(program)).toString("base64");
  const id="mui-"+createHash("sha256").update(source).update(packed).digest("hex").slice(0,16);
  const script=runtime+'\n;(async()=>{const modules={};\n'+await browserModules()+
    '\nconst root=document.getElementById('+JSON.stringify(id)+');'+
    'const bytes=Uint8Array.from(atob('+JSON.stringify(packed)+'),c=>c.charCodeAt(0));'+
    'const payload=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).json();'+
    'modules["mui-live.mjs"].mountLive({...payload,root,program:'+JSON.stringify(source)+'});})();';
  return '<div id="'+id+'" role="group" aria-label="MUI2"><style>#'+id+
    ' [data-mui="stage"]{position:relative;overflow:hidden}#'+id+
    ' img,#'+id+' canvas{position:absolute;image-rendering:pixelated;pointer-events:none}#'+id+
    ' [hidden]{display:none}</style><div data-mui="stage"><img data-mui="panel" alt="MUI2">'+
    '<canvas data-mui="surface" hidden></canvas></div></div>\n<script>'+
    script.replace(/<\/script/gi,"<\\/script")+'</script>\n';
}
