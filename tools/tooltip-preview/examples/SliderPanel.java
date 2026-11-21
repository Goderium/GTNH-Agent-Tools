import com.cleanroommc.modularui.api.GuiAxis;
import com.cleanroommc.modularui.drawable.Rectangle;
import com.cleanroommc.modularui.screen.ModularPanel;
import com.cleanroommc.modularui.value.DoubleValue;
import com.cleanroommc.modularui.widgets.SliderWidget;

/** Continuous color adjustment and a stepped vertical selector, using MUI2's native controls. */
public final class SliderPanel {

    public static ModularPanel create() {
        return new ModularPanel("adjustment").size(156, 72)
            .background(new Rectangle().color(0xff303538))
            .child(new SliderWidget().name("red").pos(8, 32).size(118, 8)
                .background(new Rectangle().horizontalGradient(0xff000000, 0xffff0000))
                .bounds(0, 255)
                .sliderSize(2, 8)
                .sliderTexture(new Rectangle().color(0xffffffff))
                .value(new DoubleValue(128))
                .scrollValues(1, 16, 0.25, 64))
            .child(new SliderWidget().name("mode").pos(133, 6).size(15, 60)
                .background(new Rectangle().color(0xff12181c))
                .setAxis(GuiAxis.Y)
                .bounds(0, 4)
                .stopper(1)
                .stopperSize(11, 1)
                .sliderSize(9, 8)
                .sliderTexture(new Rectangle().color(0xff69c8b4))
                .value(new DoubleValue(2))
                .usingScrollStep());
    }
}
