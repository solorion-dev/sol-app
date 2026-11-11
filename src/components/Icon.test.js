import { describe, it, expect } from "vitest";

// Icon.jsx is Sol's single icon family: every screen names an icon
// ("chat", "desk", "codex", ...) and Icon resolves the name to a
// lucide-react glyph with one shared stroke weight, currentColor
// colouring, and decorative-only a11y props. "<name>Filled" marks the
// active tab — the same glyph filled — except for the NO_FILL names,
// whose filled form would muddle, which get a heavier stroke instead.
// Icon is pure and hook-free, so calling it returns a plain React
// element whose type and props are asserted structurally — no DOM or
// testing-library needed.
import {
  BookOpen,
  Flag,
  Image as LucideImage,
  Lightbulb,
  Menu,
  MessageCircle,
  Monitor,
  Settings,
  TriangleAlert,
  Users,
} from "lucide-react";
import { Icon } from "./Icon.jsx";

describe("Icon sizing", () => {
  it("uses size 22 by default", () => {
    expect(Icon({ name: "chat" }).props.size).toBe(22);
  });

  it("passes a custom size through untouched", () => {
    expect(Icon({ name: "chat", size: 18 }).props.size).toBe(18);
    expect(Icon({ name: "chat", size: 32 }).props.size).toBe(32);
  });
});

describe("Icon plain rendering", () => {
  it("renders unfilled with the standard stroke and decorative a11y props", () => {
    const el = Icon({ name: "chat" });
    expect(el.props.strokeWidth).toBe(1.5);
    expect(el.props.fill).toBe("none");
    expect(el.props.absoluteStrokeWidth).toBe(false);
    expect(el.props["aria-hidden"]).toBe("true");
    expect(el.props.focusable).toBe("false");
  });
});

describe("Icon glyph identity", () => {
  it("maps chat to MessageCircle", () => {
    expect(Icon({ name: "chat" }).type).toBe(MessageCircle);
  });

  it("maps menu to Menu", () => {
    expect(Icon({ name: "menu" }).type).toBe(Menu);
  });

  it("maps settings to Settings", () => {
    expect(Icon({ name: "settings" }).type).toBe(Settings);
  });

  it("maps desk to Monitor", () => {
    expect(Icon({ name: "desk" }).type).toBe(Monitor);
  });

  it("maps codex to BookOpen", () => {
    expect(Icon({ name: "codex" }).type).toBe(BookOpen);
  });

  it("maps alert to TriangleAlert", () => {
    expect(Icon({ name: "alert" }).type).toBe(TriangleAlert);
  });
});

describe("Icon aliases", () => {
  it("resolves idea and ideas to Lightbulb", () => {
    expect(Icon({ name: "idea" }).type).toBe(Lightbulb);
    expect(Icon({ name: "ideas" }).type).toBe(Lightbulb);
  });

  it("resolves goal and goals to Flag", () => {
    expect(Icon({ name: "goal" }).type).toBe(Flag);
    expect(Icon({ name: "goals" }).type).toBe(Flag);
  });

  it("resolves agents and users to Users", () => {
    expect(Icon({ name: "agents" }).type).toBe(Users);
    expect(Icon({ name: "users" }).type).toBe(Users);
  });

  it("resolves photo and image to Image", () => {
    expect(Icon({ name: "photo" }).type).toBe(LucideImage);
    expect(Icon({ name: "image" }).type).toBe(LucideImage);
  });
});

describe("Icon fallback", () => {
  it("falls back to MessageCircle for an unknown name", () => {
    const el = Icon({ name: "doesnotexist" });
    expect(el.type).toBe(MessageCircle);
    expect(el.props.fill).toBe("none");
    expect(el.props.strokeWidth).toBe(1.5);
  });
});

describe("Icon filled rendering", () => {
  it("strips the Filled suffix and fills chatFilled", () => {
    const el = Icon({ name: "chatFilled" });
    expect(el.type).toBe(MessageCircle);
    expect(el.props.fill).toBe("currentColor");
    expect(el.props.strokeWidth).toBe(1.5);
    expect(el.props.absoluteStrokeWidth).toBe(false);
    expect(el.props["aria-hidden"]).toBe("true");
    expect(el.props.focusable).toBe("false");
  });

  it("keeps NO_FILL icons unfilled with a heavier stroke when Filled", () => {
    for (const name of ["agentsFilled", "usersFilled"]) {
      const el = Icon({ name });
      expect(el.type).toBe(Users);
      expect(el.props.fill).toBe("none");
      expect(el.props.strokeWidth).toBe(2.25);
    }
  });

  it("keeps the filled treatment when an unknown Filled name falls back", () => {
    const el = Icon({ name: "doesnotexistFilled" });
    expect(el.type).toBe(MessageCircle);
    expect(el.props.fill).toBe("currentColor");
    expect(el.props.strokeWidth).toBe(1.5);
  });

  it("does not apply the heavier NO_FILL stroke to plain agents or users", () => {
    for (const name of ["agents", "users"]) {
      const el = Icon({ name });
      expect(el.type).toBe(Users);
      expect(el.props.fill).toBe("none");
      expect(el.props.strokeWidth).toBe(1.5);
    }
  });
});
