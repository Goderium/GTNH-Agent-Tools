
import com.sun.source.tree.ArrayAccessTree;
import com.sun.source.tree.AssignmentTree;
import com.sun.source.tree.BinaryTree;
import com.sun.source.tree.ClassTree;
import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.tree.ConditionalExpressionTree;
import com.sun.source.tree.DoWhileLoopTree;
import com.sun.source.tree.EnhancedForLoopTree;
import com.sun.source.tree.ExpressionTree;
import com.sun.source.tree.ForLoopTree;
import com.sun.source.tree.IdentifierTree;
import com.sun.source.tree.IfTree;
import com.sun.source.tree.LiteralTree;
import com.sun.source.tree.MemberSelectTree;
import com.sun.source.tree.MethodInvocationTree;
import com.sun.source.tree.MethodTree;
import com.sun.source.tree.NewArrayTree;
import com.sun.source.tree.ParenthesizedTree;
import com.sun.source.tree.ReturnTree;
import com.sun.source.tree.SwitchExpressionTree;
import com.sun.source.tree.SwitchTree;
import com.sun.source.tree.Tree;
import com.sun.source.tree.UnaryTree;
import com.sun.source.tree.VariableTree;
import com.sun.source.tree.WhileLoopTree;
import com.sun.source.util.JavacTask;
import com.sun.source.util.TreeScanner;
import com.sun.source.util.Trees;

import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;
import java.nio.charset.StandardCharsets;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Parses one Java source file without analyzing, compiling or executing its classes. */
class SourceTooltip {
    private static final Set<String> INFO = Set.of("addInfo", "addMachineType", "addStructureInfo",
        "addDescription", "addTooltip", "setTooltip", "addLine", "setTooltipLine");
    private static final Set<String> STRUCTURAL = Set.of("beginStructureBlock", "beginStructureBlockCustom",
        "addCasingInfo", "addCasingInfoMin", "addController", "addMaintenanceHatch", "addEnergyHatch",
        "addInputBus", "addOutputBus", "addInputHatch", "addOutputHatch", "toolTipFinisher", "tooltipFinisher",
        "addMufflerHatch", "addOtherStructurePart", "addSubChannelUsage", "addTecTechHatchInfo");
    private static final List<String> COLORS = List.of("BLACK", "DARK_BLUE", "DARK_GREEN", "DARK_AQUA",
        "DARK_RED", "DARK_PURPLE", "GOLD", "GRAY", "DARK_GRAY", "BLUE", "GREEN", "AQUA", "RED",
        "LIGHT_PURPLE", "YELLOW", "WHITE", "OBFUSCATED", "BOLD", "STRIKETHROUGH", "UNDERLINE", "ITALIC", "RESET");
    private final Map<String, String> language = new HashMap<>();
    private final Map<String, Boolean> flags = new HashMap<>();
    private final Map<String, String> constants = new HashMap<>();
    private final Map<String, String> imports = new HashMap<>();
    private final Map<Path, Map<String, ExpressionTree>> importedFields = new HashMap<>();
    private final Set<String> resolving = new HashSet<>();
    private final List<String> lines = new ArrayList<>();
    private final List<String> issues = new ArrayList<>();
    private final List<String> methods = new ArrayList<>();
    private Path sourceRoot;
    String locale;
    private int gtFinisherStyle = 3;

    public static void main(String[] args) throws Exception {
        if (args.length < 4) throw new IllegalArgumentException("Usage: SourceTooltip.java source.java method|auto flags locale [lang ...]");
        SourceTooltip extractor = new SourceTooltip();
        for (String flag : args[2].split(",")) if (!flag.isEmpty()) {
            if (flag.startsWith("gtFinisher=")) extractor.gtFinisherStyle = Integer.parseInt(flag.substring(11));
            else extractor.flags.put(flag.replaceFirst("^!", ""), !flag.startsWith("!"));
        }
        extractor.locale = args[3];
        for (int i = 4; i < args.length; i++) extractor.readLanguage(Path.of(args[i]));
        extractor.readSourceComments(Path.of(args[0]), args[3]);
        extractor.read(Path.of(args[0]), args[1]);
        String json = "{\"lines\":" + array(extractor.lines) + ",\"methods\":" + array(extractor.methods)
            + ",\"unresolved\":" + array(extractor.issues) + "}";
        System.out.write(json.getBytes(StandardCharsets.UTF_8));
    }

    void readSourceComments(Path file, String locale) throws Exception {
        if (Files.size(file) > 4 * 1024 * 1024) throw new IllegalArgumentException("Java source is too large.");
        Pattern keyLine = Pattern.compile("^\\s*//\\s*#tr\\s+(\\S+)\\s*$");
        Pattern langLine = Pattern.compile("^\\s*//\\s*#([a-zA-Z_]+)? +(.*)$");
        Pattern formatting = Pattern.compile("\\{\\\\([A-Z_]+)}");
        String key = null;
        Map<String, String> english = new LinkedHashMap<>(), selected = new LinkedHashMap<>();
        for (String line : Files.readAllLines(file, StandardCharsets.UTF_8)) {
            var declaration = keyLine.matcher(line);
            if (declaration.matches()) { key = declaration.group(1); continue; }
            var translation = langLine.matcher(line);
            if (key == null || !translation.matches()) { key = null; continue; }
            var matcher = formatting.matcher(translation.group(2));
            String value = matcher.replaceAll(token -> {
                int i = COLORS.indexOf(token.group(1));
                return Matcher.quoteReplacement(i < 0 ? token.group() : "§" + "0123456789abcdefklmnor".charAt(i));
            });
            String tag = translation.group(1);
            if (tag == null || tag.equals("en_US")) english.put(key, value);
            if (locale.equals(tag)) selected.put(key, value);
        }
        english.forEach((k,v) -> { if (locale.equals("en_US")) language.put(k,v); else language.putIfAbsent(k,v); });
        language.putAll(selected);
    }

    void readLanguage(Path path) throws Exception {
        if (Files.size(path) > 4 * 1024 * 1024) throw new IllegalArgumentException("Language file is too large: " + path);
        for (String row : Files.readAllLines(path, StandardCharsets.UTF_8)) {
            String line = row.replaceFirst("^\uFEFF", "");
            int eq = line.indexOf('=');
            if (eq > 0 && !line.stripLeading().startsWith("#")) {
                language.put(line.substring(0, eq).strip(), line.substring(eq + 1));
            }
        }
    }

    void setImports(Path file, CompilationUnitTree unit) {
        sourceRoot = file.toAbsolutePath().normalize().getParent();
        String[] parts = Objects.toString(unit.getPackageName(), "").split("\\.");
        for (int i=parts.length-1; i>=0 && !parts[i].isEmpty(); i--) {
            if (sourceRoot == null || sourceRoot.getFileName() == null
                || !parts[i].equals(sourceRoot.getFileName().toString())) {
                sourceRoot = null;
                break;
            }
            sourceRoot = sourceRoot.getParent();
        }
        for (var declaration : unit.getImports()) {
            String name = declaration.getQualifiedIdentifier().toString();
            if (!name.endsWith(".*")) imports.put(name.substring(name.lastIndexOf('.')+1), name);
        }
    }

    String translation(String key) { return language.get(key); }

    private void read(Path file, String wanted) throws Exception {
        if (!file.getFileName().toString().endsWith(".java") || Files.size(file) > 4 * 1024 * 1024) {
            throw new IllegalArgumentException("Expected a Java source file no larger than 4 MiB.");
        }
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) throw new IllegalArgumentException("A JDK with javac is required.");
        DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<>();
        try (StandardJavaFileManager fm = compiler.getStandardFileManager(diagnostics, Locale.ROOT, StandardCharsets.UTF_8)) {
            var objects = fm.getJavaFileObjectsFromPaths(List.of(file));
            JavacTask task = (JavacTask) compiler.getTask(null, fm, diagnostics, List.of("-proc:none"), null, objects);
            for (CompilationUnitTree unit : task.parse()) {
                setImports(file, unit);
                final var positions = Trees.instance(task).getSourcePositions();
                int sourceSize = unit.getSourceFile().getCharContent(true).length();
                new TreeScanner<Void, Void>() {
                    @Override public Void visitVariable(VariableTree node, Void unused) {
                        if (node.getModifiers().getFlags().contains(javax.lang.model.element.Modifier.FINAL)) {
                            String value = evaluate(node.getInitializer());
                            if (value != null) constants.put(node.getName().toString(), value);
                        }
                        return null;
                    }
                    @Override public Void visitMethod(MethodTree node, Void unused) { return null; }
                }.scan(unit, null);

                new TreeScanner<Void, Void>() {
                    private String method;
                    private boolean dynamic;
                    @Override public Void visitMethod(MethodTree node, Void unused) {
                        String name = node.getName().toString();
                        if (!(wanted.equals("auto") ? autodetect(name) : wanted.equals(name))) return null;
                        String previous = method;
                        method = name;
                        methods.add(name + ":" + line(node));
                        scan(node.getBody(), unused);
                        method = previous;
                        return null;
                    }
                    @Override public Void visitVariable(VariableTree node, Void unused) {
                        if (method != null && !dynamic && node.getModifiers().getFlags().contains(javax.lang.model.element.Modifier.FINAL)) {
                            String value = evaluate(node.getInitializer());
                            if (value != null) constants.put(node.getName().toString(), value);
                        }
                        return super.visitVariable(node, unused);
                    }
                    @Override public Void visitIf(IfTree node, Void unused) {
                        Boolean decision = condition(node.getCondition());
                        if (decision != null) return scan(decision ? node.getThenStatement() : node.getElseStatement(), unused);
                        return scanDynamic(node, unused);
                    }
                    @Override public Void visitForLoop(ForLoopTree node, Void unused) { return scanDynamic(node, unused); }
                    @Override public Void visitEnhancedForLoop(EnhancedForLoopTree node, Void unused) { return scanDynamic(node, unused); }
                    @Override public Void visitWhileLoop(WhileLoopTree node, Void unused) { return scanDynamic(node, unused); }
                    @Override public Void visitDoWhileLoop(DoWhileLoopTree node, Void unused) { return scanDynamic(node, unused); }
                    @Override public Void visitSwitch(SwitchTree node, Void unused) { return scanDynamic(node, unused); }
                    @Override public Void visitSwitchExpression(SwitchExpressionTree node, Void unused) { return scanDynamic(node, unused); }

                    private Void scanDynamic(Tree node, Void unused) {
                        boolean before = dynamic;
                        dynamic = true;
                        // Scan descendants once while keeping their output out of the resolved line list.
                        if (node instanceof IfTree branch) {
                            scan(branch.getThenStatement(), unused);
                            scan(branch.getElseStatement(), unused);
                        } else scan(children(node), unused);
                        dynamic = before;
                        return null;
                    }
                    private Iterable<? extends Tree> children(Tree node) {
                        if (node instanceof ForLoopTree t) return List.of(t.getStatement());
                        if (node instanceof EnhancedForLoopTree t) return List.of(t.getStatement());
                        if (node instanceof WhileLoopTree t) return List.of(t.getStatement());
                        if (node instanceof DoWhileLoopTree t) return List.of(t.getStatement());
                        if (node instanceof SwitchTree t) return t.getCases();
                        if (node instanceof SwitchExpressionTree t) return t.getCases();
                        return List.of();
                    }

                    @Override public Void visitMethodInvocation(MethodInvocationTree node, Void unused) {
                        super.visitMethodInvocation(node, unused);
                        if (method == null) return null;
                        String select = node.getMethodSelect().toString();
                        String name = callName(node);
                        var args = node.getArguments();
                        boolean builder = method.equals("createTooltip") || select.toLowerCase(Locale.ROOT).contains("tooltip");
                        boolean sink = INFO.contains(name) && (builder || !name.equals("addInfo")) ||
                            name.matches("add|addAll|set") && isTooltipReceiver(select);
                        if (STRUCTURAL.contains(name) && builder) {
                            boolean structureView = Boolean.TRUE.equals(flags.get("shift"));
                            if (!method.equals("createTooltip") || structureView) warn(node, "generated GT builder section");
                            else if (Set.of("toolTipFinisher","tooltipFinisher").contains(name) && gtFinisherStyle>0) {
                                lines.add(switch (gtFinisherStyle) {
                                    case 1 -> " ";
                                    case 2 -> "§7-----------------------------------------";
                                    default -> "§7§m-----------------------------------------";
                                });
                            }
                        } else if (method.equals("createTooltip") && name.equals("addMachineType") && args.size()==1 && !dynamic) {
                            String value=evaluate(args.get(0));
                            if (value==null) warn(args.get(0), "cannot resolve machine type");
                            else lines.add("§7"+language.getOrDefault("GT5U.MBTT.MachineType",
                                locale.equalsIgnoreCase("zh_CN") ? "机器类型" : "Machine Type")+": §e"+value+"§r");
                        } else if (select.startsWith("super.") && autodetect(name)) {
                            warn(node, "inherited vanilla/mod content");
                        } else if (sink && !args.isEmpty()) {
                            if (dynamic) warn(node, "runtime branch/loop");
                            else if (name.equals("addAll") && args.get(0) instanceof MethodInvocationTree group
                                && Set.of("of", "asList").contains(callName(group))) {
                                for (var arg : group.getArguments()) append(arg);
                            } else if (name.equals("set") || args.size() > 1 && name.equals("add")) {
                                warn(node, "indexed insertion or replacement");
                            } else {
                                for (var arg : args) append(arg);
                            }
                        }
                        return null;
                    }
                    @Override public Void visitReturn(ReturnTree node, Void unused) {
                        if (!"getInfoData".equals(method)) return super.visitReturn(node, unused);
                        if (!dynamic && node.getExpression() instanceof NewArrayTree data && data.getInitializers() != null) {
                            data.getInitializers().forEach(this::append);
                        } else warn(node, "scanner result depends on runtime input or inherited content");
                        return null;
                    }
                    @Override public Void visitAssignment(AssignmentTree node, Void unused) {
                        if ("getInfoData".equals(method) && node.getVariable() instanceof ArrayAccessTree) {
                            if (dynamic) warn(node, "scanner row is assigned in a runtime branch/loop");
                            else append(node.getExpression());
                        }
                        return super.visitAssignment(node, unused);
                    }
                    private void append(ExpressionTree expression) {
                        if (expression instanceof NewArrayTree array && array.getInitializers() != null) {
                            array.getInitializers().forEach(this::append);
                            return;
                        }
                        String value = evaluate(expression);
                        if (value == null) warn(expression, "cannot resolve expression or language key");
                        else lines.add(value);
                    }
                    private long line(Tree node) {
                        long start = positions.getStartPosition(unit, node);
                        return start < 0 || start >= sourceSize ? 0 : unit.getLineMap().getLineNumber(start);
                    }
                    private void warn(Tree tree, String reason) {
                        String expr = tree.toString().replaceAll("\\s+", " ");
                        if (expr.length() > 180) expr = expr.substring(0, 180) + "…";
                        issues.add(file.getFileName() + ":" + line(tree) + " " + method + " [" + reason + "] " + expr);
                    }
                }.scan(unit, null);
            }
            diagnostics.getDiagnostics().stream().filter(d -> d.getKind() == Diagnostic.Kind.ERROR).forEach(d ->
                issues.add(file.getFileName() + ":" + d.getLineNumber() + " [parse error] " + d.getMessage(Locale.ROOT)));
        }
        if (methods.isEmpty()) issues.add("Requested method was not found. Select the actual Java method.");
    }

    private static boolean autodetect(String name) {
        return Set.of("createTooltip", "addInformation", "getWailaHead", "getWailaBody", "getWailaTail",
            "handleTooltip", "handleItemTooltip", "addToolTip", "getInfoData", "getExtraInfoData",
            "getAdditionalToolTips", "buildTooltip").contains(name);
    }
    private static boolean isTooltipReceiver(String select) {
        int dot = select.lastIndexOf('.');
        String receiver = dot < 0 ? "" : select.substring(0, dot).toLowerCase(Locale.ROOT);
        return receiver.matches(".*(?:tooltip|currenttip)") || receiver.matches("list|alist|tips|lines|textlines|ret|t");
    }
    private static String callName(MethodInvocationTree call) {
        return call.getMethodSelect() instanceof MemberSelectTree member
            ? member.getIdentifier().toString() : call.getMethodSelect().toString();
    }

    private String importedConstant(String name) {
        if (sourceRoot==null || resolving.size()>=12 || !resolving.add(name)) return null;
        try {
            int point=name.indexOf('.');
            String head=point<0 ? name : name.substring(0,point);
            String full=imports.get(head);
            if (full==null) return null;
            if (point>=0) full+=name.substring(point);
            for (int dot=full.lastIndexOf('.'); dot>0; dot=full.lastIndexOf('.',dot-1)) {
                String type=full.substring(0,dot);
                Path source=sourceRoot.resolve(type.replace('.','/')+".java");
                if (!Files.isRegularFile(source)) continue;
                String field=full.substring(type.lastIndexOf('.')+1);
                Map<String,ExpressionTree> values=importedFields.get(source);
                if (values==null) {
                    values=readImportedFields(source);
                    importedFields.put(source,values);
                }
                return evaluate(values.get(field));
            }
            return null;
        } catch (IOException e) {
            return null;
        } finally {
            resolving.remove(name);
        }
    }

    private static Map<String,ExpressionTree> readImportedFields(Path source) throws IOException {
        Map<String,ExpressionTree> fields=new HashMap<>();
        if (Files.size(source)>4 * 1024 * 1024) return fields;
        JavaCompiler compiler=ToolProvider.getSystemJavaCompiler();
        DiagnosticCollector<JavaFileObject> diagnostics=new DiagnosticCollector<>();
        try (StandardJavaFileManager fm=compiler.getStandardFileManager(diagnostics,Locale.ROOT,StandardCharsets.UTF_8)) {
            JavacTask task=(JavacTask) compiler.getTask(null,fm,diagnostics,List.of("-proc:none"),null,
                fm.getJavaFileObjectsFromPaths(List.of(source)));
            for (CompilationUnitTree unit : task.parse()) {
                new TreeScanner<Void,String>() {
                    @Override public Void visitClass(ClassTree node,String parent) {
                        return super.visitClass(node,parent+node.getSimpleName()+".");
                    }
                    @Override public Void visitVariable(VariableTree node,String parent) {
                        var modifiers=node.getModifiers().getFlags();
                        if (modifiers.contains(javax.lang.model.element.Modifier.STATIC)
                            && modifiers.contains(javax.lang.model.element.Modifier.FINAL) && node.getInitializer()!=null) {
                            fields.put(parent+node.getName(),node.getInitializer());
                        }
                        return null;
                    }
                    @Override public Void visitMethod(MethodTree node,String parent) { return null; }
                }.scan(unit,"");
            }
        }
        return fields;
    }

    private Boolean condition(ExpressionTree expression) {
        if (expression instanceof ParenthesizedTree p) return condition(p.getExpression());
        if (expression instanceof LiteralTree t && t.getValue() instanceof Boolean b) return b;
        if (expression instanceof UnaryTree u && u.getKind() == Tree.Kind.LOGICAL_COMPLEMENT) {
            Boolean b = condition(u.getExpression());
            return b == null ? null : !b;
        }
        String s = expression.toString().toLowerCase(Locale.ROOT).replaceAll("\\s+", "");
        if (s.matches(".*(?:isshiftkeydown|hasshiftdown)\\(\\)")) return flags.get("shift");
        if (s.matches(".*(?:isctrlkeydown|hascontroldown)\\(\\)")) return flags.get("ctrl");
        if (s.matches(".*(?:isaltkeydown|hasaltdown)\\(\\)")) return flags.get("alt");
        if (s.matches("advanced|advancedtooltips|f3_h")) return flags.get("advanced");
        return null;
    }

    String evaluate(ExpressionTree t) {
        if (t instanceof LiteralTree literal && literal.getValue() != null) return literal.getValue().toString();
        if (t instanceof ParenthesizedTree p) return evaluate(p.getExpression());
        if (t instanceof ConditionalExpressionTree branch) {
            Boolean decision = condition(branch.getCondition());
            return decision == null ? null : evaluate(decision ? branch.getTrueExpression() : branch.getFalseExpression());
        }
        if (t instanceof BinaryTree b && b.getKind() == Tree.Kind.PLUS) {
            String left = evaluate(b.getLeftOperand()), right = evaluate(b.getRightOperand());
            return left == null || right == null ? null : left + right;
        }
        if (t instanceof MemberSelectTree member && member.getExpression().toString().endsWith("EnumChatFormatting")) {
            int i = COLORS.indexOf(member.getIdentifier().toString());
            return i < 0 ? null : "§" + "0123456789abcdefklmnor".charAt(i);
        }
        if (t instanceof IdentifierTree id) {
            String name=id.getName().toString();
            return constants.containsKey(name) ? constants.get(name) : importedConstant(name);
        }
        if (t instanceof MemberSelectTree field) return importedConstant(field.toString());
        if (!(t instanceof MethodInvocationTree call)) return null;
        String name = callName(call), select = call.getMethodSelect().toString();
        var args = call.getArguments();
        if (name.equals("toString") && args.isEmpty() && call.getMethodSelect() instanceof MemberSelectTree m) {
            return evaluate(m.getExpression());
        }
        if (args.isEmpty()) return null;
        String first = evaluate(args.get(0));
        if (first == null) return null;
        if (Set.of("str", "literal", "of", "valueOf").contains(name) && args.size() == 1) return first;
        boolean translated = Set.of("tr", "translateToLocal", "translateToLocalFormatted", "translate", "lang",
            "translatable", "localised").contains(name);
        if (translated) first = language.get(first);
        if (first == null) return null;
        if (!translated && !select.equals("String.format")) return null;
        if (args.size() == 1) return first;
        List<String> values = new ArrayList<>();
        for (int i = 1; i < args.size(); i++) {
            String value = evaluate(args.get(i));
            if (value == null) return null;
            values.add(value);
        }
        var matcher = Pattern.compile("%%|%(?:(\\d+)\\$)?(?:[\\d.]*[dfs])").matcher(first);
        StringBuilder result = new StringBuilder();
        int index = 0;
        while (matcher.find()) {
            int arg = matcher.group().equals("%%") ? -1
                : matcher.group(1) == null ? index++ : Integer.parseInt(matcher.group(1)) - 1;
            if (arg >= values.size()) return null;
            matcher.appendReplacement(result, Matcher.quoteReplacement(arg < 0 ? "%" : values.get(arg)));
        }
        return matcher.appendTail(result).toString();
    }

    static String array(List<String> strings) {
        return "[" + strings.stream().map(SourceTooltip::quote).reduce((a, b) -> a + "," + b).orElse("") + "]";
    }
    private static String quote(String value) {
        StringBuilder result = new StringBuilder("\"");
        value.chars().forEach(c -> {
            switch (c) {
                case '"' -> result.append("\\\"");
                case '\\' -> result.append("\\\\");
                default -> {
                    if (c < 32) result.append(String.format("\\u%04x", c));
                    else result.append((char) c);
                }
            }
        });
        return result.append('"').toString();
    }
}
