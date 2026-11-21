// ModularUI 2.3.94 SliderWidget: settings, onResized, setValue, input handlers and drawing.
const defaultStopper={type:"rect",colors:Array(4).fill(0x66ffffff)};
const defaultHandle={type:"texture",resource:"modularui2:gui/widgets/base_button",
  imageSize:[18,18],border:[1,1,1,1],uv:[0,0,1,1],colorType:"color"};

export function configureSlider(widget,name,args,scalar,isReal) {
  if(widget.widget!=="SliderWidget")return false;
  const [a,b]=args,s=widget.slider??={};
  // Java selects the float overload when any argument in sliderSize is floating point.
  function dimension(value,relative) {
    return {value:Math.fround(scalar(value)),relative};
  }
  switch(name) {
    case "bounds": {
      const x=scalar(a),y=scalar(b);s.min=Math.min(x,y);s.max=Math.max(x,y);break;
    }
    case "stopper": {
      if(args.length===1&&!Array.isArray(a))s.each=scalar(a);
      else {
        s.stops??=[];
        s.stops.push(...(Array.isArray(a)?a:args).map(scalar));
        s.stops.sort((x,y)=>x-y);
      }
      break;
    }
    case "setAxis": {
      const axis=(a?.ref??a)?.split(".").pop();
      if(axis!=="X" && axis!=="Y")throw Error("Unknown SliderWidget axis.");
      s.axis=axis;break;
    }
    case "sliderWidth":s.handleWidth=dimension(a,isReal(a));break;
    case "sliderHeight":s.handleHeight=dimension(a,isReal(a));break;
    case "sliderSize": {
      const relative=isReal(a)||isReal(b);
      s.handleWidth=dimension(a,relative);s.handleHeight=dimension(b,relative);break;
    }
    case "sliderTexture":s.handle=a;break;
    case "stopperTexture":s.stopper=a;break;
    case "stopperSize":s.stopperWidth=scalar(a);s.stopperHeight=scalar(b);break;
    case "scrollValues":s.scrollSteps=args.map(scalar);s.scrollEnabled=true;break;
    case "usingScrollStep":s.scrollEnabled=args.length?!!a:true;break;
    default:return false;
  }
  return true;
}

function stopsFor(settings,min,max) {
  if(settings.stops)return settings.stops;
  if(!(settings.each>0))return [];
  const stops=[];
  for(let p=min;p<max;p+=settings.each) {
    if(stops.length>=16384 || p+settings.each===p)throw Error("SliderWidget has too many stoppers to preview.");
    stops.push(p);
  }
  stops.push(max);
  return stops;
}

function snap(control,value) {
  let nearest=value,distance=Infinity;
  for(const stop of control.stops) {
    const d=Math.abs(value-stop);
    if(d>distance)break;
    nearest=stop;distance=d;
  }
  return Math.max(control.min,Math.min(control.max,nearest));
}

export function sliderSetValue(control,value) {
  if(!Number.isFinite(value))throw Error("SliderWidget requires a finite value.");
  return snap(control,value);
}

function along(control,value) {
  const available=control.axis==="X"?control.width-control.handleWidth:control.height-control.handleHeight;
  if(control.max===control.min)return 0; // Java casts 0/0 to integer zero.
  return Math.trunc((value-control.min)/(control.max-control.min)*available);
}

export function sliderState(widget,box,value) {
  const s=widget.slider??{},[,,width,height]=box;
  const min=s.min??0,max=s.max??100,axis=s.axis??"X";
  function size(unit,length,fallback) {
    if(!unit)return fallback;
    return Math.trunc(unit.relative?Math.fround(unit.value*length):unit.value);
  }
  const handleWidth=size(s.handleWidth,width,6),handleHeight=size(s.handleHeight,height,height);
  const current=value instanceof Number?value.valueOf():value;
  const control={kind:"slider",axis,min,max,value:current??(max-min)*.5+min,width,height,handleWidth,handleHeight,
    stops:stopsFor(s,min,max),scrollEnabled:s.scrollEnabled??false,scrollSteps:s.scrollSteps??[1,100,.1,10000]};
  if(!Number.isFinite(control.value))throw Error("SliderWidget requires a finite synchronized value.");
  const pos=along(control,snap(control,control.value)),half=n=>Math.trunc(n/2);
  control.handleBox=axis==="X"?[pos,half(height)-half(handleHeight),handleWidth,handleHeight]:
    [half(width)-half(handleWidth),pos,handleWidth,handleHeight];
  return control;
}

export function sliderValueAt(control,localPointer) {
  const horizontal=control.axis==="X",handle=horizontal?control.handleWidth:control.handleHeight;
  const travel=(horizontal?control.width:control.height)-handle;
  const pointer=horizontal?localPointer.x:localPointer.y;
  if(!Number.isFinite(pointer))throw Error("SliderWidget requires a finite pointer coordinate.");
  const ratio=(Math.trunc(pointer)-handle/2)/travel;
  const result=snap(control,ratio*(control.max-control.min)+control.min);
  if(!Number.isFinite(result))throw Error("SliderWidget cannot set a finite value at this zero-length track position.");
  return result;
}

export function sliderWheelValue(control,direction,modifiers={}) {
  if(!control.scrollEnabled)return control.value;
  const sign=direction==="up"||direction===1?1:direction==="down"||direction===-1?-1:0;
  if(!sign)throw Error("SliderWidget wheel direction must be up or down.");
  const [base,shift,ctrl,alt]=control.scrollSteps;
  const step=base*(modifiers.ctrl?ctrl:1)*(modifiers.shift?shift:1)*(modifiers.alt?alt:1);
  return snap(control,control.value+step*sign);
}

export function paintSlider(widget,box,control,paintStopper,paintHandle) {
  const s=widget.slider??{},[x,y,w,h]=box;
  const sw=s.stopperWidth??2,sh=s.stopperHeight??4;
  const mark=Object.hasOwn(s,"stopper")?s.stopper:defaultStopper;
  if(mark && sw>0 && sh>0) {
    const horizontal=control.axis==="X",handle=horizontal?control.handleWidth:control.handleHeight;
    for(const stop of control.stops) {
      const center=along(control,stop)+Math.trunc(handle/2);
      const left=horizontal?center-Math.trunc(sw/2):Math.trunc(w/2-sw/2);
      const top=horizontal?Math.trunc(h/2-sh/2):center-Math.trunc(sh/2);
      paintStopper(mark,[x+left,y+top,sw,sh]);
    }
  }
  const handle=Object.hasOwn(s,"handle")?s.handle:defaultHandle;
  if(handle) {
    const [left,top,width,height]=control.handleBox;
    paintHandle(handle,[x+left,y+top,width,height]);
  }
}
