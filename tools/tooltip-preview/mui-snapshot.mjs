export const noSnapshotCall=Symbol("unhandled snapshot call");

const compound=data=>({type:"nbt",data});
export function snapshotCall(obj,name,args) {
  const [a,b]=args,full=obj?.ref+"."+name;
  if(full==="Collections.singletonList" && args.length===1)return [a];
  if(typeof obj==="string" && name==="split" && args.length===1 && typeof a==="string" && /^[\w ,:\n\t-]+$/.test(a)){
    const parts=obj.split(a);
    while(obj.length && parts.at(-1)==="")parts.pop();
    return parts;
  }
  if(typeof obj==="function" && !args.length && name==="get")return obj();
  if(Array.isArray(obj) && name==="get" && args.length===1 && Number.isInteger(a) && a>=0 && a<obj.length)return obj[a];
  if(Array.isArray(obj) && name==="forEach" && args.length===1 && typeof a==="function"){
    for(const value of obj)a(value);return;
  }
  if(full==="GenericSyncValue.builder" && args.length===1)return {type:"snapshotBuilder",className:a?.ref};
  if(obj?.type==="snapshotBuilder"){
    if(name==="build" && !args.length && obj.get)return {type:"sync",snapshot:true,get:obj.get,set:obj.set};
    if(name==="getter" && args.length===1 && typeof a==="function"){obj.get=a;return obj;}
    if(name==="setter" && args.length===1 && typeof a==="function"){obj.set=a;return obj;}
    // These configure packet serialization and defensive copying, both outside a local snapshot.
    if((name==="adapter" && a?.ref || name==="copy" && typeof a==="function") && args.length===1)return obj;
  }
  if(obj?.type==="nbt"){
    if(!obj.data || Array.isArray(obj.data) || typeof obj.data!=="object")throw Error("Expected NBT compound data.");
    const v=Object.hasOwn(obj.data,a)?obj.data[a]:undefined;
    if(name==="hasKey" && args.length===2 && b===10)
      return v!==null && typeof v==="object" && !Array.isArray(v);
    if(args.length===1 && typeof a==="string"){
      if(name==="getBoolean")return typeof v==="boolean"?v:typeof v==="number" && v!==0;
      if(name==="getInteger")return Number.isFinite(v)?v|0:0;
      if(name==="getString")return typeof v==="string"?v:"";
      if(name==="getCompoundTag")return compound(v && typeof v==="object" && !Array.isArray(v)?v:{});
    }
    if(name==="getTagList" && args.length===2 && b===10)
      return {type:"nbtCompounds",data:Array.isArray(v)?v:[]};
  }
  if(obj?.type==="nbtCompounds" && name==="tagCount" && !args.length)return obj.data.length;
  if(obj?.type==="nbtCompounds" && name==="getCompoundTagAt" && args.length===1 && Number.isInteger(a)){
    const child=obj.data[a];
    return compound(child && typeof child==="object" && !Array.isArray(child)?child:{});
  }
  return noSnapshotCall;
}

// Reproduce the local acknowledgement flag set by the arrival of a declared
// snapshot, without running an arbitrary Java networking callback.
export function receiveSnapshot(value,fn) {
  if(!value.snapshot || !value.set)return;
  const ast=fn?.body,left=ast?.[2],right=ast?.[3];
  if(ast?.[0]!=="ASSIGNMENT" || left?.[0]!=="ARRAY_ACCESS" || left[2][0]!=="IDENTIFIER" ||
     left[3][0]!=="INT_LITERAL" || right?.[0]!=="BOOLEAN_LITERAL")throw Error("Unsupported snapshot receipt setter.");
  const target=fn.env.get(left[2][2]),index=left[3][2];
  if(!Array.isArray(target) || !Number.isInteger(index) || typeof target[index]!=="boolean")throw Error("Invalid snapshot receipt flag.");
  target[index]=right[2];
}

// Only a tooltip's transient hovered-index send is evaluated during painting.
// No server actions, messages or user-defined calls can pass this check.
export function hoverIndexListener(fn) {
  if(!fn || fn.params.length!==1)return false;
  const visible=new Set(["BLOCK","IF","CONDITIONAL_AND","EXPRESSION_STATEMENT","EQUAL_TO","NOT_EQUAL_TO","METHOD_INVOCATION",
    "MEMBER_SELECT","IDENTIFIER","INT_LITERAL","BOOLEAN_LITERAL","PARENTHESIZED","UNARY_MINUS"]);
  let hoverReads=0,writes=0;
  function visit(node) {
    if(node==null || !Array.isArray(node))return true;
    if(typeof node[0]!=="string")return node.every(visit);
    if(!visible.has(node[0]))return false;
    if(node[0]==="METHOD_INVOCATION"){
      const target=node[2],args=node[3];
      if(target?.[0]!=="MEMBER_SELECT" || target[2][0]!=="IDENTIFIER")return false;
      const key=target[2][2],name=target[3],receiver=fn.env.get(key);
      if(name==="isHovering" && key===fn.params[0] && !args.length)hoverReads++;
      else if(name==="getAsBoolean" && typeof receiver==="function" && !args.length){}
      else if(name==="getIntValue" && receiver?.type==="sync" && receiver.c2s && !args.length){}
      else if(name==="setIntValue" && receiver?.type==="sync" && receiver.c2s && args.length===3 &&
        args.slice(1).every(arg=>arg[0]==="BOOLEAN_LITERAL" && arg[2]===true))writes++;
      else return false;
    }
    return node.slice(2).every(visit);
  }
  return visit(fn.body) && hoverReads===1 && writes>0;
}
