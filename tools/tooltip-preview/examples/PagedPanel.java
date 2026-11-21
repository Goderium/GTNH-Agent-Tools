import com.cleanroommc.modularui.drawable.Rectangle;
import com.cleanroommc.modularui.screen.ModularPanel;
import com.cleanroommc.modularui.widget.ParentWidget;
import com.cleanroommc.modularui.widgets.ButtonWidget;
import com.cleanroommc.modularui.widgets.PageButton;
import com.cleanroommc.modularui.widgets.PagedWidget;
import com.cleanroommc.modularui.widgets.ToggleButton;

/** Two native MUI2 pages sharing a controller, each with an independent local switch. */
public final class PagedPanel {
    static PageButton tab(PagedWidget.Controller controller, int index, String id, int x, int color) {
        return new PageButton(index, controller).name(id).pos(x, 3).size(26, 9)
            .background(true, new Rectangle().color(color))
            .background(false, new Rectangle().color(0xff45494d));
    }

    static ParentWidget<?> page(String id, int color) {
        return new ParentWidget<>().name(id).full().background(new Rectangle().color(0xff1d2226))
            .child(new ToggleButton().name(id + "-switch").pos(7, 6).size(34, 12)
                .background(false, new Rectangle().color(0xff31373a))
                .background(true, new Rectangle().color(color)));
    }

    public static ModularPanel create() {
        PagedWidget.Controller navigation = new PagedWidget.Controller();
        return new ModularPanel("pages").size(62, 48).background(new Rectangle().color(0xff171a1c))
            .child(tab(navigation, 0, "inputs-tab", 3, 0xff68a19c))
            .child(tab(navigation, 1, "outputs-tab", 33, 0xffbc965c))
            .child(new PagedWidget<>().name("settings").pos(3, 14).size(56, 24)
                .addPage(page("inputs", 0xff68a19c))
                .addPage(page("outputs", 0xffbc965c))
                .controller(navigation).initialPage(1))
            .child(new ButtonWidget<>().name("next-page").pos(3, 40).size(56, 5)
                .background(new Rectangle().color(0xff575b5f)).disableHoverBackground()
                .onMousePressed(mouse -> { navigation.nextPage(); return true; }));
    }
}
