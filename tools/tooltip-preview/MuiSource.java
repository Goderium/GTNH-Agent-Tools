import com.sun.source.tree.ArrayAccessTree;
import com.sun.source.tree.AssignmentTree;
import com.sun.source.tree.BinaryTree;
import com.sun.source.tree.BlockTree;
import com.sun.source.tree.ClassTree;
import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.tree.CompoundAssignmentTree;
import com.sun.source.tree.ConditionalExpressionTree;
import com.sun.source.tree.ExpressionStatementTree;
import com.sun.source.tree.EnhancedForLoopTree;
import com.sun.source.tree.InstanceOfTree;
import com.sun.source.tree.BindingPatternTree;
import com.sun.source.tree.ForLoopTree;
import com.sun.source.tree.IdentifierTree;
import com.sun.source.tree.IfTree;
import com.sun.source.tree.ImportTree;
import com.sun.source.tree.LambdaExpressionTree;
import com.sun.source.tree.LiteralTree;
import com.sun.source.tree.MemberReferenceTree;
import com.sun.source.tree.MemberSelectTree;
import com.sun.source.tree.MethodInvocationTree;
import com.sun.source.tree.MethodTree;
import com.sun.source.tree.NewArrayTree;
import com.sun.source.tree.NewClassTree;
import com.sun.source.tree.ParenthesizedTree;
import com.sun.source.tree.ReturnTree;
import com.sun.source.tree.Tree;
import com.sun.source.tree.TypeCastTree;
import com.sun.source.tree.UnaryTree;
import com.sun.source.tree.VariableTree;
import com.sun.source.util.JavacTask;
import com.sun.source.util.Trees;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;
import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaFileObject;
import javax.tools.ToolProvider;

/** Read drawing expressions without compiling, loading or executing the user's classes. */
class MuiSource {
    private final CompilationUnitTree unit;
    private final Trees trees;
    MuiSource(CompilationUnitTree unit, Trees trees) { this.unit = unit; this.trees = trees; }

    static String json(Object value) {
        if (value == null || value instanceof Boolean || value instanceof Number) return String.valueOf(value);
        if (value instanceof List<?> list) return list.stream().map(MuiSource::json).collect(Collectors.joining(",", "[", "]"));
        if (value instanceof Map<?,?> map) return map.entrySet().stream()
            .map(e -> json(e.getKey()) + ":" + json(e.getValue())).collect(Collectors.joining(",", "{", "}"));
        StringBuilder s = new StringBuilder("\"");
        for (char c : value.toString().toCharArray()) {
            if (c < 32) s.append(String.format("\\u%04x", (int)c));
            else { if (c == '"' || c == '\\') s.append('\\'); s.append(c); }
        }
        return s.append('"').toString();
    }

    Object nodes(List<? extends Tree> items) { return items.stream().map(this::node).toList(); }
    Object node(Tree t) {
        if (t == null) return null;
        var positions = trees.getSourcePositions();
        long position = positions.getStartPosition(unit, t);
        if (t instanceof MethodInvocationTree call) {
            long end = positions.getEndPosition(unit, call.getMethodSelect());
            if (end > position) position = end - 1;
        }
        long line = unit.getLineMap().getLineNumber(position);
        String kind = t.getKind().name();
        List<Object> a = new ArrayList<>(List.of(kind,line));
        if (t instanceof LiteralTree n) a.add(n.getValue());
        else if (t instanceof IdentifierTree n) a.add(n.getName().toString());
        else if (t instanceof MemberSelectTree n) { a.add(node(n.getExpression())); a.add(n.getIdentifier().toString()); }
        else if (t instanceof MemberReferenceTree n) { a.add(node(n.getQualifierExpression())); a.add(n.getName().toString()); }
        else if (t instanceof NewClassTree n) { a.add(n.getIdentifier().toString().replaceAll("<.*>", "")); a.add(nodes(n.getArguments()));
            if(n.getClassBody()!=null) {
                a.add(n.getClassBody().getMembers().stream().map(m -> m instanceof MethodTree method ? method.getName().toString() : m.getKind().name()).toList());
                for(Tree member:n.getClassBody().getMembers()) if(member instanceof MethodTree method && method.getName().contentEquals("onChildChangeEnabled"))
                    a.add(List.of(method.getParameters().stream().map(p->p.getName().toString()).toList(),node(method.getBody())));
            } }
        else if (t instanceof MethodInvocationTree n) { a.add(node(n.getMethodSelect())); a.add(nodes(n.getArguments())); }
        else if (t instanceof LambdaExpressionTree n) { a.add(n.getParameters().stream().map(p->p.getName().toString()).toList()); a.add(node(n.getBody())); }
        else if (t instanceof VariableTree n) {
            a.add(n.getName().toString());
            a.add(node(n.getInitializer()));
            a.add(n.getType() == null ? "" : n.getType().toString());
        }
        else if (t instanceof BlockTree n) a.add(nodes(n.getStatements()));
        else if (t instanceof ReturnTree n) a.add(node(n.getExpression()));
        else if (t instanceof ExpressionStatementTree n) a.add(node(n.getExpression()));
        else if (t instanceof ParenthesizedTree n) a.add(node(n.getExpression()));
        else if (t instanceof TypeCastTree n) { a.add(n.getType().toString()); a.add(node(n.getExpression())); }
        else if (t instanceof BinaryTree n) { a.add(node(n.getLeftOperand())); a.add(node(n.getRightOperand())); }
        else if (t instanceof UnaryTree n) a.add(node(n.getExpression()));
        else if (t instanceof IfTree n) { a.add(node(n.getCondition())); a.add(node(n.getThenStatement())); a.add(node(n.getElseStatement())); }
        else if (t instanceof ConditionalExpressionTree n) { a.add(node(n.getCondition())); a.add(node(n.getTrueExpression())); a.add(node(n.getFalseExpression())); }
        else if (t instanceof AssignmentTree n) { a.add(node(n.getVariable())); a.add(node(n.getExpression())); }
        else if (t instanceof CompoundAssignmentTree n) { a.add(node(n.getVariable())); a.add(node(n.getExpression())); }
        else if (t instanceof ForLoopTree n) { a.add(nodes(n.getInitializer())); a.add(node(n.getCondition())); a.add(nodes(n.getUpdate())); a.add(node(n.getStatement())); }
        else if (t instanceof EnhancedForLoopTree n) { a.add(n.getVariable().getName().toString()); a.add(node(n.getExpression())); a.add(node(n.getStatement())); }
        else if (t instanceof InstanceOfTree n) { a.add(node(n.getExpression())); a.add(n.getType().toString());
            a.add(n.getPattern() instanceof BindingPatternTree p ? p.getVariable().getName().toString() : null); }
        else if (t instanceof NewArrayTree n && n.getInitializers()!=null) a.add(nodes(n.getInitializers()));
        else if (t instanceof ArrayAccessTree n) { a.add(node(n.getExpression())); a.add(node(n.getIndex())); }
        return a;
    }

    Object describe(ClassTree type) {
        var fields = new LinkedHashMap<String,Object>();
        var imports = new LinkedHashMap<String,String>();
        var wildcards = new ArrayList<String>();
        for (ImportTree imp : unit.getImports()) if (imp.isStatic() && imp.getQualifiedIdentifier() instanceof MemberSelectTree name) {
            String[] components = name.getExpression().toString().split("\\.");
            String importedOwner = components[components.length-1];
            if (name.getIdentifier().contentEquals("*")) wildcards.add(importedOwner);
            else imports.put(name.getIdentifier().toString(), importedOwner);
        }
        var methods = new LinkedHashMap<String,Object>();
        for (Tree member : type.getMembers()) {
            if (member instanceof VariableTree f) fields.put(f.getName().toString(), node(f.getInitializer()));
            if (member instanceof MethodTree m && m.getBody()!=null) {
                String key = m.getName()+"/"+m.getParameters().size();
                Object body = List.of(m.getParameters().stream().map(p->p.getName().toString()).toList(), node(m.getBody()),
                    m.getParameters().stream().map(p->p.getType().toString()).toList());
                if (methods.containsKey(key)) methods.put(key, null); else methods.put(key,body);
            }
        }
        String parent = type.getExtendsClause()==null ? "" : type.getExtendsClause().toString().replaceFirst("<.*", "");
        return Map.of("fields",fields,"methods",methods,"imports",imports,"wildcards",wildcards,"parent",parent);
    }
    void collect(ClassTree type, String name, Map<String,Object> classes) {
        if (classes.put(name,describe(type))!=null) throw new IllegalArgumentException("Ambiguous source class: "+name);
        for (Tree member : type.getMembers()) {
            if (member instanceof ClassTree nested) collect(nested,name+"."+nested.getSimpleName(),classes);
        }
    }
    public static void main(String[] args) throws Exception {
        var compiler = ToolProvider.getSystemJavaCompiler();
        var diagnostics = new DiagnosticCollector<JavaFileObject>();
        try (var fm = compiler.getStandardFileManager(diagnostics,Locale.ROOT,StandardCharsets.UTF_8)) {
            var paths = Arrays.stream(args).map(Path::of).toList();
            for (Path path : paths) if (Files.size(path)>4_000_000) throw new IllegalArgumentException("Java source exceeds 4 MB: "+path);
            var task = (JavacTask)compiler.getTask(null,fm,diagnostics,List.of("-proc:none"),null,fm.getJavaFileObjectsFromPaths(paths));
            var classes = new LinkedHashMap<String,Object>();
            for (var unit : task.parse()) {
                var source = new MuiSource(unit,Trees.instance(task));
                for (Tree declaration : unit.getTypeDecls()) if (declaration instanceof ClassTree type) {
                    String name = type.getSimpleName().toString();
                    source.collect(type,name,classes);
                }
            }
            for (var diagnostic : diagnostics.getDiagnostics()) {
                if (diagnostic.getKind()!=Diagnostic.Kind.ERROR) continue;
                String hint = "";
                if (Runtime.version().feature() < 22 && diagnostic.getCode().contains("underscore.as.identifier")) {
                    hint = "\nJava " + Runtime.version().feature() + " cannot parse unnamed lambda parameters. "
                        + "Pass --java <path to JDK 22 or newer>/bin/java (for example JDK 25).";
                }
                throw new IllegalArgumentException(diagnostic.toString() + hint);
            }
            System.out.println(json(classes));
        }
    }
}
