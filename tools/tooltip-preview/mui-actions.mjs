import {sliderValueAt, sliderWheelValue, sliderSetValue} from "./mui-slider.mjs";
import {numericValue,numericScrollValue} from "./mui-number.mjs";
import {applyPress} from "./mui-press.mjs";

function edited(id, text, action, maxLength) {
  if(typeof text!=="string" || text.length>4096 || /[\r\n§]/.test(text))throw Error("Expected single-line numeric input of up to 4096 characters.");
  if(maxLength>=0 && text.length>maxLength)throw Error("Input exceeds the source field's maximum length of "+maxLength+".");
  const caret=action.caret??text.length,anchor=action.anchor??caret;
  if(![anchor,caret].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=text.length))throw Error("Invalid edit selection.");
  if(action.scrollX!=null && !Number.isSafeInteger(action.scrollX))throw Error("Expected a logical pixel offset for scrollX.");
  return {id,text,anchor,caret,showCaret:action.showCaret!==false,...(action.scrollX!=null?{scrollX:action.scrollX}:{})};
}

function writeValue(state, control, value) {
  const next={...state};
  if(value===control.value && !control.writes?.length)return next;
  for(const update of [{target:control.target,value},...(control.writes??[])]) {
    const {group,key}=update.target;
    if(!["sync","bindings"].includes(group) || typeof key!=="string" || !key.length)throw Error("Invalid MUI2 control binding.");
    next[group]={...next[group],[key]:update.value};
  }
  return next;
}

export function controlSnapshot(state) {
  return {sync:state.sync??{},bindings:state.bindings??{},edit:state.edit??null};
}

// Each transition starts from the latest source scene. Binding changes are committed together.
export async function applyMuiAction(state, action, build) {
  if(!action || typeof action!=="object" || typeof action.id!=="string")throw Error("MUI2 action requires a widget id.");
  const {type,id}=action;
  let current=state;
  if(state.edit && state.edit.id!==id && !["scroll","cancel","commit"].includes(type)) {
    current=(await applyMuiAction(state,{type:"commit",id:state.edit.id},build)).state;
  }
  const scene=await build(current),widget=scene.widgets.find(w=>w.id===id);
  if(!widget?.control)throw Error("No adjustable MUI2 control: "+id+(widget?.controlUnavailable?" ("+widget.controlUnavailable+")":""));
  const c=widget.control;
  if(c.enabled===false)throw Error("Disabled MUI2 control: "+id);
  if(c.kind==="press")return applyPress(current,c,id,action);
  let next={...current},value=c.value,consumed=true,viewOffset;
  if(type==="focus" || type==="edit"){
    if(c.kind!=="number")throw Error("Only numeric fields accept text focus.");
    const prior=current.edit?.id===id?current.edit:null;
    const text=type==="edit"?action.text:prior?.text??String(c.value);
    next.edit=edited(id,text,action,type==="edit"?c.maxLength:undefined);
    if(type==="edit" && c.autoUpdateOnChange && prior?.text!==text){
      value=numericValue(c,text,true);
      next={...writeValue(current,c,value),edit:next.edit};
    }
    next.focusOriginal=current.focusOriginal??c.value;
  }else if(type==="commit" || type==="cancel"){
    if(current.edit?.id!==id)throw Error("Field is not focused: "+id);
    if(type==="commit")value=numericValue(c,current.edit.text,true);
    else value=current.focusOriginal??c.value;
    next=writeValue(current,c,value);
    delete next.edit;delete next.focusOriginal;
  }else{
    switch(type) {
      case "click": {
        const button=action.button??0;
        if(button!==0 && button!==1)throw Error("Use button 0 (left) or 1 (right).");
        if(c.button!=null && c.button!==button){consumed=false;break;}
        if(c.kind==="choice")value=c.choice;
        else if(c.kind==="toggle")value=!c.value;
        else if(c.kind==="cycle") {
          const index=c.options.indexOf(c.value),length=c.options.length;
          if(index<0 || !length)throw Error("Invalid source cycle state.");
          value=c.options[(index+(button===1?-1:1)+length)%length];
        }else throw Error("Use focus for a number field or drag for a slider.");
        break;
      }
      case "drag":
        if(c.kind!=="slider" || ![action.x,action.y].every(Number.isFinite))throw Error("Drag needs a slider and local x/y.");
        value=sliderValueAt(c,{x:action.x,y:action.y});break;
      case "scroll": {
        if(!["up","down"].includes(action.direction))throw Error("Scroll direction must be up or down.");
        const mods=action.modifiers??{};
        if(c.kind==="slider"){
          consumed=c.scrollEnabled===true;
          if(consumed)value=sliderWheelValue(c,action.direction,mods);
        }else if(c.kind==="number"){
          consumed=c.wheel.enabled && current.edit?.id===id;
          if(consumed) {
            const step=c.wheel.base*(mods.shift?c.wheel.shift:1)*(mods.ctrl?c.wheel.ctrl:1)*(mods.alt?c.wheel.alt:1);
            value=numericScrollValue(c,current.edit.text,action.direction==="up"?step:-step);
          }else if(c.maxScrollX>0 && current.edit?.id===id){
            consumed=true;
            viewOffset=Math.max(0,Math.min(c.maxScrollX,c.scrollX+(action.direction==="up"?-30:30)));
          }
        }else consumed=false;
        break;
      }
      case "set":
        value=action.value;
        if(c.kind==="choice" && value!==c.choice)throw Error("The source button only selects "+c.choice);
        if(c.kind==="number"){
          if(typeof value==="string")edited(id,value,{},c.maxLength);
          value=numericValue(c,value,typeof value==="string");
        }else if(c.kind==="slider"){
          if(typeof value!=="number" || !Number.isFinite(value))throw Error("Expected a finite slider value.");
          value=sliderSetValue(c,value);
        }else if(c.kind==="toggle" && typeof value!=="boolean" || c.kind==="cycle" && !c.options.includes(value))throw Error("Invalid value for "+id);
        break;
      default:throw Error("Unknown control action "+type);
    }
    if(consumed)next=writeValue(current,c,value);
    if(type==="set" && next.edit?.id===id){delete next.edit;delete next.focusOriginal;}
    if(viewOffset!==undefined)next.edit={...current.edit,scrollX:viewOffset};
    else if(type==="scroll" && consumed && next.edit?.id===id){
      const text=String(value),prior=next.edit;
      next.edit=edited(id,text,{anchor:Math.min(prior.anchor,text.length),caret:Math.min(prior.caret,text.length),showCaret:prior.showCaret});
    }
  }
  return {state:next,receipt:{id,type,kind:c.kind,before:c.value,after:value,consumed,editing:next.edit?.id===id}};
}
