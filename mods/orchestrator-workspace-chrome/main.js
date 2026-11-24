import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout, nextCommand } from "herdr";

const ASSET = "mods/orchestrator-workspace-chrome";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", {
    id: "sidebar",
    px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44,
  });
}

function inboxMode() {
  const content = find(layout(), "sidebar-content");
  return content ? content.active === "inbox" : shared("layout") === "inbox";
}

function toggleInboxSurface() {
  run("layout.select", { stack: "sidebar-content", child: inboxMode() ? "sidebar-lists" : "inbox" });
}

export default class LocalWorkspaceChrome extends View {
  init(_props, cx) {
    this.sidebarWidthSynced = false;
    if (props()?.footer) return;
    cx.spawn(async () => {
      for (;;) {
        const command = await nextCommand();
        if (command === "toggle-inbox") toggleInboxSurface();
      }
    });
  }

  syncSidebarWidth(_size, _cx) {
    if (props()?.footer) return;
    // on_size_change includes the app zoom; layout.resize expects the layout's
    // unscaled px value, so always read the sidebar node rather than size.width.
    const width = find(layout(), "sidebar")?.size?.px;
    if (!Number.isFinite(width) || width <= 0) return;
    const remembered = shared("sidebar.layout-width");
    if (!this.sidebarWidthSynced) {
      this.sidebarWidthSynced = true;
      if (Number.isFinite(remembered) && Math.abs(remembered - width) > 1) {
        run("layout.resize", { id: "sidebar", px: remembered });
        return;
      }
    }
    if (remembered !== width) setShared("sidebar.layout-width", width);
  }

  button(id, icon, tooltip, action, selected = false) {
    const t = theme();
    return div()
      .id(id)
      .size(26)
      .flex_none()
      .flex()
      .items_center()
      .justify_center()
      .rounded(6)
      .tooltip(tooltip)
      .text_color(selected ? t.accent : t.muted)
      .when(selected, (el) => el.bg(t.selected))
      .hover((el) => el.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
      .on_click(action)
      .child(svg(`${ASSET}/${icon}.svg`).size(15));
  }

  render() {
    const t = theme();
    const collapsed = narrow();
    const inbox = inboxMode();

    if (props()?.footer) {
      const row = (id, icon, label, dim, action) =>
        h_flex()
          .id(id)
          .h(28)
          .px(8)
          .gap(9)
          .items_center()
          .rounded(8)
          .when(collapsed, (el) => el.relative().w(32).px(0).justify_center().tooltip(label))
          .text_color(dim ? t.dim : t.muted)
          .hover((el) => el.bg(t.hover).text_color(t.foreground))
          .cursor_pointer()
          .on_click(action)
          .child(svg(`${ASSET}/${icon}.svg`).size(14))
          .when(!collapsed, (el) => el.child(label));
      const ready = div().size(6).rounded_full().bg(t.accent);
      return v_flex()
        .size_full()
        .bg(t.chrome)
        .border_t(1)
        .border_color(t.border)
        .px(8)
        .pt(4)
        .pb(8)
        .text_size(13)
        .when(collapsed, (el) => el.px(0).items_center())
        .child(
          row("settings", "settings", "Settings", false, () => run("app.settings")).when(
            Boolean(updates().app.ready),
            (el) => el.child(collapsed ? ready.absolute().top(5).right(6) : ready),
          ),
        )
        .child(row("machine", "plus", "Add machine", true, () => run("mod.open", { name: "machine-add" })));
    }

    return h_flex()
      .size_full()
      .bg(t.chrome)
      .on_size_change((size, cx) => this.syncSidebarWidth(size, cx))
      .pl(collapsed ? 6 : 14)
      .pr(10)
      .gap(4)
      .items_center()
      .text_size(13.5)
      .when(window()?.platform === "macos" && !window()?.fullscreen && !collapsed, (el) => el.pl(76))
      .when(
        !collapsed,
        (el) =>
          el.child(
            h_flex()
              .flex_1()
              .gap(8)
              .items_center()
              .child(image("frame/welcome/herdr.png").size(20).rounded(5))
              .child(div().font_semibold().text_color(t.foreground).child("Herdr")),
          ),
      )
      .when(!collapsed, (el) =>
        el.child(
          this.button(
            "inbox-surface-toggle",
            "archive",
            inbox ? "Open Agents · ⇧⌘I" : "Open Inbox · ⇧⌘I",
            toggleInboxSurface,
            inbox,
          ),
        ),
      )
      .when(!collapsed, (el) =>
        el.child(this.button("search", "search", "Search", () => run("mod.open", { name: "picker" }))),
      )
      .when(!(collapsed && window()?.platform === "macos"), (el) =>
        el.child(this.button("sidebar-toggle", "sidebar", collapsed ? "Expand sidebar" : "Collapse sidebar", toggleSidebar)),
      );
  }
}
