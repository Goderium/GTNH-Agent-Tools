import com.sun.source.tree.ClassTree;
import com.sun.source.tree.ExpressionTree;
import com.sun.source.tree.IdentifierTree;
import com.sun.source.tree.LiteralTree;
import com.sun.source.tree.MemberReferenceTree;
import com.sun.source.tree.MethodInvocationTree;
import com.sun.source.tree.MethodTree;
import com.sun.source.tree.NewClassTree;
import com.sun.source.tree.ReturnTree;
import com.sun.source.tree.StatementTree;
import com.sun.source.tree.Tree;
import com.sun.source.tree.VariableTree;
import com.sun.source.util.JavacTask;
import com.sun.source.util.TreeScanner;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaFileObject;
import javax.tools.ToolProvider;

/** Reads supported NEI layout settings with javac's parser. It never loads the target classes. */
class SourceNeiLayout {
    public static void main(String[] args) throws Exception {
        if (args.length != 5) throw new IllegalArgumentException(
            "Usage: SourceNeiLayout.java recipeMap.java mapField frontend.java UIHelper.java BasicUIPropertiesBuilder.java");
        ClassTree map = parse(Path.of(args[0]));
        ClassTree front = parse(Path.of(args[2]));
        ClassTree helper = parse(Path.of(args[3]));
        ClassTree defaults = parse(Path.of(args[4]));
        Map<String, ExpressionTree> fields = fields(front);
        ExpressionTree declaration = require(fields(map).get(args[1]), "recipe map field " + args[1]);
        List<? extends ExpressionTree> reference = args(one(declaration, "frontend"));
        if (reference.size() != 1 || !(reference.get(0) instanceof MemberReferenceTree ref)
            || ref.getMode() != MemberReferenceTree.ReferenceMode.NEW
            || !ref.getQualifierExpression().toString().equals(front.getSimpleName().toString())) {
            throw new IllegalArgumentException("The recipe map must directly reference the selected frontend.");
        }
        int[] counts = numbers(args(one(declaration, "maxIO")), fields(map), 4, "maxIO");
        if (calls(declaration, "dontUseProgressBar").size() != 1) {
            throw new IllegalArgumentException("This layout reader supports recipe maps with an explicit disabled progress bar.");
        }
        MethodTree constructor = method(front, "<init>", 2);
        int[] size = pair(args(one(constructor, "recipeBackgroundSize")), fields, "Size");
        int[] logo = pair(args(one(constructor, "logoPos")), fields, "Pos2d");
        List<MethodInvocationTree> logoSizes = calls(constructor, "logoSize");
        ExpressionTree logoSizeExpr = logoSizes.isEmpty() ? fields(defaults).get("logoSize")
            : arg(one(constructor, "logoSize"), 0);
        int[] logoSize = pair(List.of(require(logoSizeExpr, "logo size")), fields, "Size");
        List<MethodInvocationTree> logos = calls(constructor, "logo");
        ExpressionTree logoTexture = logos.isEmpty() ? fields(defaults).get("logo") : arg(one(constructor, "logo"), 0);

        MethodTree gridMethod = method(helper, "getGridPositions", 5);
        Map<String, ExpressionTree> gridFields = new HashMap<>();
        for (StatementTree statement : gridMethod.getBody().getStatements()) {
            if (statement instanceof VariableTree variable) {
                gridFields.put(variable.getName().toString(), variable.getInitializer());
            }
        }
        int step = number(require(gridFields.get("distance"), "UIHelper grid distance"), gridFields);
        if (step < 4) throw new IllegalArgumentException("Invalid UIHelper grid distance.");
        String[] names = {"ItemInput", "ItemOutput", "FluidInput", "FluidOutput"};
        String[] roles = {"item-input", "item-output", "fluid-input", "fluid-output"};
        List<String> grids = new ArrayList<>();
        for (int i = 0; i < names.length; i++) {
            MethodTree method = method(front, "get" + names[i] + "Positions", 1);
            if (method.getBody().getStatements().size() != 1
                || !(method.getBody().getStatements().get(0) instanceof ReturnTree ret)
                || !(ret.getExpression() instanceof MethodInvocationTree call)
                || !call.getMethodSelect().toString().equals("UIHelper.getGridPositions")
                || call.getArguments().size() != 4
                || !call.getArguments().get(0).toString().equals(method.getParameters().get(0).getName().toString())) {
                throw new IllegalArgumentException("Unsupported grid implementation: " + method.getName());
            }
            int[] geometry = numbers(call.getArguments().subList(1, 4), fields, 3, names[i]);
            grids.add("{\"role\":" + quote(roles[i]) + ",\"count\":" + counts[i] + ",\"x\":" + geometry[0]
                + ",\"y\":" + geometry[1] + ",\"columns\":" + geometry[2] + "}");
        }
        List<String> decorations = new ArrayList<>();
        decorations.add(decoration("logo", logo[0], logo[1], logoSize[0], logoSize[1],
            require(logoTexture, "logo texture").toString()));
        int index = 0;
        List<MethodInvocationTree> specialTextures = calls(declaration, "addSpecialTexture");
        Collections.reverse(specialTextures);
        for (MethodInvocationTree special : specialTextures) {
            List<? extends ExpressionTree> values = args(special);
            if (values.size() != 5) throw new IllegalArgumentException("Unsupported special texture.");
            int[] box = numbers(values.subList(0, 4), fields(map), 4, "special texture");
            decorations.add(decoration("special-" + index++, box[0], box[1], box[2], box[3], values.get(4).toString()));
        }
        System.out.print("{\"map\":" + quote(args[1]) + ",\"frontend\":" + quote(front.getSimpleName().toString())
            + ",\"width\":" + size[0] + ",\"height\":" + size[1] + ",\"step\":" + step
            + ",\"grids\":[" + String.join(",", grids) + "],\"decorations\":[" + String.join(",", decorations) + "]}");
    }

    private static ClassTree parse(Path path) throws Exception {
        if (Files.size(path) > 4 * 1024 * 1024) throw new IllegalArgumentException("Java source is too large.");
        var compiler = ToolProvider.getSystemJavaCompiler();
        var diagnostics = new DiagnosticCollector<JavaFileObject>();
        try (var manager = compiler.getStandardFileManager(diagnostics, null, StandardCharsets.UTF_8)) {
            JavacTask task = (JavacTask) compiler.getTask(null, manager, diagnostics, List.of("-proc:none"), null,
                manager.getJavaFileObjects(path));
            var unit = task.parse().iterator().next();
            if (diagnostics.getDiagnostics().stream().anyMatch(d -> d.getKind() == Diagnostic.Kind.ERROR)) {
                throw new IllegalArgumentException("Unable to parse " + path + ": " + diagnostics.getDiagnostics());
            }
            return unit.getTypeDecls().stream().filter(ClassTree.class::isInstance).map(ClassTree.class::cast)
                .findFirst().orElseThrow(() -> new IllegalArgumentException("No class found: " + path));
        }
    }

    private static Map<String, ExpressionTree> fields(ClassTree type) {
        Map<String, ExpressionTree> fields = new HashMap<>();
        for (Tree member : type.getMembers()) {
            if (member instanceof VariableTree variable) fields.put(variable.getName().toString(), variable.getInitializer());
        }
        return fields;
    }

    private static MethodTree method(ClassTree type, String name, int arity) {
        return type.getMembers().stream().filter(MethodTree.class::isInstance).map(MethodTree.class::cast)
            .filter(m -> m.getName().contentEquals(name) && m.getParameters().size() == arity && m.getBody() != null)
            .findFirst().orElseThrow(() -> new IllegalArgumentException("Missing method " + name));
    }

    private static List<MethodInvocationTree> calls(Tree tree, String name) {
        List<MethodInvocationTree> found = new ArrayList<>();
        new TreeScanner<Void, Void>() {
            @Override public Void visitMethodInvocation(MethodInvocationTree call, Void unused) {
                String select = call.getMethodSelect().toString();
                if (select.equals(name) || select.endsWith("." + name)) found.add(call);
                return super.visitMethodInvocation(call, unused);
            }
        }.scan(tree, null);
        return found;
    }

    private static MethodInvocationTree one(Tree tree, String name) {
        List<MethodInvocationTree> found = calls(tree, name);
        if (found.size() != 1) throw new IllegalArgumentException("Expected exactly one " + name + " setting.");
        return found.get(0);
    }

    private static List<? extends ExpressionTree> args(MethodInvocationTree call) { return call.getArguments(); }
    private static ExpressionTree arg(MethodInvocationTree call, int i) { return args(call).get(i); }

    private static <T> T require(T value, String name) {
        if (value == null) throw new IllegalArgumentException("Missing " + name);
        return value;
    }

    private static int number(ExpressionTree expression, Map<String, ExpressionTree> constants) {
        var seen = new java.util.HashSet<String>();
        while (expression instanceof IdentifierTree id && seen.add(id.getName().toString())) {
            expression = constants.get(id.getName().toString());
        }
        if (expression instanceof LiteralTree literal && literal.getValue() instanceof Integer value) return value;
        throw new IllegalArgumentException("Expected a literal integer or a class constant: " + expression);
    }

    private static int[] numbers(List<? extends ExpressionTree> args, Map<String, ExpressionTree> fields, int count, String where) {
        if (args.size() != count) throw new IllegalArgumentException("Unexpected arguments for " + where);
        return args.stream().mapToInt(value -> number(value, fields)).toArray();
    }

    private static int[] pair(List<? extends ExpressionTree> args, Map<String, ExpressionTree> fields, String type) {
        if (args.size() != 1 || !(args.get(0) instanceof NewClassTree pair) || !pair.getIdentifier().toString().equals(type)) {
            throw new IllegalArgumentException("Expected new " + type + "(x, y)");
        }
        return numbers(pair.getArguments(), fields, 2, type);
    }

    private static String quote(String text) {
        return "\"" + text.replace("\\", "\\\\").replace("\"", "\\\"").replace("\r", "\\r").replace("\n", "\\n") + "\"";
    }

    private static String decoration(String id, int x, int y, int width, int height, String expression) {
        return "{\"id\":" + quote(id) + ",\"x\":" + x + ",\"y\":" + y + ",\"width\":" + width + ",\"height\":" + height
            + ",\"textureExpression\":" + quote(expression) + "}";
    }
}
