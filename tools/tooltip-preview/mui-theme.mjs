// MUI2 2.3.94 IThemeApi and TextFieldTheme supply the inherited widget defaults.
const vanilla = {
  color: 0xffffffff, textColor: 0xff404040, textShadow: false,
  ModularPanel: {background: "GuiTextures.MC_BACKGROUND", width: 176, height: 166},
  ButtonWidget: {background: "GuiTextures.MC_BUTTON", hover: "GuiTextures.MC_BUTTON_HOVERED", textColor: 0xffffffff, textShadow: true},
  "IThemeApi.CLOSE_BUTTON": {background: "GuiTextures.MC_BUTTON", hover: "GuiTextures.MC_BUTTON_HOVERED", width: 10, height: 10, textColor: 0xffffffff, textShadow: true},
  ToggleButton: {background: "GuiTextures.MC_BUTTON", hover: "GuiTextures.MC_BUTTON_HOVERED", pressed: "GuiTextures.MC_BUTTON_DISABLED", textColor: 0xffffffff, textShadow: true},
  TextFieldWidget: {background: "GuiTextures.DISPLAY_SMALL", width: 56, height: 18, textColor: 0xffffffff},
  ItemSlot: {background: "GuiTextures.SLOT_ITEM"},
  FluidSlot: {background: "GuiTextures.SLOT_FLUID"}
};

function merge(base, changes) {
  const result = {...base};
  for (const [key, value] of Object.entries(changes)) {
    result[key] = value && typeof value === "object" ? {...base[key], ...value} : value;
  }
  return result;
}

function qualified(node) {
  if (node?.[0] === "IDENTIFIER" || node?.[0] === "STRING_LITERAL") return node[2];
  if (node?.[0] === "MEMBER_SELECT") return qualified(node[2]) + "." + node[3];
  throw Error("Unsupported Java name at line " + node?.[1]);
}

function calls(expr) {
  const chain = [];
  while (expr?.[0] === "METHOD_INVOCATION" && expr[2][0] === "MEMBER_SELECT") {
    const [, line, receiver, method] = expr[2];
    chain.push({line, method, args: expr[3]});
    expr = receiver;
  }
  return {base: expr, chain: chain.reverse()};
}

const indices = new WeakMap();
function textureIndex(classes) {
  if (indices.has(classes)) return indices.get(classes);
  const registry = new Map();
  for (const [owner, type] of Object.entries(classes)) {
    for (const [field, expr] of Object.entries(type.fields)) {
      for (const {method, args} of calls(expr).chain) {
        if (method !== "name" || args.length !== 1) continue;
        const n = args[0];
        if (!["MEMBER_SELECT", "STRING_LITERAL", "IDENTIFIER"].includes(n[0])) continue;
        let id = qualified(n);
        if (type.imports?.[id]) id = type.imports[id] + "." + id;
        // Only consider builder field registrations, never a widget's .name().
        if (qualifiedBuilder(expr) !== "UITexture") continue;
        registry.set(id, owner + "." + field);
      }
    }
  }
  indices.set(classes, registry);
  return registry;
}

function qualifiedBuilder(expr) {
  const {base} = calls(expr);
  return base?.[0] === "IDENTIFIER" ? base[2] : null;
}

// RGB values read by GTGuiTheme's JSON builder receive an opaque alpha by default.
function opaque(n) { return (n >>> 24 ? n : n | 0xff000000) >>> 0; }

export function readMuiTheme(classes, overrides = {}, bindings = {}) {
  const source = overrides.source ?? (classes.GTGuiThemes ? "GTGuiThemes.STANDARD" : null);
  if (!source) return overrides;
  if (source === "vanilla") return merge(vanilla, overrides);
  const registry = textureIndex(classes);
  const seen = new Set();

  function build(source) {
    const [owner, field] = source.split(".");
    const expr = classes[owner]?.fields[field];
    if (!expr || seen.has(source)) throw Error("Missing or recursive MUI2 theme " + source);
    seen.add(source);
    const {base, chain} = calls(expr);
    if (qualified(base) !== "GTGuiTheme" || chain[0]?.method !== "builder" || chain.at(-1)?.method !== "build")
      throw Error("Expected GTGuiTheme.builder(...).build() in " + source);

    let theme = structuredClone(vanilla);
    const put = (key, values) => {theme[key] = {...theme[key], ...values};};
    function name(n) {
      if (n?.[0] === "METHOD_INVOCATION" && n[2][3] === "getFullName") n = n[2][2];
      return qualified(n);
    }
    function texture(n) {
      const id = name(n);
      return registry.get(id) ?? {missingTexture: id};
    }
    function color(n) {
      if (n?.[0] === "INT_LITERAL") return opaque(n[2]);
      if (n?.[0] === "METHOD_INVOCATION") {
        const receiver = n[2][2], method = n[2][3];
        if (method === "getRGB" && receiver[0] === "NEW_CLASS" && receiver[2] === "Color") return color(receiver[3][0]);
        const id = name(receiver) + "." + method;
        if (Number.isInteger(bindings[id])) return opaque(bindings[id]);
        // Defaults from GregTech Client.ColorModulation and Dyes.
        if (id === "Dyes.GUI_METAL.toInt") return opaque(overrides.color ?? 0xd2dcff);
        if (id === "Dyes.MACHINE_METAL.toInt" || id === "Dyes.dyeWhite.toInt") return 0xffffffff;
      }
      throw Error("Unresolved theme color at " + source + ":" + n?.[1]);
    }
    for (const {line, method, args} of chain) {
      const [a, b, c, d, e, f, g] = args;
      switch (method) {
        case "builder": case "build": break;
        case "parent": {
          const parent = name(a);
          theme = build(parent.includes(".") ? parent : owner + "." + parent);
          break;
        }
        case "color": case "textColor": theme[method] = color(a); break;
        case "textShadow": theme.textShadow = true; break;
        case "panel": put("ModularPanel", {background: texture(a)}); break;
        case "textField": put("TextFieldWidget", {textColor: color(a)}); break;
        case "button": put("ButtonWidget", {background: texture(a), hover: texture(b ?? a), textColor: c ? color(c) : 0xffffffff, textShadow: d?.[2] ?? false}); break;
        case "itemSlot": case "fluidSlot":
          put(method === "itemSlot" ? "ItemSlot" : "FluidSlot", {background: texture(a), slotHoverColor: b ? color(b) : 0x60ffffff});
          break;
        case "simpleToggleButton":
          put("ToggleButton", {background: texture(a), hover: texture(a), pressed: texture(b), pressedHover: texture(b),
            pressedColor: color(c), textColor: d ? color(d) : 0xffbbbbbb, textShadow: e?.[2] ?? false});
          break;
        case "toggleButton":
          put("ToggleButton", {background: texture(a), hover: texture(b), pressed: texture(c), pressedHover: texture(d),
            pressedColor: color(e), textColor: f ? color(f) : 0xffbbbbbb, textShadow: g?.[2] ?? false});
          break;
        case "customTextColor": put(name(a), {textColor: color(b)}); break;
        case "themedColor": put(name(a), {color: color(b)}); break;
        case "themedTexture": put(name(a), {background: texture(b)}); break;
        case "themedButton": put(name(a), {background: texture(b), hover: texture(c ?? b)}); break;
        case "themedOverlayItemSlot": case "themedOverlayFluidSlot": {
          const slot = theme[method === "themedOverlayItemSlot" ? "ItemSlot" : "FluidSlot"];
          put(name(a), {background: [slot.background, texture(b)], slotHoverColor: slot.slotHoverColor});
          break;
        }
        case "progressbar":
          put(name(a), d ? {emptyTexture: texture(b), fullTexture: texture(c), imageSize: d[2]}
            : {wholeTexture: texture(b), imageSize: c[2]});
          break;
        default: throw Error(source + ":" + line + " — unsupported GTGuiTheme.Builder." + method);
      }
    }
    seen.delete(source);
    return theme;
  }
  return merge(build(source), overrides);
}
