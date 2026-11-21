import com.cleanroommc.modularui.api.drawable.IDrawable;
import com.cleanroommc.modularui.drawable.Rectangle;
import com.cleanroommc.modularui.screen.ModularPanel;
import com.cleanroommc.modularui.widget.ParentWidget;
import com.cleanroommc.modularui.widgets.layout.Flow;

/** A small MUI2 factory with explicit visuals, usable without a mod resource pack. */
public final class SignalPanel {
    private static IDrawable indicator(int color) {
        return (ctx, x, y, w, h, theme) -> {
            new Rectangle().color(0xff182025).draw(ctx, x, y, w, h, theme);
            new Rectangle().color(color).draw(ctx, x + 1, y + 1, w - 2, h - 2, theme);
        };
    }

    public static ModularPanel create(int charge) {
        return new ModularPanel("signals").size(96, 34)
            .background(new Rectangle().color(0xff363b40))
            .child(Flow.row().pos(5, 5).size(60, 9).childPadding(3)
                .child(indicator(0xff729f4b).asWidget().size(9, 9))
                .child(indicator(0xffebc35d).asWidget().size(9, 9))
                .child(indicator(0xffa84736).asWidget().size(9, 9)))
            .child(new ParentWidget<>().name("charge").pos(5, 20).size(86, 8)
                .background(new Rectangle().color(0xff11181c))
                .child(new Rectangle().color(0xff73b04c).asWidget().pos(1, 1)
                    .size(84 * Math.min(100, Math.max(0, charge)) / 100, 6)));
    }
}
