// The snapshot interpreter probes a source button on an isolated copy of its
// declared fields. Native/network/widget side effects have no fallback here.
const nodes=new Set(("BLOCK EXPRESSION_STATEMENT METHOD_INVOCATION MEMBER_SELECT IDENTIFIER IF RETURN VARIABLE "+
  "PARENTHESIZED CONDITIONAL_EXPRESSION CONDITIONAL_AND CONDITIONAL_OR EQUAL_TO NOT_EQUAL_TO GREATER_THAN "+
  "LESS_THAN GREATER_THAN_EQUAL LESS_THAN_EQUAL PLUS MINUS MULTIPLY DIVIDE REMAINDER UNARY_MINUS LOGICAL_COMPLEMENT "+
  "ASSIGNMENT ARRAY_ACCESS NEW_ARRAY INT_LITERAL BOOLEAN_LITERAL STRING_LITERAL NULL_LITERAL").split(" "));
export function checkPressNode(node,replay){
  if(--replay.remaining<0 || !nodes.has(node))throw Error("Unmodeled button expression "+node);
}

export function pressStatement(callback){
  if(callback?.params?.length!==1 || callback.body?.[0]!=="BLOCK")return null;
  const [stmt,last,...extra]=callback.body[2];
  if(extra.length || stmt?.[0]!=="EXPRESSION_STATEMENT" || stmt[2]?.[0]!=="METHOD_INVOCATION" ||
    last?.[0]!=="RETURN" || last[2]?.[0]!=="BOOLEAN_LITERAL" || last[2][2]!==true)return null;
  const usesMouse=node=>Array.isArray(node) && (node[0]==="IDENTIFIER" && node[2]===callback.params[0] ||
    node.some(usesMouse));
  return usesMouse(stmt)?null:stmt[2];
}

export function applyPress(state,control,id,action){
  if(action.type!=="click" || ![0,1].includes(action.button??0))throw Error("Source button requires a left or right click.");
  const next={...state},changes=[];
  for(const {target,before,after} of control.assignments){
    const {group,key}=target;
    if(!["bindings","sync"].includes(group) || !Object.hasOwn(state[group]??{},key) || state[group][key]!==before)
      throw Error("Source button snapshot changed before replay.");
    if(before!==after){
      next[group]={...next[group],[key]:after};
      changes.push({target,before,after});
    }
  }
  return {state:next,receipt:{id,type:"click",kind:"press",consumed:true,editing:next.edit?.id===id,changes,
    methods:control.methods}};
}
