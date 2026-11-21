import com.sun.source.tree.ArrayAccessTree;
import com.sun.source.tree.AssignmentTree;
import com.sun.source.tree.BinaryTree;
import com.sun.source.tree.BlockTree;
import com.sun.source.tree.ClassTree;
import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.tree.ConditionalExpressionTree;
import com.sun.source.tree.EnhancedForLoopTree;
import com.sun.source.tree.ExpressionStatementTree;
import com.sun.source.tree.ExpressionTree;
import com.sun.source.tree.IdentifierTree;
import com.sun.source.tree.IfTree;
import com.sun.source.tree.LambdaExpressionTree;
import com.sun.source.tree.LiteralTree;
import com.sun.source.tree.MemberSelectTree;
import com.sun.source.tree.MethodInvocationTree;
import com.sun.source.tree.MethodTree;
import com.sun.source.tree.NewArrayTree;
import com.sun.source.tree.NewClassTree;
import com.sun.source.tree.ParenthesizedTree;
import com.sun.source.tree.ReturnTree;
import com.sun.source.tree.StatementTree;
import com.sun.source.tree.Tree;
import com.sun.source.tree.TypeCastTree;
import com.sun.source.tree.UnaryTree;
import com.sun.source.tree.VariableTree;
import com.sun.source.util.JavacTask;
import com.sun.source.util.Trees;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.text.NumberFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaFileObject;
import javax.tools.ToolProvider;

/** Evaluates display methods against explicit controller fields or Waila's synchronized tag. */
class MachineText {
    private final SourceTooltip strings = new SourceTooltip();
    private final Map<String, Object> fields = new HashMap<>(),
            nbt = new HashMap<>(),
            calls = new HashMap<>();
    private final Map<String, MethodTree> methods = new HashMap<>();
    private final Set<String> visited = new LinkedHashSet<>();
    private final List<String> tip = new ArrayList<>();
    private Map<String, Object> locals = new HashMap<>();
    private CompilationUnitTree unit;
    private Trees trees;
    private int depth, steps;

    private enum Token {
        NBT,
        ACCESSOR,
        TILE
    }

    private record Returned(Object value) {}

    private record Stack(String displayName) {}

    public static void main(String[] args) throws Exception {
        MachineText machine = new MachineText();
        Path file = Path.of(args[0]);
        String entry = args[1];
        if (!Set.of("getInfoData", "getExtraInfoData", "getWailaBody").contains(entry))
            throw new IllegalArgumentException("Choose a scanner or Waila body method.");
        machine.strings.locale = args[2];
        for (int i = 3; i < args.length; i++) machine.strings.readLanguage(Path.of(args[i]));
        machine.strings.readSourceComments(file, args[2]);
        machine.readState();
        var diagnostics = new DiagnosticCollector<JavaFileObject>();
        var compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) throw new IllegalArgumentException("Machine reports require a JDK.");
        try (var fm =
                compiler.getStandardFileManager(diagnostics, Locale.ROOT, StandardCharsets.UTF_8)) {
            var task =
                    (JavacTask)
                            compiler.getTask(
                                    null,
                                    fm,
                                    diagnostics,
                                    List.of("-proc:none"),
                                    null,
                                    fm.getJavaFileObjects(file));
            machine.unit = task.parse().iterator().next();
            if (diagnostics.getDiagnostics().stream()
                    .anyMatch(d -> d.getKind() == Diagnostic.Kind.ERROR))
                throw new IllegalArgumentException(
                        "Cannot parse " + file + ": " + diagnostics.getDiagnostics());
            machine.trees = Trees.instance(task);
            machine.strings.setImports(file, machine.unit);
            var type =
                    (ClassTree)
                            machine.unit.getTypeDecls().stream()
                                    .filter(
                                            t ->
                                                    t instanceof ClassTree c
                                                            && file.getFileName()
                                                                    .toString()
                                                                    .equals(
                                                                            c.getSimpleName()
                                                                                    + ".java"))
                                    .findFirst()
                                    .orElseThrow();
            for (Tree member : type.getMembers())
                if (member instanceof MethodTree m && m.getBody() != null) {
                    String key = m.getName() + "/" + m.getParameters().size();
                    if (machine.methods.containsKey(key)) machine.methods.put(key, null);
                    else machine.methods.put(key, m);
                }
            List<String> rows;
            if (entry.equals("getWailaBody")) {
                machine.invoke(entry, Arrays.asList(null, machine.tip, Token.ACCESSOR, null));
                rows = machine.tip;
            } else {
                String[] result = (String[]) machine.invoke(entry, List.of());
                rows = Arrays.stream(result).filter(Objects::nonNull).toList();
            }
            String json =
                    "{\"lines\":"
                            + SourceTooltip.array(rows)
                            + ",\"methods\":"
                            + SourceTooltip.array(new ArrayList<>(machine.visited))
                            + ",\"unresolved\":[]}";
            System.out.write(json.getBytes(StandardCharsets.UTF_8));
        }
    }

    private void readState() throws Exception {
        var reader =
                new java.io.BufferedReader(
                        new java.io.InputStreamReader(System.in, StandardCharsets.UTF_8));
        for (String line; (line = reader.readLine()) != null; ) {
            String[] parts = line.split("\t", -1);
            Map<String, Object> group =
                    switch (parts[0]) {
                        case "fields" -> fields;
                        case "nbt" -> nbt;
                        case "calls" -> calls;
                        default ->
                                throw new IllegalArgumentException(
                                        "Unknown state group: " + parts[0]);
                    };
            String value = new String(Base64.getDecoder().decode(parts[3]), StandardCharsets.UTF_8);
            Object typed =
                    switch (parts[2]) {
                        case "string" -> value;
                        case "null" -> null;
                        case "boolean" -> Boolean.valueOf(value);
                        case "long" -> Long.valueOf(value);
                        case "double" -> Double.valueOf(value);
                        case "list" -> new ArrayList<String>();
                        case "element" -> {
                            @SuppressWarnings("unchecked")
                            var list = (List<String>) group.get(parts[1]);
                            list.add(value);
                            yield list;
                        }
                        default -> throw new IllegalArgumentException("Unknown state type.");
                    };
            group.put(parts[1], typed);
        }
    }

    private long line(Tree t) {
        return unit.getLineMap()
                .getLineNumber(trees.getSourcePositions().getStartPosition(unit, t));
    }

    private RuntimeException unsupported(Tree t) {
        return new IllegalArgumentException(
                "Unsupported display expression or missing state at line " + line(t) + ": " + t);
    }

    private Object invoke(String name, List<Object> args) {
        MethodTree method = methods.get(name + "/" + args.size());
        if (method == null || ++depth > 20)
            throw new IllegalArgumentException("Missing, ambiguous or recursive method: " + name);
        visited.add(name + ":" + line(method));
        var previous = locals;
        locals = new HashMap<>();
        try {
            for (int i = 0; i < args.size(); i++)
                locals.put(method.getParameters().get(i).getName().toString(), args.get(i));
            Returned ret = statement(method.getBody());
            return ret == null ? null : ret.value;
        } finally {
            locals = previous;
            depth--;
        }
    }

    private Returned statement(StatementTree t) {
        if (t == null) return null;
        if (++steps > 50000)
            throw new IllegalArgumentException("Machine display exceeds evaluation limit.");
        if (t instanceof BlockTree block) {
            for (var stmt : block.getStatements()) {
                var ret = statement(stmt);
                if (ret != null) return ret;
            }
        } else if (t instanceof VariableTree var) {
            locals.put(var.getName().toString(), expr(var.getInitializer()));
        } else if (t instanceof IfTree branch) {
            return statement(
                    (boolean) expr(branch.getCondition())
                            ? branch.getThenStatement()
                            : branch.getElseStatement());
        } else if (t instanceof ReturnTree ret) {
            return new Returned(expr(ret.getExpression()));
        } else if (t instanceof ExpressionStatementTree stmt) {
            expr(stmt.getExpression());
        } else if (t instanceof EnhancedForLoopTree loop
                && expr(loop.getExpression()) instanceof List<?> values) {
            for (Object value : values) {
                locals.put(loop.getVariable().getName().toString(), value);
                var ret = statement(loop.getStatement());
                if (ret != null) return ret;
            }
        } else throw unsupported(t);
        return null;
    }

    private Object expr(ExpressionTree t) {
        if (t == null) return null;
        if (t instanceof LiteralTree lit) return lit.getValue();
        if (t instanceof ParenthesizedTree p) return expr(p.getExpression());
        if (t instanceof ConditionalExpressionTree c)
            return expr(
                    (boolean) expr(c.getCondition())
                            ? c.getTrueExpression()
                            : c.getFalseExpression());
        if (t instanceof IdentifierTree id) {
            String name = id.getName().toString();
            if (locals.containsKey(name)) return locals.get(name);
            if (fields.containsKey(name)) return fields.get(name);
        }
        if (t instanceof MemberSelectTree m) {
            if (m.getExpression().toString().equals("this")
                    && fields.containsKey(m.getIdentifier().toString()))
                return fields.get(m.getIdentifier().toString());
            if (m.getIdentifier().contentEquals("length")
                    && expr(m.getExpression()) instanceof Object[] array) return array.length;
        }
        if (t instanceof IdentifierTree || t instanceof MemberSelectTree) {
            String constant = strings.evaluate(t);
            if (constant != null) return constant;
            throw unsupported(t);
        }
        if (t instanceof MethodInvocationTree call) return call(call);
        if (t instanceof BinaryTree b) return binary(b);
        if (t instanceof UnaryTree u) {
            Object value = expr(u.getExpression());
            if (u.getKind() == Tree.Kind.LOGICAL_COMPLEMENT) return !(boolean) value;
            if (u.getKind() == Tree.Kind.POSTFIX_INCREMENT
                    && u.getExpression() instanceof IdentifierTree id) {
                locals.put(id.getName().toString(), ((Number) value).intValue() + 1);
                return value;
            }
        }
        if (t instanceof TypeCastTree c) {
            Number n = (Number) expr(c.getExpression());
            return switch (c.getType().toString()) {
                case "double" -> Double.valueOf(n.doubleValue());
                case "int" -> Integer.valueOf(n.intValue());
                default -> throw unsupported(t);
            };
        }
        if (t instanceof AssignmentTree a) {
            Object value = expr(a.getExpression());
            if (a.getVariable() instanceof IdentifierTree id
                    && locals.containsKey(id.getName().toString()))
                locals.put(id.getName().toString(), value);
            else if (a.getVariable() instanceof ArrayAccessTree index)
                ((Object[]) expr(index.getExpression()))
                                [((Number) expr(index.getIndex())).intValue()] =
                        value;
            else throw unsupported(t);
            return value;
        }
        if (t instanceof NewClassTree ctor && ctor.getArguments().isEmpty()) {
            String type = ctor.getIdentifier().toString();
            if (type.equals("ArrayList<>")) return new ArrayList<>();
            if (type.equals("StringBuilder")) return new StringBuilder();
        }
        if (t instanceof NewArrayTree a && a.getType().toString().equals("String")) {
            if (a.getInitializers() != null)
                return a.getInitializers().stream()
                        .map(x -> (String) expr(x))
                        .toArray(String[]::new);
            int count = ((Number) expr(a.getDimensions().get(0))).intValue();
            if (count < 0 || count > 4096) throw unsupported(t);
            return new String[count];
        }
        if (t instanceof ArrayAccessTree a)
            return ((Object[]) expr(a.getExpression()))[((Number) expr(a.getIndex())).intValue()];
        throw unsupported(t);
    }

    private Object binary(BinaryTree b) {
        Tree.Kind op = b.getKind();
        Object left = expr(b.getLeftOperand());
        if (op == Tree.Kind.CONDITIONAL_AND)
            return (boolean) left && (boolean) expr(b.getRightOperand());
        if (op == Tree.Kind.CONDITIONAL_OR)
            return (boolean) left || (boolean) expr(b.getRightOperand());
        Object right = expr(b.getRightOperand());
        if (op == Tree.Kind.PLUS && (left instanceof String || right instanceof String))
            return String.valueOf(left) + right;
        if (op == Tree.Kind.EQUAL_TO || op == Tree.Kind.NOT_EQUAL_TO) {
            boolean equal =
                    left instanceof Number a && right instanceof Number n
                            ? compare(a, n) == 0
                            : Objects.equals(left, right);
            return op == Tree.Kind.EQUAL_TO ? equal : !equal;
        }
        Number a = (Number) left, n = (Number) right;
        boolean floating =
                a instanceof Double
                        || n instanceof Double
                        || a instanceof Float
                        || n instanceof Float;
        return switch (op) {
            case LESS_THAN -> compare(a, n) < 0;
            case GREATER_THAN -> compare(a, n) > 0;
            case LESS_THAN_EQUAL -> compare(a, n) <= 0;
            case GREATER_THAN_EQUAL -> compare(a, n) >= 0;
            case PLUS, MINUS, MULTIPLY, DIVIDE -> {
                if (floating)
                    yield switch (op) {
                        case PLUS -> a.doubleValue() + n.doubleValue();
                        case MINUS -> a.doubleValue() - n.doubleValue();
                        case MULTIPLY -> a.doubleValue() * n.doubleValue();
                        default -> a.doubleValue() / n.doubleValue();
                    };
                long value =
                        switch (op) {
                            case PLUS -> a.longValue() + n.longValue();
                            case MINUS -> a.longValue() - n.longValue();
                            case MULTIPLY -> a.longValue() * n.longValue();
                            default -> a.longValue() / n.longValue();
                        };
                if (a instanceof Long || n instanceof Long) yield value;
                yield (int) value;
            }
            default -> throw unsupported(b);
        };
    }

    private static int compare(Number a, Number b) {
        if (a instanceof Double || b instanceof Double || a instanceof Float || b instanceof Float)
            return Double.compare(a.doubleValue(), b.doubleValue());
        return Long.compare(a.longValue(), b.longValue());
    }

    @SuppressWarnings("unchecked")
    private Object call(MethodInvocationTree c) {
        var selector = c.getMethodSelect();
        var member = selector instanceof MemberSelectTree m ? m : null;
        String owner = member == null ? "" : member.getExpression().toString();
        String name = member == null ? selector.toString() : member.getIdentifier().toString();
        if (owner.equals("super") && Set.of("getInfoData", "getExtraInfoData").contains(name))
            return new String[0];
        if (owner.equals("super") && name.equals("getWailaBody")) return null;
        if (name.equals("removeIf")
                && c.getArguments().get(0) instanceof LambdaExpressionTree lambda
                && lambda.getBody() instanceof ExpressionTree test) {
            var list = (List<?>) expr(member.getExpression());
            String variable = lambda.getParameters().get(0).getName().toString();
            list.removeIf(
                    item -> {
                        locals.put(variable, item);
                        return (boolean) expr(test);
                    });
            locals.remove(variable);
            return null;
        }
        List<Object> args = new ArrayList<>();
        for (var arg : c.getArguments()) args.add(expr(arg));
        if (owner.equals("System") && name.equals("arraycopy")) {
            System.arraycopy(
                    args.get(0),
                    ((Number) args.get(1)).intValue(),
                    args.get(2),
                    ((Number) args.get(3)).intValue(),
                    ((Number) args.get(4)).intValue());
            return null;
        }
        if (Set.of("tr", "translateToLocal", "translateToLocalFormatted").contains(name)) {
            String key = (String) args.get(0), pattern = strings.translation(key);
            if (pattern == null) throw new IllegalArgumentException("Missing translation: " + key);
            return args.size() == 1
                    ? pattern
                    : String.format(Locale.ROOT, pattern, args.subList(1, args.size()).toArray());
        }
        if (owner.equals("Math")) {
            Number first = (Number) args.get(0);
            return switch (name) {
                case "min" -> Math.min(first.intValue(), ((Number) args.get(1)).intValue());
                case "max" -> Math.max(first.intValue(), ((Number) args.get(1)).intValue());
                case "abs" -> Math.abs(first.intValue());
                case "ceil" -> Math.ceil(first.doubleValue());
                default -> throw unsupported(c);
            };
        }
        if (name.equals("formatNumber") && args.size() == 1)
            return NumberFormat.getIntegerInstance(Locale.US).format(args.get(0));
        if (owner.isEmpty() || owner.equals("this")) {
            if (name.equals("getBaseMetaTileEntity") && args.isEmpty()) return Token.TILE;
            if (args.isEmpty() && calls.containsKey(name)) return calls.get(name);
            return invoke(name, args);
        }
        Object target = expr(member.getExpression());
        if (target == Token.NBT && args.size() == 1) {
            Object val = nbt.get((String) args.get(0));
            return switch (name) {
                case "hasKey" -> nbt.containsKey(args.get(0));
                case "getBoolean" ->
                        val instanceof Boolean b
                                ? b
                                : val instanceof Number n && n.byteValue() != 0;
                case "getInteger" -> val instanceof Number n ? n.intValue() : 0;
                case "getLong" -> val instanceof Number n ? n.longValue() : 0L;
                case "getString" -> val instanceof String s ? s : "";
                default -> throw unsupported(c);
            };
        }
        if (target == Token.TILE && name.equals("isActive") && calls.containsKey("isActive"))
            return calls.get("isActive");
        if (target == Token.ACCESSOR && name.equals("getNBTData")) return Token.NBT;
        if (target instanceof List list)
            return switch (name) {
                case "add" -> list.add(args.get(0));
                case "isEmpty" -> list.isEmpty();
                case "size" -> list.size();
                default -> throw unsupported(c);
            };
        if (target instanceof String s && name.equals("getOutputs"))
            return new Stack[] {new Stack(s)};
        if (target instanceof Stack stack && name.equals("getItemStack")) return stack;
        if (target instanceof Stack stack && name.equals("getDisplayName"))
            return stack.displayName();
        if (target instanceof String s && name.equals("contains"))
            return s.contains((String) args.get(0));
        if (target instanceof StringBuilder sb) {
            if (name.equals("append")) return sb.append(args.get(0));
            if (name.equals("toString")) return sb.toString();
        }
        throw unsupported(c);
    }
}
