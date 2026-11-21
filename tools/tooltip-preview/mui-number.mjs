// Numeric TextFieldWidget's default MUI2 2.3.94 parsers use EvalEx with a
// 68-significant-digit, HALF_EVEN MathContext. Convert to double only at parse().
const precision = 68;
const absolute = n => n < 0n ? -n : n;
const magnitude = n => absolute(n).toString().length;
const pow10 = n => 10n ** BigInt(n);

function invalid() { throw new SyntaxError("Invalid numeric expression"); }

function nearestEven(a, b) {
  const negative = (a < 0n) !== (b < 0n);
  a = absolute(a);
  b = absolute(b);
  const q = a / b, remainder = a % b;
  const roundUp = remainder * 2n > b || remainder * 2n === b && q % 2n !== 0n;
  const rounded = q + (roundUp ? 1n : 0n);
  return negative ? -rounded : rounded;
}

// A BigDecimal-style coefficient and power of ten. Very large exponents do
// not allocate their corresponding number of zeroes when aligning operands.
class Decimal {
  constructor(c, e = 0, round = false) {
    if (!Number.isSafeInteger(e) || Math.abs(e) > 2147483647) invalid();
    if (round && c) {
      const trim = magnitude(c) - precision;
      if (trim > 0) { c = nearestEven(c, pow10(trim)); e += trim; }
    }
    while (c !== 0n && c % 10n === 0n) { c /= 10n; e++; }
    this.c = c;
    this.e = c === 0n ? 0 : e;
  }

  static parse(value) {
    if (typeof value === "bigint") return new Decimal(value);
    const str = String(value);
    if (/^0[xX]/.test(str)) return new Decimal(BigInt(str));
    const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(str);
    if (!m || !(m[2] || m[3])) invalid();
    const fraction = m[3] || "";
    return new Decimal(BigInt(m[1] + m[2] + fraction), Number(m[4] || 0) - fraction.length);
  }

  double() { return Number(this.c + "e" + this.e); }
  neg() { return new Decimal(-this.c, this.e); }
  order() { return magnitude(this.c) + this.e; }

  compare(b) {
    if (this.c === b.c && this.e === b.e) return 0;
    if ((this.c <= 0n && b.c >= 0n) || (this.c >= 0n && b.c <= 0n)) return this.c < b.c ? -1 : 1;
    const delta = this.order() - b.order();
    if (delta) return Math.sign(delta) * (this.c < 0n ? -1 : 1);
    const e = Math.min(this.e, b.e);
    return this.c * pow10(this.e - e) < b.c * pow10(b.e - e) ? -1 : 1;
  }

  add(b) {
    if (!this.c) return new Decimal(b.c,b.e,true);
    if (!b.c) return new Decimal(this.c,this.e,true);
    const delta = this.order() - b.order();
    if (Math.abs(delta) > precision + 2) {
      const dominant = delta > 0 ? this : b;
      return new Decimal(dominant.c,dominant.e,true);
    }
    const e = Math.min(this.e,b.e);
    return new Decimal(this.c * pow10(this.e-e) + b.c * pow10(b.e-e), e, true);
  }

  multiply(b) { return new Decimal(this.c * b.c, this.e + b.e, true); }

  divide(b) {
    if (!b.c) invalid();
    if (!this.c) return this;
    const delta = magnitude(this.c) - magnitude(b.c);
    const leading = delta >= 0
      ? absolute(this.c) >= absolute(b.c) * pow10(delta)
      : absolute(this.c) * pow10(-delta) >= absolute(b.c);
    const scale = precision - delta - (leading ? 1 : 0);
    const q = scale >= 0
      ? nearestEven(this.c * pow10(scale), b.c)
      : nearestEven(this.c, b.c * pow10(-scale));
    return new Decimal(q,this.e - b.e - scale);
  }

  remainder(b) {
    if (!b.c || this.order() - b.order() > precision) invalid();
    if (this.order() < b.order()) return this;
    const e = Math.min(this.e,b.e);
    return new Decimal(this.c * pow10(this.e-e) % (b.c * pow10(b.e-e)),e);
  }

  atScale(scale, mode = "nearest") {
    const shift = -scale - this.e;
    if (shift <= 0) return this;
    if (shift > magnitude(this.c)) {
      return new Decimal(mode === "floor" && this.c < 0n ? -1n : mode === "ceiling" && this.c > 0n ? 1n : 0n,-scale);
    }
    const unit = pow10(shift), rem = this.c % unit;
    let q = this.c / unit;
    if (mode === "nearest") q = nearestEven(this.c,unit);
    else if (mode === "floor" && rem < 0n) q--;
    else if (mode === "ceiling" && rem > 0n) q++;
    return new Decimal(q,-scale);
  }

  power(b) {
    const exponent = Math.abs(b.double()), integer = Math.trunc(exponent);
    if (integer > 999999999 || !Number.isFinite(exponent)) invalid();
    let result = one, base = this;
    for (let i = integer; i > 0; i = Math.floor(i/2)) {
      if (i % 2) result = result.multiply(base);
      if (i > 1) base = base.multiply(base);
    }
    if (exponent !== integer) {
      const fraction = (b.c < 0n ? b.neg() : b).remainder(one).double();
      result = result.multiply(Decimal.parse(Math.pow(this.double(),fraction)));
    }
    return b.c < 0n ? one.divide(result).atScale(precision) : result;
  }

  sqrt() {
    if (this.c < 0n) invalid();
    if (!this.c) return this;
    const shift = this.e + precision*2;
    if (shift < -magnitude(this.c)) invalid();
    if (shift > 4000) throw new RangeError("Square root exceeds the preview’s computation limit.");
    const n = shift < 0 ? this.c / pow10(-shift) : this.c * pow10(shift);
    let x = n >> BigInt(Math.ceil(n.toString(2).length/2));
    if (!x) invalid();
    let previous;
    do {
      previous = x;
      x = (x + n/x) >> 1n;
    } while (absolute(x-previous) > 1n);
    return new Decimal(x,-precision);
  }
}

const one = new Decimal(1n), zero = new Decimal(0n), hundred = new Decimal(1n,2);
const si = {};
for (const [i, symbol] of [..."QRYZXPTGMk"].entries()) si[symbol] = new Decimal(1n,(10-i)*3);
for (const [i, symbol] of [..."mµnpfazyrq"].entries()) si[symbol] = new Decimal(1n,-(i+1)*3);
const whole = {k:si.k, m:si.M, g:si.G, b:si.G, t:si.T, i:Decimal.parse(144), s:Decimal.parse(64)};
const constants = {
  PI:Decimal.parse("3.1415926535897932384626433832795028841971693993751058209749445923078164062862089986280348253421170679"),
  E:Decimal.parse("2.71828182845904523536028747135266249775724709369995957496696762772407663"),
  TRUE:true, FALSE:false, NULL:null,
};

function asDecimal(value) {
  if (value == null) invalid();
  if (value instanceof Decimal) return value;
  return String(value).toLowerCase() === "true" ? one : zero;
}

function requireNumber(value) {
  if (!(value instanceof Decimal)) invalid();
  return value;
}

function compare(a,b) {
  if (a instanceof Decimal && b instanceof Decimal) return a.compare(b);
  if (typeof a !== typeof b) return undefined;
  return a < b ? -1 : a > b ? 1 : 0;
}

const precedence = {"||":2,"&&":4,"=":7,"==":7,"!=":7,"<>":7,"<":10,">":10,"<=":10,">=":10,"+":20,"-":20,"*":30,"/":30,"%":30,"^":40};

function binary(op, a, right) {
  if (op === "&&") return asDecimal(a).c !== 0n && asDecimal(right()).c !== 0n;
  if (op === "||") return asDecimal(a).c !== 0n || asDecimal(right()).c !== 0n;
  const b = right();
  if (precedence[op] <= 10) {
    const c = compare(a,b);
    switch(op) {
      case "=": case "==": return c === 0;
      case "!=": case "<>": return c !== 0;
      case ">": return c > 0;
      case "<": return c < 0;
      case ">=": return c >= 0;
      case "<=": return c <= 0;
    }
  }
  if (op === "+" && (!(a instanceof Decimal) || !(b instanceof Decimal))) {
    const string = v => v instanceof Decimal ? String(v.double()) : String(v);
    return string(a) + string(b);
  }
  requireNumber(a);
  requireNumber(b);
  switch (op) {
    case "+": return a.add(b);
    case "-": return a.add(b.neg());
    case "*": return a.multiply(b);
    case "/": return a.divide(b);
    case "%": return a.remainder(b);
    case "^": return a.power(b);
  }
  invalid();
}

const arity = {ABS:1, FLOOR:1, CEILING:1, ROUND:2, SQRT:1, FACT:1, NOT:1, LOG:1, LOG10:1,
  SIN:1, COS:1, TAN:1, SINR:1, COSR:1, TANR:1, ASIN:1, ACOS:1, ATAN:1, ASINR:1, ACOSR:1,
  ATANR:1, ATAN2:2, ATAN2R:2, SINH:1, COSH:1, TANH:1, ASINH:1, ACOSH:1, ATANH:1,
  COT:1, COTR:1, SEC:1, SECR:1, CSC:1, CSCR:1, COTH:1, CSCH:1, SECH:1, ACOT:1, ACOTR:1,
  ACOTH:1, DEG:1, RAD:1, IF:3, RANDOM:0};

function call(name,args) {
  if (/^(?:STR_(?:ENDS_WITH|FORMAT|LEFT|LENGTH|LOWER|MATCHES|RIGHT|SPLIT|STARTS_WITH|SUBSTRING|TRIM|UPPER)|DT_(?:DATE_(?:NEW|PARSE|FORMAT|TO_EPOCH)|DURATION_(?:NEW|FROM_MILLIS|TO_MILLIS|PARSE)|NOW|TODAY))$/.test(name)) {
    throw Error("This EvalEx function is outside the numeric field preview: "+name);
  }
  if (Object.hasOwn(arity,name) && args.length !== arity[name]) invalid();
  const truth = n => asDecimal(n).c !== 0n;
  if (name === "IF") return truth(args[0]()) ? args[1]() : args[2]();
  if (name === "NOT") return !truth(args[0]());
  if (name === "RANDOM") return Decimal.parse(Math.random());
  if (name === "COALESCE") return args.map(arg=>arg()).find(value=>value!=null) ?? null;
  if (name === "SWITCH") {
    if (args.length < 3) invalid();
    const test = args[0]();
    for (let i = 1; i + 1 < args.length; i += 2) {
      if (compare(test,args[i]()) === 0) return args[i+1]();
    }
    return args.length % 2 === 0 ? args.at(-1)() : null;
  }
  const values = args.map(arg => arg()).map(asDecimal);
  const a = values[0], b = values[1];
  if (!values.length) invalid();
  switch (name) {
    case "ABS": return a.c < 0n ? a.neg() : a;
    case "MIN": return values.reduce((v,n) => v.compare(n) < 0 ? v : n);
    case "MAX": return values.reduce((v,n) => v.compare(n) > 0 ? v : n);
    case "SUM": return values.reduce((v,n) => v.add(n),zero);
    case "AVERAGE": return values.reduce((v,n) => v.add(n),zero).divide(Decimal.parse(values.length));
    case "FLOOR": return a.atScale(0,"floor");
    case "CEILING": return a.atScale(0,"ceiling");
    case "ROUND": return a.atScale(Math.trunc(b.double()));
    case "SQRT": return a.sqrt();
    case "FACT": {
      const count = Math.trunc(a.double());
      if (count > 10000) throw new RangeError("Factorial exceeds the preview's computation limit.");
      let n = one;
      for (let i = 2; i <= count; i++) n = n.multiply(Decimal.parse(i));
      return n;
    }
  }
  const n = a.double(), rad = n * (Math.PI / 180), deg = 180 / Math.PI;
  let result;
  switch (name) {
    case "LOG": result = Math.log(n); break;
    case "LOG10": result = Math.log10(n); break;
    case "SIN": result = Math.sin(rad); break;
    case "COS": result = Math.cos(rad); break;
    case "TAN": result = Math.tan(rad); break;
    case "COT": result = 1/Math.tan(rad); break;
    case "SEC": result = 1/Math.cos(rad); break;
    case "CSC": result = 1/Math.sin(rad); break;
    case "SINR": result = Math.sin(n); break;
    case "COSR": result = Math.cos(n); break;
    case "TANR": result = Math.tan(n); break;
    case "COTR": result = 1/Math.tan(n); break;
    case "SECR": result = 1/Math.cos(n); break;
    case "CSCR": result = 1/Math.sin(n); break;
    case "ASIN": result = Math.asin(n)*deg; break;
    case "ACOS": result = Math.acos(n)*deg; break;
    case "ATAN": result = Math.atan(n)*deg; break;
    case "ACOT": result = (Math.PI/2 - Math.atan(n))*deg; break;
    case "ASINR": result = Math.asin(n); break;
    case "ACOSR": result = Math.acos(n); break;
    case "ATANR": result = Math.atan(n); break;
    case "ACOTR": result = Math.PI/2 - Math.atan(n); break;
    case "ATAN2": result = Math.atan2(n,b.double())*deg; break;
    case "ATAN2R": result = Math.atan2(n,b.double()); break;
    case "SINH": result = Math.sinh(n); break;
    case "COSH": result = Math.cosh(n); break;
    case "TANH": result = Math.tanh(n); break;
    case "COTH": result = 1/Math.tanh(n); break;
    case "SECH": result = 1/Math.cosh(n); break;
    case "CSCH": result = 1/Math.sinh(n); break;
    case "ASINH": result = Math.log(n+Math.sqrt(n*n+1)); break;
    case "ACOSH": result = Math.log(n+Math.sqrt(n*n-1)); break;
    case "ATANH": result = 0.5*Math.log((1+n)/(1-n)); break;
    case "ACOTH": result = 0.5*Math.log((n+1)/(n-1)); break;
    case "DEG": result = n*deg; break;
    case "RAD": result = rad; break;
    default: invalid();
  }
  return Decimal.parse(result);
}

function tokens(text) {
  const result = [];
  // Tokenizer consumes an adjacent e/E as a numeric exponent even when the
  // exponent is malformed. An identifier after a space remains a variable.
  const pattern = /\s+|0[xX][0-9a-fA-F]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d*)?|[\p{L}_][\p{L}\p{N}_]*|"(?:[^"\\]|\\.)*"|<=|>=|==|!=|<>|&&|\|\||[()+\-/^*%,!<>=]/guy;
  while (pattern.lastIndex < text.length) {
    const m = pattern.exec(text);
    if (!m) invalid();
    const token = m[0];
    if (/^\s/.test(token)) continue;
    const number = /^[.\d]/.test(token);
    const word = /^[\p{L}_]/u.test(token);
    const previous = result.at(-1);
    if ((previous?.number && (word || token === "(")) || (previous?.value === ")" && token === "(")) {
      result.push({value:"*"});
    }
    result.push({value:token,number,word});
  }
  return result;
}

function evaluate(text,wholeNumbers) {
  const stream = tokens(text);
  let index = 0;
  const peek = () => stream[index]?.value;
  function read(level) {
    const t = stream[index++];
    if (!t) invalid();
    let node;
    if (t.number) {
      const number = Decimal.parse(t.value);
      node = () => number;
    } else if (t.value === "(") {
      node = read(0);
      if (stream[index++]?.value !== ")") invalid();
    } else if (t.value === "+" || t.value === "-" || t.value === "!") {
      // EvalEx's prefix NOT is left-associative at unary precedence.
      if (peek() === "!") invalid();
      const operand = read(60);
      node = () => {
        const v = operand();
        if (t.value === "!") return asDecimal(v).c === 0n;
        return t.value === "-" ? requireNumber(v).neg() : requireNumber(v);
      };
    } else if (t.word) {
      const name = t.value.toUpperCase();
      if (peek() === "(") {
        index++;
        const args = [];
        if (peek() !== ")") {
          args.push(read(0));
          while (peek() === ",") { index++; args.push(read(0)); }
        }
        if (stream[index++]?.value !== ")") invalid();
        node = () => call(name,args);
      } else {
        const units = wholeNumbers ? whole : si;
        const key = wholeNumbers ? t.value.toLowerCase() : t.value;
        node = () => {
          if (Object.hasOwn(units,key)) return units[key];
          if (Object.hasOwn(constants,name)) return constants[name];
          invalid();
        };
      }
    } else if (t.value.startsWith('"')) {
      const value = JSON.parse(t.value);
      node = () => value;
    } else invalid();
    while (Object.hasOwn(precedence,peek())) {
      const op = peek(), after = stream[index+1];
      const postfix = op === "%" && !(after?.number || after?.word || after?.value === "(" || after?.value?.startsWith('"'));
      const rank = postfix ? 29 : precedence[op];
      if (rank < level) break;
      index++;
      const lhs = node;
      if (postfix) {
        if (after?.value === "%") invalid();
        node = () => requireNumber(lhs()).divide(hundred);
      } else {
        const rhs = read(op === "^" ? rank : rank + 1);
        node = () => binary(op,lhs(),rhs);
      }
    }
    return node;
  }
  const root = read(0);
  if (index !== stream.length) invalid();
  return asDecimal(root()).double();
}

// NumberFormat.AMOUNT_TEXT has US decimal symbols, no grouping, and Java's
// prefix-parse semantics. Its exponent separator is uppercase E.
function plainNumber(text) {
  if (text.startsWith("NaN")) return NaN;
  if (text.startsWith("∞")) return Infinity;
  if (text.startsWith("-∞")) return -Infinity;
  const m = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:E-?\d+)?/.exec(text);
  return m ? Number(m[0]) : 0;
}

export function parseNumericInput(control,input) {
  // Java's Character.digit(char, 10) accepts BMP decimal digits. For each
  // contiguous run the zero-to-nine values repeat in Unicode order.
  const text = String(input).replace(/[^\x00-\x7f]/g,ch => {
    if (!/\p{Nd}/u.test(ch)) return ch;
    const code = ch.charCodeAt(0);
    let first = code;
    while (/\p{Nd}/u.test(String.fromCharCode(first-1))) first--;
    return String((code-first)%10);
  });
  if (control.acceptsExpression === false) return plainNumber(text);
  const fallback = control.defaultNumber ?? 0;
  if (!text) return fallback;
  const wholeNumbers = control.numberMode ? ["numbersInt","numbersLong"].includes(control.numberMode)
    : control.integer && control.rounding !== "truncate";
  try {
    return evaluate(text,wholeNumbers);
  } catch (error) {
    if (error instanceof SyntaxError) return fallback;
    throw error;
  }
}

// DecimalFormat.format(double) rounds the actual binary64 value when a
// shortest decimal spelling ends exactly halfway between the last digits.
function fieldDecimal(value) {
  if (!Number.isFinite(value) || Math.trunc(value) === value) return value;
  const bits = new DataView(new ArrayBuffer(8));
  bits.setFloat64(0,Math.abs(value));
  const binary = bits.getBigUint64(0);
  const exponent = Number(binary >> 52n);
  const mantissa = (binary & ((1n<<52n)-1n)) + (exponent ? 1n<<52n : 0n);
  const shift = (exponent || 1) - 1075;
  if (shift >= 0) return value;
  const rounded = nearestEven(mantissa*1000n,1n<<BigInt(-shift));
  // Parse the formatted decimal directly, avoiding a second binary rounding.
  const result = Number(rounded+"e-3");
  return value < 0 ? -result : result;
}

export function numericValue(control,input,fromText) {
  const text = String(input);
  let n = fromText ? (text === "" ? control.defaultNumber ?? 0 : parseNumericInput(control,text)) : input;
  if (typeof n !== "number" || !fromText && !Number.isFinite(n)) throw Error("Expected a finite numeric control value.");
  if (fromText && control.relativeToMax && (text.includes("%") || n<=1 && Math.abs(n-Math.round(n))>=1e-7)) n *= control.max;
  if (control.integer) {
    if (Number.isNaN(n)) n = 0;
    const isInt = control.numberMode === "numbersInt" || control.numberMode === "setNumbers";
    const limit = isInt ? 2**31 : 2**63;
    n = control.rounding === "truncate" ? Math.trunc(n) : Math.round(n);
    n = Math.max(-limit,Math.min(isInt ? limit-1 : limit,n));
  }
  if (control.max != null) n = Math.min(n,control.max);
  if (control.min != null) n = Math.max(n,control.min);
  if (!Number.isFinite(n)) throw Error("A non-finite field value cannot be stored in JSON.");
  if (control.integer && !Number.isSafeInteger(n)) throw Error("Integer exceeds the preview's exact range.");
  return control.integer ? n || 0 : fieldDecimal(n);
}

// onMouseScroll sends Double.toString(parse(text) + step) through the same
// validator again. DecimalFormat in particular only accepts uppercase E.
export function numericScrollValue(control,text,signedStep) {
  const n = parseNumericInput(control,text) + signedStep;
  const magnitude = Math.abs(n);
  const spelling = magnitude !== 0 && (magnitude < 1e-3 || magnitude >= 1e7) && Number.isFinite(n)
    ? n.toExponential().replace(/e\+?/,"E") : String(n);
  return numericValue(control,spelling,true);
}
